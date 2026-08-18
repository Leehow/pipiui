import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

describe("PiHostBackend fake-pi end to end",()=>{let root="";afterEach(async()=>{if(root)await (await import("node:fs/promises")).rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25})});
/** Same reason: the panel row flips to aborted inside that background sweep. */
const waitForAgentState=async(backend:any,agentId:string,state:string,timeoutMs=3_000)=>{const deadline=Date.now()+timeoutMs;for(;;){const agent=((await backend.handle("listAgents",["session-1"])) as any[]).find(a=>a.agentId===agentId);if(agent?.state===state)return agent;if(Date.now()>deadline)return agent;await new Promise(r=>setTimeout(r,10));}};
/** `stop` no longer awaits the subagent sweep, so poll for the receipt it writes. */
const waitForPrompt=async(path:string,needle:string,timeoutMs=3_000)=>{const deadline=Date.now()+timeoutMs;for(;;){const log=await readFile(path,"utf8").catch(()=>"");if(log.includes(needle))return log;if(Date.now()>deadline)throw new Error(`prompt log never contained ${needle}: ${log}`);await new Promise(r=>setTimeout(r,10));}};
it("stop sweeps the session's running background subagents instead of leaving them to wake the stopped session",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-pi-sweep-"));const cwd=join(root,"project");const dir=join(root,"sessions","project");await mkdir(dir,{recursive:true});await mkdir(cwd,{recursive:true});const promptLog=join(root,"prompts.log");await writeFile(join(dir,"session.jsonl"),[JSON.stringify({type:"session",version:3,id:"session-1",timestamp:"2026-08-10T00:00:00.000Z",cwd})].join("\n")+"\n");const backend=createPiHostBackend({agentDir:join(root,"agent"),sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),canonicalProjectPaths:async()=>undefined,piPath:"node",spawn:(_bin,_args,options)=>spawn("/usr/local/bin/node",[new URL("./fake-pi.mjs",import.meta.url).pathname],{...options,env:{...options.env,PATH:"/usr/local/bin:/usr/bin:/bin",FAKE_PI_PROMPT_LOG:promptLog}}) as any});await backend.handle("addProject",[cwd]);await backend.handle("sendPrompt",["session-1","__agent_running__"]);await new Promise(r=>setTimeout(r,30));const before=(await backend.handle("listAgents",["session-1"]) as any[]).find(a=>a.agentId==="agent-1");expect(before?.state).toBe("running");await backend.handle("stop",["session-1"]);await waitForPrompt(promptLog,"/subagent_abort_all");const after=await waitForAgentState(backend,"agent-1","aborted");expect(after?.state).toBe("aborted");await backend.close();});
it("stop arms the host-stop quiet sweep even when no background subagent is running",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-pi-quiet-"));const cwd=join(root,"project");const dir=join(root,"sessions","project");await mkdir(dir,{recursive:true});await mkdir(cwd,{recursive:true});const promptLog=join(root,"prompts.log");await writeFile(join(dir,"session.jsonl"),[JSON.stringify({type:"session",version:3,id:"session-1",timestamp:"2026-08-10T00:00:00.000Z",cwd})].join("\n")+"\n");const backend=createPiHostBackend({agentDir:join(root,"agent"),sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),canonicalProjectPaths:async()=>undefined,piPath:"node",spawn:(_bin,_args,options)=>spawn("/usr/local/bin/node",[new URL("./fake-pi.mjs",import.meta.url).pathname],{...options,env:{...options.env,PATH:"/usr/local/bin:/usr/bin:/bin",FAKE_PI_PROMPT_LOG:promptLog}}) as any});await backend.handle("addProject",[cwd]);await backend.handle("sendPrompt",["session-1","go"]);await new Promise(r=>setTimeout(r,30));const agents=await backend.handle("listAgents",["session-1"]) as any[];expect(agents.every(a=>a.state!=="running")).toBe(true);await backend.handle("stop",["session-1"]);await waitForPrompt(promptLog,"/subagent_abort_all");await backend.close();});
it("loads a configured project and its JSONL history, then spawns RPC and relays streamed events",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-pi-"));const cwd=join(root,"project");const dir=join(root,"sessions","project");await mkdir(dir,{recursive:true});await mkdir(cwd,{recursive:true});const path=join(dir,"session.jsonl");await writeFile(path,[JSON.stringify({type:"session",version:3,id:"session-1",timestamp:"2026-08-10T00:00:00.000Z",cwd}),JSON.stringify({type:"message",id:"u1",parentId:null,timestamp:"2026-08-10T00:00:01.000Z",message:{role:"user",content:"saved"}})].join("\n")+"\n");const backend=createPiHostBackend({agentDir:join(root,"agent"),sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),canonicalProjectPaths:async()=>undefined,piPath:"node",spawn:(_bin,_args,options)=>spawn("/usr/local/bin/node",[new URL("./fake-pi.mjs",import.meta.url).pathname],{...options,env:{...options.env,PATH:"/usr/local/bin:/usr/bin:/bin"}}) as any});await backend.handle("addProject",[cwd]);const projects=await backend.handle("listProjects",[]) as any[];expect(projects).toHaveLength(1);const sessions=await backend.handle("listSessions",[projects[0].id]) as any[];expect(sessions[0].id).toBe("session-1");expect(await backend.handle("getSessionHistory",["session-1"])).toMatchObject([{content:"saved"}]);const events:any[]=[];const off=backend.subscribe(e=>events.push(e));await backend.handle("queueFollowUp",["session-1","later"]);await backend.handle("sendPrompt",["session-1","go"]);await new Promise(r=>setTimeout(r,20));off();expect(events.map(e=>e.channel==="stream"&&e.event.type)).toEqual(expect.arrayContaining(["thinking","text","tool_call","tool_result","status"]));
    // Tool args stream on toolcall_delta; toolcall_end promotes the card to the real id/name.
    expect(events.some(e=>e.channel==="stream"&&e.event.type==="tool_call"&&e.event.contentIndex===1&&e.event.toolCallId==="tool-1"&&e.event.name==="fake_tool"&&e.event.delta==='{"command":"ls -la"}')).toBe(true);expect(events.some(e=>e.channel==="stream"&&e.event.status==="settled")).toBe(true);expect(events.some(e=>e.channel==="stream"&&e.event.pendingFollowUps?.includes("later"))).toBe(true);expect(events.some(e=>e.channel==="session_stats"&&e.event.type==="snapshot"&&e.event.sessionId==="session-1")).toBe(true);expect(await backend.handle("getSessionStats",["session-1"])).toMatchObject({sessionId:"session-1",tokens:{input:1200,output:340,cacheRead:800,cacheWrite:100,total:2440},cost:0.00123,contextUsage:{tokens:15000,contextWindow:262144,percent:5.7},model:{provider:"fake",id:"fake-1",name:"Fake"}});expect(await backend.handle("listAgents",["session-1"])).toEqual([expect.objectContaining({agentId:"agent-1",parentId:null,depth:1,role:"general-purpose",title:"Build fixture",sessionId:"session-1"})]);expect(await backend.handle("getWorktreeStatus",["agent-1"])).toMatchObject({lifecycle:"pendingReview",merge:"ready",discard:"ready"});
// This used to assert that mergeWorktree reported success. It reported success without running
// any Git: the branch stayed unmerged and the user was told otherwise. Automatic finalization is
// real now (PIPIUI_WORKTREE_FINALIZER=pi); the manual fallback for a retained worktree must fail
// loudly until it routes through a real operation, and the status must stay pendingReview.
await expect(backend.handle("mergeWorktree",["agent-1"])).rejects.toThrow(/not implemented in this host yet/);
expect(await backend.handle("getWorktreeStatus",["agent-1"])).toMatchObject({lifecycle:"pendingReview",merge:"ready"});
await expect(backend.handle("discardWorktree",["agent-1"])).rejects.toThrow(/not implemented in this host yet/);expect(await backend.handle("capabilities",[])).toMatchObject({computerUse:false,revealInFinder:true});});

it("serves real get_session_stats snapshots: empty session, missing usage, and RPC errors stay distinguishable",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-pi-stats-"));const cwd=join(root,"project");const dir=join(root,"sessions","project");await mkdir(dir,{recursive:true});await mkdir(cwd,{recursive:true});const path=join(dir,"session.jsonl");await writeFile(path,[JSON.stringify({type:"session",version:3,id:"session-1",timestamp:"2026-08-10T00:00:00.000Z",cwd})].join("\n")+"\n");const spawnPi=()=>({piPath:"node",spawn:(_bin,_args,options)=>spawn("/usr/local/bin/node",[new URL("./fake-pi.mjs",import.meta.url).pathname],{...options,env:{...options.env,PATH:"/usr/local/bin:/usr/bin:/bin"}}) as any});const backend=createPiHostBackend({agentDir:join(root,"agent"),sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),canonicalProjectPaths:async()=>undefined,...spawnPi()});
// Browsing a session that never ran must not spawn Pi: zeros, no fabricated window/model.
const empty=await backend.handle("getSessionStats",["session-1"]) as any;expect(empty).toMatchObject({sessionId:"session-1",tokens:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0},cost:0});expect(empty.contextUsage).toBeUndefined();expect(empty.model).toBeUndefined();
// A real turn establishes last-known occupancy. A later turn that omits
// contextUsage must fall back to that last-known window instead of guessing.
await backend.handle("sendPrompt",["session-1","go"]);await new Promise(r=>setTimeout(r,20));
const events:any[]=[];const off=backend.subscribe(e=>events.push(e));await backend.handle("sendPrompt",["session-1","no-usage"]);await new Promise(r=>setTimeout(r,20));off();const missing=await backend.handle("getSessionStats",["session-1"]) as any;expect(missing.tokens).toMatchObject({input:1200,output:340,cacheRead:800,cacheWrite:100,total:2440});expect(missing.cost).toBe(0.00123);expect(missing.contextUsage).toMatchObject({tokens:15000,contextWindow:262144,percent:5.7});expect(events.some(e=>e.channel==="session_stats"&&e.event.type==="snapshot"&&e.event.stats.contextUsage&&e.event.stats.contextUsage.tokens===15000)).toBe(true);
// A failing pi RPC surfaces as a rejected command, not a fabricated snapshot.
await backend.handle("sendPrompt",["session-1","fail-stats"]);await new Promise(r=>setTimeout(r,20));await expect(backend.handle("getSessionStats",["session-1"])).rejects.toThrow(/stats unavailable/);
// No id and no active session: explicit error rather than a guessed session.
const fresh=createPiHostBackend({agentDir:join(root,"agent"),sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),canonicalProjectPaths:async()=>undefined,...spawnPi()});await expect(fresh.handle("getSessionStats",[])).rejects.toThrow(/no active session/);});

