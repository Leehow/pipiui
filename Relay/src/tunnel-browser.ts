type Boot = { roomID: string; secret: string; tunnelURL: string };
type JSONValue = null | string | number | boolean | JSONValue[] | {
  [key: string]: JSONValue;
};
type CommandBody = { [key: string]: JSONValue };
type CommandResponse = { status: number; body: JSONValue };

declare global {
  interface Window { __PIPI_TUNNEL_BOOT__?: Boot }
}

const boot = window.__PIPI_TUNNEL_BOOT__;
if (!boot || !/^[0-9a-f]{64}$/.test(boot.secret)) {
  throw new Error("链接无效或密钥缺失");
}
delete window.__PIPI_TUNNEL_BOOT__;

const byID = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = byID<HTMLSpanElement>("status");
const transport = byID<HTMLSpanElement>("transport");
const connPill = byID<HTMLDivElement>("conn-pill");
const projectList = byID<HTMLDivElement>("project-list");
const sessionList = byID<HTMLDivElement>("session-list");
const projectSelect = byID<HTMLSelectElement>("projects");
const sessionSelect = byID<HTMLSelectElement>("sessions");
const transcript = byID<HTMLElement>("transcript");
const prompt = byID<HTMLTextAreaElement>("prompt");
const sendButton = byID<HTMLButtonElement>("send");
const stopButton = byID<HTMLButtonElement>("stop");
const main = byID<HTMLElement>("remote-main");
const title = byID<HTMLElement>("session-title");
const modelsToggle = byID<HTMLButtonElement>("models-toggle");
const modelsPanel = byID<HTMLDivElement>("models-panel");
const remotePanel = byID<HTMLDivElement>("remote-panel");
const panelToggles = {
  agents: byID<HTMLButtonElement>("agents-toggle"),
  web: byID<HTMLButtonElement>("web-toggle"),
  documents: byID<HTMLButtonElement>("documents-toggle"),
};
const socket = new WebSocket(boot.tunnelURL);

const pending = new Map<string, {
  resolve: (value: CommandResponse) => void;
  reject: (error: Error) => void;
  timer: number;
}>();
let connected = false;
let revoked = false;
let activeSession: string | null = null;
let selectedProject: string | null = null;
let revision: string | number | null = null;
let models: any = null;
let currentModelName: string | null = null;
let activePanel: "agents" | "web" | "documents" | null = null;

function setStatus(message: string, error = false) {
  status.textContent = message;
  status.style.color = error ? "#ffb020" : "";
}

function setConnection(isConnected: boolean) {
  connPill.classList.toggle("connected", isConnected);
  transport.textContent = isConnected ? "服务器能力隧道已连接" : "服务器隧道尚未连接";
}

function label(tag: string, text: string, className?: string) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function failPending(message: string) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error(message));
  }
  pending.clear();
}

async function command(name: string, body: CommandBody) {
  if (revoked || !connected || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Mac 尚未连接");
  }
  const requestID = crypto.randomUUID();
  const result = await new Promise<CommandResponse>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestID);
      reject(new Error("Mac 响应超时"));
    }, 15_000);
    pending.set(requestID, { resolve, reject, timer });
    socket.send(JSON.stringify({
      v: 1, type: "request", requestID, command: name, body,
    }));
  });
  if (result.status === 304) return null;
  if (result.status < 200 || result.status >= 300) {
    const bodyValue = result.body as { error?: unknown } | null;
    throw new Error(typeof bodyValue?.error === "string"
      ? bodyValue.error : `命令失败 (${result.status})`);
  }
  return result.body as any;
}

function showList() {
  main.dataset.mobileView = "list";
  activeSession = null;
  revision = null;
  sendButton.disabled = true;
  stopButton.disabled = true;
  modelsToggle.disabled = true;
  modelsPanel.hidden = true;
  models = null;
  currentModelName = null;
  activePanel = null;
  remotePanel.hidden = true;
  for (const toggle of Object.values(panelToggles)) toggle.disabled = true;
  title.textContent = "请选择会话";
  setStatus("请选择会话");
}

function showDetail() {
  main.dataset.mobileView = "detail";
}

