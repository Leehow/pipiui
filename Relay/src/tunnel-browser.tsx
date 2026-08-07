import {
  Button,
  List,
  Popup,
  Selector,
  Skeleton,
  SpinLoading,
  Tag,
  TextArea,
  Toast,
} from "antd-mobile";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  canSendPrompt,
  composerActionMode,
  isNearBottom,
} from "./chat-ui.js";
import { TunnelClient, type TunnelStatus } from "./tunnel-client.js";
import { MessageView } from "./message-view.js";
import "antd-mobile/es/global/global.css";
import "./styles.css";

type Boot = { roomID: string; secret: string; tunnelURL: string };

declare global {
  interface Window { __PIPI_TUNNEL_BOOT__?: Boot }
}

const boot = window.__PIPI_TUNNEL_BOOT__;
if (!boot || !/^[0-9a-f]{64}$/.test(boot.secret)) {
  throw new Error("链接无效或密钥缺失");
}
delete window.__PIPI_TUNNEL_BOOT__;

const SESSION_PAGE_SIZE = 10;
const POLL_INTERVAL_MS = 900;

type PanelKind = "agents" | "web" | "documents";

type LogicRef = {
  activeSession: string | null;
  revision: number | null;
  activePanel: PanelKind | null;
  connected: boolean;
};

function statusText(status: TunnelStatus): { text: string; tone: string } {
  switch (status.kind) {
    case "connecting":
      return { text: "正在连接服务器…", tone: "" };
    case "connected":
      return { text: "Mac 已连接", tone: "connected" };
    case "replaced":
      return { text: "已被接管·刷新恢复", tone: "bad" };
    case "invalidated":
      return { text: "链接已失效", tone: "bad" };
    case "error":
      return { text: "连接失败", tone: "error" };
    case "closed":
      return { text: "已断开·刷新重连", tone: "bad" };
    default:
      return { text: "未知状态", tone: "bad" };
  }
}

const THEME_KEY = "pipiui-remote-theme";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M3.4 20.4 20.85 12.9a1 1 0 0 0 0-1.8L3.4 3.6a.9.9 0 0 0-1.25 1.08l2.4 7.02a1 1 0 0 0 .74.68l8.21 1.62-8.21 1.62a1 1 0 0 0-.74.68L2.15 19.32A.9.9 0 0 0 3.4 20.4z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ModelChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function snapshotStatus(snapshot: any): string {
  if (!snapshot) return "—";
  if (snapshot.isStopping) return "正在停止…";
  if (snapshot.isGenerating) return "生成中";
  if (snapshot.isInitializing) return "正在加载…";
  if (snapshot.processAlive) return `空闲 · 队列 ${snapshot.queuedPromptCount ?? 0}`;
  return "进程已退出";
}