it("tags streamed thinking with a per-message segment epoch",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-pi-seg-"));const cwd=join(root,"project");const dir=join(root,"sessions","project");await mkdir(dir,{recursive:true});await mkdir(cwd,{recursive:true});await writeFile(join(dir,"session.jsonl"),[JSON.stringify({type:"session",version:3,id:"session-1",timestamp:"2026-08-10T00:00:00.000Z",cwd})].join("\n")+"\n");const backend=createPiHostBackend({agentDir:join(root,"agent"),sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),canonicalProjectPaths:async()=>undefined,piPath:"node",spawn:(_bin,_args,options)=>spawn("/usr/local/bin/node",[new URL("./fake-pi.mjs",import.meta.url).pathname],{...options,env:{...options.env,PATH:"/usr/local/bin:/usr/bin:/bin"}}) as any});await backend.handle("addProject",[cwd]);const events:any[]=[];const off=backend.subscribe(e=>events.push(e));await backend.handle("sendPrompt",["session-1","__segments__"]);await new Promise(r=>setTimeout(r,20));off();
// Pi restarts contentIndex at every assistant message; the second thinking block
// at contentIndex 0 must carry a fresh segment so the UI keeps the blocks apart.
const thinking=events.filter(e=>e.channel==="stream"&&e.event.type==="thinking").map(e=>[e.event.segment,e.event.contentIndex,e.event.delta]);expect(thinking).toEqual([[0,0,"think"],[1,0,"reflect"]]);});

