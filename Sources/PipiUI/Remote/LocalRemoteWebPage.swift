import Foundation

enum LocalRemoteWebPage {
    static let tokenHeader = "X-PipiUI-Remote-Token"

    static func render(token: String, nonce: String) -> Data {
        let template = #"""
        <!doctype html>
        <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
          <title>PipiUI 远程会话</title>
          <style nonce="__NONCE__">
            :root {
              color-scheme: dark;
              --bg: #0b0f14;
              --surface: #131a22;
              --surface-2: #1a2430;
              --border: #26313d;
              --text: #e6edf3;
              --muted: #8b98a5;
              --accent: #2f81f7;
              --accent-soft: rgba(47, 129, 247, .16);
              --accent-text: #79b8ff;
              --ok: #3dd68c;
              --warn: #ffb020;
              font: 15px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
            }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); }
            h1, h2, h3 { margin: 0; }
            button, textarea { font: inherit; }
            button {
              border: 1px solid var(--border); border-radius: 10px;
              background: var(--surface-2); color: var(--text);
              padding: 7px 14px; cursor: pointer; transition: background .15s, border-color .15s;
            }
            button:hover:not(:disabled) { background: #22303e; border-color: #354554; }
            button:disabled { opacity: .45; cursor: default; }
            button.primary { background: var(--accent); border-color: transparent; color: #fff; font-weight: 600; }
            button.primary:hover:not(:disabled) { background: #1f6feb; }

            header.app-header {
              position: sticky; top: 0; z-index: 20;
              display: flex; align-items: center; justify-content: space-between; gap: 12px;
              padding: 13px 20px; border-bottom: 1px solid var(--border);
              background: rgba(11, 15, 20, .92); backdrop-filter: blur(12px);
            }
            header.app-header h1 { font-size: 16px; font-weight: 650; letter-spacing: .2px; }

            .conn-pill {
              display: inline-flex; align-items: center; gap: 7px;
              padding: 5px 12px; border-radius: 999px; font-size: 12.5px; white-space: nowrap;
              background: var(--surface); border: 1px solid var(--border); color: var(--muted);
            }
            .conn-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; }
            .conn-pill.is-connected { color: var(--ok); }
            .conn-pill.is-disconnected { color: var(--warn); border-color: rgba(255, 176, 32, .4); }
            .conn-pill.is-disconnected .conn-dot { background: var(--warn); animation: conn-pulse 1.1s ease-in-out infinite; }
            @keyframes conn-pulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: .35; transform: scale(.78); }
            }

            main { display: grid; grid-template-columns: minmax(260px, 32%) 1fr; height: calc(100vh - 54px); height: calc(100dvh - 54px); }
            aside { padding: 16px; border-right: 1px solid var(--border); overflow: auto; }
            aside h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); margin: 0 0 10px; }
            .list { display: grid; gap: 8px; margin-bottom: 24px; }
            .row.card {
              display: flex; gap: 10px; align-items: center; justify-content: space-between;
              padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px;
              background: var(--surface); transition: background .15s, border-color .15s;
            }
            .row.card:hover { background: var(--surface-2); border-color: #354554; }
            .row.card.selected { border-color: var(--accent); background: var(--accent-soft); }
            .row-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
            .row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .badge {
              flex: none; font-size: 11px; line-height: 1; padding: 4px 8px; border-radius: 999px;
              background: var(--accent-soft); color: var(--accent-text);
            }

            section#session-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
            .session-head { display: flex; align-items: center; gap: 10px; padding: 14px 20px 6px; }
            .session-head h2 { font-size: 15px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            #back-to-list { display: none; flex: none; padding: 6px 10px; }

            #transcript { flex: 1; overflow: auto; padding: 10px 20px 18px; display: flex; flex-direction: column; gap: 10px; }
            .message { max-width: 78%; padding: 10px 14px; border-radius: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
            .message.user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 6px; }
            .message.assistant { align-self: flex-start; background: var(--surface-2); border: 1px solid var(--border); border-bottom-left-radius: 6px; }
            .message.system {
              align-self: center; max-width: 92%; background: transparent;
              border: 1px dashed var(--border); color: var(--muted); font-size: 13px;
            }
            .message.user .role { color: rgba(255, 255, 255, .75); }
            .role { display: block; color: var(--muted); font-size: 11.5px; margin-bottom: 4px; }

            .tool-entry, .thinking-entry {
              align-self: flex-start; display: flex; align-items: baseline; gap: 8px; max-width: 88%;
              padding: 6px 12px; border-radius: 10px;
              background: var(--surface); border: 1px solid var(--border);
              font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted);
            }
            .tool-icon { flex: none; }
            .tool-name { color: var(--text); font-weight: 600; }
            .tool-summary { min-width: 0; overflow-wrap: anywhere; }
            .tool-entry.live, .thinking-entry.live { border-color: var(--accent); color: var(--accent-text); }
            .tool-entry.live .tool-icon, .thinking-entry.live .tool-icon {
              display: inline-block; animation: live-spin 1s linear infinite;
            }
            @keyframes live-spin { to { transform: rotate(360deg); } }

            .composer {
              position: sticky; bottom: 0; z-index: 10;
              display: grid; gap: 8px;
              padding: 12px 20px calc(12px + env(safe-area-inset-bottom, 0px));
              background: var(--bg); border-top: 1px solid var(--border);
            }
            textarea {
              width: 100%; min-height: 62px; max-height: 180px; resize: vertical;
              border: 1px solid var(--border); border-radius: 12px;
              padding: 10px 12px; background: var(--surface); color: inherit;
            }
            textarea:focus { outline: none; border-color: var(--accent); }
            .actions { display: flex; gap: 8px; align-items: center; }
            #status { color: var(--muted); margin-left: auto; font-size: 12px; text-align: right; }

            @media (max-width: 760px) {
              main { display: block; height: auto; min-height: calc(100dvh - 54px); }
              aside { border-right: 0; }
              main[data-mobile-view="list"] #session-pane { display: none; }
              main[data-mobile-view="detail"] #list-pane { display: none; }
              main[data-mobile-view="detail"] #session-pane {
                display: flex; height: calc(100dvh - 54px);
              }
              main[data-mobile-view="detail"] #back-to-list { display: inline-flex; }
              .message { max-width: 88%; }
              textarea { min-height: 72px; }
            }
          </style>
        </head>
        <body>
          <header class="app-header">
            <h1>PipiUI 远程会话</h1>
            <div id="conn-pill" class="conn-pill is-connected" role="status" aria-live="polite">
              <span class="conn-dot" aria-hidden="true"></span>
              <span id="conn-label">已连接</span>
            </div>
          </header>
          <main id="remote-main" data-mobile-view="list">
            <aside id="list-pane" aria-label="项目与会话列表">
              <h2>项目</h2><div id="projects" class="list"></div>
              <h2>会话</h2><div id="sessions" class="list"></div>
            </aside>
            <section id="session-pane" aria-label="会话详情">
              <div class="session-head">
                <button id="back-to-list" type="button" aria-label="返回会话列表">← 返回</button>
                <h2 id="session-title">请选择会话</h2>
              </div>
              <div id="transcript" aria-live="polite"></div>
              <div class="composer">
                <textarea id="prompt" placeholder="发送文本（本地内置 slash 命令会被拒绝）"></textarea>
                <div class="actions">
                  <button id="send" class="primary" disabled>发送</button>
                  <button id="stop" disabled>停止</button>
                  <span id="status">未连接会话</span>
                </div>
              </div>
            </section>
          </main>
          <script nonce="__NONCE__">
          (() => {
            "use strict";
            const token = "__TOKEN__";
            let activeSession = null;
            let revision = null;
            let pollTimer = null;
            let connFailures = 0;
            let connState = "connected";
            const el = id => document.getElementById(id);
            const label = (tag, text, className) => {
              const node = document.createElement(tag);
              node.textContent = text;
              if (className) node.className = className;
              return node;
            };
            function setConn(state) {
              connState = state;
              const pill = el("conn-pill");
              pill.classList.toggle("is-connected", state === "connected");
              pill.classList.toggle("is-disconnected", state !== "connected");
              el("conn-label").textContent =
                state === "connected" ? "已连接" : "连接中断，重试中…";
            }
            function noteConnSuccess() {
              connFailures = 0;
              if (connState !== "connected") setConn("connected");
            }
            function noteConnFailure() {
              connFailures += 1;
              if (connFailures >= 2 || navigator.onLine === false) setConn("disconnected");
            }
            window.addEventListener("offline", () => {
              connFailures = 2;
              setConn("disconnected");
            });
            window.addEventListener("online", () => { pollSnapshot(); });
            async function api(path, body) {
              let response;
              try {
                response = await fetch(path, {
                  method: body === undefined ? "GET" : "POST",
                  headers: {
                    "__TOKEN_HEADER__": token,
                    ...(body === undefined ? {} : {"Content-Type": "application/json"})
                  },
                  body: body === undefined ? undefined : JSON.stringify(body),
                  cache: "no-store",
                  credentials: "same-origin"
                });
              } catch (networkError) {
                noteConnFailure();
                throw new Error("网络连接失败");
              }
              noteConnSuccess();
              if (response.status === 304) return {unchanged: true};
              const data = await response.json().catch(() => ({error: "响应不是 JSON"}));
              if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
              return data;
            }
            function setStatus(text) { el("status").textContent = text; }
            function showList() {
              el("remote-main").dataset.mobileView = "list";
              activeSession = null;
              revision = null;
              el("send").disabled = true;
              el("stop").disabled = true;
              setStatus("未连接会话");
            }
            function showDetail() {
              el("remote-main").dataset.mobileView = "detail";
            }
            async function loadIndex() {
              const data = await api("/api/index");
              const projects = el("projects");
              const sessions = el("sessions");
              projects.replaceChildren();
              sessions.replaceChildren();
              for (const project of data.projects) {
                const row = document.createElement("div"); row.className = "row card";
                const titleWrap = document.createElement("div"); titleWrap.className = "row-title";
                titleWrap.append(label("span", project.name, "row-name"));
                row.append(titleWrap);
                const button = label("button", "新建");
                button.addEventListener("click", async () => {
                  try {
                    const created = await api("/api/sessions", {projectID: project.id});
                    await loadIndex(); await openSession(created.sessionID, false);
                  } catch (error) { setStatus(error.message); }
                });
                row.append(button); projects.append(row);
              }
              for (const session of data.sessions) {
                const row = document.createElement("div");
                row.className = "row card" + (session.id === activeSession ? " selected" : "");
                const titleWrap = document.createElement("div"); titleWrap.className = "row-title";
                titleWrap.append(label("span", session.title, "row-name"));
                if (session.isGenerating) titleWrap.append(label("span", "生成中", "badge"));
                row.append(titleWrap);
                const button = label("button", "打开");
                button.addEventListener("click", () => openSession(session.id, true));
                row.append(button); sessions.append(row);
              }
            }
            async function openSession(sessionID, requestOpen) {
              try {
                if (requestOpen) await api("/api/sessions/open", {sessionID});
                activeSession = sessionID; revision = null;
                el("send").disabled = false; el("stop").disabled = false;
                await pollSnapshot();
                await loadIndex();
              } catch (error) { setStatus(error.message); }
            }
            function roleLabel(role) {
              return role === "user" ? "你" : role === "assistant" ? "助手" : "系统";
            }
            function renderEntry(message, live) {
              if (message.kind === "tool") {
                const row = document.createElement("div");
                row.className = "tool-entry" + (live ? " live" : "");
                row.append(label("span", "⚙︎", "tool-icon"));
                row.append(label("span", message.toolName || "tool", "tool-name"));
                if (message.toolSummary) {
                  row.append(label("span", message.toolSummary, "tool-summary"));
                }
                return row;
              }
              if (message.kind === "thinking") {
                const row = document.createElement("div");
                row.className = "thinking-entry" + (live ? " live" : "");
                row.append(label("span", "💭", "tool-icon"));
                row.append(label("span", "思考中", "thinking-label"));
                return row;
              }
              const bubble = document.createElement("div");
              bubble.className = "message " + message.role;
              bubble.append(label("span", roleLabel(message.role), "role"));
              bubble.append(document.createTextNode(message.text));
              return bubble;
            }
            function renderSnapshot(data) {
              const snapshot = data.snapshot;
              revision = data.revision;
              showDetail();
              el("session-title").textContent = snapshot.title;
              el("send").disabled = !snapshot.processAlive;
              el("stop").disabled = !(snapshot.isGenerating || snapshot.isStopping);
              const transcript = el("transcript");
              transcript.replaceChildren();
              snapshot.messages.forEach((message, index) => {
                const isProgress = message.kind === "tool" || message.kind === "thinking";
                const live = snapshot.isGenerating
                  && isProgress
                  && index === snapshot.messages.length - 1;
                transcript.append(renderEntry(message, live));
              });
              transcript.scrollTop = transcript.scrollHeight;
              setStatus(snapshot.isStopping ? "正在停止…" :
                snapshot.isGenerating ? "生成中" :
                snapshot.isInitializing ? "正在加载…" :
                snapshot.processAlive ? `空闲 · 队列 ${snapshot.queuedPromptCount}` : "进程已退出");
            }
            async function pollSnapshot() {
              if (!activeSession) return;
              try {
                const data = await api("/api/snapshot", {sessionID: activeSession, revision});
                if (!data.unchanged) renderSnapshot(data);
              } catch (error) { setStatus(error.message); }
            }
            el("send").addEventListener("click", async () => {
              const text = el("prompt").value;
              if (!text.trim() || !activeSession) return;
              try {
                await api("/api/send", {sessionID: activeSession, text, commandID: crypto.randomUUID()});
                el("prompt").value = ""; revision = null; await pollSnapshot();
              } catch (error) { setStatus(error.message); }
            });
            el("stop").addEventListener("click", async () => {
              if (!activeSession) return;
              try { await api("/api/stop", {sessionID: activeSession}); revision = null; await pollSnapshot(); }
              catch (error) { setStatus(error.message); }
            });
            el("back-to-list").addEventListener("click", async () => {
              showList();
              try { await loadIndex(); }
              catch (error) { setStatus(error.message); }
            });
            loadIndex().catch(error => setStatus(error.message));
            pollTimer = window.setInterval(pollSnapshot, 900);
            window.addEventListener("pagehide", () => window.clearInterval(pollTimer), {once: true});
          })();
          </script>
        </body>
        </html>
        """#
        let html = template
            .replacingOccurrences(of: "__TOKEN__", with: token)
            .replacingOccurrences(of: "__NONCE__", with: nonce)
            .replacingOccurrences(of: "__TOKEN_HEADER__", with: tokenHeader)
        return Data(html.utf8)
    }
}
