import { afterEach, expect, it, vi } from "vitest";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BatchCoordinator } from "../agent/batches.js";
import type { BatchInput } from "../agent/batch-contract.js";
import { resolvePiRuntime, type PiProfile } from "../agent/pi-session.js";
import { ExperimentService, DATA_DIRECTORY } from "../agent/service.js";
import { VariantStore } from "../agent/variants.js";
import { registerGitWorktreePlacementProviderV1, requestGitWorktreePlacementProviderV1 } from "../../../resources/runtime/extensions/git-capability/agent/worktree-service.ts";

const roots: string[] = [], coordinators: BatchCoordinator[] = [];
const exec = promisify(execFile), exp = "pi-comparison";
const git = async (root: string, ...args: string[]) => exec("git", ["-C", root, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
afterEach(async () => {
  await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.shutdown()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(budget: BatchInput["budget"] = {}, twoVariants = false) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const candidates = [process.env.PIPIUI_TEST_PI_CLI, join(repo, "build/PipiUI.app/Contents/Resources/pipiui-embedded/pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js")].filter((p): p is string => Boolean(p));
  let cli: string | undefined;
  for (const path of candidates) if (await access(path).then(() => true, () => false)) { cli = path; break; }
  if (!cli) throw new Error("Real project-mounted Pi required; no global Pi/mock/network fallback");
  const runtime = await resolvePiRuntime(cli);
  const root = await realpath(await mkdtemp(join(tmpdir(), "lab-batches-"))); roots.push(root);
  await git(root, "init", "-b", "main"); await git(root, "config", "user.name", "Lab fixture"); await git(root, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(root, ".gitignore"), ".pi/\n"); await writeFile(join(root, "seed.txt"), "baseline");
  await git(root, "add", "."); await git(root, "commit", "-m", "fixture");
  const store = new ExperimentService(root);
  await store.create({ experimentId: exp, kind: "pi", question: "Compare fixed Pi trials", variants: twoVariants ? [{ id: "baseline", hypothesis: "baseline" }, { id: "fast", hypothesis: "candidate" }] : undefined, metrics: [{ id: "score", unit: "points", direction: "higher" }], budget: { repetitions: 2, concurrency: 2, maxTrials: 16, trialTimeoutMs: 15000, totalTimeoutMs: 60000, ...budget } });
  await store.freeze(exp);
  registerGitWorktreePlacementProviderV1();
  const variants = new VariantStore(root, { store, placement: requestGitWorktreePlacementProviderV1()! });
  if (twoVariants) {
    const workspace = await variants.prepare({ experimentId: exp, variantId: "fast", agentId: "batch-candidate" });
    await writeFile(join(workspace.path, "seed.txt"), "candidate"); await variants.freeze(exp, "fast");
  }
  const extension = join(root, ".pi", "scripted.mjs");
  // The same real Pi registerProvider/AssistantMessageEventStream route as pi-session.test.ts.
  // It never contacts a model service, but Pi itself executes actual write tools.
  await writeFile(extension, `
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import {writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
export default function(pi) {
 pi.on('session_start', () => { writeFileSync(join(process.env.HOME,'owner.txt'),String(process.pid)); });
 pi.on('before_agent_start', async (event,ctx) => { if(event.prompt.includes('ask-input')) await ctx.ui.input('fixture-question'); });
 pi.registerProvider('lab-scripted', {
  name:'Lab scripted', baseUrl:'http://127.0.0.1:1/never', apiKey:'fixture-not-a-secret', api:'lab-scripted-api',
  models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],
  streamSimple(model,context,options) {
   const stream=createAssistantMessageEventStream();
   (async()=>{
    const result={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[],usage:{input:11,output:7,cacheRead:0,cacheWrite:0,totalTokens:18,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'pending',timestamp:Date.now()};
    try {
     const prompt=JSON.stringify(context.messages.filter(m=>m.role==='user'));
     await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,prompt.includes('slow')?10000:100);options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('cancelled'))},{once:true});});
     if(prompt.includes('forced-failure')) throw new Error('fixture-failure');
     if(prompt.includes('noisy')) for(let i=0;i<350;i++) process.stderr.write('日志-'+i+'-'+ 'x'.repeat(1000)+'\\n');
     const wrote=context.messages.some(m=>m.role==='toolResult');
     result.content=wrote?[{type:'text',text:process.env.LAB_PAYLOAD||'finished ok'}]:[
       {type:'toolCall',id:'write-result',name:'write',arguments:{path:'result.txt',content:'ok'}},
       {type:'toolCall',id:'write-metrics',name:'write',arguments:{path:'metrics.json',content:JSON.stringify({score:7,'runtime-total-ms':-1})}},
       {type:'toolCall',id:'write-seed',name:'write',arguments:{path:'observed.txt',content:readFileSync('seed.txt','utf8')}}];
     result.stopReason=wrote?'stop':'toolUse'; stream.push({type:'start',partial:result});
     result.content.forEach((block,i)=>{if(wrote){stream.push({type:'text_start',contentIndex:i,partial:result});stream.push({type:'text_delta',contentIndex:i,delta:block.text,partial:result});stream.push({type:'text_end',contentIndex:i,content:block.text,partial:result});}else{stream.push({type:'toolcall_start',contentIndex:i,partial:result});stream.push({type:'toolcall_end',contentIndex:i,toolCall:block,partial:result});}});
     stream.push({type:'done',reason:result.stopReason,message:result});stream.end();
    }catch(error){result.stopReason='error';result.errorMessage=String(error);stream.push({type:'error',reason:'error',error:result});stream.end();}
   })();return stream;
  }
 });
}`);
  const profile: PiProfile = { id: "scripted", provider: "lab-scripted", model: "fixture", thinking: "off", tools: ["write"], extensions: [extension] };
  const input: BatchInput = { experimentId: exp, batchId: "fair-run", variants: (twoVariants ? ["baseline", "fast"] : ["baseline"]).map((id) => ({ id, profile })), cases: [{ id: "write-output", title: "Write output", prompt: "write fixture", checks: [{ path: "result.txt", expectedText: "ok" }], expectedAnswer: "finished ok", metricsFile: "metrics.json" }] };
  await writeFile(join(root, ".pi/agent/auth.json"), '{"must-not-copy":"project-secret"}');
  const activeCounts: number[] = [];
  const coordinator = new BatchCoordinator(root, { runtime, store, variants, ownerSessionId: "test-owner", onUpdate: (batch) => { activeCounts.push(batch.progress.active); } }); coordinators.push(coordinator);
  return { root, runtime, store, variants, coordinator, input, profile, extension, activeCounts };
}
const trialRoot = (root: string, batch: string, trial: string) => join(root, DATA_DIRECTORY, exp, "batches", batch, "trials", trial);
async function until(check: () => Promise<boolean>, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await check())) { if (Date.now() >= end) throw new Error("fixture wait timed out"); await new Promise((resolve) => setTimeout(resolve, 30)); }
}

it("真实Pi：两候选×两轮公平矩阵、至少两进程重叠、独立写入/状态/usage与固定断言", async () => {
  const f = await fixture({}, true);
  const receipt = await f.coordinator.start(f.input);
  expect(receipt.state).toBe("queued");
  expect(receipt.trials.map((t) => [t.variantId, t.repetition])).toEqual([["baseline", 1], ["fast", 1], ["fast", 2], ["baseline", 2]]);
  const duplicate = await f.coordinator.start(structuredClone(f.input));
  expect(duplicate.trials.map((t) => t.id)).toEqual(receipt.trials.map((t) => t.id));
  await expect(f.coordinator.start({ ...f.input, cases: [{ ...f.input.cases[0], prompt: "different" }] })).rejects.toMatchObject({ code: "batch-conflict" });
  const result = await f.coordinator.wait(exp, receipt.id);
  expect(result.state).toBe("completed");
  expect(Math.max(...f.activeCounts)).toBe(2);
  expect(result.trials.map((t) => [t.state, t.quality])).toEqual(Array.from({ length: 4 }, () => ["succeeded", "pass"]));
  const [a, b] = result.trials.map((t) => t.run!);
  expect(a.pid).not.toBe(b.pid);
  expect(Math.max(Date.parse(a.startedAt), Date.parse(b.startedAt))).toBeLessThan(Math.min(Date.parse(a.endedAt), Date.parse(b.endedAt)));
  expect(new Set(result.trials.map((t) => t.run?.sessionId)).size).toBe(4);
  for (const trial of result.trials) {
    const base = trialRoot(f.root, result.id, trial.id);
    expect(await readFile(join(base, "workspace/result.txt"), "utf8")).toBe("ok");
    expect(await readFile(join(base, "workspace/observed.txt"), "utf8")).toBe(trial.variantId === "baseline" ? "baseline" : "candidate");
    expect(await readFile(join(base, "state/home/owner.txt"), "utf8")).toBe(String(trial.run!.pid));
    expect(await readFile(join(base, "state/agent/trust.json"), "utf8").catch(() => "missing")).toBe("missing");
    expect(JSON.parse(await readFile(join(base, "state/agent/auth.json"), "utf8"))).toEqual({});
    expect(trial.run).toMatchObject({ runtime: f.runtime, toolCalls: 3, usage: { total: 36, source: "pi-session" } });
    expect(trial.metrics.find((m) => m.id === "score")).toMatchObject({ value: 7, source: "workload-output" });
    expect(trial.metrics.find((m) => m.id === "runtime-total-ms")!.value).toBeGreaterThan(0);
    expect(await readFile(join(base, "metrics.raw.json"), "utf8")).toContain('"score":7');
    expect(await f.coordinator.view(exp, result.id, trial.id)).toMatchObject({ mode: "read-only-log", logPath: join(base, "events.jsonl"), logAvailable: true, pid: trial.run!.pid, ownerState: "not-active", canRespond: false });
    expect((await f.coordinator.cancelTrial(exp, result.id, trial.id)).state).toBe("completed");
  }
  const reopened = new BatchCoordinator(f.root, { runtime: f.runtime }); coordinators.push(reopened);
  expect((await reopened.read(exp, result.id)).trials.map((t) => t.run!.sessionId)).toEqual(result.trials.map((t) => t.run!.sessionId));
  expect((await reopened.get(exp, result.id)).trials[0].run).not.toHaveProperty("answer");
  expect((await reopened.list(exp, 1, 0)).length).toBe(1); expect(await reopened.list(exp, 1, 1)).toEqual([]);
}, 60000);

it("被测Pi不能递归预留或调度新实验矩阵", async () => {
  const f = await fixture({ repetitions: 1 });
  vi.stubEnv("PIPIUI_EXPERIMENT_CHILD", "1");
  try {
    await expect(f.coordinator.start(f.input)).rejects.toMatchObject({ code: "nested-experiment-not-allowed" });
    await expect(readFile(join(f.root, DATA_DIRECTORY, exp, "batches", f.input.batchId, "batch.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { vi.unstubAllEnvs(); }
});

it("缺失批次返回领域错误，取消与自然完成竞争时返回真实终态", async () => {
  const f = await fixture({ repetitions: 1 });
  await expect(f.coordinator.get(exp, "missing-batch")).rejects.toMatchObject({ code: "batch-not-found" });
  await expect(f.coordinator.read(exp, "missing-batch")).rejects.toMatchObject({ code: "batch-not-found" });
  await f.coordinator.start(f.input);
  const original = f.coordinator.get.bind(f.coordinator);
  const spy = vi.spyOn(f.coordinator, "get").mockImplementationOnce(async (experimentId, batchId) => {
    const receipt = await original(experimentId, batchId);
    expect(["queued", "running"]).toContain(receipt.state);
    await f.coordinator.wait(experimentId, batchId);
    return receipt;
  });
  try { expect((await f.coordinator.cancel(exp, f.input.batchId)).state).toBe("completed"); }
  finally { spy.mockRestore(); }
}, 30000);

it("真实Pi单轮失败不阻断其他项，无断言为unknown，输出不能自报PASS", async () => {
  const f = await fixture({ repetitions: 1 });
  const input = { ...f.input, cases: [
    { ...f.input.cases[0], id: "broken", prompt: "forced-failure" },
    { ...f.input.cases[0], id: "wrong", checks: [{ path: "result.txt", expectedText: "not ok" }] },
    { ...f.input.cases[0], id: "unknown", checks: [], expectedAnswer: undefined },
    f.input.cases[0],
  ] };
  await f.coordinator.start(input); const result = await f.coordinator.wait(exp, input.batchId);
  expect(result.trials.map((t) => [t.state, t.quality])).toEqual([["failed", "unknown"], ["failed", "fail"], ["succeeded", "unknown"], ["succeeded", "pass"]]);
}, 60000);

it("真实Pi全批取消：不启动排队项、进程退出后终态、取消不返还修订轮数预算", async () => {
  const f = await fixture({ maxTrials: 4, repetitions: 4 });
  f.input.cases[0].prompt = "slow";
  await f.coordinator.start(f.input);
  await until(async () => (await f.coordinator.get(exp, f.input.batchId)).trials.filter((t) => t.pid).length === 2);
  await f.coordinator.cancel(exp, f.input.batchId);
  const result = await f.coordinator.wait(exp, f.input.batchId);
  expect(result.state).toBe("cancelled"); expect(result.trials.every((t) => t.state === "cancelled")).toBe(true);
  expect(result.trials.filter((t) => t.run).length).toBe(2); expect(result.trials.filter((t) => t.pid).length).toBe(2);
  for (const trial of result.trials.filter((t) => t.pid)) expect(() => process.kill(trial.pid!, 0)).toThrow();
  const reopened = new BatchCoordinator(f.root, { runtime: f.runtime }); coordinators.push(reopened);
  await expect(reopened.start({ ...f.input, batchId: "retry", budget: { repetitions: 1 } })).rejects.toMatchObject({ code: "budget-exhausted" });
}, 30000);

it("整体截止及单轮超时持久化，取消/新batch不补满整体时间", async () => {
  const f = await fixture({ repetitions: 4, totalTimeoutMs: 700, trialTimeoutMs: 6000 });
  f.input.cases[0].prompt = "slow";
  await f.coordinator.start(f.input); const result = await f.coordinator.wait(exp, f.input.batchId);
  expect(result.trials.every((t) => t.state === "timed-out")).toBe(true);
  expect(result.trials.filter((t) => t.pid).length).toBeLessThanOrEqual(2);
  await expect(f.coordinator.start({ ...f.input, batchId: "new-time-budget", budget: { repetitions: 1 } })).rejects.toMatchObject({ code: "budget-exhausted" });
  const single = await fixture({ repetitions: 1, trialTimeoutMs: 400 });
  single.input.cases[0].prompt = "slow";
  await single.coordinator.start(single.input);
  expect((await single.coordinator.wait(exp, single.input.batchId)).trials[0].state).toBe("timed-out");
}, 30000);

it("跨owner拒绝并发，但查询/重复启动不把其他会话标成中断；只解析声明环境名", async () => {
  const f = await fixture(); f.input.cases[0].prompt = "slow";
  const resolved: string[] = [];
  const one = new BatchCoordinator(f.root, { runtime: f.runtime, resolveEnvironment: (key) => { resolved.push(key); return 'a-secret-value'; } }); coordinators.push(one);
  const two = new BatchCoordinator(f.root, { runtime: f.runtime, ownerSessionId: "other" }); coordinators.push(two);
  f.input.variants[0].environmentKeys = ["LAB_TOKEN"];
  await one.start(f.input);
  expect(resolved).toEqual(["LAB_TOKEN"]);
  expect((await two.start(f.input)).id).toBe(f.input.batchId);
  expect((await two.get(exp, f.input.batchId)).state).not.toBe("interrupted");
  await expect(two.start({ ...f.input, batchId: "competing-run" })).rejects.toMatchObject({ code: "batch-busy" });
  await expect(two.cancel(exp, f.input.batchId)).rejects.toMatchObject({ code: "batch-not-owned" });
  const file = await readFile(join(f.root, DATA_DIRECTORY, exp, "batches", f.input.batchId, "batch.json"), "utf8");
  expect(file).toContain("LAB_TOKEN"); expect(file).not.toContain("a-secret-value");
  await one.cancel(exp, f.input.batchId); await one.wait(exp, f.input.batchId);
}, 30000);

it("真实Pi输入请求准确绑定、manualInput不记回复值；支持只取消单轮", async () => {
  const f = await fixture({ repetitions: 1 });
  f.input.cases = [{ ...f.input.cases[0], id: "ask", prompt: "ask-input" }, { ...f.input.cases[0], id: "other", prompt: "slow" }];
  await f.coordinator.start(f.input);
  await until(async () => (await f.coordinator.get(exp, f.input.batchId)).trials[0].state === "waiting-input");
  const state = await f.coordinator.get(exp, f.input.batchId), trial = state.trials[0];
  expect(await f.coordinator.view(exp, f.input.batchId, trial.id)).toMatchObject({ mode: "read-only-log", ownerState: "this-session", canRespond: true, inputRequestId: trial.inputRequest!.id });
  await expect(f.coordinator.respond(exp, f.input.batchId, state.trials[1].id, trial.inputRequest!.id, { value: "wrong" })).rejects.toMatchObject({ code: "input-not-pending" });
  await expect(f.coordinator.respond(exp, f.input.batchId, trial.id, trial.inputRequest!.id, { confirmed: "yes" as never })).rejects.toMatchObject({ code: "invalid-input" });
  await expect(f.coordinator.respond(exp, f.input.batchId, trial.id, trial.inputRequest!.id, { unexpected: true } as never)).rejects.toMatchObject({ code: "invalid-input" });
  await f.coordinator.respond(exp, f.input.batchId, trial.id, trial.inputRequest!.id, { value: "private-answer-value" });
  await expect(f.coordinator.respond(exp, f.input.batchId, trial.id, trial.inputRequest!.id, { value: "duplicate" })).rejects.toMatchObject({ code: "input-not-pending" });
  await f.coordinator.cancelTrial(exp, f.input.batchId, state.trials[1].id);
  const result = await f.coordinator.wait(exp, f.input.batchId);
  expect(result.trials[0]).toMatchObject({ state: "succeeded", manualInput: true }); expect(result.trials[1].state).toBe("cancelled");
  const page = await f.coordinator.logs(exp, f.input.batchId, trial.id, 0, 65536);
  expect(page.text).not.toContain("private-answer-value"); expect(JSON.stringify(result)).not.toContain("private-answer-value");
}, 30000);

it("有界日志逐页无重叠遗漏、UTF8边界正确、截断显式且不串trial", async () => {
  const f = await fixture({ repetitions: 1 }); f.input.cases[0].prompt = "noisy";
  await f.coordinator.start(f.input); const result = await f.coordinator.wait(exp, f.input.batchId), trial = result.trials[0];
  expect(trial.state).toBe("succeeded"); expect(trial.logTruncated).toBe(true);
  let cursor = 0, text = "";
  for (;;) { const page = await f.coordinator.logs(exp, result.id, trial.id, cursor, 997); expect(page.cursor).toBe(cursor); expect(page.truncated).toBe(true); text += page.text; if (page.nextCursor === cursor) break; cursor = page.nextCursor; }
  const saved = await readFile(join(trialRoot(f.root, result.id, trial.id), "events.jsonl"), "utf8");
  expect(text).toBe(saved); expect(text).not.toContain("�"); expect(cursor).toBeLessThanOrEqual(256 * 1024);
  await expect(f.coordinator.logs(exp, result.id, trial.id, cursor + 1)).rejects.toMatchObject({ code: "invalid-cursor" });
  await expect(f.coordinator.logs(exp, result.id, trial.id, 0, 2)).rejects.toMatchObject({ code: "invalid-page" });
}, 30000);

it("重开仅在kernel租约确无owner时重建interrupted，不重跑Pi", async () => {
  const f = await fixture({ repetitions: 1 });
  await f.coordinator.start(f.input); await f.coordinator.wait(exp, f.input.batchId);
  const base = join(f.root, DATA_DIRECTORY, exp, "batches", f.input.batchId), metaPath = join(base, "batch.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8")); meta.state = "running"; delete meta.endedAt;
  await writeFile(metaPath, JSON.stringify(meta));
  const trialPath = join(base, "trials", meta.trialIds[0], "trial.json"), trial = JSON.parse(await readFile(trialPath, "utf8")); trial.state = "running"; await writeFile(trialPath, JSON.stringify(trial));
  // Separate process really owns SQLite's kernel lease; querying cannot steal it.
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');console.log('locked');process.stdin.resume();process.stdin.on('data',()=>{db.exec('ROLLBACK');db.close();process.exit(0)});`, join(dirname(base), "owner.sqlite")], { env: { ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); });
  const fresh = new BatchCoordinator(f.root, { runtime: f.runtime }); coordinators.push(fresh);
  try { expect((await fresh.get(exp, f.input.batchId)).state).toBe("running"); }
  finally { child.stdin.write("release\n"); await new Promise((resolve) => child.once("close", resolve)); }
  const recovered = await fresh.get(exp, f.input.batchId);
  expect(recovered.state).toBe("interrupted"); expect(recovered.trials[0]).toMatchObject({ state: "interrupted", reason: "owner-released" });
  expect((await readdir(join(trialRoot(f.root, f.input.batchId, trial.id), "state/sessions"))).length).toBe(1);
}, 30000);

it("日志IO失败不拖垮真实Pi或留下running；外部通知抛错不改变结果", async () => {
  const f = await fixture({ repetitions: 1 }); f.input.cases[0].prompt = "ask-input";
  const coordinator = new BatchCoordinator(f.root, { runtime: f.runtime, onUpdate: () => { throw new Error("UI unavailable"); } }); coordinators.push(coordinator);
  await coordinator.start(f.input);
  await until(async () => (await coordinator.get(exp, f.input.batchId)).trials[0].state === "waiting-input");
  const trial = (await coordinator.get(exp, f.input.batchId)).trials[0];
  const path = join(trialRoot(f.root, f.input.batchId, trial.id), "events.jsonl");
  await rm(path); await mkdir(path);
  await coordinator.respond(exp, f.input.batchId, trial.id, trial.inputRequest!.id, { confirmed: true });
  const result = await coordinator.wait(exp, f.input.batchId);
  expect(result.state).toBe("completed"); expect(result.trials[0]).toMatchObject({ state: "succeeded", logTruncated: true });
  expect((await coordinator.get(exp, f.input.batchId)).progress.active).toBe(0);
}, 30000);

it("声明环境值即使名字不含secret也不进入协调器日志及结果记录", async () => {
  const f = await fixture({ repetitions: 1 });
  f.input.variants[0].environmentKeys = ["LAB_PAYLOAD"];
  delete f.input.cases[0].expectedAnswer;
  const coordinator = new BatchCoordinator(f.root, { runtime: f.runtime, resolveEnvironment: () => 'private-mounted-value' }); coordinators.push(coordinator);
  await coordinator.start(f.input); const result = await coordinator.wait(exp, f.input.batchId);
  expect(result.trials[0].run!.answer).toBe("[REDACTED]");
  const base = trialRoot(f.root, result.id, result.trials[0].id);
  for (const name of ["run.json", "trial.json", "events.jsonl"]) expect(await readFile(join(base, name), "utf8")).not.toContain('private-mounted-value');
}, 30000);

it("输入只允许缩小固定预算，拒绝任意快照路径/环境值及超大矩阵", async () => {
  const f = await fixture({ maxTrials: 2 });
  await expect(f.coordinator.start({ ...f.input, budget: { concurrency: 3 } })).rejects.toMatchObject({ code: "invalid-budget" });
  await expect(f.coordinator.start({ ...f.input, variants: [{ ...f.input.variants[0], snapshotPath: '/tmp/unregistered' }] } as BatchInput)).rejects.toMatchObject({ code: "invalid-profile" });
  await expect(f.coordinator.start({ ...f.input, variants: [{ ...f.input.variants[0], environment: { KEY: 'forbidden-secret' } }] } as BatchInput)).rejects.toMatchObject({ code: "invalid-profile" });
  await expect(f.coordinator.start({ ...f.input, cases: [f.input.cases[0], { ...f.input.cases[0], id: "extra" }] })).rejects.toMatchObject({ code: "budget-exhausted" });
  await f.coordinator.start({ ...f.input, budget: { repetitions: 1 } });
  await f.coordinator.wait(exp, f.input.batchId);
  await expect(f.coordinator.start({ ...f.input, batchId: "smaller-ceiling", budget: { repetitions: 1, maxTrials: 1 } })).rejects.toMatchObject({ code: "budget-exhausted" });
}, 30000);
