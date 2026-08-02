export const pageHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>PipiUI Remote</title>
<style nonce="{{NONCE}}">body{font:15px system-ui;margin:0;background:#f5f5f7;color:#1d1d1f}main{max-width:900px;margin:32px auto;padding:20px}section{background:white;border-radius:14px;padding:16px;margin:12px 0}button,select,textarea{font:inherit;padding:8px;margin:3px}textarea{width:100%;box-sizing:border-box}.msg{white-space:pre-wrap;border-top:1px solid #eee;padding:10px 0}.muted{color:#666}.transport{font-weight:600}</style>
</head><body><main><h1>PipiUI Remote</h1><p id="status" class="muted">请选择已配对的 Mac。</p>
<section><label for="devices">Mac</label> <select id="devices"></select>
<button id="connect">P2P 连接</button><button id="disconnect">断开</button>
<button id="revoke">解除配对</button>
<button id="fallback">显式使用兼容回退</button>
<p id="transport" class="transport">未连接</p>
<p class="muted">当前 P2P 仅使用浏览器与 Mac 的本地/直连 ICE 候选；未配置 TURN 时不会宣称具备 TURN 中继能力。兼容回退只会在你点击后启用，且不会重放此前命令。</p></section>
<section id="uncertainSection" hidden><h2>⚠️ 待确认的变更命令</h2>
<p>这些命令的结果未知，系统不会自动重放。请先核对 Mac 状态，再逐项确认已处理。</p>
<div id="uncertainList"></div></section>
<section><button id="refresh">刷新</button> <select id="projects"></select> <button id="create">新建会话</button><br><select id="sessions"></select> <button id="open">打开</button></section>
<section id="transcript"></section>
<section><textarea id="prompt" rows="4" placeholder="输入消息"></textarea><button id="send">发送</button> <button id="stop">Stop</button></section>
</main><script type="module" nonce="{{NONCE}}">
import { bootstrapBrowser } from "/assets/remote.js";
void bootstrapBrowser();
</script></body></html>`;

export const unpairedPageHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>PipiUI Remote</title>
<style nonce="{{NONCE}}">body{font:15px system-ui;margin:0;background:#f5f5f7;color:#1d1d1f}main{max-width:620px;margin:64px auto;padding:24px}section{background:white;border-radius:14px;padding:22px}.muted{color:#666;line-height:1.6}</style>
</head><body><main><section><h1>PipiUI Remote</h1>
<p class="muted">请在 Mac 上打开 PipiUI 的“远程连接”，生成一次性配对链接，然后在此浏览器中打开该链接。</p>
</section></main></body></html>`;
