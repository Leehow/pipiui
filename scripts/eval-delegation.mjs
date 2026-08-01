#!/usr/bin/env node
/**
 * Delegation / decomposition evaluation for the real PipiUI boss stack.
 *
 * Zero runtime dependencies. The automatic runner launches pi JSON mode with
 * the project-owned philosophy and patched subagent extension; it never
 * replaces the subagent tool with a mock.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.join(SCRIPT_DIR, "delegation-eval-corpus.json");
const DEFAULT_MODEL = "kimi-coding/k3";
const DEFAULT_TIMEOUT_MS = 120_000;
// Capture mode stops before a subagent executor can make worker model calls.
// Four parent turns across nine cases cap nominal boss-model turns at 36.
const DEFAULT_MAX_ASSISTANT_TURNS = 4;
const REDACTED = "[redacted]";

function usage() {
  console.log(`Usage:
  node scripts/eval-delegation.mjs --list
  node scripts/eval-delegation.mjs --self-test
  node scripts/eval-delegation.mjs --packet-dir <directory> [--case <id>]
  node scripts/eval-delegation.mjs --score <transcript.json|jsonl|directory> [--case <id>] [--report <file>]
  node scripts/eval-delegation.mjs --run [--model provider/model] [--case <id>] [--out <directory>] [--report <file>]

Automatic mode uses real pi JSON mode, Sources/PipiUI/PiPhilosophy/philosophy.ts,
and Sources/PipiUI/PiExt/subagent/index.ts. It defaults to capture-dispatch-only:
it records the streamed completed subagent tool-call event, then terminates pi before the tool executor starts workers.
Use --full only in the disposable git-worktree sandbox when worker execution is desired.

Options:
  --list                         List corpus cases and executable scoring dimensions; no API request.
  --self-test                    Score bundled positive/negative fixture transcripts.
  --packet-dir <dir>             Create a semi-manual reproduction packet; no API request.
  --score, --transcript <path>   Score a raw pi JSONL stream, normalized JSON transcript, or directory.
  --run                          Run selected corpus cases through the real headless boss stack.
  --full                         Let real dispatched workers run (capture-only is the default).
  --model <provider/model>       Boss model (default: ${DEFAULT_MODEL}).
  --thinking <level>             Optional pi thinking level.
  --case <id>                    Select one case; repeatable.
  --out <dir>                    Directory for automatic transcripts and scores.
  --report <file>                Write the Markdown report to this exact path.
  --report-note <text>           Add a scope/provenance note to the generated report.
  --workspace <dir>              Use an existing workspace instead of a temporary git worktree.
  --keep-workspace               Keep the temporary git worktree after --run.
  --timeout-ms <n>               Per-case process timeout (default: ${DEFAULT_TIMEOUT_MS}).
  --max-assistant-turns <n>      Capture-mode parent turn cap (default: ${DEFAULT_MAX_ASSISTANT_TURNS}).
  --reference-parallel-rate <n>  Optional naked/reference rate in [0,1] for a comparison delta.
  --llm-judge [auto|kimi|deepseek]
                                Optional boundary-clarity judge. Reads only KIMI_API_KEY or
                                DEEPSEEK_API_KEY from the environment and never prints either.
  --judge-base-url <url>         Override the optional judge OpenAI-compatible base URL.
  --judge-model <name>           Override the optional judge model.
  --strict                       Treat optional LLM-judge failures as command failures.
  --help, -h                     Show this help.
`);
}

function parseNumber(value, flag, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${flag} must be ${integer ? "an integer" : "a number"} in [${min}, ${max}]`);
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const options = {
    list: false,
    selfTest: false,
    run: false,
    full: false,
    packetDir: null,
    scorePaths: [],
    caseIds: [],
    model: DEFAULT_MODEL,
    thinking: null,
    outDir: null,
    reportPath: null,
    reportNote: null,
    workspace: null,
    keepWorkspace: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxAssistantTurns: DEFAULT_MAX_ASSISTANT_TURNS,
    referenceParallelRate: null,
    llmJudge: null,
    judgeBaseUrl: null,
    judgeModel: null,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--list": options.list = true; break;
      case "--self-test": options.selfTest = true; break;
      case "--run": options.run = true; break;
      case "--full": options.full = true; break;
      case "--packet-dir": options.packetDir = requireValue(argv, i, arg); i += 1; break;
      case "--score":
      case "--transcript": options.scorePaths.push(requireValue(argv, i, arg)); i += 1; break;
      case "--case": options.caseIds.push(requireValue(argv, i, arg)); i += 1; break;
      case "--model": options.model = requireValue(argv, i, arg); i += 1; break;
      case "--thinking": options.thinking = requireValue(argv, i, arg); i += 1; break;
      case "--out": options.outDir = requireValue(argv, i, arg); i += 1; break;
      case "--report": options.reportPath = requireValue(argv, i, arg); i += 1; break;
      case "--report-note": options.reportNote = requireValue(argv, i, arg); i += 1; break;
      case "--workspace": options.workspace = requireValue(argv, i, arg); i += 1; break;
      case "--keep-workspace": options.keepWorkspace = true; break;
      case "--timeout-ms": options.timeoutMs = parseNumber(requireValue(argv, i, arg), arg, { min: 1, integer: true }); i += 1; break;
      case "--max-assistant-turns": options.maxAssistantTurns = parseNumber(requireValue(argv, i, arg), arg, { min: 1, max: 100, integer: true }); i += 1; break;
      case "--reference-parallel-rate": options.referenceParallelRate = parseNumber(requireValue(argv, i, arg), arg, { min: 0, max: 1 }); i += 1; break;
      case "--llm-judge": {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          if (!["auto", "kimi", "deepseek"].includes(next)) throw new Error("--llm-judge must be auto, kimi, or deepseek");
          options.llmJudge = next;
          i += 1;
        } else {
          options.llmJudge = "auto";
        }
        break;
      }
      case "--judge-base-url": options.judgeBaseUrl = requireValue(argv, i, arg); i += 1; break;
      case "--judge-model": options.judgeModel = requireValue(argv, i, arg); i += 1; break;
      case "--strict": options.strict = true; break;
      case "--help":
      case "-h": usage(); process.exit(0); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const actionCount = Number(options.list) + Number(options.selfTest) + Number(options.run)
    + Number(Boolean(options.packetDir)) + Number(options.scorePaths.length > 0);
  if (actionCount === 0) throw new Error("Choose --list, --self-test, --packet-dir, --score, or --run");
  if (actionCount > 1) throw new Error("Choose exactly one primary action");
  if (options.full && !options.run) throw new Error("--full only applies to --run");
  if (options.keepWorkspace && !options.run) throw new Error("--keep-workspace only applies to --run");
  if (options.workspace && !options.run) throw new Error("--workspace only applies to --run");
  if (options.outDir && !options.run) throw new Error("--out only applies to --run");
  if (options.reportNote && !(options.run || options.scorePaths.length)) throw new Error("--report-note only applies to --run or --score");
  if ((options.llmJudge || options.judgeBaseUrl || options.judgeModel || options.strict) && !(options.run || options.scorePaths.length)) {
    throw new Error("LLM judge options only apply to --run or --score");
  }
  return options;
}

async function loadCorpus() {
  const corpus = JSON.parse(await readFile(CORPUS_PATH, "utf8"));
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) throw new Error("Corpus contains no cases");
  const ids = new Set();
  for (const item of corpus.cases) {
    if (!item?.id || !item?.type || !item?.prompt || !item?.expectation || !Array.isArray(item.rubric)) {
      throw new Error("Corpus case is missing id, type, prompt, expectation, or rubric");
    }
    if (ids.has(item.id)) throw new Error(`Duplicate corpus case id: ${item.id}`);
    ids.add(item.id);
  }
  return corpus;
}

function selectCases(corpus, caseIds) {
  if (caseIds.length === 0) return corpus.cases;
  const byId = new Map(corpus.cases.map((item) => [item.id, item]));
  const selected = caseIds.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown case id: ${id}`);
    return item;
  });
  return [...new Map(selected.map((item) => [item.id, item])).values()];
}

function printList(cases) {
  console.log("PipiUI delegation evaluation corpus (dry run; no API request)");
  console.log("Automatic form: pi --mode json + real philosophy + real patched subagent extension.");
  console.log("Semi-manual form: --packet-dir creates prompts/rubrics; --score consumes exported JSON/JSONL.");
  console.log("");
  for (const item of cases) {
    const e = item.expectation;
    let dimensions;
    if (item.type === "ambiguous") {
      dimensions = `clarify or one conservative probe; first-wave width <= ${e.maxFirstWaveWidth}; dispatches <= ${e.maxDispatches}`;
    } else if (item.type === "parallelizable") {
      dimensions = `first-wave width >= ${e.minFirstWaveWidth}; target coverage >= ${e.minimumTargetCoverage}/${e.parallelTargets.length}`;
    } else {
      dimensions = `ordered chain >= ${e.minimumChainSteps} steps; parallel dispatch forbidden`;
    }
    console.log(`- ${item.id} [${item.type}] — ${item.title}`);
    console.log(`  Score dimensions: ${dimensions}`);
    for (const point of item.rubric) console.log(`  • ${point}`);
  }
}

function redactText(value) {
  return String(value ?? "")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, `$1${REDACTED}`)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/g, `$1${REDACTED}`)
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9._-]{10,})\b/g, REDACTED);
}

function redactValue(value, key = "") {
  if (/(api.?key|authorization|token|secret|password|credential)/i.test(key)) return REDACTED;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]));
  }
  return value;
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  // Clarification is observable boss behavior, not private reasoning. Do not
  // award an agent merely for thinking that it should ask a question.
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

function parseToolArguments(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try { return JSON.parse(value); } catch { return { _unparsed: value.slice(0, 2_000) }; }
}

function assistantToolCalls(message) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content
    .filter((part) => part?.type === "toolCall" && typeof part.name === "string")
    .map((part) => ({
      id: typeof part.id === "string" ? part.id : null,
      name: part.name,
      arguments: parseToolArguments(part.arguments),
    }));
}

function normalizeMode(args) {
  if (Array.isArray(args?.chain) && args.chain.length > 0) return "chain";
  if (Array.isArray(args?.tasks) && args.tasks.length > 0) return "parallel";
  if (typeof args?.agent === "string" && typeof args?.task === "string") return "single";
  return "other";
}

function lanesForArguments(args, mode = normalizeMode(args)) {
  if (mode === "parallel") {
    return args.tasks.map((task) => ({
      agent: typeof task?.agent === "string" ? task.agent : "",
      title: typeof task?.title === "string" ? task.title : "",
      task: typeof task?.task === "string" ? task.task : "",
      kind: "parallel",
    }));
  }
  if (mode === "chain") {
    return args.chain.map((step) => ({
      agent: typeof step?.agent === "string" ? step.agent : "",
      title: typeof step?.title === "string" ? step.title : "",
      task: typeof step?.task === "string" ? step.task : "",
      kind: "chain",
    }));
  }
  if (mode === "single") {
    return [{
      agent: args.agent,
      title: typeof args.title === "string" ? args.title : "",
      task: args.task,
      kind: "single",
    }];
  }
  return [];
}

function messageFingerprint(message) {
  const hash = createHash("sha256");
  hash.update(String(message?.timestamp ?? ""));
  hash.update(JSON.stringify(message?.content ?? ""));
  return hash.digest("hex");
}

function extractDispatchTrace(events) {
  const assistantMessages = [];
  const seenMessages = new Set();
  const toolStarts = [];
  const streamedToolEnds = [];
  let streamedAssistantGeneration = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || typeof event !== "object") continue;
    if (event.type === "message_start" && event.message?.role === "assistant") streamedAssistantGeneration += 1;
    const message = event.type === "message_end" || event.type === "message" || event.type === "turn_end"
      ? event.message
      : null;
    if (message?.role === "assistant") {
      const fingerprint = messageFingerprint(message);
      if (!seenMessages.has(fingerprint)) {
        seenMessages.add(fingerprint);
        assistantMessages.push({ index, message });
      }
    }
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "toolcall_end") {
      const toolCall = event.assistantMessageEvent.toolCall;
      if (toolCall?.name === "subagent") {
        streamedToolEnds.push({
          index,
          generation: streamedAssistantGeneration,
          id: typeof toolCall.id === "string" ? toolCall.id : null,
          args: parseToolArguments(toolCall.arguments),
        });
      }
    }
    if (event.type === "tool_execution_start" && event.toolName === "subagent") {
      toolStarts.push({
        index,
        id: typeof event.toolCallId === "string" ? event.toolCallId : null,
        args: parseToolArguments(event.args),
      });
    }
  }

  const startsById = new Map(toolStarts.filter((item) => item.id).map((item) => [item.id, item]));
  const dispatches = [];
  const capturedIds = new Set();
  let wave = 0;

  for (const entry of assistantMessages) {
    const calls = assistantToolCalls(entry.message).filter((call) => call.name === "subagent");
    if (calls.length === 0) continue;
    wave += 1;
    for (const call of calls) {
      const start = call.id ? startsById.get(call.id) : null;
      const args = start?.args && Object.keys(start.args).length > 0 ? start.args : call.arguments;
      const mode = normalizeMode(args);
      const lanes = lanesForArguments(args, mode);
      dispatches.push({
        id: call.id ?? `message-${entry.index}-${dispatches.length}`,
        source: "assistant_message",
        eventIndex: entry.index,
        wave,
        mode,
        arguments: args,
        lanes,
        executionStarted: Boolean(start),
      });
      if (call.id) capturedIds.add(call.id);
    }
  }

  const streamWaveByGeneration = new Map();
  for (const streamed of streamedToolEnds) {
    if (streamed.id && capturedIds.has(streamed.id)) continue;
    if (!streamWaveByGeneration.has(streamed.generation)) {
      wave += 1;
      streamWaveByGeneration.set(streamed.generation, wave);
    }
    const mode = normalizeMode(streamed.args);
    dispatches.push({
      id: streamed.id ?? `streamed-tool-${streamed.index}`,
      source: "streamed_toolcall_end",
      eventIndex: streamed.index,
      wave: streamWaveByGeneration.get(streamed.generation),
      mode,
      arguments: streamed.args,
      lanes: lanesForArguments(streamed.args, mode),
      executionStarted: false,
    });
    if (streamed.id) capturedIds.add(streamed.id);
  }

  for (const start of toolStarts) {
    if (start.id && capturedIds.has(start.id)) {
      const existing = dispatches.find((dispatch) => dispatch.id === start.id);
      if (existing) existing.executionStarted = true;
      continue;
    }
    wave += 1;
    const mode = normalizeMode(start.args);
    dispatches.push({
      id: start.id ?? `tool-start-${start.index}`,
      source: "tool_execution_start",
      eventIndex: start.index,
      wave,
      mode,
      arguments: start.args,
      lanes: lanesForArguments(start.args, mode),
      executionStarted: true,
    });
  }

  dispatches.sort((a, b) => a.eventIndex - b.eventIndex || a.id.localeCompare(b.id));
  const waves = [];
  for (const dispatch of dispatches) {
    let current = waves.find((item) => item.wave === dispatch.wave);
    if (!current) {
      current = { wave: dispatch.wave, dispatches: [], lanes: [], parallelLanes: 0, hasParallel: false };
      waves.push(current);
    }
    current.dispatches.push(dispatch);
    current.lanes.push(...dispatch.lanes);
    // A chain can have many ordered steps but occupies one top-level lane.
    current.parallelLanes += dispatch.mode === "chain" ? 1 : dispatch.lanes.length;
    if ((dispatch.mode === "parallel" && dispatch.lanes.length >= 2) || dispatch.mode === "single") {
      // Updated after all sibling calls are added below.
      current.hasParallel ||= dispatch.mode === "parallel" && dispatch.lanes.length >= 2;
    }
  }
  for (const current of waves) {
    if (current.parallelLanes >= 2) current.hasParallel = true;
  }

  const assistantText = assistantMessages.map((entry) => contentToText(entry.message.content)).filter(Boolean).join("\n");
  return {
    assistantText,
    assistantMessageCount: assistantMessages.length,
    dispatches,
    waves,
    firstWave: waves[0] ?? null,
    hasDispatch: dispatches.length > 0,
  };
}

function includesOneOf(text, keywords) {
  const normalized = String(text ?? "").toLowerCase();
  return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
}

function lanesText(lanes) {
  return lanes.map((lane) => `${lane.agent} ${lane.title} ${lane.task}`).join("\n").toLowerCase();
}

function hasClarifyingText(text) {
  const normalized = String(text ?? "").toLowerCase();
  if (/[?？]/.test(normalized)) return true;
  return /\b(which|what|where|when|could you|can you|do you mean|please (?:share|provide|clarify)|need (?:a |the )?(?:repro|reproduction|log|error|details|context)|expected (?:behavior|result)|actual (?:behavior|result)|clarif(?:y|ication)|more information|failing command)\b/.test(normalized);
}

function briefQuality(lanes) {
  if (lanes.length === 0) return 0;
  const good = lanes.filter((lane) => String(lane.task ?? "").trim().length >= 24 && String(lane.title ?? "").trim().length >= 2);
  return good.length / lanes.length;
}

function check(id, passed, points, note) {
  return { id, passed: Boolean(passed), points: passed ? points : 0, maxPoints: points, note };
}

function scoreAmbiguous(item, trace) {
  const expectation = item.expectation;
  const firstWaveWidth = trace.firstWave?.parallelLanes ?? 0;
  const noFanout = trace.waves.every((wave) => !wave.hasParallel && wave.parallelLanes <= expectation.maxFirstWaveWidth);
  const smallVolume = trace.dispatches.length <= expectation.maxDispatches;
  const textClarifies = hasClarifyingText(trace.assistantText);
  const only = trace.dispatches[0];
  const firstTaskText = only ? lanesText(only.lanes) : "";
  const conservativeRole = only && only.lanes.length === 1 && expectation.conservativeRoles.includes(String(only.lanes[0].agent).toLowerCase());
  const conservativeTask = only && only.lanes.length === 1 && includesOneOf(firstTaskText, expectation.conservativeTaskKeywords);
  const conservativeProbe = Boolean(only && smallVolume && noFanout && (conservativeRole || conservativeTask));
  const correctAmbiguityHandling = textClarifies || (expectation.permitConservativeProbe && conservativeProbe);
  const checks = [
    check("no_speculative_fanout", noFanout, 45, `max observed first-wave width: ${firstWaveWidth}`),
    check("bounded_dispatch", smallVolume, 20, `observed subagent dispatches: ${trace.dispatches.length}`),
    check("clarify_or_conservative_probe", correctAmbiguityHandling, 35,
      textClarifies ? "assistant asked for missing evidence" : conservativeProbe ? "one conservative reconnaissance probe" : "no clarification or conservative probe found"),
  ];
  return {
    score: checks.reduce((sum, itemCheck) => sum + itemCheck.points, 0),
    passed: noFanout && smallVolume && correctAmbiguityHandling,
    checks,
    details: {
      firstWaveWidth,
      noFanout,
      smallVolume,
      clarificationCorrect: textClarifies,
      conservativeProbe,
      serialShapeCorrect: noFanout && smallVolume && correctAmbiguityHandling,
    },
  };
}

function scoreParallelizable(item, trace) {
  const expectation = item.expectation;
  const firstWave = trace.firstWave;
  const width = firstWave?.parallelLanes ?? 0;
  const parallelFirstWave = Boolean(firstWave && firstWave.hasParallel && width >= expectation.minFirstWaveWidth);
  const firstWaveText = lanesText(firstWave?.lanes ?? []);
  const targets = expectation.parallelTargets.map((target) => ({
    id: target.id,
    matched: includesOneOf(firstWaveText, target.keywords),
  }));
  const targetCoverage = targets.filter((target) => target.matched).length;
  const coveragePass = targetCoverage >= expectation.minimumTargetCoverage;
  const quality = briefQuality(firstWave?.lanes ?? []);
  const checks = [
    check("parallel_first_wave", parallelFirstWave, 60, `first-wave lanes: ${width}; expected at least ${expectation.minFirstWaveWidth}`),
    check("independent_target_coverage", coveragePass, 25, `covered ${targetCoverage}/${expectation.parallelTargets.length}: ${targets.filter((target) => target.matched).map((target) => target.id).join(", ") || "none"}`),
    check("standalone_briefs", quality >= 0.5, 15, `${Math.round(quality * 100)}% of first-wave lanes have a title and substantive task`),
  ];
  return {
    score: checks.reduce((sum, itemCheck) => sum + itemCheck.points, 0),
    passed: parallelFirstWave && coveragePass,
    checks,
    details: {
      firstWaveWidth: width,
      parallelFirstWave,
      targetCoverage,
      targets,
      briefQuality: quality,
    },
  };
}

function scoreDependent(item, trace) {
  const expectation = item.expectation;
  const unsafeParallel = trace.waves.some((wave) => wave.hasParallel);
  const chain = trace.dispatches.find((dispatch) => dispatch.mode === "chain" && dispatch.lanes.length >= expectation.minimumChainSteps);
  const chainText = lanesText(chain?.lanes ?? []);
  const dependencyCoverage = expectation.dependencyKeywords.filter((keyword) => chainText.includes(String(keyword).toLowerCase())).length;
  const noUnsafeFanout = !unsafeParallel;
  const serialShapeCorrect = trace.hasDispatch && noUnsafeFanout;
  const validChain = Boolean(chain);
  const checks = [
    check("initiated_dependency_work", trace.hasDispatch, 10, trace.hasDispatch ? "a subagent dispatch was observed" : "no delegated dependency work was observed"),
    check("no_parallel_dependency_violation", trace.hasDispatch && noUnsafeFanout, 30,
      unsafeParallel ? "a same-wave parallel dispatch was observed" : trace.hasDispatch ? "no same-wave parallel dispatch observed" : "cannot receive serial credit without a dispatch"),
    check("visible_dependency_chain", validChain, 40, validChain ? `chain has ${chain.lanes.length} ordered steps` : `no chain with ${expectation.minimumChainSteps} steps found`),
    check("chain_mentions_interface_consumers_tests", dependencyCoverage >= Math.min(2, expectation.dependencyKeywords.length), 20,
      `chain dependency cue coverage: ${dependencyCoverage}/${expectation.dependencyKeywords.length}`),
  ];
  return {
    score: checks.reduce((sum, itemCheck) => sum + itemCheck.points, 0),
    passed: noUnsafeFanout && validChain,
    checks,
    details: {
      unsafeParallel,
      serialShapeCorrect,
      validChain,
      chainSteps: chain?.lanes.length ?? 0,
      dependencyCoverage,
    },
  };
}

function scoreCase(item, transcript) {
  const trace = extractDispatchTrace(transcript.events ?? []);
  let grade;
  if (item.type === "ambiguous") grade = scoreAmbiguous(item, trace);
  else if (item.type === "parallelizable") grade = scoreParallelizable(item, trace);
  else if (item.type === "dependent") grade = scoreDependent(item, trace);
  else throw new Error(`Unsupported case type: ${item.type}`);

  return {
    caseId: item.id,
    title: item.title,
    type: item.type,
    score: grade.score,
    passed: grade.passed,
    checks: grade.checks,
    details: grade.details,
    trace: {
      assistantMessageCount: trace.assistantMessageCount,
      dispatchCount: trace.dispatches.length,
      firstWave: trace.firstWave ? {
        laneCount: trace.firstWave.parallelLanes,
        hasParallel: trace.firstWave.hasParallel,
        modes: trace.firstWave.dispatches.map((dispatch) => dispatch.mode),
      } : null,
      dispatches: trace.dispatches.map((dispatch) => ({
        id: dispatch.id,
        wave: dispatch.wave,
        mode: dispatch.mode,
        executionStarted: dispatch.executionStarted,
        lanes: dispatch.lanes,
      })),
      assistantText: redactText(trace.assistantText).slice(0, 6_000),
    },
    transcriptMeta: transcript.meta ?? {},
  };
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function percent(value) {
  return value === null || value === undefined ? "n/a" : `${Math.round(value * 100)}%`;
}

function aggregateScores(scores, referenceParallelRate = null) {
  const parallel = scores.filter((item) => item.type === "parallelizable");
  const ambiguous = scores.filter((item) => item.type === "ambiguous");
  const dependent = scores.filter((item) => item.type === "dependent");
  const parallelCorrect = parallel.filter((item) => item.details.parallelFirstWave).length;
  const ambiguousSerialCorrect = ambiguous.filter((item) => item.details.serialShapeCorrect).length;
  const dependentSerialCorrect = dependent.filter((item) => item.details.serialShapeCorrect).length;
  const clarificationCorrect = ambiguous.filter((item) => item.details.clarificationCorrect).length;
  const parallelRate = rate(parallelCorrect, parallel.length);
  const serialRate = rate(ambiguousSerialCorrect + dependentSerialCorrect, ambiguous.length + dependent.length);
  return {
    cases: scores.length,
    meanScore: scores.length === 0 ? null : scores.reduce((sum, item) => sum + item.score, 0) / scores.length,
    passRate: rate(scores.filter((item) => item.passed).length, scores.length),
    shouldParallelRate: parallelRate,
    shouldSerialRate: serialRate,
    clarificationCorrectRate: rate(clarificationCorrect, ambiguous.length),
    ambiguousCorrectRate: rate(ambiguous.filter((item) => item.passed).length, ambiguous.length),
    observedEnvironmentSuppressionRate: parallelRate === null ? null : 1 - parallelRate,
    referenceParallelRate,
    referenceGap: referenceParallelRate === null || parallelRate === null ? null : referenceParallelRate - parallelRate,
  };
}

function summarizeShape(score) {
  const wave = score.trace.firstWave;
  if (!wave) {
    if (score.transcriptMeta?.terminationReason === "assistant_turn_cap") return "no dispatch (turn-capped)";
    if (score.transcriptMeta?.terminationReason === "timeout") return "no dispatch (timed out)";
    return "no subagent dispatch";
  }
  return `${wave.modes.join("+")} / ${wave.laneCount} lane${wave.laneCount === 1 ? "" : "s"}${wave.hasParallel ? " / parallel" : " / serial"}`;
}

function markdownReport(scores, metadata) {
  const metrics = aggregateScores(scores, metadata.referenceParallelRate ?? null);
  const lines = [
    "# PipiUI delegation evaluation",
    "",
    `Generated: ${metadata.generatedAt ?? new Date().toISOString()}.`,
    "",
    "## Runner form",
    "",
    `- Selected form: **${metadata.runnerForm ?? "manual transcript scoring"}**.`,
    `- Reason: ${metadata.runnerReason ?? "transcripts were supplied by the operator"}`,
  ];
  if (metadata.stack) {
    lines.push(`- Stack: ${metadata.stack}.`);
  }
  if (metadata.captureMode) {
    lines.push(`- Capture: ${metadata.captureMode}.`);
  }
  if (metadata.reportNote) lines.push(`- Scope note: ${metadata.reportNote}`);
  if (metadata.artifactDir) lines.push(`- Evidence directory: \`${metadata.artifactDir}\`.`);
  lines.push(
    "",
    "## Per-case results",
    "",
    "| Case | Type | Score | Outcome | First dispatch shape |",
    "|---|---|---:|---|---|",
  );
  for (const score of scores) {
    lines.push(`| ${score.caseId} | ${score.type} | ${score.score}/100 | ${score.passed ? "pass" : "fail"} | ${summarizeShape(score)} |`);
  }

  lines.push(
    "",
    "## Aggregate",
    "",
    `- Mean score: **${metrics.meanScore === null ? "n/a" : metrics.meanScore.toFixed(1)}/100**; full-case pass rate: **${percent(metrics.passRate)}**.`,
    `- Should-parallel rate: **${percent(metrics.shouldParallelRate)}** (${scores.filter((item) => item.type === "parallelizable").length} parallelizable cases; success means the first subagent wave had the required width).`,
    `- Should-serial rate: **${percent(metrics.shouldSerialRate)}** (ambiguous cases require clarification/conservative probing without fan-out; dependent cases require an actual non-parallel dispatch shape).`,
    `- Clarification correctness rate: **${percent(metrics.clarificationCorrectRate)}** (ambiguous cases where the boss explicitly asks for missing evidence).`,
    `- Observed environment-suppression proxy: **${percent(metrics.observedEnvironmentSuppressionRate)}** (= 1 − should-parallel rate under this boss stack; this is an observed deployment loss, not causal attribution).`,
  );
  if (metrics.referenceGap !== null) {
    lines.push(`- Reference parallel-rate gap: **${Math.round(metrics.referenceGap * 100)}pp** versus supplied reference ${percent(metrics.referenceParallelRate)}.`);
  }

  lines.push("", "## Deterministic scoring detail", "");
  for (const score of scores) {
    lines.push(`### ${score.caseId} — ${score.score}/100 (${score.passed ? "pass" : "fail"})`, "");
    for (const itemCheck of score.checks) {
      lines.push(`- ${itemCheck.passed ? "✓" : "✗"} **${itemCheck.id}**: ${itemCheck.points}/${itemCheck.maxPoints}. ${itemCheck.note}`);
    }
    if (score.llmJudge) {
      lines.push(`- Optional LLM boundary clarity: ${score.llmJudge.boundaryClarity ?? "unavailable"}/5. ${score.llmJudge.reason ?? score.llmJudge.error ?? ""}`);
    }
    lines.push("");
  }

  lines.push(
    "## Method notes",
    "",
    "- A `tasks[]` call and two or more single `subagent` calls in one assistant message both count as one parallel wave.",
    "- A `chain[]` call counts as one top-level serial lane regardless of its number of steps.",
    "- Automatic capture mode loads the actual project philosophy and patched subagent sources. It does not inject a fake or mock subagent tool.",
    "- Capture mode intentionally stops at pi's streamed `toolcall_end` event for `subagent`, before the real tool executor starts delegated workers; use `--full` only when real worker execution is desired.",
    "- Optional LLM judging adds only a boundary-clarity annotation. Deterministic shape scoring remains the primary score.",
    "",
  );
  return lines.join("\n");
}

async function writeReport(reportPath, scores, metadata) {
  const absolute = path.resolve(reportPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${markdownReport(scores, metadata)}\n`, "utf8");
  return absolute;
}

async function filesUnder(inputPath) {
  const absolute = path.resolve(inputPath);
  const info = await stat(absolute);
  if (!info.isDirectory()) return [absolute];
  const output = [];
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(child));
    // Artifact directories also contain metadata and prior score outputs. They
    // are not transcripts and must not make `--score <artifact-directory>` fail.
    else if (/\.(?:json|jsonl)$/i.test(entry.name) && !["manifest.json", "scores.json"].includes(entry.name.toLowerCase())) output.push(child);
  }
  return output.sort();
}

function caseIdFromFilename(filePath, knownIds) {
  const base = path.basename(filePath).replace(/\.(?:json|jsonl)$/i, "");
  if (knownIds.has(base)) return base;
  const match = [...knownIds].find((id) => base.includes(id));
  return match ?? null;
}

function parseJsonLines(text, origin) {
  const events = [];
  for (const [offset, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    try { events.push(JSON.parse(line)); }
    catch { throw new Error(`${origin}:${offset + 1} is not valid JSONL`); }
  }
  return events;
}

function normalizedTranscriptsFromText(text, origin, fallbackCaseId) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!parsed) return [{ caseId: fallbackCaseId, events: parseJsonLines(text, origin), meta: { origin } }];

  if (Array.isArray(parsed)) return [{ caseId: fallbackCaseId, events: parsed, meta: { origin } }];
  if (Array.isArray(parsed.runs)) {
    return parsed.runs.flatMap((run, index) => {
      const events = Array.isArray(run?.events) ? run.events : [];
      return [{ caseId: run?.caseId ?? fallbackCaseId, events, meta: { origin, runIndex: index, ...(run?.meta ?? {}) } }];
    });
  }
  if (Array.isArray(parsed.events)) return [{ caseId: parsed.caseId ?? fallbackCaseId, events: parsed.events, meta: { origin, ...(parsed.meta ?? {}), runner: parsed.runner } }];
  if (Array.isArray(parsed.transcript?.events)) return [{ caseId: parsed.caseId ?? parsed.transcript.caseId ?? fallbackCaseId, events: parsed.transcript.events, meta: { origin, ...(parsed.meta ?? {}) } }];
  if (typeof parsed.type === "string") return [{ caseId: fallbackCaseId, events: [parsed], meta: { origin } }];
  throw new Error(`${origin} is JSON but not a supported transcript shape`);
}

async function loadTranscripts(paths, knownIds, forcedCaseIds) {
  const allFiles = [];
  for (const inputPath of paths) allFiles.push(...await filesUnder(inputPath));
  const transcripts = [];
  for (const filePath of [...new Set(allFiles)]) {
    const content = await readFile(filePath, "utf8");
    const fallback = forcedCaseIds.length === 1 ? forcedCaseIds[0] : caseIdFromFilename(filePath, knownIds);
    transcripts.push(...normalizedTranscriptsFromText(content, filePath, fallback));
  }
  return transcripts;
}

function scoreTranscripts(casesById, transcripts, selectedIds) {
  const allowed = selectedIds.length ? new Set(selectedIds) : null;
  const scores = [];
  for (const transcript of transcripts) {
    if (!transcript.caseId) throw new Error(`Cannot infer a corpus case id for ${transcript.meta?.origin ?? "transcript"}; name the file after a case id or pass --case <id>`);
    if (allowed && !allowed.has(transcript.caseId)) continue;
    const item = casesById.get(transcript.caseId);
    if (!item) throw new Error(`Transcript refers to unknown case id: ${transcript.caseId}`);
    scores.push(scoreCase(item, transcript));
  }
  if (scores.length === 0) throw new Error("No transcripts matched the selected cases");
  return scores;
}

function resolveJudgeConfig(options) {
  if (!options.llmJudge) return null;
  let provider = options.llmJudge;
  if (provider === "auto") provider = process.env.KIMI_API_KEY ? "kimi" : process.env.DEEPSEEK_API_KEY ? "deepseek" : null;
  if (!provider) return { unavailable: "No KIMI_API_KEY or DEEPSEEK_API_KEY is available in the environment." };
  const keyName = provider === "kimi" ? "KIMI_API_KEY" : "DEEPSEEK_API_KEY";
  const apiKey = process.env[keyName];
  if (!apiKey) return { unavailable: `${keyName} is not available in the environment.` };
  return {
    provider,
    apiKey,
    baseUrl: options.judgeBaseUrl
      ?? process.env.DELEGATION_EVAL_JUDGE_BASE_URL
      ?? (provider === "kimi" ? "https://api.moonshot.cn/v1" : "https://api.deepseek.com/v1"),
    model: options.judgeModel
      ?? process.env.DELEGATION_EVAL_JUDGE_MODEL
      ?? (provider === "kimi" ? "kimi-k2.5" : "deepseek-chat"),
  };
}

function extractJsonObject(text) {
  const trimmed = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("judge did not return a JSON object");
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function runJudge(item, score, config) {
  const trace = {
    dispatches: score.trace.dispatches,
    firstWave: score.trace.firstWave,
    deterministicChecks: score.checks.map((itemCheck) => ({ id: itemCheck.id, passed: itemCheck.passed, note: itemCheck.note })),
  };
  const prompt = [
    "You are scoring only the clarity of a boss agent's delegation boundary.",
    "Do not override deterministic shape scoring. Return compact JSON only:",
    '{"boundaryClarity":0,"reason":"..."}',
    "boundaryClarity is an integer 0..5. Give 5 only when the dispatch/clarification makes the right serial-vs-parallel boundary explicit.",
    `Case type: ${item.type}`,
    `User prompt: ${item.prompt}`,
    `Rubric: ${item.rubric.join(" ")}`,
    `Observed trace: ${JSON.stringify(trace).slice(0, 12_000)}`,
  ].join("\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`judge HTTP ${response.status}: ${redactText(body).slice(0, 300)}`);
    const json = JSON.parse(body);
    const result = extractJsonObject(json?.choices?.[0]?.message?.content);
    const clarity = Number(result.boundaryClarity);
    if (!Number.isInteger(clarity) || clarity < 0 || clarity > 5) throw new Error("judge boundaryClarity must be an integer from 0 to 5");
    return { provider: config.provider, model: config.model, boundaryClarity: clarity, reason: redactText(result.reason ?? "").slice(0, 800) };
  } finally {
    clearTimeout(timer);
  }
}

async function applyOptionalJudge(casesById, scores, options) {
  const config = resolveJudgeConfig(options);
  if (!config) return;
  if (config.unavailable) {
    for (const score of scores) score.llmJudge = { unavailable: true, error: config.unavailable };
    if (options.strict) throw new Error(config.unavailable);
    return;
  }
  for (const score of scores) {
    try {
      score.llmJudge = await runJudge(casesById.get(score.caseId), score, config);
    } catch (error) {
      score.llmJudge = { unavailable: true, error: redactText(error instanceof Error ? error.message : String(error)) };
      if (options.strict) throw error;
    }
  }
}

function gitRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Cannot locate git repository root: ${redactText(result.stderr || result.stdout)}`);
  return result.stdout.trim();
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${redactText(result.stderr || result.stdout).slice(0, 1_000)}`);
  return result.stdout.trim();
}

function createDisposableWorktree(repoRoot) {
  const workspace = path.join(os.tmpdir(), `pipiui-delegation-eval-${Date.now()}-${randomUUID().slice(0, 8)}`);
  runGit(repoRoot, ["worktree", "add", "--detach", workspace, "HEAD"]);
  return workspace;
}

function removeDisposableWorktree(repoRoot, workspace) {
  try { runGit(repoRoot, ["worktree", "remove", "--force", workspace]); }
  catch { /* Best effort; report the retained path to the operator. */ }
}

