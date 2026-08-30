#!/usr/bin/env node
/**
 * Mainline-orchestration probe.
 *
 * The Boss used to be a pure orchestrator: `bossReadOnly` withheld bash/edit/write, the
 * philosophy told it never to work the floor, and every change of substance crossed a
 * summary boundary into a worker. It now owns and implements the mainline and delegates the
 * sidecars. This script asks whether that actually happened in practice, and whether it
 * broke the thing the old design was good at.
 *
 * It is READ-ONLY forensics over artifacts the runtime already writes. Nothing here
 * instruments the agent, so running it can never perturb the behaviour it measures — which
 * matters, because the change under test is itself about behaviour.
 *
 *   node scripts/mainline-probe.mjs                  # before/after around the cutover commit
 *   node scripts/mainline-probe.mjs --json           # machine-readable
 *   node scripts/mainline-probe.mjs --since <iso>    # override the cutover
 *
 * Sources, all under <project>/.pi:
 *   agent/sessions/*.jsonl     Boss transcripts — the tool calls the Boss itself made
 *   agent-sessions/*.jsonl     worker transcripts — one per dispatched agentId
 *   plans/*.json               published plans and their task states
 *   boss/ledger-*.md           the judgement half of the Boss ledger
 *
 * What the numbers can and cannot say is annotated at each section in the report. The short
 * version: tool-call counts are facts, and everything about *quality* is a hint that tells
 * you which session to go read.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PROJECT = flag("project", "/Users/haoli/leehow/code/pipiui");
/** The mainline commit. Sessions on either side of it are two different systems. */
const CUTOVER = new Date(flag("since", "2026-08-30T07:36:38-04:00"));
const BASELINE_DAYS = Number(flag("baseline-days", 7));
const BASELINE_FROM = new Date(CUTOVER.getTime() - BASELINE_DAYS * 864e5);
const AS_JSON = args.includes("--json");

const PI = join(PROJECT, ".pi");
const num = (n) => (Number.isFinite(n) ? n : 0);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function readLines(file) {
	try {
		return readFileSync(file, "utf8").split("\n").filter(Boolean);
	} catch {
		return [];
	}
}
function parseJsonl(file) {
	const out = [];
	for (const line of readLines(file)) {
		try { out.push(JSON.parse(line)); } catch { /* a partial trailing write is not an error */ }
	}
	return out;
}
function listFiles(dir, ext = ".jsonl") {
	try {
		return readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f));
	} catch {
		return [];
	}
}

/** Tool families, named after the question each one answers about the new design. */
const FAMILY = {
	// Exactly the set `bossReadOnly` used to withhold. `terminal` is deliberately NOT here:
	// it was always available, so counting it would make "did the change take" ambiguous —
	// the pre-change baseline shows 88 terminal calls and zero edit/write/bash.
	implement: ["edit", "write", "bash"],
	terminal: ["terminal"],
	dispatch: ["subagent", "subagent_chain"],
	supervise: ["subagent_status", "subagent_abort", "subagent_resolve", "subagent_watch", "subagent_progress"],
	// Split on purpose. The first version of this probe lumped these together as one `read`
	// family, and that is exactly what hid the regression it was supposed to catch: a Boss
	// running 81 greps while touching the retrieval index once scored the same as one using
	// the index properly. Locating and reading are different work; measure them apart.
	grep: ["grep", "find", "ls"],
	retrieval: ["code_search", "code_nav", "repo_map", "read_spans"],
	read: ["read", "git"],
	track: ["plan_publish", "plan_task_update", "plan_approve", "plan_cancel", "plan_check"],
	record: ["ledger_note", "context_doc"],
};

/** One Boss transcript reduced to the counts this change is about. */
function readBossSession(file) {
	const entries = parseJsonl(file);
	const header = entries.find((e) => e.type === "session");
	if (!header) return null;
	const tools = new Map();
	let assistantTurns = 0;
	let compactions = 0;
	/** Boss tool calls between consecutive plan_task_update calls — the drift proxy. */
	const trackingGaps = [];
	const dispatched = [];
	const briefs = [];
	let sinceTrack = 0;
	let sawTrack = false;

	for (const e of entries) {
		if (e.type === "compaction") compactions += 1;
		const m = e.message;
		if (!m || typeof m !== "object") continue;
		if (m.role === "assistant") assistantTurns += 1;
		if (!Array.isArray(m.content)) continue;
		for (const block of m.content) {
			if (!block || typeof block !== "object") continue;
			if (!["toolCall", "tool_use", "toolUse"].includes(block.type)) continue;
			const name = block.name ?? block.toolName;
			if (!name) continue;
			tools.set(name, (tools.get(name) ?? 0) + 1);
			// The transcript stores the arguments the Boss actually sent, so agent mix, wave
			// width, fork requests and real brief text all come from here rather than from a
			// telemetry stream a test harness can write to.
			if (name === "subagent" || name === "subagent_chain") {
				const a = block.arguments ?? block.input ?? {};
				const items = Array.isArray(a.tasks) && a.tasks.length
					? a.tasks
					: Array.isArray(a.chain) && a.chain.length
						? a.chain
						: [a];
				dispatched.push({ width: items.length });
				for (const it of items) {
					briefs.push({
						agent: it.subagent_type ?? it.agent ?? "general-purpose",
						fork: it.fork === true || a.fork === true,
						text: String(it.prompt ?? it.task ?? ""),
					});
				}
			}
			if (name === "plan_task_update") {
				if (sawTrack) trackingGaps.push(sinceTrack);
				sawTrack = true;
				sinceTrack = 0;
			} else {
				sinceTrack += 1;
			}
		}
	}
	const family = {};
	for (const [key, names] of Object.entries(FAMILY)) {
		family[key] = names.reduce((sum, n) => sum + num(tools.get(n)), 0);
	}
	return {
		file,
		started: header.timestamp ? new Date(header.timestamp) : new Date(statSync(file).mtime),
		cwd: header.cwd ?? null,
		assistantTurns,
		compactions,
		family,
		tools: Object.fromEntries(tools),
		maxTrackingGap: trackingGaps.length ? Math.max(...trackingGaps) : null,
		dispatched,
		briefs,
	};
}

