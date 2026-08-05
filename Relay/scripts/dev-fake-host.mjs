#!/usr/bin/env node
// Dev-only fake host for the PipiUI capability tunnel. Connects to a local
// tunnel server as the *host* of a room and answers browser commands with
// canned data so the mobile UI can be exercised without a real Mac.
//
// NEVER imported by production code or the bundle.
//
// Usage:
//   1. Build:  npm run build
//   2. Start the relay (see below / README).
//   3. Run this fixture:  node scripts/dev-fake-host.mjs
//      It prints the pair URL to open (with the 64-hex secret fragment).
//
// Env (optional):
//   TUNNEL_URL   defaults to ws://127.0.0.1:8787/tunnel/ws
//   ROOM_ID      random UUID if not set
//   SECRET       64 hex chars, random if not set

import { randomBytes } from "node:crypto";
import WebSocket from "ws";

const TUNNEL_URL = process.env.TUNNEL_URL ?? "ws://127.0.0.1:8787/tunnel/ws";
const ROOM_ID = process.env.ROOM_ID ?? randomUUID();
const SECRET = process.env.SECRET ?? randomBytes(32).toString("hex");

function randomUUID() {
  return crypto.randomUUID();
}

// ---- canned data ----
const PROJECTS = [
  { id: "proj-alpha", name: "Alpha 项目" },
  { id: "proj-beta", name: "Beta 项目" },
  { id: "proj-gamma", name: "Gamma 项目" },
];

// 25 sessions so pagination (10/page -> 3 pages) is exercised.
const SESSIONS = [];
for (let i = 0; i < 25; i += 1) {
  const project = PROJECTS[i % PROJECTS.length];
  SESSIONS.push({
    id: `session-${String(i).padStart(2, "0")}`,
    projectID: project.id,
    title: `会话 ${i + 1}（${project.name}）`,
    isGenerating: i === 0,
  });
}

const AGENTS = [
  { agentID: "agent-code", name: "code", state: "idle", title: "代码助手" },
  { agentID: "agent-explore", name: "explore", state: "working", title: "探索 agent" },
];

const AGENT_DETAIL = {
  code: {
    agentID: "agent-code", name: "code", state: "idle",
    title: "代码助手", model: "xai/grok-4", cost: 1.23, turns: 7,
    activity: "正在等待任务", log: "第一步：读取需求\n第二步：生成代码示例。",
  },
  explore: {
    agentID: "agent-explore", name: "explore", state: "working",
    title: "探索 agent", model: "xai/grok-4-fast", cost: 0.41, turns: 3,
    activity: "正在浏览网页", log: "正在搜索相关文档…",
  },
};

const DOCUMENTS = [
  { id: "doc-1", name: "需求说明.md", kind: "markdown", size: 1234 },
  { id: "doc-2", name: "设计文档.pdf", kind: "pdf", size: 567890 },
];

const DOCUMENT_CONTENT = {
  "doc-1": "需求说明\n========\n\n1. 移动端优先\n2. 深色主题\n3. 支持分页",
  "doc-2": "设计文档（PDF 内容无法内联显示）",
};

const SNAPSHOT = {
  title: "会话 01（Alpha 项目）",
  processAlive: true,
  isGenerating: false,
  isStopping: false,
  isInitializing: false,
  queuedPromptCount: 0,
  messages: [
    { role: "system", text: "会话已就绪。" },
    { role: "user", text: "请帮我重构这段代码。" },
    { kind: "tool", toolName: "read_file", toolSummary: "读取 src/main.ts" },
    { role: "assistant", text: "好的，我来分析一下。这段代码的主要问题是重复逻辑过多。" },
    { kind: "thinking" },
    { role: "assistant", text: "我建议提取一个公共函数，并把状态集中管理。" },
  ],
};

function snapshotsFor(sessionID) {
  return {
    ...SNAPSHOT,
    title: `会话 ${sessionID}`,
    messages: [
      ...SNAPSHOT.messages,
      { role: "assistant", text: `（来自假宿主的会话 ${sessionID} 回复）` },
    ],
  };
}