async function loadIndex() {
  const value = await command("index", {});
  projectList.replaceChildren();
  sessionList.replaceChildren();
  projectSelect.replaceChildren();
  sessionSelect.replaceChildren();

  const projects = value?.projects ?? [];
  const sessions = value?.sessions ?? [];
  const sessionCountByProject = new Map<string, number>();
  for (const session of sessions) {
    if (typeof session.projectID !== "string") continue;
    sessionCountByProject.set(
      session.projectID,
      (sessionCountByProject.get(session.projectID) ?? 0) + 1,
    );
  }

  for (const project of projects) {
    projectSelect.append(new Option(project.name, project.id));
    const row = document.createElement("div");
    row.className = "row card" + (project.id === selectedProject ? " selected" : "");
    const main = document.createElement("button");
    main.type = "button";
    main.className = "row-main";
    const titleWrap = document.createElement("div");
    titleWrap.className = "row-title";
    titleWrap.append(label("span", project.name, "row-name"));
    titleWrap.append(label("span", String(sessionCountByProject.get(project.id) ?? 0), "badge"));
    main.append(titleWrap);
    main.onclick = () => {
      selectedProject = selectedProject === project.id ? null : project.id;
      void loadIndex();
    };
    row.append(main);
    const button = label("button", "新建") as HTMLButtonElement;
    button.onclick = (event) => {
      event.stopPropagation();
      void (async () => {
        try {
          const created = await command("session.create", { projectID: project.id });
          selectedProject = project.id;
          await loadIndex();
          await openSession(created.sessionID, false);
        } catch (error) {
          setStatus(String((error as Error).message || error), true);
        }
      })();
    };
    row.append(button);
    projectList.append(row);
  }

  const visibleSessions = selectedProject === null
    ? sessions
    : sessions.filter((s: any) => s.projectID === selectedProject);
  for (const session of visibleSessions) {
    sessionSelect.append(new Option(session.title, session.id));
    const row = document.createElement("div");
    row.className = "row card" + (session.id === activeSession ? " selected" : "");
    const main = document.createElement("button");
    main.type = "button";
    main.className = "row-main";
    const titleWrap = document.createElement("div");
    titleWrap.className = "row-title";
    titleWrap.append(label("span", session.title, "row-name"));
    if (session.isGenerating) titleWrap.append(label("span", "生成中", "badge"));
    main.append(titleWrap);
    main.onclick = () => void openSession(session.id, true);
    row.append(main);
    const button = label("button", "打开") as HTMLButtonElement;
    button.onclick = (event) => {
      event.stopPropagation();
      void openSession(session.id, true);
    };
    row.append(button);
    sessionList.append(row);
  }
  if (visibleSessions.length === 0 && selectedProject !== null) {
    sessionList.append(label("div", "该项目暂无会话", "list-empty"));
  }
}

function setPanel(panel: "agents" | "web" | "documents" | null) {
  activePanel = panel;
  remotePanel.hidden = panel === null;
  for (const [name, toggle] of Object.entries(panelToggles)) {
    toggle.classList.toggle("active", name === panel);
  }
  if (panel) void refreshPanel().catch((error) => setStatus(error.message, true));
}

function panelTitle(text: string) {
  remotePanel.replaceChildren(label("h3", text));
}