it("emits a tool_call card on toolcall_start so the UI does not wait for toolcall_end",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-pi-tool-start-"));const cwd=join(root,"project");const dir=join(root,"sessions","project");await mkdir(dir,{recursive:true});await mkdir(cwd,{recursive:true});await writeFile(join(dir,"session.jsonl"),[JSON.stringify({type:"session",version:3,id:"session-1",timestamp:"2026-08-10T00:00:00.000Z",cwd})].join("\n")+"\n");const backend=createPiHostBackend({agentDir:join(root,"agent"),sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),canonicalProjectPaths:async()=>undefined,piPath:"node",spawn:(_bin,_args,options)=>spawn("/usr/local/bin/node",[new URL("./fake-pi.mjs",import.meta.url).pathname],{...options,env:{...options.env,PATH:"/usr/local/bin:/usr/bin:/bin"}}) as any});await backend.handle("addProject",[cwd]);const events:any[]=[];const off=backend.subscribe(e=>events.push(e));await backend.handle("sendPrompt",["session-1","__tool_start_only__"]);await new Promise(r=>setTimeout(r,20));off();
const toolCalls=events.filter(e=>e.channel==="stream"&&e.event.type==="tool_call").map(e=>e.event);
expect(toolCalls).toEqual([expect.objectContaining({type:"tool_call",sessionId:"session-1",contentIndex:1})]);});

