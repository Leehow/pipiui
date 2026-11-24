import { expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPiJsonlReader, resolvePiRuntime } from "../agent/pi-session.js";
import type { BatchRecord, BatchTrial } from "../agent/batch-contract.js";

const exec = promisify(execFile);
const git = async (root: string, ...args: string[]) => (await exec("git", ["-C", root, ...args], { env: { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: "0" } })).stdout;
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } };

// Both providers below emit model messages only. Pi, not the fixture, resolves and
// executes experiment/write/bash. No forged tool result or user session entry.
const providerPrelude = `
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const text = m => typeof m.content === 'string' ? m.content : (m.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('');
const call = (id,name,args) => ({type:'toolCall',id,name,arguments:args});
const answer = text => ({type:'text',text});
function register(pi, decide) {
 pi.registerProvider('pilot-scripted', {
  name:'Deterministic pilot (not a paid model)',baseUrl:'http://127.0.0.1:1/never',apiKey:'fixture-only',api:'pilot-scripted-api',
  models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:4000}],
  streamSimple(model,context,options) {
   const stream=createAssistantMessageEventStream();
   (async()=>{
    const result={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[],usage:{input:11,output:7,cacheRead:0,cacheWrite:0,totalTokens:18,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'pending',timestamp:Date.now()};
    try {
     result.content=await decide(context,options);
     result.stopReason=result.content.some(p=>p.type==='toolCall')?'toolUse':'stop';
     stream.push({type:'start',partial:result});
     result.content.forEach((block,i)=>{
      if(block.type==='text') {stream.push({type:'text_start',contentIndex:i,partial:result});stream.push({type:'text_delta',contentIndex:i,delta:block.text,partial:result});stream.push({type:'text_end',contentIndex:i,content:block.text,partial:result});}
      else {stream.push({type:'toolcall_start',contentIndex:i,partial:result});stream.push({type:'toolcall_end',contentIndex:i,toolCall:block,partial:result});}
     });
     stream.push({type:'done',reason:result.stopReason,message:result});stream.end();
    } catch(error) {result.stopReason='error';result.errorMessage=String(error);stream.push({type:'error',reason:'error',error:result});stream.end();}
   })();return stream;
  }
 });
}
`;