function assertRealStack(workspace) {
  const files = {
    philosophy: path.join(workspace, "Sources", "PipiUI", "PiPhilosophy", "philosophy.ts"),
    subagent: path.join(workspace, "Sources", "PipiUI", "PiExt", "subagent", "index.ts"),
    agents: path.join(workspace, "Sources", "PipiUI", "PiExt", "agents"),
  };
  for (const [name, filePath] of Object.entries(files)) {
    const result = spawnSync("test", [name === "agents" ? "-d" : "-f", filePath]);
    if (result.status !== 0) throw new Error(`Real PipiUI ${name} path is missing: ${filePath}`);
  }
  const pi = spawnSync("pi", ["--version"], { encoding: "utf8" });
  if (pi.status !== 0) throw new Error("pi executable is unavailable; use --packet-dir for the semi-manual form.");
  return files;
}

function piArguments(item, stack, options) {
  const args = [
    "--mode", "json",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    // The runner is itself launched from a dispatched evaluation worktree. Do not
    // inherit an ambient worker AGENTS.md into the measured boss; the product-owned
    // philosophy below supplies the boss behavior under test.
    "--no-context-files",
    "--approve",
    "-e", stack.philosophy,
    "-e", stack.subagent,
    "--model", options.model,
  ];
  if (options.thinking) args.push("--thinking", options.thinking);
  args.push(item.prompt);
  return args;
}