it("forwards a terminal stopReason error as a stream error so a failed turn is never blank",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-pi-fail-"));const cwd=join(root,"project");const dir=join(root,"sessions","project");await mkdir(dir,{recursive:true});await mkdir(cwd,{recursive:true});await writeFile(join(dir,"session.jsonl"),[JSON.stringify({type:"session",version:3,id:"session-1",timestamp:"2026-08-10T00:00:00.000Z",cwd})].join("\n")+"\n");const backend=createPiHostBackend({agentDir:join(root,"agent"),sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),canonicalProjectPaths:async()=>undefined,piPath:"node",spawn:(_bin,_args,options)=>spawn("/usr/local/bin/node",[new URL("./fake-pi.mjs",import.meta.url).pathname],{...options,env:{...options.env,PATH:"/usr/local/bin:/usr/bin:/bin"}}) as any});await backend.handle("addProject",[cwd]);const events:any[]=[];const off=backend.subscribe(e=>events.push(e));await backend.handle("sendPrompt",["session-1","__fail_turn__"]);await new Promise(r=>setTimeout(r,20));off();
// Pi reports message_end with stopReason "error" + errorMessage and no content;
// the host must surface it as a stream error so the UI can render the failure.
const errors=events.filter(e=>e.channel==="stream"&&e.event.type==="error").map(e=>e.event);expect(errors).toEqual([{type:"error",sessionId:"session-1",content:"Codex error: Invalid schema for function 'subagent': ..."}]);});