/** A worker transcript: was it forked, and did its brief carry file:line anchors? */
const ANCHOR = /[\w./-]+\.(?:ts|tsx|js|jsx|mjs|md|json|rs|py|swift|css):\d+/;
function readWorkerSession(file) {
	const entries = parseJsonl(file);
	const header = entries.find((e) => e.type === "session");
	if (!header) return null;
	const firstUser = entries.find((e) => e.message?.role === "user");
	const brief = (() => {
		const c = firstUser?.message?.content;
		if (typeof c === "string") return c;
		if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("\n");
		return "";
	})();
	return {
		agentId: header.id ?? null,
		started: header.timestamp ? new Date(header.timestamp) : new Date(statSync(file).mtime),
		forked: Boolean(header.parentSession),
		briefChars: brief.length,
		briefHasAnchor: ANCHOR.test(brief),
	};
}

function windowOf(items, from, to) {
	return items.filter((i) => i && i.started >= from && i.started < to);
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

const bossSessions = listFiles(join(PI, "agent", "sessions")).map(readBossSession).filter(Boolean);
const workerSessions = listFiles(join(PI, "agent-sessions")).map(readWorkerSession).filter(Boolean);
/*
 * `agent/subagent-stats.jsonl` is deliberately NOT read. Its emitter writes to
 * `PI_CODING_AGENT_DIR/.pi/agent`, so any process that inherits that variable appends to the
 * project's stream — including test suites. Measured 2026-08-30: real dispatches ran 5-35 per
 * hour with 700-1200 char briefs, then two hours of test runs added 1059 records whose briefs
 * were 27 chars. Dispatch facts come from the Boss transcripts instead, which no harness writes.
 */

const plans = listFiles(join(PI, "plans"), ".json").map((f) => {
	try {
		const p = JSON.parse(readFileSync(f, "utf8"));
		return { id: p.id ?? null, tasks: Array.isArray(p.tasks) ? p.tasks.length : 0, started: new Date(statSync(f).mtime) };
	} catch {
		return null;
	}
}).filter(Boolean);

function summarize(label, from, to) {
	const boss = windowOf(bossSessions, from, to);
	const workers = windowOf(workerSessions, from, to);
	// A session under three assistant turns is a false start or a one-line question; including
	// them would let "how often did the user open a window" move every ratio below.
	const active = boss.filter((s) => s.assistantTurns >= 3);

	const sum = (key) => active.reduce((n, s) => n + s.family[key], 0);
	const briefs = active.flatMap((s) => s.briefs);
	const waves = active.flatMap((s) => s.dispatched);
	const agentMix = {};
	for (const b of briefs) agentMix[b.agent] = (agentMix[b.agent] ?? 0) + 1;

	return {
		label,
		from: from.toISOString(),
		to: to.toISOString(),
		bossSessions: active.length,
		bossTurns: active.reduce((n, s) => n + s.assistantTurns, 0),
		implement: sum("implement"),
		terminal: sum("terminal"),
		dispatch: sum("dispatch"),
		supervise: sum("supervise"),
		grep: sum("grep"),
		retrieval: sum("retrieval"),
		read: sum("read"),
		exploreDispatched: 0,
		track: sum("track"),
		record: sum("record"),
		sessionsThatImplemented: active.filter((s) => s.family.implement > 0).length,
		sessionsThatDispatched: active.filter((s) => s.family.dispatch > 0).length,
		sessionsThatDidBoth: active.filter((s) => s.family.implement > 0 && s.family.dispatch > 0).length,
		sessionsWithPlanTracking: active.filter((s) => s.tools.plan_task_update).length,
		worstTrackingGap: Math.max(0, ...active.map((s) => s.maxTrackingGap ?? 0)),
		plansPublished: windowOf(plans, from, to).length,
		dispatchedTasks: briefs.length,
		medianWaveWidth: median(waves.map((w) => w.width)),
		medianBriefChars: median(briefs.map((b) => b.text.length)),
		briefsWithAnchor: briefs.filter((b) => ANCHOR.test(b.text)).length,
		agentMix,
		forkRequested: briefs.filter((b) => b.fork).length,
		exploreShare: briefs.length ? briefs.filter((b) => b.agent === "explore").length / briefs.length : 0,
		workersStarted: workers.length,
		workersForked: workers.filter((w) => w.forked).length,
	};
}

const before = summarize("改造前基线", BASELINE_FROM, CUTOVER);
const after = summarize("改造后", CUTOVER, new Date(Date.now() + 864e5));

if (AS_JSON) {
	console.log(JSON.stringify({ project: PROJECT, cutover: CUTOVER.toISOString(), before, after }, null, 2));
	process.exit(0);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const row = (name, a, b, note = "") =>
	console.log(`  ${name.padEnd(26)} ${String(a).padStart(9)} ${String(b).padStart(9)}   ${note}`);

console.log(`\nMainline probe — ${PROJECT}`);
console.log(`cutover ${CUTOVER.toISOString()}  (baseline = ${BASELINE_DAYS}d before)\n`);
console.log(`  ${"".padEnd(26)} ${"改造前".padStart(7)} ${"改造后".padStart(7)}`);

console.log("\n— 改动是否生效 —  Boss 自己动手的次数。旧设计下工具被扣留，这里结构性为 0。");
row("Boss 会话数(≥3轮)", before.bossSessions, after.bossSessions);
row("Boss 自己实现(次)", before.implement, after.implement, before.implement === 0 && after.implement > 0 ? "← 生效" : "");
row("(参考) terminal 调用", before.terminal, after.terminal, "一直可用，非本次改动");
row("有实现动作的会话", before.sessionsThatImplemented, after.sessionsThatImplemented);

console.log("\n— 派工是否还活着 —  失败模式：Boss 拿回工具后什么都自己干，fan-out 死掉。");
row("派发调用(次)", before.dispatch, after.dispatch);
row("派出的任务(个)", before.dispatchedTasks, after.dispatchedTasks);
row("有派工的会话", before.sessionsThatDispatched, after.sessionsThatDispatched);
row("既实现又派工的会话", before.sessionsThatDidBoth, after.sessionsThatDidBoth, "← 主线/侧枝分工的正面信号");
row("wave 宽度中位数", before.medianWaveWidth, after.medianWaveWidth);
console.log(`    agent 组成  前: ${JSON.stringify(before.agentMix)}`);
console.log(`                后: ${JSON.stringify(after.agentMix)}`);

console.log("\n— 检索行为 —  Boss 自己找代码 vs 用索引 vs 派 explore。这一节是 2026-08-30 回归的看门狗。");
// Raw totals across windows with very different session counts invite a wrong reading, so
// the search metrics are normalised per Boss session and the ratio is stated outright.
const per = (w, key) => (w.bossSessions ? (w[key] / w.bossSessions).toFixed(1) : "—");
const indexShare = (w) => (w.grep + w.retrieval ? `${Math.round((w.retrieval / (w.grep + w.retrieval)) * 100)}%` : "—");
row("grep/find/ls 每会话", per(before, "grep"), per(after, "grep"), "自己硬找，越高越可疑");
row("检索索引 每会话", per(before, "retrieval"), per(after, "retrieval"), "code_search/code_nav/repo_map/read_spans");
row("索引占检索比", indexShare(before), indexShare(after), "越低=越在用 grep 硬扫");
row("read/git 每会话", per(before, "read"), per(after, "read"), "读已定位的东西，属主线");
row("explore 占派发比", `${Math.round(before.exploreShare * 100)}%`, `${Math.round(after.exploreShare * 100)}%`);

console.log("\n— 主线纪律 —  计划是否被记下并持续更新。gap = 两次 plan_task_update 之间的 Boss 工具调用数。");
row("发布的计划", before.plansPublished, after.plansPublished);
row("plan_* 调用", before.track, after.track);
row("有跟踪的会话", before.sessionsWithPlanTracking, after.sessionsWithPlanTracking);
row("最差跟踪间隔", before.worstTrackingGap, after.worstTrackingGap, "越小越好；很大=停止跟踪");
row("ledger/context 记录", before.record, after.record);

console.log("\n— fork —  worker 会话头里的 parentSession 是无歧义证据。");
row("请求 fork 的任务", before.forkRequested, after.forkRequested);
row("实际 fork 的 worker", before.workersForked, after.workersForked);
row("启动的 worker", before.workersStarted, after.workersStarted);

console.log("\n— brief 质量 —  提示而非结论：带 file:line 锚点的 brief 比例。");
row("带锚点的 brief", before.briefsWithAnchor, after.briefsWithAnchor,
	`${pct(before.briefsWithAnchor, before.dispatchedTasks)} → ${pct(after.briefsWithAnchor, after.dispatchedTasks)}`);
row("brief 长度中位数", before.medianBriefChars, after.medianBriefChars);

console.log("\n读法：上面的调用计数是事实；brief 锚点和跟踪间隔是启发式，用来挑出该人工去读的会话，");
console.log("不要当成质量判决。样本少于 3 个 Boss 会话时任何比较都不作数。\n");
