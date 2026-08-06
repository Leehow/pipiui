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
            html, body { height: 100%; }
            body {
              height: 100vh; height: 100dvh;
              margin: 0; overflow: hidden;
              display: flex; flex-direction: column;
              background: var(--bg); color: var(--text);
            }
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
              flex: none; z-index: 20;
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
            .conn-pill.is-idle { color: var(--accent-text); border-color: rgba(121, 184, 255, .4); }
            .conn-pill.is-idle .conn-dot { background: var(--accent-text); }
            .conn-pill.is-disconnected { color: var(--warn); border-color: rgba(255, 176, 32, .4); }
            .conn-pill.is-disconnected .conn-dot { background: var(--warn); animation: conn-pulse 1.1s ease-in-out infinite; }
            @keyframes conn-pulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: .35; transform: scale(.78); }
            }

            main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(260px, 32%) 1fr; }
            aside { min-height: 0; overflow-y: auto; padding: 16px; border-right: 1px solid var(--border); }
            aside h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); margin: 0 0 10px; }
            .list { display: grid; gap: 8px; margin-bottom: 24px; }
            .row.card {
              display: flex; gap: 10px; align-items: center; justify-content: space-between;
              padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px;
              background: var(--surface); transition: background .15s, border-color .15s;
            }
            .row.card:hover { background: var(--surface-2); border-color: #354554; }
            .row.card.selected { border-color: var(--accent); background: var(--accent-soft); }
            .row-title { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
            .row.card > button { flex: none; }
            .row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .pager {
              display: flex; align-items: center; justify-content: center; gap: 12px;
              margin: 2px 0 24px; padding-top: 4px;
            }
            .pager button { padding: 5px 12px; font-size: 12.5px; }
            .pager button:disabled { visibility: hidden; }
            .pager-info { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
            .badge {
              flex: none; font-size: 11px; line-height: 1; padding: 4px 8px; border-radius: 999px;
              background: var(--accent-soft); color: var(--accent-text);
            }
            .empty-hint {
              margin: 0; padding: 18px 14px; border: 1px dashed var(--border); border-radius: 12px;
              color: var(--muted); font-size: 13px; text-align: center; line-height: 1.55;
            }

            section#session-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
            .session-head { display: flex; align-items: center; gap: 10px; padding: 14px 20px 6px; }
            .session-head h2 { font-size: 15px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            #back-to-list { display: none; flex: none; padding: 6px 10px; }

            #transcript { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 20px 18px; display: flex; flex-direction: column; gap: 10px; }
            .message { max-width: 78%; padding: 10px 14px; border-radius: 16px; overflow-wrap: anywhere; }
            .message.user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 6px; }
            .message.assistant { align-self: flex-start; background: var(--surface-2); border: 1px solid var(--border); border-bottom-left-radius: 6px; }
            .message.system {
              align-self: center; max-width: 92%; background: transparent;
              border: 1px dashed var(--border); color: var(--muted); font-size: 13px;
            }
            .message.user .role { color: rgba(255, 255, 255, .75); }
            .role { display: block; color: var(--muted); font-size: 11.5px; margin-bottom: 4px; }
            .markdown-body { min-width: 0; }
            .markdown-body > :first-child { margin-top: 0; }
            .markdown-body > :last-child { margin-bottom: 0; }
            .markdown-body p { margin: 0 0 .7em; }
            .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
              margin: .85em 0 .4em; line-height: 1.25;
            }
            .markdown-body h1 { font-size: 1.35em; }
            .markdown-body h2 { font-size: 1.22em; }
            .markdown-body h3 { font-size: 1.12em; }
            .markdown-body h4 { font-size: 1.04em; }
            .markdown-body ul, .markdown-body ol { margin: .45em 0 .7em; padding-left: 1.45em; }
            .markdown-body li { margin: .16em 0; }
            .markdown-body blockquote {
              margin: .55em 0; padding: .1em 0 .1em .85em;
              border-left: 3px solid var(--accent-text); color: var(--muted);
            }
            .markdown-body hr { border: 0; border-top: 1px solid currentColor; opacity: .25; margin: .85em 0; }
            .markdown-body code {
              padding: .12em .38em; border-radius: 5px;
              background: rgba(0, 0, 0, .28);
              font: .9em/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
            }
            .markdown-body pre {
              margin: .65em 0; padding: 11px 12px; overflow: auto;
              border: 1px solid rgba(255, 255, 255, .11); border-radius: 9px;
              background: rgba(0, 0, 0, .32); white-space: pre;
            }
            .markdown-body pre code { padding: 0; background: transparent; font-size: 12.5px; }
            .markdown-body a { color: #9dccff; text-decoration: underline; text-underline-offset: 2px; }
            .message.user .markdown-body a { color: #fff; }

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
              flex: none; display: grid; gap: 8px;
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
              main { display: block; }
              aside { border-right: 0; height: 100%; }
              main[data-mobile-view="list"] #session-pane { display: none; }
              main[data-mobile-view="detail"] #list-pane { display: none; }
              main[data-mobile-view="detail"] #session-pane {
                display: flex; height: 100%;
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
            <div id="conn-pill" class="conn-pill is-idle" role="status" aria-live="polite">
              <span class="conn-dot" aria-hidden="true"></span>
              <span id="conn-label">已连接 · 暂无会话</span>
            </div>
          </header>
          <main id="remote-main" data-mobile-view="list">
            <aside id="list-pane" aria-label="项目与会话列表">
              <h2>项目</h2><div id="projects" class="list"></div>
              <h2>会话</h2><div id="sessions" class="list"></div>
              <div id="session-pagination" class="pager"></div>
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
            const SESSION_PAGE_SIZE = 10;
            let sessionPage = 0;
            let pollTimer = null;
            let connFailures = 0;
            let connState = "idle";
            let hasSessions = false;
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
              pill.classList.toggle("is-idle", state === "idle");
              pill.classList.toggle("is-disconnected", state === "disconnected");
              el("conn-label").textContent =
                state === "connected" ? "已连接" :
                state === "idle" ? "已连接 · 暂无会话" :
                "连接中断，重试中…";
            }
            function noteConnReachable() {
              connFailures = 0;
              if (connState === "disconnected") setConn(hasSessions ? "connected" : "idle");
            }
            function noteSessionAvailability(count) {
              hasSessions = count > 0;
              if (connFailures >= 2) return;
              const next = hasSessions ? "connected" : "idle";
              if (connState !== next) setConn(next);
            }
            function noteConnFailure() {
              connFailures += 1;
              if (connFailures >= 2) setConn("disconnected");
            }
            window.addEventListener("offline", () => { pollSnapshot(); });
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
              noteConnReachable();
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
            function renderPager(page, totalPages, total) {
              const pager = el("session-pagination");
              pager.replaceChildren();
              if (totalPages <= 1) return;
              const prev = label("button", "‹ 上一页");
              prev.disabled = page <= 0;
              prev.addEventListener("click", () => {
                sessionPage = Math.max(0, sessionPage - 1);
                loadIndex().catch(error => setStatus(error.message));
              });
              const next = label("button", "下一页 ›");
              next.disabled = page >= totalPages - 1;
              next.addEventListener("click", () => {
                sessionPage = Math.min(totalPages - 1, sessionPage + 1);
                loadIndex().catch(error => setStatus(error.message));
              });
              const info = label("span", `${page + 1} / ${totalPages} 页 · 共 ${total} 个`, "pager-info");
              pager.append(prev, info, next);
            }
            async function loadIndex() {
              const data = await api("/api/index");
              noteSessionAvailability(data.sessions.length);
              const projects = el("projects");
              const sessions = el("sessions");
              projects.replaceChildren();
              const totalPages = Math.max(1, Math.ceil(data.sessions.length / SESSION_PAGE_SIZE));
              if (sessionPage >= totalPages) sessionPage = totalPages - 1;
              const pageSessions = data.sessions.slice(
                sessionPage * SESSION_PAGE_SIZE,
                sessionPage * SESSION_PAGE_SIZE + SESSION_PAGE_SIZE
              );
              sessions.replaceChildren();
              if (data.sessions.length === 0) {
                const hint = label("p", "暂无会话，可在上方项目区点击「新建」", "empty-hint");
                sessions.append(hint);
              }
              renderPager(sessionPage, totalPages, data.sessions.length);
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
              for (const session of pageSessions) {
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
            function appendPlain(parent, text) {
              if (!text) return;
              const span = document.createElement("span");
              span.textContent = text;
              parent.append(span);
            }
            function isAllowedLink(url) {
              const allowed = url.startsWith("http://") || url.startsWith("https://");
              if (!allowed) return false;
              for (let index = 0; index < url.length; index += 1) {
                const code = url.charCodeAt(index);
                if (code <= 32 || code === 127) return false;
              }
              return true;
            }
            function appendInline(parent, text, depth = 0) {
              if (depth > 6) {
                appendPlain(parent, text);
                return;
              }
              let index = 0;
              let plain = "";
              let noMoreLinkClosures = false;
              const flush = () => {
                appendPlain(parent, plain);
                plain = "";
              };
              while (index < text.length) {
                if (text[index] === "\\" && index + 1 < text.length) {
                  plain += text[index + 1];
                  index += 2;
                  continue;
                }
                if (text[index] === "`") {
                  const close = text.indexOf("`", index + 1);
                  if (close > index + 1) {
                    flush();
                    const code = document.createElement("code");
                    code.textContent = text.slice(index + 1, close);
                    parent.append(code);
                    index = close + 1;
                    continue;
                  }
                }
                if (text[index] === "[" && !noMoreLinkClosures) {
                  const middle = text.indexOf("](", index + 1);
                  if (middle === -1) {
                    noMoreLinkClosures = true;
                  } else {
                    const close = text.indexOf(")", middle + 2);
                    if (close !== -1) {
                      const original = text.slice(index, close + 1);
                      const linkText = text.slice(index + 1, middle);
                      const url = text.slice(middle + 2, close).trim();
                      flush();
                      if (isAllowedLink(url)) {
                        const link = document.createElement("a");
                        link.setAttribute("href", url);
                        link.setAttribute("target", "_blank");
                        link.setAttribute("rel", "noopener noreferrer");
                        appendInline(link, linkText, depth + 1);
                        parent.append(link);
                      } else {
                        appendPlain(parent, original);
                      }
                      index = close + 1;
                      continue;
                    }
                  }
                }
                if (text.startsWith("**", index)) {
                  const close = text.indexOf("**", index + 2);
                  if (close > index + 2) {
                    flush();
                    const strong = document.createElement("strong");
                    appendInline(strong, text.slice(index + 2, close), depth + 1);
                    parent.append(strong);
                    index = close + 2;
                    continue;
                  }
                  plain += "**";
                  index += 2;
                  continue;
                }
                if (text.startsWith("~~", index)) {
                  const close = text.indexOf("~~", index + 2);
                  if (close > index + 2) {
                    flush();
                    const strike = document.createElement("del");
                    appendInline(strike, text.slice(index + 2, close), depth + 1);
                    parent.append(strike);
                    index = close + 2;
                    continue;
                  }
                  plain += "~~";
                  index += 2;
                  continue;
                }
                if (text[index] === "*") {
                  const close = text.indexOf("*", index + 1);
                  if (close > index + 1) {
                    flush();
                    const emphasis = document.createElement("em");
                    appendInline(emphasis, text.slice(index + 1, close), depth + 1);
                    parent.append(emphasis);
                    index = close + 1;
                    continue;
                  }
                }
                plain += text[index];
                index += 1;
              }
              flush();
            }
            function headingInfo(line) {
              const value = line.trimStart();
              let level = 0;
              while (level < 4 && value[level] === "#") level += 1;
              if (level > 0 && value[level] === " ") {
                return {level, text: value.slice(level + 1)};
              }
              return null;
            }
            function unorderedItem(line) {
              const value = line.trimStart();
              if (value.length >= 2
                  && (value[0] === "-" || value[0] === "*" || value[0] === "+")
                  && value[1] === " ") {
                return value.slice(2);
              }
              return null;
            }
            function orderedItem(line) {
              const value = line.trimStart();
              let index = 0;
              while (index < value.length && value[index] >= "0" && value[index] <= "9") {
                index += 1;
              }
              if (index > 0 && value[index] === "." && value[index + 1] === " ") {
                return value.slice(index + 2);
              }
              return null;
            }
            function isBlockStart(line) {
              const value = line.trimStart();
              return value.startsWith("```")
                || headingInfo(line) !== null
                || value === "---"
                || value.startsWith(">")
                || unorderedItem(line) !== null
                || orderedItem(line) !== null;
            }
            function appendInlineLines(parent, lines) {
              lines.forEach((line, index) => {
                if (index > 0) parent.append(document.createElement("br"));
                appendInline(parent, line, 0);
              });
            }
            function renderMarkdown(text) {
              const root = document.createElement("div");
              root.className = "markdown-body";
              const normalized = (typeof text === "string" ? text : "")
                .split("\r\n").join("\n").split("\r").join("\n");
              const lines = normalized.split("\n");
              let index = 0;
              while (index < lines.length) {
                if (lines[index].trim() === "") {
                  index += 1;
                  continue;
                }
                const value = lines[index].trimStart();
                if (value.startsWith("```")) {
                  const language = value.slice(3).trim();
                  const codeLines = [];
                  index += 1;
                  while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
                    codeLines.push(lines[index]);
                    index += 1;
                  }
                  if (index < lines.length) index += 1;
                  const pre = document.createElement("pre");
                  const code = document.createElement("code");
                  if (language) code.setAttribute("data-language", language);
                  code.textContent = codeLines.join("\n");
                  pre.append(code);
                  root.append(pre);
                  continue;
                }
                const heading = headingInfo(lines[index]);
                if (heading !== null) {
                  const node = document.createElement(`h${heading.level}`);
                  appendInline(node, heading.text, 0);
                  root.append(node);
                  index += 1;
                  continue;
                }
                if (value === "---") {
                  root.append(document.createElement("hr"));
                  index += 1;
                  continue;
                }
                const firstUnordered = unorderedItem(lines[index]);
                if (firstUnordered !== null) {
                  const list = document.createElement("ul");
                  while (index < lines.length) {
                    const itemText = unorderedItem(lines[index]);
                    if (itemText === null) break;
                    const item = document.createElement("li");
                    appendInline(item, itemText, 0);
                    list.append(item);
                    index += 1;
                  }
                  root.append(list);
                  continue;
                }
                const firstOrdered = orderedItem(lines[index]);
                if (firstOrdered !== null) {
                  const list = document.createElement("ol");
                  while (index < lines.length) {
                    const itemText = orderedItem(lines[index]);
                    if (itemText === null) break;
                    const item = document.createElement("li");
                    appendInline(item, itemText, 0);
                    list.append(item);
                    index += 1;
                  }
                  root.append(list);
                  continue;
                }
                if (value.startsWith(">")) {
                  const quoteLines = [];
                  while (index < lines.length) {
                    const quote = lines[index].trimStart();
                    if (!quote.startsWith(">")) break;
                    quoteLines.push(quote[1] === " " ? quote.slice(2) : quote.slice(1));
                    index += 1;
                  }
                  const quote = document.createElement("blockquote");
                  appendInlineLines(quote, quoteLines);
                  root.append(quote);
                  continue;
                }
                const paragraphLines = [];
                while (index < lines.length
                    && lines[index].trim() !== ""
                    && !isBlockStart(lines[index])) {
                  paragraphLines.push(lines[index]);
                  index += 1;
                }
                if (paragraphLines.length > 0) {
                  const paragraph = document.createElement("p");
                  appendInlineLines(paragraph, paragraphLines);
                  root.append(paragraph);
                }
              }
              return root;
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
              bubble.append(renderMarkdown(message.text));
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
              if (activeSession) {
                try {
                  const data = await api("/api/snapshot", {sessionID: activeSession, revision});
                  if (!data.unchanged) renderSnapshot(data);
                } catch (error) { setStatus(error.message); }
                return;
              }
              try { await loadIndex(); }
              catch (error) { setStatus(error.message); }
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