it("flushes unstreamed assistant text on message_end and tags status with turnEpoch",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-pi-flush-"));const cwd=join(root,"project");const dir=join(root,"sessions","project");await mkdir(dir,{recursive:true});await mkdir(cwd,{recursive:true});await writeFile(join(dir,"session.jsonl"),[JSON.stringify({type:"session",version:3,id:"session-1",timestamp:"2026-08-10T00:00:00.000Z",cwd})].join("\n")+"\n");const backend=createPiHostBackend({agentDir:join(root,"agent"),sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),canonicalProjectPaths:async()=>undefined,piPath:"node",spawn:(_bin,_args,options)=>spawn("/usr/local/bin/node",[new URL("./fake-pi.mjs",import.meta.url).pathname],{...options,env:{...options.env,PATH:"/usr/local/bin:/usr/bin:/bin"}}) as any});await backend.handle("addProject",[cwd]);const events:any[]=[];const off=backend.subscribe(e=>events.push(e));await backend.handle("sendPrompt",["session-1","__no_stream_text__"]);await new Promise(r=>setTimeout(r,20));off();
const statuses=events.filter(e=>e.channel==="stream"&&e.event.type==="status").map(e=>e.event);
expect(statuses).toEqual([
  expect.objectContaining({status:"started",turnEpoch:expect.any(Number)}),
  expect.objectContaining({status:"settled",turnEpoch:statuses[0].turnEpoch}),
]);
const texts=events.filter(e=>e.channel==="stream"&&e.event.type==="text").map(e=>e.event.delta);
expect(texts).toEqual(["我把两条链路都梳理了一遍。"]);
});});

