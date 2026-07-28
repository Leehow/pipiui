import Foundation

enum LocalRemoteWebPage {
    static let tokenHeader = "X-PipiUI-Remote-Token"

    static func render(token: String, nonce: String) -> Data {
        let template = #"""
        <!doctype html>
        <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>PipiUI 本地远程测试</title>
          <style nonce="__NONCE__">
            :root { color-scheme: light dark; font: 15px -apple-system,BlinkMacSystemFont,sans-serif; }
            body { margin: 0; background: #101418; color: #e8eef2; }
            header { padding: 16px 20px; border-bottom: 1px solid #31404a; }
            main { display: grid; grid-template-columns: minmax(260px, 34%) 1fr; min-height: calc(100vh - 62px); }
            aside { padding: 16px; border-right: 1px solid #31404a; overflow: auto; }
            section { padding: 16px; min-width: 0; }
            h1,h2,h3 { margin: 0 0 12px; }
            h1 { font-size: 18px; } h2 { font-size: 16px; }
            button,textarea { font: inherit; }
            button { border: 1px solid #49606e; border-radius: 8px; background: #22313a; color: inherit; padding: 7px 10px; cursor: pointer; }
            button:hover { background: #2d424e; } button:disabled { opacity: .5; cursor: default; }
            .list { display: grid; gap: 8px; margin-bottom: 20px; }
            .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 9px; border: 1px solid #31404a; border-radius: 9px; }
            .row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
            #transcript { display: grid; gap: 10px; max-height: calc(100vh - 250px); overflow: auto; padding-bottom: 10px; }
            .message { padding: 10px 12px; border-radius: 10px; background: #1b252c; white-space: pre-wrap; overflow-wrap: anywhere; }
            .message.user { background: #183848; } .message.system { background: #3a2f1b; }
            .role { display: block; color: #9db0bc; font-size: 12px; margin-bottom: 5px; }
            .composer { display: grid; gap: 8px; margin-top: 12px; }
            textarea { min-height: 78px; resize: vertical; border: 1px solid #49606e; border-radius: 9px; padding: 9px; background: #131c21; color: inherit; }
            .actions { display: flex; gap: 8px; align-items: center; }
            #status { color: #9db0bc; margin-left: auto; font-size: 12px; }
            @media (max-width: 760px) { main { grid-template-columns: 1fr; } aside { border-right: 0; border-bottom: 1px solid #31404a; } }
          </style>
        </head>
        <body>
          <header><h1>PipiUI 本地远程测试</h1></header>
          <main>
            <aside>
              <h2>项目</h2><div id="projects" class="list"></div>
              <h2>会话</h2><div id="sessions" class="list"></div>
            </aside>
            <section>
              <h2 id="session-title">请选择会话</h2>
              <div id="transcript"></div>
              <div class="composer">
                <textarea id="prompt" placeholder="发送文本（本地内置 slash 命令会被拒绝）"></textarea>
                <div class="actions">
                  <button id="send" disabled>发送</button>
                  <button id="stop" disabled>Stop</button>
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
            const el = id => document.getElementById(id);
            const label = (tag, text, className) => {
              const node = document.createElement(tag);
              node.textContent = text;
              if (className) node.className = className;
              return node;
            };
            async function api(path, body) {
              const response = await fetch(path, {
                method: body === undefined ? "GET" : "POST",
                headers: {
                  "__TOKEN_HEADER__": token,
                  ...(body === undefined ? {} : {"Content-Type": "application/json"})
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                cache: "no-store",
                credentials: "same-origin"
              });
              if (response.status === 304) return {unchanged: true};
              const data = await response.json().catch(() => ({error: "响应不是 JSON"}));
              if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
              return data;
            }
            function setStatus(text) { el("status").textContent = text; }
            async function loadIndex() {
              const data = await api("/api/index");
              const projects = el("projects");
              const sessions = el("sessions");
              projects.replaceChildren();
              sessions.replaceChildren();
              for (const project of data.projects) {
                const row = document.createElement("div"); row.className = "row";
                row.append(label("span", project.name));
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
                const row = document.createElement("div"); row.className = "row";
                row.append(label("span", session.title + (session.isGenerating ? " · 生成中" : "")));
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
              } catch (error) { setStatus(error.message); }
            }
            function renderSnapshot(data) {
              const snapshot = data.snapshot;
              revision = data.revision;
              el("session-title").textContent = snapshot.title;
              el("send").disabled = !snapshot.processAlive;
              el("stop").disabled = !(snapshot.isGenerating || snapshot.isStopping);
              const transcript = el("transcript");
              transcript.replaceChildren();
              for (const message of snapshot.messages) {
                const row = document.createElement("div");
                row.className = "message " + message.role;
                row.append(label("span", message.role, "role"));
                row.append(document.createTextNode(message.text));
                transcript.append(row);
              }
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
