import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createPiJsonlReader, resolvePiRuntime, startPiSession, type PiRunHandle, type PiRunEvent, type PiProfile } from "../agent/pi-session.js";

const roots: string[] = [], handles: PiRunHandle[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const handle of handles.splice(0)) { handle.cancel(); await handle.result; }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const candidates = [process.env.PIPIUI_TEST_PI_CLI,
    join(repo, "build/PipiUI.app/Contents/Resources/pipiui-embedded/pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    join(repo, "../../..", "build/PipiUI.app/Contents/Resources/pipiui-embedded/pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  ].filter((path): path is string => Boolean(path));
  let cli: string | undefined;
  for (const path of candidates) if (await access(path).then(() => true, () => false)) { cli = path; break; }
  if (!cli) throw new Error("A real installed target Pi is required; no mock or installation fallback");
  const runtime = await resolvePiRuntime(cli);
  const root = await mkdtemp(join(tmpdir(), "lab-pi-session-")); roots.push(root);
  const workspace = join(root, "worktree"); await mkdir(workspace);
  const extension = join(root, "scripted.mjs");
  await writeFile(extension, `
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
export default function(pi) {
 pi.registerCommand('lab_handled', { description:'Handle without a model run', handler:async()=>{} });
 pi.registerProvider('lab-scripted', {
  name:'Lab scripted', baseUrl:'http://127.0.0.1:1/never', apiKey:'fixture-not-a-secret', api:'lab-scripted-api',
  models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],
  streamSimple(model, context, options) {
   const stream=createAssistantMessageEventStream();
   (async()=>{
    const result={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[],usage:{input:11,output:7,cacheRead:0,cacheWrite:0,totalTokens:18,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'pending',timestamp:Date.now()};
    try {
     await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,Number(process.env.LAB_DELAY||0));options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('cancelled'))},{once:true});});
     const wrote=context.messages.some(m=>m.role==='toolResult');
     const block=wrote?{type:'text',text:'finished '+(process.env.LAB_TEXT||'ok')}:{type:'toolCall',id:'write-result',name:'write',arguments:{path:'result.txt',content:process.env.LAB_TEXT||'ok'}};
     result.content=[block];result.stopReason=wrote?'stop':'toolUse';
     stream.push({type:'start',partial:result});
     if(wrote){stream.push({type:'text_start',contentIndex:0,partial:result});stream.push({type:'text_delta',contentIndex:0,delta:block.text,partial:result});stream.push({type:'text_end',contentIndex:0,content:block.text,partial:result});}
     else {stream.push({type:'toolcall_start',contentIndex:0,partial:result});stream.push({type:'toolcall_end',contentIndex:0,toolCall:block,partial:result});}
     stream.push({type:'done',reason:result.stopReason,message:result});stream.end();
    }catch(error){result.stopReason='aborted';result.errorMessage=String(error);stream.push({type:'error',reason:'aborted',error:result});stream.end();}
   })(); return stream;
  }
 });
}
`);
  const profile: PiProfile = { id: "scripted", provider: "lab-scripted", model: "fixture", thinking: "off", tools: ["write"], extensions: [extension] };
  return { runtime, root, workspace, profile };
}

it("JSONL只按LF分隔，保留Unicode分隔符与跨chunk UTF-8", () => {
  const lines: string[] = [];
  const reader = createPiJsonlReader((line) => lines.push(line));
  const input = Buffer.from(JSON.stringify({ text: "中文\u2028下一行\u2029" }) + "\r\n" + '{"done":true}\n');
  for (let at = 0; at < input.length; at += 2) reader(input.subarray(at, at + 2));
  expect(lines.map((line) => JSON.parse(line))).toEqual([{ text: "中文\u2028下一行\u2029" }, { done: true }]);
});