describe("PiHostBackend history structure",()=>{let root="";afterEach(async()=>{if(root)await (await import("node:fs/promises")).rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25});root="";});it("preserves thinking/tool structure in history entries (SessionManager path)", async () => {
  root = await mkdtemp(join(tmpdir(), "pipi-pi-hist-"));
  const cwd = join(root, "project");
  const dir = join(root, "sessions", "project");
  await mkdir(dir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const path = join(dir, "session.jsonl");
  const msg = (id, parentId, message) => JSON.stringify({ type: "message", id, parentId, timestamp: "2026-08-10T00:00:01.000Z", message });
  await writeFile(path, [
    JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
    msg("a1", null, { role: "assistant", content: [
      { type: "thinking", thinking: "plan first" },
      { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls -la" } },
      { type: "thinking", thinking: "verify next" },
      { type: "toolCall", id: "call-2", name: "read", arguments: { path: "src/App.tsx" } },
      { type: "text", text: "done" },
    ] }),
    msg("t1", "a1", { role: "toolResult", toolCallId: "call-1", toolName: "bash", isError: false, content: [{ type: "text", text: "total 0" }] }),
  ].join("\n") + "\n");
  const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions"), runtimeRoot: join(root, "runtime"), piPath: "node" });
  const history = await backend.handle("getSessionHistory", ["session-1"]) as any[];
  expect(history).toEqual([
    expect.objectContaining({ role: "assistant", content: "done", thinking: "plan firstverify next", tools: [{ id: "call-1", name: "bash", input: '{"command":"ls -la"}' }, { id: "call-2", name: "read", input: '{"path":"src/App.tsx"}' }], activities: [
      { type: "thinking", contentIndex: 0, content: "plan first" },
      { type: "tool", contentIndex: 1, tool: { id: "call-1", name: "bash", input: '{"command":"ls -la"}' } },
      { type: "thinking", contentIndex: 2, content: "verify next" },
      { type: "tool", contentIndex: 3, tool: { id: "call-2", name: "read", input: '{"path":"src/App.tsx"}' } },
      { type: "text", contentIndex: 4, content: "done" },
    ] }),
    expect.objectContaining({ role: "tool", content: "total 0", toolCallId: "call-1", toolName: "bash", isError: false }),
  ]);
});

it("preserves tool structure via the streaming fallback for oversized sessions", async () => {
  root = await mkdtemp(join(tmpdir(), "pipi-pi-hist-big-"));
  const cwd = join(root, "project");
  const dir = join(root, "sessions", "project");
  await mkdir(dir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const path = join(dir, "session.jsonl");
  const msg = (id, parentId, message) => JSON.stringify({ type: "message", id, parentId, timestamp: "2026-08-10T00:00:00.000Z", message });
  // > 4MB forces the streaming fallback path (SESSION_MANAGER_MAX_BYTES).
  const pad = "x".repeat(4096);
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
    msg("a1", null, { role: "assistant", content: [{ type: "toolCall", id: "call-9", name: "web_search", arguments: { query: "hello" } }, { type: "text", text: "ok" }] }),
    msg("t1", "a1", { role: "toolResult", toolCallId: "call-9", toolName: "web_search", isError: false, content: [{ type: "text", text: "result!" }] }),
  ];
  while (Buffer.byteLength(lines.join("\n")) < 4.2 * 1024 * 1024) lines.push(JSON.stringify({ type: "fixture_padding", content: pad }));
  await writeFile(path, lines.join("\n") + "\n");
  const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions"), runtimeRoot: join(root, "runtime"), piPath: "node" });
  const history = await backend.handle("getSessionHistory", ["session-1"]) as any[];
  expect(history).toEqual([
    expect.objectContaining({ role: "assistant", content: "ok", tools: [{ id: "call-9", name: "web_search", input: '{"query":"hello"}' }] }),
    expect.objectContaining({ role: "tool", content: "result!", toolCallId: "call-9", toolName: "web_search" }),
  ]);
});

it("surfaces a hidden-display subagent completion custom_message as a user history row", async () => {
  root = await mkdtemp(join(tmpdir(), "pipi-pi-hist-done-"));
  const cwd = join(root, "project");
  const dir = join(root, "sessions", "project");
  await mkdir(dir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const path = join(dir, "session.jsonl");
  await writeFile(path, [
    JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
    JSON.stringify({ type: "message", id: "a1", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "assistant", content: "already answered", stopReason: "stop" } }),
    JSON.stringify({
      type: "custom_message",
      id: "c-done",
      parentId: "a1",
      timestamp: "2026-08-10T00:00:02.000Z",
      customType: "pipiui-subagent-complete-v1",
      display: false,
      content: "[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n找到了设置页",
    }),
    JSON.stringify({
      type: "custom_message",
      id: "c-git",
      parentId: "c-done",
      timestamp: "2026-08-10T00:00:03.000Z",
      customType: "pipiui-git-snapshot",
      display: false,
      content: "hidden git snapshot",
    }),
  ].join("\n") + "\n");
  const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions"), runtimeRoot: join(root, "runtime"), piPath: "node" });
  const history = await backend.handle("getSessionHistory", ["session-1"]) as any[];
  expect(history).toEqual([
    expect.objectContaining({ role: "assistant", content: "already answered" }),
    expect.objectContaining({
      id: "c-done",
      role: "user",
      content: "[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n找到了设置页",
    }),
  ]);
});

it("carries terminal assistant errors into history so resumed sessions still show them", async () => {
  root = await mkdtemp(join(tmpdir(), "pipi-pi-hist-fail-"));
  const cwd = join(root, "project");
  const dir = join(root, "sessions", "project");
  await mkdir(dir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const path = join(dir, "session.jsonl");
  const msg = (id, parentId, message) => JSON.stringify({ type: "message", id, parentId, timestamp: "2026-08-10T00:00:00.000Z", message });
  // The on-disk shape of a failed openai-codex turn: content [], stopReason "error", errorMessage.
  await writeFile(path, [
    JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
    msg("fail-1", null, { role: "assistant", content: [], stopReason: "error", errorMessage: "Codex error: Invalid schema for function 'subagent': ..." }),
  ].join("\n") + "\n");
  const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions"), runtimeRoot: join(root, "runtime"), piPath: "node" });
  const history = await backend.handle("getSessionHistory", ["session-1"]) as any[];
  expect(history).toEqual([
    expect.objectContaining({ role: "assistant", content: "", errorMessage: "Codex error: Invalid schema for function 'subagent': ..." }),
  ]);
});
});