function eventContainsCompletedSubagentCall(event) {
  if (event?.type === "message_update" && event.assistantMessageEvent?.type === "toolcall_end") {
    return event.assistantMessageEvent.toolCall?.name === "subagent";
  }
  return event?.type === "message_end"
    && event.message?.role === "assistant"
    && assistantToolCalls(event.message).some((call) => call.name === "subagent");
}

async function runPiCase(item, workspace, stack, options) {
  const startedAt = new Date().toISOString();
  const args = piArguments(item, stack, options);
  const env = {
    ...process.env,
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    PIPIUI_SUBAGENT_EXT: stack.subagent,
    PIPIUI_AGENTS_DIR: stack.agents,
    PIPIUI_MAIN_CWD: workspace,
    PIPIUI_AGENT_DEPTH: "0",
    PIPIUI_AGENT_MAX_DEPTH: "2",
    PIPI_PHILOSOPHY_ROLE: "main",
  };

  return new Promise((resolve, reject) => {
    const child = spawn("pi", args, { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] });
    const events = [];
    let stdoutBuffer = "";
    let stderr = "";
    let assistantTurns = 0;
    let terminationReason = null;
    let didTimeout = false;
    let closed = false;
    let killEscalation = null;

    const terminate = (reason) => {
      if (terminationReason || closed) return;
      terminationReason = reason;
      try { child.kill("SIGTERM"); } catch { /* Process may have exited. */ }
      killEscalation = setTimeout(() => {
        if (!closed) {
          try { child.kill("SIGKILL"); } catch { /* Process may have exited. */ }
        }
      }, 3_000);
      killEscalation.unref?.();
    };

    const timeout = setTimeout(() => {
      didTimeout = true;
      terminate("timeout");
    }, options.timeoutMs);
    timeout.unref?.();

    const ingest = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event;
      try { event = JSON.parse(trimmed); }
      catch {
        // pi JSON mode should be JSONL; preserve only a redacted diagnostic in stderr.
        stderr += `[non-json stdout] ${redactText(trimmed).slice(0, 1_000)}\n`;
        return;
      }
      const safeEvent = redactValue(event);
      events.push(safeEvent);
      if (!options.full && eventContainsCompletedSubagentCall(safeEvent)) {
        // pi emits toolcall_end before tool execution. The full arguments are
        // preserved in the streamed event, so terminate synchronously before
        // the real dispatcher can enter its executor or spawn a worker.
        terminate("captured_before_subagent_execution");
      }
      if (safeEvent.type === "message_end" && safeEvent.message?.role === "assistant") {
        assistantTurns += 1;
        if (!options.full && !terminationReason && assistantTurns >= options.maxAssistantTurns) {
          terminate("assistant_turn_cap");
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      while (true) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        let line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        ingest(line);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += redactText(chunk.toString("utf8")); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (killEscalation) clearTimeout(killEscalation);
      reject(error);
    });
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timeout);
      if (killEscalation) clearTimeout(killEscalation);
      if (stdoutBuffer.trim()) ingest(stdoutBuffer);
      resolve({
        format: "pipiui-delegation-eval-transcript/v1",
        caseId: item.id,
        startedAt,
        endedAt: new Date().toISOString(),
        runner: {
          form: options.full ? "automatic-json-full" : "automatic-json-capture-dispatch-only",
          piArgs: args.map((arg, index) => (args[index - 1] === "--api-key" ? REDACTED : arg)),
          model: options.model,
          thinking: options.thinking,
        },
        meta: {
          workspace,
          intentionalCaptureStop: terminationReason === "captured_before_subagent_execution",
          terminationReason,
          timedOut: didTimeout,
          assistantTurns,
          exitCode: code,
          signal,
        },
        events,
        stderr: redactText(stderr).slice(-20_000),
      });
    });
  });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function runAutomatic(cases, options) {
  const repoRoot = gitRoot(process.cwd());
  const workspace = options.workspace ? path.resolve(options.workspace) : createDisposableWorktree(repoRoot);
  const ownsWorkspace = !options.workspace;
  const outDir = path.resolve(options.outDir ?? path.join(process.cwd(), ".pi", "delegation-eval", timestampSlug()));
  const transcriptDir = path.join(outDir, "transcripts");
  await mkdir(transcriptDir, { recursive: true });
  let stack;
  const transcripts = [];
  try {
    stack = assertRealStack(workspace);
    for (const item of cases) {
      console.log(`Running ${item.id} with ${options.model} (${options.full ? "full" : "capture-dispatch-only"})…`);
      const transcript = await runPiCase(item, workspace, stack, options);
      const transcriptPath = path.join(transcriptDir, `${item.id}.json`);
      await writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
      transcripts.push(transcript);
      console.log(`  recorded ${transcript.events.length} JSON events; ${transcript.meta.terminationReason ?? "pi exited normally"}`);
    }
  } finally {
    if (ownsWorkspace && !options.keepWorkspace) removeDisposableWorktree(repoRoot, workspace);
  }
  const meta = {
    generatedAt: new Date().toISOString(),
    runnerForm: options.full ? "automatic headless JSON (full)" : "automatic headless JSON (capture-dispatch-only)",
    runnerReason: "pi JSON mode runs extensions without a TUI; the real project philosophy and patched subagent extension are explicitly mounted. The runner suppresses inherited AGENTS.md context because this evaluator itself runs as a dispatched worker and that ambient context would contaminate the measured boss role. Bridge-only UI plumbing is omitted because no PipiUI GUI bridge exists in a headless process.",
    stack: `real PiPhilosophy/philosophy.ts and PiExt/subagent/index.ts from ${ownsWorkspace ? `a disposable git worktree of ${repoRoot}` : workspace}; model ${options.model}`,
    captureMode: options.full
      ? "real delegated workers were allowed to execute inside a disposable git worktree"
      : `the boss process was stopped synchronously at pi's streamed toolcall_end event for subagent, before the real tool executor starts; no mock tool was injected; max parent turns per case: ${options.maxAssistantTurns}`,
    artifactDir: outDir,
    referenceParallelRate: options.referenceParallelRate,
    reportNote: options.reportNote,
    workspace: options.keepWorkspace || options.workspace ? workspace : "removed disposable git worktree",
  };
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify({ meta, cases: cases.map((item) => ({ id: item.id, type: item.type, title: item.title })) }, null, 2)}\n`, "utf8");
  return { transcripts, meta, outDir };
}

async function generatePacket(cases, destination) {
  const target = path.resolve(destination);
  await mkdir(target, { recursive: true });
  const scriptPath = path.resolve(process.argv[1]);
  const manifest = {
    format: "pipiui-delegation-eval-packet/v1",
    generatedAt: new Date().toISOString(),
    runnerForm: "semi-manual transcript scoring",
    reason: "Use this form when the operator needs a GUI/App session or a separately captured real-stack transcript.",
    captureRequirements: [
      "Use the real PipiUI philosophy and patched subagent tool; do not replace subagent with a mock.",
      "Export JSONL containing assistant toolCall blocks, preferably pi --mode json output or /export JSON.",
      "Save each transcript as <case-id>.jsonl or include caseId in normalized JSON.",
    ],
    scoreCommand: `node ${scriptPath} --score <transcript-or-directory> --report delegation-eval-report.md`,
    cases: cases.map((item) => ({ id: item.id, type: item.type, title: item.title })),
  };
  await writeFile(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const item of cases) {
    const text = [
      `# ${item.id} — ${item.title}`,
      "",
      `Type: **${item.type}**`,
      "",
      "## Exact user prompt",
      "",
      "```text",
      item.prompt,
      "```",
      "",
      "## Executable expectation",
      "",
      "```json",
      JSON.stringify(item.expectation, null, 2),
      "```",
      "",
      "## Human scoring rubric",
      "",
      ...item.rubric.map((point) => `- ${point}`),
      "",
      "## Capture instructions",
      "",
      "1. Run this exact prompt in a fresh real boss session with the full philosophy and real patched subagent tool loaded.",
      "2. Export the structured transcript including assistant tool calls; do not hand-copy prose only.",
      `3. Save it as \`${item.id}.jsonl\` (or normalized JSON with \`caseId: \"${item.id}\"\`).`,
      "4. Score it with the command in manifest.json.",
      "",
    ].join("\n");
    await writeFile(path.join(target, `${item.id}.md`), text, "utf8");
  }
  return target;
}