const MODELS = {
  main: { id: "xai/grok-4", name: "Grok 4" },
  available: [
    { id: "xai/grok-4", name: "Grok 4" },
    { id: "xai/grok-4-fast", name: "Grok 4 Fast" },
    { id: "xai/grok-4-mini", name: "Grok 4 Mini" },
  ],
  subagents: [
    { agent: "code", model: "", thinking: "" },
    { agent: "explore", model: "xai/grok-4-fast", thinking: "" },
  ],
};

function ok(body) {
  return { status: 200, body };
}

function handlers() {
  return {
    index() {
      return ok({ projects: PROJECTS, sessions: SESSIONS });
    },
    "session.open"() { return ok({ accepted: true }); },
    "session.create"({ projectID }) {
      const id = `session-created-${randomUUID().slice(0, 8)}`;
      SESSIONS.unshift({ id, projectID, title: "新建会话", isGenerating: false });
      return ok({ sessionID: id });
    },
    snapshot({ sessionID }) {
      return ok({ snapshot: snapshotsFor(sessionID), revision: Date.now() });
    },
    "models.get"() { return ok(MODELS); },
    "model.set"() { return ok({ accepted: true }); },
    "subagentModel.set"() { return ok({ accepted: true }); },
    "agents.list"() { return ok({ agents: AGENTS }); },
    "agents.detail"({ agentID }) {
      return ok(AGENT_DETAIL[agentID] ?? AGENT_DETAIL.code);
    },
    "panel.state"() {
      return ok({
        web: {
          url: "https://example.com",
          isLoading: false,
          title: "Example",
        },
        documents: DOCUMENTS,
      });
    },
    "document.get"({ documentID }) {
      return ok({
        name: DOCUMBER_NAME(documentID),
        content: DOCUMENT_CONTENT[documentID] ?? "无法显示内容",
      });
    },
    "prompt.send"() { return ok({ accepted: true }); },
    "generation.stop"() { return ok({ accepted: true }); },
  };
}

function DOCUMBER_NAME(id) {
  return DOCUMENTS.find((d) => d.id === id)?.name ?? "文档";
}

// ---- wire it up ----
const socket = new WebSocket(TUNNEL_URL);
const table = handlers();
let pending = 0;

socket.on("open", () => {
  socket.send(JSON.stringify({
    v: 1, type: "hello", roomID: ROOM_ID, secret: SECRET, role: "host",
  }));
});

socket.on("message", (raw) => {
  let frame;
  try {
    frame = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (frame?.v !== 1) return;
  if (frame.type === "host-ready") {
    console.log(`[fake-host] room ready: ${ROOM_ID}`);
    return;
  }
  if (frame.type === "ready") {
    console.log("[fake-host] browser attached — opening pair URL below");
  }
  if (frame.type !== "request") return;
  const { requestID, command, body } = frame;
  const handler = table[command];
  const respond = (result) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      v: 1, type: "response", requestID, status: result.status, body: result.body,
    }));
  };
  if (!handler) {
    respond({ status: 400, body: { error: `unknown command ${command}` } });
    return;
  }
  pending += 1;
  try {
    const result = handler(body ?? {});
    // Simulate slight latency for realism.
    setTimeout(() => { pending -= 1; respond(result); }, 15);
  } catch (error) {
    pending -= 1;
    respond({ status: 500, body: { error: String(error.message || error) } });
  }
});

socket.on("close", () => {
  console.log("[fake-host] connection closed");
});
socket.on("error", (error) => {
  console.error("[fake-host] error:", error.message);
});

const pairURL = `https://127.0.0.1:8787/pair/${ROOM_ID}#${SECRET}`;
console.log("");
console.log("┌─────────────────────────────────────────────────────────");
console.log("│  Fake host started. Open this URL in your phone/browser:");
console.log(`│  ${pairURL}`);
console.log("│");
console.log(`│  roomID: ${ROOM_ID}`);
console.log(`│  secret: ${SECRET.slice(0, 8)}…${SECRET.slice(-8)}`);
console.log(`│  tunnel: ${TUNNEL_URL}`);
console.log("└─────────────────────────────────────────────────────────");