function App() {
  const clientRef = useRef<TunnelClient | null>(null);
  const [status, setStatus] = useState<TunnelStatus>({ kind: "connecting" });
  const [projects, setProjects] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [sessionPage, setSessionPage] = useState(0);
  const [view, setView] = useState<"list" | "detail">("list");
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [sessionTitle, setSessionTitle] = useState("请选择会话");
  const [models, setModels] = useState<any>(null);
  const [currentModelName, setCurrentModelName] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<PanelKind | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [text, setText] = useState("");
  const [panelData, setPanelData] = useState<any>(null);
  const [panelDetail, setPanelDetail] = useState<any>(null);
  const [panelDetailLoading, setPanelDetailLoading] = useState(false);
  const [indexPending, setIndexPending] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const logicRef = useRef<LogicRef>({
    activeSession: null,
    revision: null,
    activePanel: null,
    connected: false,
  });
  logicRef.current.activeSession = activeSession;
  logicRef.current.activePanel = activePanel;
  logicRef.current.connected = status.kind === "connected";

  const pill = statusText(status);
  const statusLine = status.kind === "error" && status.message ? status.message : pill.text;
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const attr = document.documentElement.dataset.theme;
    if (attr === "dark" || attr === "light") return attr;
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === "dark" || stored === "light") return stored;
    } catch {}
    try {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);
  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  // ---- protocol bootstrap ----
  useEffect(() => {
    const client = new TunnelClient({
      tunnelURL: boot!.tunnelURL,
      roomID: boot!.roomID,
      secret: boot!.secret,
      onStatus: (s) => setStatus(s),
    });
    clientRef.current = client;
    client.connect();
    const onPageHide = () => client.close();
    window.addEventListener("pagehide", onPageHide, { once: true });
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      client.close();
    };
  }, []);

  const showError = useCallback((error: unknown) => {
    const message = String((error as Error)?.message || error);
    Toast.show({ icon: "fail", content: message, duration: 3000 });
    return message;
  }, []);

  const logic = () => clientRef.current;

  // ---- data loading ----
  const loadIndex = useCallback(async () => {
    setIndexPending(true);
    let value: any;
    try {
      value = await logic()!.command("index", {});
    } catch (error) {
      showError(error);
      return;
    } finally {
      setIndexPending(false);
    }
    const nextProjects = value?.projects ?? [];
    const nextSessions = value?.sessions ?? [];
    setProjects(nextProjects);
    setSessions(nextSessions);
    const countByProject = new Map<string, number>();
    for (const session of nextSessions) {
      if (typeof session.projectID !== "string") continue;
      countByProject.set(
        session.projectID,
        (countByProject.get(session.projectID) ?? 0) + 1,
      );
    }
    const visible = selectedProject === null
      ? nextSessions
      : nextSessions.filter((s: any) => s.projectID === selectedProject);
    const totalPages = Math.max(1, Math.ceil(visible.length / SESSION_PAGE_SIZE));
    setSessionPage((page) => {
      if (page >= totalPages) return totalPages - 1;
      return page;
    });
    return { countByProject, visible };
  }, [selectedProject, showError]);

  // load index whenever we become connected (and once on mount of a fresh page)
  useEffect(() => {
    if (status.kind === "connected") {
      void loadIndex();
    }
  }, [status.kind, loadIndex]);

  const refreshPanel = useCallback(async (kind?: PanelKind) => {
    const { activeSession: as, activePanel: ap } = logicRef.current;
    const target = kind ?? ap;
    if (!as || !target) return;
    try {
      if (target === "agents") {
        const value = await logic()!.command("agents.list", { sessionID: as });
        setPanelData({ kind: "agents", agents: value?.agents ?? [] });
        return;
      }
      const value = await logic()!.command("panel.state", { sessionID: as });
      if (target === "web") setPanelData({ kind: "web", web: value?.web ?? null });
      else if (target === "documents") {
        setPanelData({ kind: "documents", documents: value?.documents ?? [] });
      }
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  const renderSnapshot = useCallback((value: any) => {
    const snapshotValue = value?.snapshot;
    if (!snapshotValue) return;
    setRevision(value.revision ?? null);
    setView("detail");
    setSessionTitle(typeof snapshotValue.title === "string" ? snapshotValue.title : "会话");
    setSnapshot(snapshotValue);
  }, []);

  const pollSnapshot = useCallback(async () => {
    const { activeSession: as, revision: rev, activePanel: ap, connected: conn } = logicRef.current;
    if (!as || !conn) return;
    try {
      const value = await logic()!.command("snapshot", {
        sessionID: as,
        ...(rev === null ? {} : { revision: rev }),
      });
      if (value) renderSnapshot(value);
      if (ap) await refreshPanel();
    } catch (error) {
      showError(error);
    }
  }, [renderSnapshot, refreshPanel, showError]);

  useEffect(() => {
    const timer = window.setInterval(() => void pollSnapshot(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pollSnapshot]);

  // Stick-to-bottom: only auto-scroll when user is already near the bottom.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot]);

  const onTranscriptScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight);
    stickToBottomRef.current = near;
    setStickToBottom(near);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setStickToBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const resetStickToBottom = () => {
    stickToBottomRef.current = true;
    setStickToBottom(true);
  };

  const loadModels = useCallback(async () => {
    const as = logicRef.current.activeSession;
    if (!as) {
      setModels({ main: null, available: [], subagents: [] });
      setCurrentModelName(null);
      return;
    }
    try {
      const value = await logic()!.command("models.get", { sessionID: as });
      setModels(value);
      setCurrentModelName(value?.main?.name ?? null);
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  // ---- list actions ----
  const toggleProject = (id: string) => {
    setSelectedProject((prev) => (prev === id ? null : id));
    setSessionPage(0);
    void loadIndex();
  };

  const openSession = useCallback(async (sessionID: string, requestOpen: boolean) => {
    setSessionLoading(true);
    setPanelDetailLoading(false);
    resetStickToBottom();
    try {
      if (requestOpen) await logic()!.command("session.open", { sessionID });
      logicRef.current.activeSession = sessionID;
      setActiveSession(sessionID);
      setRevision(null);
      setSnapshot(null);
      setActivePanel(null);
      setPanelData(null);
      setPanelDetail(null);
      await loadModels();
      await pollSnapshot();
      await loadIndex();
    } catch (error) {
      showError(error);
    } finally {
      setSessionLoading(false);
    }
  }, [loadModels, loadIndex, pollSnapshot, showError]);

  const createSession = async (projectID: string) => {
    try {
      const created = await logic()!.command("session.create", { projectID });
      setSelectedProject(projectID);
      setSessionPage(0);
      await loadIndex();
      await openSession(created.sessionID, false);
    } catch (error) {
      showError(error);
    }
  };

  const showList = () => {
    setView("list");
    setActiveSession(null);
    setRevision(null);
    setSnapshot(null);
    setModels(null);
    setCurrentModelName(null);
    setActivePanel(null);
    setPanelData(null);
    setPanelDetail(null);
    setPanelDetailLoading(false);
    setSessionLoading(false);
    setModelOpen(false);
    setSessionTitle("请选择会话");
    resetStickToBottom();
    void loadIndex();
  };

  const goPrevPage = () => setSessionPage((p) => Math.max(0, p - 1));
  const goNextPage = (totalPages: number) =>
    setSessionPage((p) => Math.min(totalPages - 1, p + 1));

  // fire loadIndex after page/project changes too
  useEffect(() => {
    if (status.kind === "connected") void loadIndex();
  }, [sessionPage, status.kind, loadIndex]);

  // ---- chat actions ----
  const actionMode = composerActionMode(snapshot);
  const canSend = canSendPrompt({
    connected: status.kind === "connected",
    hasSession: !!logicRef.current.activeSession,
    text,
    processAlive: snapshot?.processAlive,
    sending,
  });

  const send = async () => {
    const as = logicRef.current.activeSession;
    if (!as || !canSend) return;
    setSending(true);
    resetStickToBottom();
    try {
      await logic()!.command("prompt.send", {
        sessionID: as,
        text,
        commandID: crypto.randomUUID(),
      });
      setText("");
      setRevision(null);
      await pollSnapshot();
    } catch (error) {
      showError(error);
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    const as = logicRef.current.activeSession;
    if (!as) return;
    try {
      await logic()!.command("generation.stop", { sessionID: as });
      setRevision(null);
      await pollSnapshot();
    } catch (error) {
      showError(error);
    }
  };

  const onComposerAction = () => {
    if (actionMode === "stop") void stop();
    else void send();
  };

  // ---- model panel ----
  const toggleModel = () => {
    setModelOpen((open) => {
      const next = !open;
      if (next) void loadModels();
      return next;
    });
  };

  const setMainModel = async (modelId: string) => {
    const as = logicRef.current.activeSession;
    if (!as || !modelId) return;
    try {
      await logic()!.command("model.set", { sessionID: as, modelId });
      await loadModels();
    } catch (error) {
      showError(error);
    }
  };

  const setSubagentModel = async (agent: string, model: string, thinking: string) => {
    try {
      await logic()!.command("subagentModel.set", { agent, model, thinking });
      await loadModels();
    } catch (error) {
      showError(error);
    }
  };

  // ---- remote panels ----
  const togglePanel = (kind: PanelKind) => {
    setActivePanel((prev) => {
      const next = prev === kind ? null : kind;
      setPanelDetail(null);
      setPanelDetailLoading(false);
      if (next) {
        setPanelData(null);
        void refreshPanel(next);
      }
      return next;
    });
  };

  const openAgentDetail = async (agent: any) => {
    const as = logicRef.current.activeSession;
    if (!as) return;
    setPanelDetail(null);
    setPanelDetailLoading(true);
    try {
      const detail = await logic()!.command("agents.detail", {
        sessionID: as, agentID: agent.agentID,
      });
      setPanelDetail({
        title: detail.title || detail.name || "Subagent",
        meta: `${detail.state} · ${detail.model || ""} · $${detail.cost ?? 0} · ${detail.turns ?? 0} turns\n${detail.activity || ""}`,
        log: detail.log || "暂无日志",
      });
    } catch (error) {
      showError(error);
    } finally {
      setPanelDetailLoading(false);
    }
  };

  const openDocument = async (document: any) => {
    const as = logicRef.current.activeSession;
    if (!as) return;
    setPanelDetail(null);
    setPanelDetailLoading(true);
    try {
      const detail = await logic()!.command("document.get", {
        sessionID: as, documentID: document.id,
      });
      setPanelDetail({
        title: detail.name || "文档",
        content: detail.content ?? detail.note ?? "无法显示内容",
      });
    } catch (error) {
      showError(error);
    } finally {
      setPanelDetailLoading(false);
    }
  };

  // ---- derived pagination ----
  const visibleSessions = selectedProject === null
    ? sessions
    : sessions.filter((s: any) => s.projectID === selectedProject);
  const totalPages = Math.max(1, Math.ceil(visibleSessions.length / SESSION_PAGE_SIZE));
  const clampedPage = Math.min(sessionPage, totalPages - 1);
  const pageSessions = visibleSessions.slice(
    clampedPage * SESSION_PAGE_SIZE,
    clampedPage * SESSION_PAGE_SIZE + SESSION_PAGE_SIZE,
  );

  const messages = (snapshot?.messages ?? []) as any[];
  const liveTail = Boolean(snapshot?.isGenerating);
  // Panel data is keyed by kind so a stale response for a closed/switched
  // panel never renders; `null` means the request is in flight or not started.
  const activePanelData = panelData?.kind === activePanel ? panelData : null;

  return (
    <div className="app">
      <header className="app-header">
        {view === "detail" ? (
          <Button size="small" onClick={showList}>‹ 返回</Button>
        ) : null}
        <div className="header-title">{view === "detail" ? sessionTitle : "PipiUI 远程会话"}</div>
        {view === "detail" ? (
          <button
            type="button"
            className="model-pill"
            disabled={!activeSession || status.kind !== "connected"}
            onClick={toggleModel}
            aria-label={currentModelName ? `当前模型 ${currentModelName}` : "选择模型"}
          >
            <span className="model-pill-label">{currentModelName || "模型"}</span>
            <ModelChevronIcon />
          </button>
        ) : null}
        <button
          type="button"
          className="theme-toggle"
          aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <div className={`conn-pill ${pill.tone}`} role="status">
          <span className="conn-dot" />
          <span>{pill.text}</span>
        </div>
      </header>

      {view === "list" ? (
        status.kind !== "connected" ? (
          <div className="center-block fill">
            <SpinLoading color="primary" />
            <span>{statusLine}</span>
          </div>
        ) : (
        <div className="list-view">
          <div className="list-section">
            <div className="list-section-title">项目</div>
            <List>
              {indexPending && projects.length === 0 ? (
                <div className="skeleton-list">
                  <Skeleton animated className="skeleton-row" />
                  <Skeleton animated className="skeleton-row" />
                  <Skeleton animated className="skeleton-row" />
                </div>
              ) : (
                <>
              {projects.map((project) => {
                const count = visibleSessions.filter((s: any) => s.projectID === project.id).length;
                return (
                  <List.Item
                    key={project.id}
                    className={`project-row${selectedProject === project.id ? " selected" : ""}`}
                    onClick={() => toggleProject(project.id)}
                    extra={(
                      <div className="project-extra">
                        <span className="project-badge">{count}</span>
                        <Button
                          size="mini"
                          color="primary"
                          fill="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            void createSession(project.id);
                          }}
                        >
                          新建
                        </Button>
                      </div>
                    )}
                  >
                    {project.name}
                  </List.Item>
                );
              })}
              {projects.length === 0 ? (
                <div className="list-empty">暂无项目</div>
              ) : null}
                </>
              )}
            </List>
          </div>

          <div className="list-section">
            <div className="list-section-title">
              <span>会话{selectedProject !== null ? `（已筛选）` : ""}</span>
              <span className="spacer" />
            </div>
            {indexPending && sessions.length === 0 ? (
              <div className="skeleton-list">
                <Skeleton animated className="skeleton-row" />
                <Skeleton animated className="skeleton-row" />
                <Skeleton animated className="skeleton-row" />
              </div>
            ) : (
              <>
            <List>
              {pageSessions.map((session) => (
                <List.Item
                  key={session.id}
                  className="session-row"
                  onClick={() => void openSession(session.id, true)}
                  extra={session.isGenerating ? (
                    <Tag color="warning" className="session-badge">生成中</Tag>
                  ) : undefined}
                >
                  {session.title}
                </List.Item>
              ))}
            </List>
            {visibleSessions.length === 0 && selectedProject !== null ? (
              <div className="list-empty">该项目暂无会话</div>
            ) : null}
            {totalPages > 1 ? (
              <div className="pager">
                <Button size="small" disabled={clampedPage <= 0} onClick={goPrevPage}>
                  ‹ 上一页
                </Button>
                <span className="pager-info">
                  第 {clampedPage + 1} / {totalPages} 页 · 共 {visibleSessions.length} 个
                </span>
                <Button
                  size="small"
                  disabled={clampedPage >= totalPages - 1}
                  onClick={() => goNextPage(totalPages)}
                >
                  下一页 ›
                </Button>
              </div>
            ) : null}
              </>
            )}
          </div>
        </div>
        )
      ) : (
        <div className="chat-view">
          <div className="chat-tabs">
            <Button size="small" onClick={() => togglePanel("agents")} disabled={!activeSession}>
              Subagents
            </Button>
            <Button size="small" onClick={() => togglePanel("web")} disabled={!activeSession}>
              Web
            </Button>
            <Button size="small" onClick={() => togglePanel("documents")} disabled={!activeSession}>
              文档
            </Button>
          </div>

          <div className="transcript-wrap">
            <div
              className="transcript"
              ref={scrollRef}
              onScroll={onTranscriptScroll}
              aria-live="polite"
            >
              {sessionLoading ? (
                <div className="center-block fill">
                  <SpinLoading color="primary" />
                  <span>正在加载会话…</span>
                </div>
              ) : messages.length === 0 ? (
                status.kind !== "connected" ? (
                  <div className="center-block fill">
                    <SpinLoading color="primary" />
                    <span>{statusLine}</span>
                  </div>
                ) : (
                  <div className="list-empty">暂无消息</div>
                )
              ) : (
                messages.map((message: any, index: number) => (
                  <MessageView
                    key={index}
                    message={message}
                    live={liveTail
                      && (message.kind === "tool" || message.kind === "thinking")
                      && index === messages.length - 1}
                  />
                ))
              )}
            </div>
            {!stickToBottom ? (
              <button
                type="button"
                className="scroll-bottom-btn"
                onClick={scrollToBottom}
                aria-label="回到底部"
              >
                <ChevronDownIcon />
              </button>
            ) : null}
          </div>

          <div className="composer">
            <div className="composer-status">{snapshotStatus(snapshot)}</div>
            <div className="composer-row">
              <div className="composer-input-wrap">
                <TextArea
                  value={text}
                  onChange={setText}
                  placeholder="输入消息"
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  rows={1}
                />
              </div>
              <button
                type="button"
                className={`composer-action${actionMode === "stop" ? " stop" : ""}`}
                disabled={actionMode === "send" ? !canSend : false}
                aria-label={actionMode === "stop" ? "停止" : "发送"}
                onClick={onComposerAction}
              >
                {actionMode === "stop" ? <StopIcon /> : <SendIcon />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Model panel */}
      <Popup
        visible={modelOpen}
        onMaskClick={() => setModelOpen(false)}
        position="bottom"
        bodyStyle={{ height: "60%" }}
      >
        <div className="panel-body">
          <div className="panel-head">
            <h3>模型</h3>
            <Button size="small" onClick={() => setModelOpen(false)}>关闭</Button>
          </div>
          <div className="panel-scroll">
            {models === null ? (
              <div className="center-block scroll-fill">
                <SpinLoading color="primary" />
                <span>正在加载…</span>
              </div>
            ) : (
            <div className="model-panel-grid">
              <div className="model-row">
                <label>主模型</label>
                <Selector
                  columns={1}
                  options={[
                    { label: "选择模型", value: "" },
                    ...(models?.available ?? []).map((m: any) => ({
                      label: m.name, value: m.id,
                    })),
                  ]}
                  value={models?.main?.id ? [models.main.id] : []}
                  onChange={(values) => void setMainModel(values[0] ?? "")}
                />
              </div>
              {(models?.subagents ?? []).map((subagent: any) => (
                <div className="model-row" key={subagent.agent}>
                  <label>{subagent.agent}</label>
                  <Selector
                    columns={1}
                    options={[
                      { label: "跟随主模型", value: "" },
                      ...(models?.available ?? []).map((m: any) => ({
                        label: m.name, value: m.id,
                      })),
                    ]}
                    value={subagent.model ? [subagent.model] : []}
                    onChange={(values) => void setSubagentModel(
                      subagent.agent, values[0] ?? "", subagent.thinking ?? "",
                    )}
                  />
                </div>
              ))}
            </div>
            )}
          </div>
        </div>
      </Popup>

      {/* Remote panels (agents / web / documents) */}
      <Popup
        visible={activePanel !== null}
        onMaskClick={() => setActivePanel(null)}
        position="right"
        bodyStyle={{ width: "100%", height: "100%" }}
      >
        <div className="panel-body">
          <div className="panel-head">
            <h3>
              {panelDetail
                ? panelDetail.title
                : activePanel === "agents"
                  ? "Subagents"
                  : activePanel === "web"
                    ? "Web"
                    : "文档"}
            </h3>
            <Button size="small" onClick={() => setActivePanel(null)}>关闭</Button>
          </div>
          <div className="panel-scroll">
            {panelDetailLoading ? (
              <div className="center-block scroll-fill">
                <SpinLoading color="primary" />
                <span>正在加载…</span>
              </div>
            ) : panelDetail ? (
              <>
                {panelDetail.meta ? <pre className="panel-meta">{panelDetail.meta}</pre> : null}
                {panelDetail.content ? (
                  <pre className="document-content">{panelDetail.content}</pre>
                ) : (
                  <pre className="panel-detail">{panelDetail.log}</pre>
                )}
              </>
            ) : activePanelData === null ? (
              <div className="center-block scroll-fill">
                <SpinLoading color="primary" />
                <span>正在加载…</span>
              </div>
            ) : activePanel === "agents" ? (
              <div className="model-panel-grid">
                {activePanelData.agents.map((agent: any) => (
                  <Button
                    key={agent.agentID}
                    className="panel-item"
                    fill="outline"
                    onClick={() => void openAgentDetail(agent)}
                  >
                    {agent.name} · {agent.state} · {agent.title}
                  </Button>
                ))}
                {activePanelData.agents.length === 0 ? (
                  <div className="list-empty">暂无 Subagent</div>
                ) : null}
              </div>
            ) : activePanel === "web" ? (
              <div className="web-frame-wrap">
                {activePanelData.web ? (
                  <>
                    <span className="web-status">
                      {activePanelData.web.isLoading
                        ? "加载中…"
                        : (() => {
                            try {
                              return new URL(activePanelData.web.url).href;
                            } catch {
                              return "网页地址不可远程显示";
                            }
                          })()}
                    </span>
                    {(() => {
                      try {
                        const url = new URL(activePanelData.web.url);
                        if (url.protocol !== "http:" && url.protocol !== "https:") {
                          throw new Error("invalid url");
                        }
                        return (
                          <iframe
                            className="web-frame"
                            sandbox="allow-forms allow-scripts allow-popups"
                            src={url.href}
                            title="Web"
                          />
                        );
                      } catch {
                        return null;
                      }
                    })()}
                  </>
                ) : (
                  <div className="list-empty">未打开网页</div>
                )}
              </div>
            ) : (
              <div className="model-panel-grid">
                {activePanelData.documents.map((document: any) => (
                  <Button
                    key={document.id}
                    className="panel-item"
                    fill="outline"
                    onClick={() => void openDocument(document)}
                  >
                    {document.name} · {document.kind} · {document.size} B
                  </Button>
                ))}
                {activePanelData.documents.length === 0 ? (
                  <div className="list-empty">未打开文档</div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </Popup>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  const bootStatus = document.getElementById("boot-status");
  if (bootStatus) bootStatus.remove();
  createRoot(root).render(<App />);
}