it("真实Pi使用声明profile调用工具并以settled完成，记录实际usage", async () => {
  const f = await fixture(), events: PiRunEvent[] = [];
  const text = "中文\u2028line\u2029end";
  const handle = await startPiSession({ ...f, stateDirectory: join(f.root, "run"), prompt: "Write the fixed fixture", timeoutMs: 20000, environment: { LAB_TEXT: text }, onEvent: (event) => events.push(event) }); handles.push(handle);
  const result = await handle.result;
  expect(result, JSON.stringify(result)).toMatchObject({ state: "completed", profile: { provider: "lab-scripted", model: "fixture" }, toolCalls: 1, stopReason: "stop" });
  expect(await readFile(join(f.workspace, "result.txt"), "utf8")).toBe(text);
  expect(result.answer).toBe("finished " + text);
  expect(result.sessionId).toBeTruthy();
  expect(result.effectiveSystemPromptFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(result.usage).toMatchObject({ input: 22, output: 14, total: 36, cost: 0, source: "pi-session" });
  expect(events.some((event) => event.type === "ready")).toBe(true);
  expect(events.some((event) => event.type === "agent_settled")).toBe(true);
  expect(events.at(-1)?.type).toBe("terminal");
  expect(await readFile(join(f.root, "run/agent/trust.json"), "utf8").catch(() => "")).toBe("");
  expect(JSON.parse(await readFile(join(f.root, "run/effective-profile.json"), "utf8"))).toMatchObject({ experimentChild: "1" });
}, 30000);

it("真实Pi处理扩展命令后直接完成，不等待不存在的settled事件", async () => {
  const f = await fixture(), events: PiRunEvent[] = [];
  const handle = await startPiSession({ ...f, stateDirectory: join(f.root, "handled"), prompt: "/lab_handled", timeoutMs: 5000, onEvent: event => events.push(event) });
  handles.push(handle);
  const result = await handle.result;
  expect(result, JSON.stringify(result)).toMatchObject({ state: "completed", stopReason: "handled", toolCalls: 0 });
  expect(events.some(event => event.type === "agent_start")).toBe(false);
  expect(events.some(event => event.type === "agent_settled")).toBe(false);
  expect(result.usage).toMatchObject({ total: 0, cost: 0 });
}, 10000);

it("真实Pi完整工具回合命中压缩与工具归属钩子的活实例", async () => {
  const f = await fixture();
  const guards = resolve(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/pi-ext/subagent");
  const evidence = join(f.root, "guard-evidence.json");
  const extension = f.profile.extensions![0];
  const source = await readFile(extension, "utf8");
  const imports = `
import {AgentSession,ExtensionRunner} from '@earendil-works/pi-coding-agent';
import {writeFileSync} from 'node:fs';
import {installMidTurnCompactionGuard} from ${JSON.stringify(join(guards, "mid-turn-compaction.ts"))};
import {installFollowUpCompactionGuard} from ${JSON.stringify(join(guards, "follow-up-compaction.ts"))};
import {installFatalHookPropagation} from ${JSON.stringify(join(guards, "fatal-hook.ts"))};
import {installIdleNotificationGuard} from ${JSON.stringify(join(guards, "idle-notification.ts"))};
import {installExtensionToolOwnershipCapture,hasCapturedExtensionToolOwnership} from ${JSON.stringify(join(guards, "agents.ts"))};
`;
  const install = `
 const proof={installed:[installMidTurnCompactionGuard(AgentSession),installFollowUpCompactionGuard(AgentSession),installFatalHookPropagation(ExtensionRunner),installIdleNotificationGuard(AgentSession),installExtensionToolOwnershipCapture(ExtensionRunner)],runs:0,ownership:false};
 const save=()=>writeFileSync(${JSON.stringify(evidence)},JSON.stringify(proof));
 const run=AgentSession.prototype._runAgentPrompt;
 AgentSession.prototype._runAgentPrompt=function(...args){proof.runs++;save();return run.apply(this,args);};
 const bind=ExtensionRunner.prototype.bindCore;
 ExtensionRunner.prototype.bindCore=function(...args){const result=bind.apply(this,args);proof.ownership=hasCapturedExtensionToolOwnership();save();return result;};
 save();
`;
  await writeFile(extension, imports + source.replace("export default function(pi) {", "export default function(pi) {" + install));
  const handle = await startPiSession({ ...f, stateDirectory: join(f.root, "guards"), prompt: "Write the fixed fixture", timeoutMs: 15000 });
  handles.push(handle);
  expect(await handle.result).toMatchObject({ state: "completed", toolCalls: 1 });
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  expect(proof.installed).toEqual([true, true, true, true, true]);
  expect(proof.runs).toBeGreaterThan(0);
  expect(proof.ownership).toBe(true);
}, 20000);

it("真实Pi将旧SDK导入映射到当前SDK，并加载原有MCP扩展", async () => {
  const f = await fixture();
  const extension = f.profile.extensions![0];
  const proof = join(f.root, "legacy-sdk.json");
  const source = await readFile(extension, "utf8");
  const modules = resolve(dirname(f.runtime.cliPath), "../../..");
  await writeFile(extension, `import {VERSION,AgentSession as OldSession} from '@mariozechner/pi-coding-agent';
import {AgentSession} from '@earendil-works/pi-coding-agent';
import domino from ${JSON.stringify(join(modules, '@mixmark-io/domino/lib/index.js'))};
import {writeFileSync} from 'node:fs';\n` + source.replace("export default function(pi) {", `export default function(pi) {writeFileSync(${JSON.stringify(proof)},JSON.stringify({version:VERSION,sameClass:OldSession===AgentSession,htmlText:domino.createDocument('<p>Pi 1.0</p>').body.textContent}));`));
  f.profile.extensions!.push(join(modules, "pi-mcp-extension/src/index.ts"));
  const handle = await startPiSession({ ...f, stateDirectory: join(f.root, "legacy"), prompt: "Write the fixed fixture", timeoutMs: 15000 });
  handles.push(handle);
  expect(await handle.result).toMatchObject({ state: "completed", toolCalls: 1 });
  expect(JSON.parse(await readFile(proof, "utf8"))).toEqual({ version: f.runtime.version, sameClass: true, htmlText: 'Pi 1.0' });
}, 20000);

it("被测子进程的结构性标记阻止递归启动，且不创建新的运行状态", async () => {
  const f = await fixture();
  vi.stubEnv("PIPIUI_EXPERIMENT_CHILD", "1");
  await expect(startPiSession({ ...f, stateDirectory: join(f.root, "nested"), prompt: "must not spawn", timeoutMs: 1000 })).rejects.toMatchObject({ code: "nested-experiment-not-allowed" });
  await expect(access(join(f.root, "nested"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("两条真实Pi会话可同时推进且可写状态不串扰", async () => {
  const a = await fixture(), b = await fixture();
  const left = await startPiSession({ ...a, stateDirectory: join(a.root, "run"), prompt: "write left", timeoutMs: 20000, environment: { LAB_TEXT: "left", LAB_DELAY: "150" } }); handles.push(left);
  const right = await startPiSession({ ...b, stateDirectory: join(b.root, "run"), prompt: "write right", timeoutMs: 20000, environment: { LAB_TEXT: "right", LAB_DELAY: "150" } }); handles.push(right);
  const [one, two] = await Promise.all([left.result, right.result]);
  expect(one.state, JSON.stringify(one)).toBe("completed"); expect(two.state, JSON.stringify(two)).toBe("completed");
  expect(one.pid).not.toBe(two.pid);
  expect(Math.max(Date.parse(one.startedAt), Date.parse(two.startedAt))).toBeLessThan(Math.min(Date.parse(one.endedAt), Date.parse(two.endedAt)));
  expect(await readFile(join(a.workspace, "result.txt"), "utf8")).toBe("left");
  expect(await readFile(join(b.workspace, "result.txt"), "utf8")).toBe("right");
}, 30000);

it("取消与超时终止自己的Pi，不把prompt ack当作成功", async () => {
  const f = await fixture();
  const handle = await startPiSession({ ...f, stateDirectory: join(f.root, "cancel"), prompt: "slow", timeoutMs: 20000, environment: { LAB_DELAY: "10000" }, onEvent: (event) => { if (event.type === "agent_start") handle.cancel(); } }); handles.push(handle);
  expect((await handle.result).state).toBe("cancelled");
  const timed = await startPiSession({ ...f, stateDirectory: join(f.root, "timeout"), prompt: "slow", timeoutMs: 250, environment: { LAB_DELAY: "10000" } }); handles.push(timed);
  expect((await timed.result).state).toBe("timed-out");
  await expect(readFile(join(f.workspace, "result.txt"))).rejects.toMatchObject({ code: "ENOENT" });
}, 30000);

it("协调器被强制结束时真实Pi通过专属IPC失联自行退出，不遗留继续请求的孤儿", async () => {
  const f = await fixture();
  const compiled = join(f.root, "source-adapter");
  await mkdir(compiled);
  await writeFile(join(compiled, "package.json"), '{"type":"module"}');
  // Compile current source, not a possibly stale checked-out dist artifact.
  for (const name of ["pi-session", "paths", "snapshot"]) {
    const source = await readFile(new URL(`../agent/${name}.ts`, import.meta.url), "utf8");
    await writeFile(join(compiled, `${name}.js`), transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText);
  }
  const script = join(f.root, "coordinator.mjs");
  const input = { runtime: f.runtime, workspace: f.workspace, profile: f.profile, stateDirectory: join(f.root, "orphan-run"), prompt: "slow orphan fixture", timeoutMs: 60000, environment: { LAB_DELAY: "60000" } };
  await writeFile(script, `import {startPiSession} from './source-adapter/pi-session.js';\nlet handle; handle=await startPiSession({...${JSON.stringify(input)},onEvent(event){if(event.type==='agent_start')process.send({pid:handle.pid});}}); await handle.result;`);
  const parent = spawn(process.execPath, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let pid: number | undefined, stderr = "";
  parent.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-6000); });
  const closed = once(parent, "close");
  const alive = (value: number) => { try { process.kill(value, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } };
  try {
    pid = await new Promise<number>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`coordinator startup timeout: ${stderr}`)), 12000);
      parent.once("message", (message: any) => { clearTimeout(timer); typeof message?.pid === "number" ? done(message.pid) : reject(new Error("missing real Pi pid")); });
      parent.once("error", (error) => { clearTimeout(timer); reject(error); });
      parent.once("exit", () => { clearTimeout(timer); reject(new Error(`coordinator exited early: ${stderr}`)); });
    });
    expect(alive(pid)).toBe(true);
    parent.kill("SIGKILL");
    await closed;
    const deadline = Date.now() + 8000;
    while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alive(pid)).toBe(false);
    await expect(readFile(join(f.workspace, "result.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
    await closed;
    if (pid && alive(pid)) process.kill(pid, "SIGTERM");
  }
}, 30000);

it("声明的扩展加载失败时不继续执行模型任务", async () => {
  const f = await fixture();
  const broken = join(f.root, "broken.mjs");
  await writeFile(broken, "export default function(){ throw new Error('fixture-load-failed'); }");
  const handle = await startPiSession({ ...f, profile: { ...f.profile, extensions: [...f.profile.extensions!, broken] }, stateDirectory: join(f.root, "run"), prompt: "must not run", timeoutMs: 10000 }); handles.push(handle);
  const result = await handle.result;
  expect(result).toMatchObject({ state: "failed", toolCalls: 0 });
  expect(result.reason + result.stderr).toMatch(/declared Pi extension failed to load|fixture-load-failed/);
  await expect(readFile(join(f.workspace, "result.txt"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("真实Pi显式加载Skill并核对实际可用命令", async () => {
  const f = await fixture();
  const skill = join(f.root, "skills", "lab-fixture", "SKILL.md");
  await mkdir(dirname(skill), { recursive: true });
  await writeFile(skill, "---\nname: lab-fixture\ndescription: A deterministic test skill\n---\nUse the fixture write tool.\n");
  const handle = await startPiSession({ ...f, profile: { ...f.profile, skills: [skill] }, stateDirectory: join(f.root, "run"), prompt: "/skill:lab-fixture", timeoutMs: 10000 }); handles.push(handle);
  const result = await handle.result;
  expect(result.state, JSON.stringify(result)).toBe("completed");
  expect(await readFile(join(f.workspace, "result.txt"), "utf8")).toBe("ok");
});

it("含引号和反斜线的凭据在结构化事件及答案中仍脱敏", async () => {
  const f = await fixture(), events: PiRunEvent[] = [], secret = 'quote"slash\\secret-value';
  const handle = await startPiSession({ ...f, stateDirectory: join(f.root, "run"), prompt: "write fixture", timeoutMs: 10000, environment: { LAB_TEXT: secret, LAB_TOKEN: secret }, onEvent: (event) => events.push(event) }); handles.push(handle);
  const result = await handle.result;
  expect(result.state, JSON.stringify(result)).toBe("completed");
  expect(result.answer).toBe("finished [REDACTED]");
  expect(JSON.stringify(events)).not.toContain(JSON.stringify(secret).slice(1, -1));
});

it("离线启动仍可解析内置真实provider目录，取消握手后不发模型请求", async () => {
  const f = await fixture(), events: PiRunEvent[] = [];
  const handle = await startPiSession({ ...f, profile: { id: "catalog-check", provider: "openai", model: "gpt-4o", thinking: "off", tools: [] }, stateDirectory: join(f.root, "catalog"), prompt: "must not be sent", timeoutMs: 10000, onEvent: (event) => { events.push(event); if (event.type === "ready") handle.cancel(); } }); handles.push(handle);
  const result = await handle.result;
  expect(result.state, JSON.stringify(result)).toBe("cancelled");
  expect(events.find((event) => event.type === "ready")?.data).toMatchObject({ model: "gpt-4o", provider: "openai" });
  expect(events.some((event) => event.type === "agent_start")).toBe(false);
});

it("明确绑定runtime并拒绝旧状态目录和环境覆盖", async () => {
  await expect(resolvePiRuntime("pi")).rejects.toMatchObject({ code: "pi-runtime-unavailable" });
  const f = await fixture();
  await expect(startPiSession({ ...f, stateDirectory: join(f.root, "run"), prompt: "x", timeoutMs: 1000, environment: { NODE_OPTIONS: "--bad" } })).rejects.toMatchObject({ code: "invalid-environment" });
  await expect(startPiSession({ ...f, stateDirectory: join(f.root, "run"), prompt: "x", timeoutMs: 1000 })).rejects.toMatchObject({ code: "EEXIST" });
});