async function refreshPanel() {
  if (!activeSession || !activePanel) return;
  if (activePanel === "agents") {
    const value = await command("agents.list", { sessionID: activeSession });
    panelTitle("Subagents");
    for (const agent of value.agents ?? []) {
      const button = label("button", `${agent.name} · ${agent.state} · ${agent.title}`, "panel-item") as HTMLButtonElement;
      button.onclick = () => void command("agents.detail", { sessionID: activeSession!, agentID: agent.agentID })
        .then((detail) => {
          panelTitle(detail.title || detail.name || "Subagent");
          const meta = label("div", `${detail.state} · ${detail.model || ""} · $${detail.cost ?? 0} · ${detail.turns ?? 0} turns\n${detail.activity || ""}`, "panel-detail");
          const log = label("pre", detail.log || "暂无日志", "panel-detail");
          remotePanel.append(meta, log);
        }).catch((error) => setStatus(error.message, true));
      remotePanel.append(button);
    }
    return;
  }
  const value = await command("panel.state", { sessionID: activeSession });
  if (activePanel === "web") {
    panelTitle(value.web?.title || "Web");
    if (!value.web?.url) { remotePanel.append(label("p", "未打开网页")); return; }
    try {
      const url = new URL(value.web.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid URL");
      remotePanel.append(label("p", value.web.isLoading ? "加载中…" : url.href));
      const frame = document.createElement("iframe");
      frame.className = "web-frame";
      frame.setAttribute("sandbox", "allow-forms allow-scripts allow-popups");
      frame.setAttribute("src", url.href);
      remotePanel.append(frame);
    } catch { remotePanel.append(label("p", "网页地址不可远程显示")); }
    return;
  }
  panelTitle("文档");
  for (const document of value.documents ?? []) {
    const button = label("button", `${document.name} · ${document.kind} · ${document.size} B`, "panel-item") as HTMLButtonElement;
    button.onclick = () => void command("document.get", { sessionID: activeSession!, documentID: document.id })
      .then((detail) => {
        panelTitle(detail.name || "文档");
        remotePanel.append(label("pre", detail.content ?? detail.note ?? "无法显示内容", "document-content"));
      }).catch((error) => setStatus(error.message, true));
    remotePanel.append(button);
  }
  if (!(value.documents ?? []).length) remotePanel.append(label("p", "未打开文档"));
}

function modelOption(value: string, text: string) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

function renderModels() {
  modelsPanel.replaceChildren();
  if (!models) return;

  const mainRow = document.createElement("div");
  mainRow.className = "model-row";
  mainRow.append(label("label", "主模型"));
  const mainSelect = document.createElement("select");
  mainSelect.disabled = !activeSession || !(models.available ?? []).length;
  mainSelect.append(modelOption("", "选择模型"));
  for (const model of models.available ?? []) {
    mainSelect.append(modelOption(model.id, model.name));
  }
  mainSelect.value = models.main?.id ?? "";
  mainSelect.onchange = () => {
    if (!activeSession || !mainSelect.value) return;
    void command("model.set", { sessionID: activeSession, modelId: mainSelect.value })
      .then(() => loadModels())
      .catch((error) => setStatus(error.message, true));
  };
  mainRow.append(mainSelect);
  modelsPanel.append(mainRow);

  for (const subagent of models.subagents ?? []) {
    const row = document.createElement("div");
    row.className = "model-row";
    row.append(label("label", subagent.agent));
    const select = document.createElement("select");
    select.append(modelOption("", "跟随主模型"));
    for (const model of models.available ?? []) {
      select.append(modelOption(model.id, model.name));
    }
    select.value = subagent.model ?? "";
    select.onchange = () => {
      void command("subagentModel.set", {
        agent: subagent.agent,
        model: select.value,
        thinking: subagent.thinking ?? "",
      }).then(() => loadModels())
        .catch((error) => setStatus(error.message, true));
    };
    row.append(select);
    modelsPanel.append(row);
  }
}

async function loadModels() {
  if (!activeSession) {
    models = { main: null, available: [], subagents: [] };
    currentModelName = null;
    renderModels();
    return;
  }
  models = await command("models.get", { sessionID: activeSession });
  currentModelName = models?.main?.name ?? null;
  renderModels();
  if (activeSession) title.textContent = sessionTitle();
}

function sessionTitle(base?: string) {
  const titleText = base ?? "会话";
  return currentModelName ? `${titleText} · ${currentModelName}` : titleText;
}

function roleLabel(role: string) {
  return role === "user" ? "你" : role === "assistant" ? "助手" : "系统";
}

function renderEntry(message: any, live: boolean) {
  if (message.kind === "tool" || message.kind === "thinking") {
    const row = document.createElement("div");
    row.className = "tool-entry";
    row.textContent = message.kind === "thinking"
      ? "💭 思考中"
      : `⚙︎ ${message.toolName || "tool"}${message.toolSummary ? ` · ${message.toolSummary}` : ""}`;
    if (live) row.style.borderColor = "#2f81f7";
    return row;
  }
  const bubble = document.createElement("div");
  bubble.className = `message ${message.role || "system"}`;
  bubble.append(label("span", roleLabel(message.role), "role"));
  bubble.append(label("span", typeof message.text === "string" ? message.text : ""));
  return bubble;
}

function renderSnapshot(value: any) {
  const snapshot = value?.snapshot;
  if (!snapshot) return;
  revision = value.revision ?? null;
  showDetail();
  title.textContent = sessionTitle(snapshot.title);
  sendButton.disabled = !snapshot.processAlive;
  stopButton.disabled = !(snapshot.isGenerating || snapshot.isStopping);
  transcript.replaceChildren();
  const messages = snapshot.messages ?? [];
  messages.forEach((message: any, index: number) => {
    const live = Boolean(snapshot.isGenerating)
      && (message.kind === "tool" || message.kind === "thinking")
      && index === messages.length - 1;
    transcript.append(renderEntry(message, live));
  });
  transcript.scrollTop = transcript.scrollHeight;
  setStatus(snapshot.isStopping ? "正在停止…"
    : snapshot.isGenerating ? "生成中"
      : snapshot.isInitializing ? "正在加载…"
        : snapshot.processAlive ? `空闲 · 队列 ${snapshot.queuedPromptCount ?? 0}` : "进程已退出");
}

async function openSession(sessionID: string, requestOpen: boolean) {
  try {
    if (requestOpen) await command("session.open", { sessionID });
    activeSession = sessionID;
    revision = null;
    modelsToggle.disabled = false;
    for (const toggle of Object.values(panelToggles)) toggle.disabled = false;
    await loadModels();
    await pollSnapshot();
    await loadIndex();
  } catch (error) {
    setStatus(String((error as Error).message || error), true);
  }
}

async function pollSnapshot() {
  if (!activeSession || !connected || revoked) return;
  try {
    const value = await command("snapshot", {
      sessionID: activeSession,
      ...(revision === null ? {} : { revision }),
    });
    if (value) renderSnapshot(value);
  if (activePanel) await refreshPanel();
  } catch (error) {
    setStatus(String((error as Error).message || error), true);
  }
}

socket.onopen = () => socket.send(JSON.stringify({
  v: 1, type: "hello", roomID: boot.roomID, secret: boot.secret, role: "browser",
}));
socket.onerror = () => setStatus("服务器隧道连接失败", true);
socket.onclose = (event) => {
  connected = false;
  setConnection(false);
  failPending("连接已断开");
  if (revoked) return;
  if (event?.reason === "replaced") {
    setStatus("已被其他浏览器接管；重新打开或刷新此链接即可恢复连接。", true);
    return;
  }
  setStatus("连接已断开；重新打开或刷新此链接即可重新连接。", true);
};
socket.onmessage = (event) => {
  let frame: Record<string, any>;
  try { frame = JSON.parse(String(event.data)); } catch { socket.close(); return; }
  if (frame?.v !== 1 || typeof frame.type !== "string") { socket.close(); return; }
  if (frame.type === "ready") {
    connected = true;
    setConnection(true);
    setStatus("Mac 已连接；新打开的浏览器会顶替当前连接。");
    void loadIndex().catch((error) => setStatus(error.message, true));
    return;
  }
  if (frame.type === "replaced") {
    connected = false;
    setConnection(false);
    setStatus("已被其他浏览器接管；重新打开或刷新此链接即可恢复连接。", true);
    return;
  }
  if (frame.type === "invalidated") {
    connected = false;
    setConnection(false);
    setStatus("此链接已失效；请在 Mac 上重新生成链接。", true);
    return;
  }
  if (frame.type === "error" && typeof frame.requestID === "string") {
    const entry = pending.get(frame.requestID);
    if (!entry) return;
    pending.delete(frame.requestID);
    clearTimeout(entry.timer);
    entry.reject(new Error(typeof frame.message === "string" ? frame.message : "隧道请求失败"));
    return;
  }
  if (frame.type !== "response" || typeof frame.requestID !== "string"
    || !Number.isInteger(frame.status)) { socket.close(); return; }
  const entry = pending.get(frame.requestID);
  if (!entry) return;
  pending.delete(frame.requestID);
  clearTimeout(entry.timer);
  entry.resolve({ status: frame.status, body: frame.body as JSONValue });
};

sendButton.onclick = () => {
  const text = prompt.value;
  if (!text.trim() || !activeSession) return;
  void command("prompt.send", { sessionID: activeSession, text, commandID: crypto.randomUUID() })
    .then(() => { prompt.value = ""; revision = null; return pollSnapshot(); })
    .catch((error) => setStatus(error.message, true));
};
stopButton.onclick = () => {
  if (activeSession) void command("generation.stop", { sessionID: activeSession })
    .then(() => { revision = null; return pollSnapshot(); })
    .catch((error) => setStatus(error.message, true));
};
modelsToggle.onclick = () => {
  modelsPanel.hidden = !modelsPanel.hidden;
  if (!modelsPanel.hidden) void loadModels()
    .catch((error) => setStatus(error.message, true));
};
panelToggles.agents.onclick = () => setPanel(activePanel === "agents" ? null : "agents");
panelToggles.web.onclick = () => setPanel(activePanel === "web" ? null : "web");
panelToggles.documents.onclick = () => setPanel(activePanel === "documents" ? null : "documents");
byID<HTMLButtonElement>("back-to-list").onclick = () => {
  showList();
  void loadIndex().catch((error) => setStatus(error.message, true));
};
byID<HTMLButtonElement>("revoke").onclick = () => {
  revoked = true;
  connected = false;
  setConnection(false);
  socket.close(1000, "revoked by browser");
  setStatus("已断开连接；重新打开此链接即可重新连接。");
};
window.setInterval(() => void pollSnapshot(), 900);
window.addEventListener("pagehide", () => socket.close(1000, "page closed"), { once: true });
