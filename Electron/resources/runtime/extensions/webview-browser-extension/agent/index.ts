/**
 * webview-browser-extension agent half (frozen core-capability tools:
 * `browser` / `browser_search` / `browser_fetch`).
 *
 * Tool names, schemas, wire actions, the watch protocol, per-session partition
 * semantics, and transcript rendering are unchanged from the pre-migration
 * single-file mounts (`pipiui-electron-webview.ts` + `pipiui-browser-search.ts`).
 * What changed is the transport: every WebContentsView/session call now rides
 * the versioned Host Capability API (`agent/capability-bridge.ts`), so the
 * Electron core keeps only the native minimum (WebContentsView, partition,
 * session, DOM bridge) while this package owns the tool surface.
 *
 * Watch delivery keeps the frozen `[browser-watch]` follow-up contract: the
 * pi-ext callback server + durable delivery obligations stay the wake channel,
 * and the subscribe now travels as a `browser.watch` capability op.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { startBrowserWatchCallbackServer } from "../../../pi-ext/subagent/browser-watch-callback.ts";
import { registerBrowserWatchDelivery } from "../../../pi-ext/subagent/browser-watch-delivery.ts";
import { capabilityCall } from "./capability-bridge.ts";
import registerBrowserTool from "./browser-tool.ts";
import registerBrowserSearchTools from "./browser-search-tools.ts";

export {
  BROWSER_TOOL_DECLARED_ACTIONS,
  BROWSER_WATCH_TOOL_ACTIONS,
  executeBrowserTool,
} from "./browser-tool.ts";

export default function webviewBrowserExtension(pi: ExtensionAPI): void {
  const port = process.env.PIPIUI_BRIDGE_PORT;
  const key = process.env.PIPIUI_SESSION_KEY;
  if (!port || !key) return; // Not running inside Pipi UI; stay dormant.

  const capability = process.env.PIPIUI_SESSION_CAPABILITY;
  const watchDelivery = registerBrowserWatchDelivery({
    pi,
    sessionKey: () => process.env.PIPIUI_SESSION_KEY,
  });
  pi.on("session_start", () => {
    try { watchDelivery.recover(); } catch { /* recover is best-effort */ }
  });
  if (capability) {
    void startBrowserWatchCallbackServer({ secret: capability }).then(async (server) => {
      try {
        await capabilityCall("browser.watch", {
          action: "subscribe",
          op: "subscribe",
          callbackPort: server.port,
          callbackSecret: capability,
        });
      } catch (error) {
        console.error("[pipiui-browser-watch] subscribe failed:", error);
      }
    }).catch((error) => {
      console.error("[pipiui-browser-watch] callback listen failed:", error);
    });
  }

  registerBrowserTool(pi);
  registerBrowserSearchTools(pi);
}