async function runSelfTest(casesById) {
  const fixtureDir = path.join(SCRIPT_DIR, "fixtures", "delegation-eval");
  const files = await filesUnder(fixtureDir);
  const fixtures = await loadTranscripts(files, new Set(casesById.keys()), []);
  const scores = scoreTranscripts(casesById, fixtures, []);
  const expected = new Map([
    ["ambiguous-subagent-regression", (score) => score.passed && score.details.clarificationCorrect],
    ["parallel-spawn-vs-fanout", (score) => score.passed && score.details.parallelFirstWave],
    ["dependent-subagent-evaluation-tag", (score) => !score.passed && !score.details.serialShapeCorrect],
  ]);
  if (scores.length !== expected.size) throw new Error(`Expected ${expected.size} fixture scores, received ${scores.length}`);
  for (const score of scores) {
    const assertion = expected.get(score.caseId);
    if (!assertion || !assertion(score)) throw new Error(`Fixture assertion failed: ${score.caseId}; score=${score.score}, passed=${score.passed}`);
    console.log(`PASS ${score.caseId}: ${score.score}/100 (${score.passed ? "positive" : "negative"} fixture)`);
  }

  // Regression guard for the explicitly supported alternate parallel shape:
  // two single subagent calls in the same assistant message must count as one wave.
  const synthetic = {
    caseId: "parallel-spawn-vs-fanout",
    events: [{
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "one", name: "subagent", arguments: { agent: "explore", title: "Spawn assembly", task: "Inspect PipiSpawnAssembly extension arguments and environment variables; report findings." } },
          { type: "toolCall", id: "two", name: "subagent", arguments: { agent: "explore", title: "Fanout runtime", task: "Inspect PiPhilosophy fanout and patched subagent forced background behavior; report findings." } },
        ],
      },
    }],
  };
  const syntheticScore = scoreCase(casesById.get(synthetic.caseId), synthetic);
  if (!syntheticScore.details.parallelFirstWave) throw new Error("Same-message single subagent calls were not counted as a parallel wave");
  console.log("PASS same-message single-call fan-out is counted as parallel.");

  // Capture mode terminates at this streamed event, before a message_end exists.
  // The scorer must still retain the complete real-tool arguments.
  const streamed = {
    caseId: "parallel-spawn-vs-fanout",
    events: [{
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        toolCall: {
          type: "toolCall",
          id: "streamed", name: "subagent",
          arguments: { tasks: [
            { agent: "explore", title: "Spawn wiring", task: "Inspect PipiSpawnAssembly extension arguments and environment variables." },
            { agent: "explore", title: "Fanout runtime", task: "Inspect PiPhilosophy fanout forced background runtime behavior." },
          ] },
        },
      },
    }],
  };
  const streamedScore = scoreCase(casesById.get(streamed.caseId), streamed);
  if (!streamedScore.details.parallelFirstWave) throw new Error("Streamed toolcall_end was not scored as a parallel wave");
  console.log("PASS streamed toolcall_end fan-out is captured before execution.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpus = await loadCorpus();
  const cases = selectCases(corpus, options.caseIds);
  const casesById = new Map(corpus.cases.map((item) => [item.id, item]));

  if (options.list) {
    printList(cases);
    return;
  }
  if (options.selfTest) {
    await runSelfTest(casesById);
    return;
  }
  if (options.packetDir) {
    const packet = await generatePacket(cases, options.packetDir);
    console.log(`Wrote semi-manual reproduction packet: ${packet}`);
    return;
  }

  let scores;
  let metadata;
  if (options.run) {
    const automatic = await runAutomatic(cases, options);
    scores = scoreTranscripts(casesById, automatic.transcripts, cases.map((item) => item.id));
    metadata = automatic.meta;
    metadata.localArtifactDir = automatic.outDir;
  } else {
    const transcripts = await loadTranscripts(options.scorePaths, new Set(casesById.keys()), options.caseIds);
    scores = scoreTranscripts(casesById, transcripts, options.caseIds);
    metadata = {
      generatedAt: new Date().toISOString(),
      runnerForm: "semi-manual transcript scoring",
      runnerReason: "Operator supplied structured transcript JSON/JSONL; no model request was made by this scoring invocation.",
      referenceParallelRate: options.referenceParallelRate,
      reportNote: options.reportNote,
    };
  }

  await applyOptionalJudge(casesById, scores, options);
  if (options.run) {
    await writeFile(path.join(metadata.localArtifactDir, "scores.json"), `${JSON.stringify({ metadata, scores }, null, 2)}\n`, "utf8");
    const localReport = await writeReport(path.join(metadata.localArtifactDir, "report.md"), scores, metadata);
    console.log(`Wrote ${localReport}`);
  }
  const metrics = aggregateScores(scores, options.referenceParallelRate);
  for (const score of scores) console.log(`${score.caseId}: ${score.score}/100 ${score.passed ? "PASS" : "FAIL"} — ${summarizeShape(score)}`);
  console.log(`should-parallel=${percent(metrics.shouldParallelRate)} should-serial=${percent(metrics.shouldSerialRate)} clarification=${percent(metrics.clarificationCorrectRate)}`);

  if (options.reportPath) {
    const report = await writeReport(options.reportPath, scores, metadata);
    console.log(`Wrote ${report}`);
  }
}

main().catch((error) => {
  console.error(`delegation-eval failed: ${redactText(error instanceof Error ? error.stack ?? error.message : String(error))}`);
  process.exitCode = 1;
});