it("主聊天真实Pi：原型冻结→并发子Pi→报告→后续真实用户采用，仅生成never-merge交接", async () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const cli = process.env.PIPIUI_TEST_PI_CLI ?? join(repo, "build/PipiUI.app/Contents/Resources/pipiui-embedded/pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  await access(cli); // Missing embedded runtime is a real failure, not a mock fallback.
  const runtime = await resolvePiRuntime(cli);
  const extension = join(repo, "Electron/packages/experiment-lab-extension/agent/dist/index.js");
  await access(extension); // Run the workspace build first; test the shipped entry.
  const skill = join(repo, "Electron/packages/experiment-lab-extension/skills/prototype-experiments/SKILL.md");
  const root = await realpath(await mkdtemp(join(tmpdir(), "lab-prototype-flow-")));
  const deadline = Date.now() + 65000;
  const experimentId = "chat-prototype", batchId = "fixed-comparison";
  const base = join(root, ".pi/agent/experiments", experimentId, "batches", batchId);
  let child: ReturnType<typeof spawn> | undefined, closed: Promise<unknown> | undefined;
  let processClosed = false, stderr = "", fatal: Error | undefined;
  const events: any[] = [], pids = new Set<number>();
  async function until(check: () => boolean | Promise<boolean>) {
    while (!await check()) {
      if (fatal) throw fatal;
      if (processClosed) throw new Error(`Pi exited unexpectedly: ${stderr}`);
      if (Date.now() > deadline) throw new Error(`Real Pi pilot deadline exceeded; stderr=${stderr}; last events=${JSON.stringify(events.slice(-5))}`);
      await pause(25);
    }
  }
  try {
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.name", "Pilot fixture");
    await git(root, "config", "user.email", "fixture@example.invalid");
    await writeFile(join(root, ".gitignore"), ".pi/\n");
    await writeFile(join(root, "seed.txt"), "baseline\n");
    await git(root, "add", "."); await git(root, "commit", "-m", "fixture baseline");
    await writeFile(join(root, "seed.txt"), "staged baseline\n"); await git(root, "add", "seed.txt");
    await writeFile(join(root, "seed.txt"), "dirty baseline\n");
    await writeFile(join(root, "extra.txt"), "included untracked input\n");
    const mainHead = await git(root, "rev-parse", "HEAD"), mainIndex = await readFile(join(root, ".git/index"));
    const mainStatus = await git(root, "status", "--porcelain=v1", "-z");
    const agent = join(root, ".pi/agent"), home = join(root, ".pi/home"), sessions = join(agent, "sessions");
    await Promise.all([agent, home, sessions].map((path) => mkdir(path, { recursive: true })));
    const workload = join(agent, "workload.mjs"), bossProvider = join(agent, "boss-provider.mjs");
    await writeFile(workload, providerPrelude + `
export default function(pi) {
 pi.on('session_start',()=>writeFileSync(join(process.env.HOME,'owner.txt'),String(process.pid)));
 register(pi,async context=>{
  await new Promise(done=>setTimeout(done,250));
  if(context.messages.some(m=>m.role==='toolResult')) return [answer('fixed answer')];
  return [call('write-output','write',{path:'result.txt',content:'fixed output'}),call('write-observed','write',{path:'observed.txt',content:readFileSync('seed.txt','utf8')})];
 });
}
`);
    const profiles = ["candidate-a", "candidate-b"].map((id) => ({ id, profile: { id: `${id}-profile`, provider: "pilot-scripted", model: "fixture", thinking: "off", tools: ["write"], extensions: [workload] } }));
    const common = { experimentId, batchId };
    const create = { action: "create", experimentId, kind: "pi", question: "请比较两个原型的固定输出；失败和未知也必须报告。", includeUntracked: ["extra.txt"], variants: [{ id: "baseline", hypothesis: "冻结对照输入" }, { id: "candidate-a", hypothesis: "原型A" }, { id: "candidate-b", hypothesis: "原型B" }], budget: { repetitions: 1, concurrency: 2, maxTrials: 6, trialTimeoutMs: 15000, totalTimeoutMs: 45000 } };
    const run = { action: "batch_run", ...common, profiles, piCases: [
      { id: "fixed-pass", title: "固定输出", prompt: "write the fixed output", checks: [{ path: "result.txt", expectedText: "fixed output" }], expectedAnswer: "fixed answer" },
      { id: "fixed-fail", title: "显式失败边界", prompt: "write the fixed output", checks: [{ path: "result.txt", expectedText: "deliberately different" }] },
      { id: "unchecked", title: "无检查即未知", prompt: "write the fixed output", checks: [] },
    ] };
    const gitProvider = join(repo, "Electron/resources/runtime/extensions/git-capability/agent/worktree-service.ts");
    await writeFile(bossProvider, providerPrelude + `
import {registerGitWorktreePlacementProviderV1} from ${JSON.stringify(gitProvider)};
export default function(pi) {
 registerGitWorktreePlacementProviderV1();
 pi.on('project_trust',()=>({trusted:'yes',remember:false}));
 pi.on('session_start',()=>writeFileSync(${JSON.stringify(join(agent, "active-tools.json"))},JSON.stringify(pi.getActiveTools())));
 const common=${JSON.stringify(common)}, create=${JSON.stringify(create)}, run=${JSON.stringify(run)};
 let serial=0;
 const ex=(id,args)=>call(id,'experiment',args);
 register(pi,async context=>{
  const messages=context.messages;
  const receipts=messages.filter(m=>m.role==='toolResult');
  const failure=receipts.find(m=>m.isError);
  if(failure) throw new Error('Real tool failed: '+text(failure));
  const got=id=>receipts.find(m=>m.toolCallId===id);
  const data=id=>JSON.parse(text(got(id)));
  const users=messages.filter(m=>m.role==='user');
  const user=text(users.at(-1));
  // A custom notification may be projected as a user message to the model. Only
  // these literal RPC prompts trigger actions; adoption still validates SDK entries.
  if(user==='按A正式实现'||user==='不要按A正式实现') {
   const id=user==='按A正式实现'?'adopt-approved':'adopt-denied';
   if(!got(id)) return [ex(id,{...common,action:'adopt',variantId:'candidate-a',reportFingerprint:data('report').report.fingerprint})];
   return [answer('采用结果：'+data(id).handoff.status)];
  }
  if(!got('create')) return [ex('create',create)];
  if(!got('freeze')) return [ex('freeze',{action:'freeze',experimentId:common.experimentId})];
  for(const variantId of ['candidate-a','candidate-b']) {
   const id=variantId;
   if(!got('prepare-'+id)) return [ex('prepare-'+id,{action:'variant_prepare',experimentId:common.experimentId,variantId,agentId:'prototype-'+id})];
   const path=data('prepare-'+id).preparation.path;
   if(!got('edit-'+id)) return [call('edit-'+id,'write',{path:join(path,'seed.txt'),content:id+'\\n'})];
   if(!got('checkpoint-'+id)) return [call('checkpoint-'+id,'bash',{command:'git -C '+JSON.stringify(path)+' add seed.txt extra.txt && git -C '+JSON.stringify(path)+' commit -m "private prototype checkpoint"'})];
   if(!got('freeze-'+id)) return [ex('freeze-'+id,{action:'variant_freeze',experimentId:common.experimentId,variantId})];
  }
  if(!got('run')) return [ex('run',run)];
  const statuses=receipts.filter(m=>m.toolCallId.startsWith('status-'));
  const status=statuses.length?JSON.parse(text(statuses.at(-1))).batch:null;
  if(!status||!['completed','cancelled','interrupted'].includes(status.state)) {
   await new Promise(done=>setTimeout(done,200));
   return [ex('status-'+(++serial),{...common,action:'batch_status'})];
  }
  if(!got('logs')) return [ex('logs',{...common,action:'batch_logs',trialId:status.trials[0].id,cursor:0,logLimit:4096})];
  if(!got('view')) return [ex('view',{...common,action:'batch_view',trialId:status.trials[0].id})];
  if(!got('report')) return [ex('report',{...common,action:'batch_report',saveReport:true,section:'points',limit:20})];
  return [answer('报告已展示；失败和unknown未隐藏，请由用户决定是否按A正式实现。')];
 });
}
`);
    const argv = [runtime.cliPath, "--mode", "rpc", "--session-dir", sessions, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--provider", "pilot-scripted", "--model", "fixture", "--thinking", "off", "-e", extension, "-e", bossProvider, "--skill", skill];
    child = spawn(runtime.nodePath, argv, { cwd: root, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: root, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", ELECTRON_RUN_AS_NODE: "1", PIPIUI_PROJECT_ROOT: root }, stdio: ["pipe", "pipe", "pipe"] });
    closed = once(child, "close").then(() => { processClosed = true; });
    child.on("error", (error) => { fatal = error; });
    child.stdin!.on("error", (error) => { if (!processClosed) fatal = error; });
    child.stderr!.on("data", (chunk) => { stderr = (stderr + chunk).slice(-10000); });
    const parse = createPiJsonlReader((line) => {
      const event = JSON.parse(line); events.push(event);
      if (event.type === "extension_error") fatal = new Error(JSON.stringify(event));
      if (event.type === "message_end" && event.message?.role === "assistant" && event.message.stopReason === "error") fatal = new Error(event.message.errorMessage);
      if (event.type === "tool_execution_end" && event.isError) fatal = new Error(JSON.stringify(event));
    });
    child.stdout!.on("data", (chunk) => { try { parse(chunk); } catch (error) { fatal = error as Error; } });
    let sequence = 0;
    async function rpc(type: string, params: Record<string, unknown> = {}) {
      const id = `pilot-${++sequence}`;
      child!.stdin!.write(JSON.stringify({ id, type, ...params }) + "\n");
      await until(() => events.some((event) => event.type === "response" && event.id === id));
      const response = events.find((event) => event.type === "response" && event.id === id);
      expect(response.success, JSON.stringify(response)).toBe(true); return response.data;
    }
    async function prompt(message: string) {
      const start = events.length;
      await rpc("prompt", { message });
      await until(() => events.slice(start).some((event) => event.type === "agent_settled"));
      if (fatal) throw fatal;
    }
    const state = await rpc("get_state");
    expect(state.model).toMatchObject({ provider: "pilot-scripted", id: "fixture" });
    expect(JSON.parse(await readFile(join(agent, "active-tools.json"), "utf8"))).toEqual(expect.arrayContaining(["experiment", "write", "bash"]));
    const commands = await rpc("get_commands");
    expect(commands.commands).toEqual(expect.arrayContaining([expect.objectContaining({ name: "skill:prototype-experiments", source: "skill" })]));
    await rpc("set_auto_retry", { enabled: false });
    await rpc("set_auto_compaction", { enabled: false });
    await prompt("请试做A、B两个原型，比较固定输出并报告失败和未知；暂不正式实现。");
    const receipt = (id: string) => events.find((event) => event.type === "tool_execution_end" && event.toolCallId === id)?.result?.details;
    const report = receipt("report");
    expect(report, stderr).toBeTruthy();
    expect(report.report).toMatchObject({ state: "completed", totals: { planned: 6, recorded: 6, started: 6 }, conditions: { baseline: "verified-frozen-evidence", resourceContention: "possible", cache: "unknown" } });
    expect(report.report.perVariant.map((v: any) => v.quality)).toEqual([{ pass: 1, fail: 1, unknown: 1 }, { pass: 1, fail: 1, unknown: 1 }]);
    expect(report.report.variants.map((v: any) => [v.id, v.label])).toEqual([["candidate-a", "A"], ["candidate-b", "B"]]);
    expect(receipt("view").view).toMatchObject({ mode: "read-only-log", logAvailable: true, ownerState: "not-active" });
    expect(receipt("logs").log.text.length).toBeGreaterThan(0);
    const savedReport = JSON.parse(await readFile(resolve(root, report.reportPath), "utf8"));
    expect(savedReport.fingerprint).toBe(report.report.fingerprint);
    expect(savedReport.points.map((point: any) => point.usage.cost.actualBill)).toEqual(Array(6).fill(false));
    expect(savedReport.points.filter((point: any) => point.quality === "unknown")).toHaveLength(2);
    const metadata = JSON.parse(await readFile(join(base, "batch.json"), "utf8"));
    const trials: BatchTrial[] = await Promise.all(metadata.trialIds.map(async (id: string) => {
      const trial = JSON.parse(await readFile(join(base, "trials", id, "trial.json"), "utf8"));
      trial.run = JSON.parse(await readFile(join(base, "trials", id, "run.json"), "utf8"));
      return trial;
    }));
    const batch = { ...metadata, trials } as BatchRecord;
    expect(new Set(batch.trials.map((t) => t.run!.sessionId)).size).toBe(6);
    const [a, b] = batch.trials.map((t) => t.run!);
    expect(a.pid).not.toBe(b.pid);
    expect(Math.max(Date.parse(a.startedAt), Date.parse(b.startedAt))).toBeLessThan(Math.min(Date.parse(a.endedAt), Date.parse(b.endedAt)));
    for (const trial of batch.trials) {
      const directory = join(base, "trials", trial.id);
      pids.add(trial.run!.pid!);
      expect(trial.run).toMatchObject({ state: "completed", runtime, toolCalls: 2, usage: { total: 36, source: "pi-session" } });
      expect(await readFile(join(directory, "workspace/observed.txt"), "utf8")).toBe(`${trial.variantId}\n`);
      expect(await readFile(join(directory, "workspace/extra.txt"), "utf8")).toBe("included untracked input\n");
      expect(await readFile(join(directory, "state/home/owner.txt"), "utf8")).toBe(String(trial.run!.pid));
      expect(JSON.parse(await readFile(join(directory, "state/agent/auth.json"), "utf8"))).toEqual({});
      expect(alive(trial.run!.pid!)).toBe(false);
    }
    // The denial and approval enter through real RPC prompt(), not SessionManager.appendMessage.
    await prompt("不要按A正式实现");
    expect(receipt("adopt-denied").handoff.status).toBe("suggestion-draft");
    await prompt("按A正式实现");
    const handoff = receipt("adopt-approved").handoff;
    expect(handoff).toMatchObject({ status: "implementation-handoff", reason: "explicit-user-selection", reportFingerprint: savedReport.fingerprint, selection: { variantId: "candidate-a", label: "A" }, mergePolicy: "never", automaticImplementation: false });
    const entries = (await rpc("get_entries")).entries;
    const user = entries.find((entry: any) => entry.id === handoff.userEvidence.entryId);
    const displayed = entries.find((entry: any) => entry.message?.role === "toolResult" && entry.message?.toolCallId === "report");
    expect(handoff.userEvidence.sessionId).toBe(state.sessionId);
    expect(user.message).toMatchObject({ role: "user", content: [{ type: "text", text: "按A正式实现" }] });
    expect(displayed.message.details.report.fingerprint).toBe(savedReport.fingerprint);
    expect(entries.indexOf(displayed)).toBeLessThan(entries.indexOf(user));
    expect(await git(root, "rev-parse", "HEAD")).toBe(mainHead);
    expect(await readFile(join(root, ".git/index"))).toEqual(mainIndex);
    expect(await git(root, "status", "--porcelain=v1", "-z")).toBe(mainStatus);
    expect(await readFile(join(root, "seed.txt"), "utf8")).toBe("dirty baseline\n");
    for (const id of ["candidate-a", "candidate-b"]) {
      expect(JSON.parse(await readFile(join(root, `.pi/worktree-policies/prototype-${id}.json`), "utf8"))).toMatchObject({ mergePolicy: "never" });
      expect(await git(receipt(`prepare-${id}`).preparation.path, "rev-parse", "HEAD")).not.toBe(mainHead);
    }
  } finally {
    // Only this fixture's subprocess is signalled. Nested runners have IPC-owner
    // liveness guards; collect persisted PIDs as well and require all to be gone.
    if (child && !processClosed) child.kill("SIGTERM");
    const killTimer = setTimeout(() => { if (child && !processClosed) child.kill("SIGKILL"); }, 1500);
    try { if (closed) await closed; } finally { clearTimeout(killTimer); }
    const meta = JSON.parse(await readFile(join(base, "batch.json"), "utf8").catch(() => "null"));
    for (const id of meta?.trialIds ?? []) {
      const trial = JSON.parse(await readFile(join(base, "trials", id, "trial.json"), "utf8").catch(() => "null"));
      if (trial?.pid) pids.add(trial.pid);
    }
    const end = Date.now() + 3000;
    while ([...pids].some(alive) && Date.now() < end) await pause(25);
    const remaining = [...pids].filter(alive);
    for (const pid of remaining) process.kill(pid, "SIGKILL");
    await rm(root, { recursive: true, force: true });
    expect(remaining, "Fixture-owned nested Pi processes must exit with their owner").toEqual([]);
  }
}, 80000);
