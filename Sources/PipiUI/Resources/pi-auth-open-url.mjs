// Browser launcher for the OAuth `auth_url` event. Kept in its own module so it
// can be unit-tested in isolation (the helper script runs top-level CLI code on
// import and otherwise cannot be loaded as a plain module).
//
// Mirrors pi's utils/open-browser.ts: never spawn a shell, and absorb launcher
// failures so a failed spawn can never crash the calling process.
import { spawn as defaultSpawn } from "node:child_process";

/**
 * Open `url` in the macOS default browser (or the platform equivalent).
 *
 * Two differences from a naive `spawn("open", [url])`:
 *  1. On macOS we use the absolute path `/usr/bin/open`. This helper runs as a
 *     subprocess of the PipiUI GUI app, whose inherited PATH can be minimal and
 *     may not resolve a bare "open" — when that happens spawn fails and (without
 *     an error listener, see #2) the helper crashes mid-OAuth before the browser
 *     opens. The absolute path is PATH-independent.
 *  2. spawn reports launcher failures (e.g. binary missing) via an asynchronous
 *     'error' event. We attach a no-op listener so the failure never becomes an
 *     uncaught exception / unhandled rejection that would abort the surrounding
 *     `runtime.login()` promise.
 *
 * @param {string} url - The auth_url to open.
 * @param {{ spawn?: typeof defaultSpawn, platform?: NodeJS.Platform }} [opts]
 *   Injection points used only by tests.
 * @returns {import("node:child_process").ChildProcess | null} The spawned child
 *   (already unref'd), or null if spawning threw synchronously.
 */
export function openURL(url, opts = {}) {
  const doSpawn = opts.spawn ?? defaultSpawn;
  const platform = opts.platform ?? process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? ["/usr/bin/open", [url]]
      : platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const child = doSpawn(cmd, args, { stdio: "ignore", detached: true });
    // Best-effort launcher: an unhandled 'error' event would otherwise become an
    // uncaughtException and abort OAuth login. The auth_url has already been
    // emitted to the host, so silently swallow launcher errors.
    if (child && typeof child.on === "function") child.on("error", () => {});
    if (child && typeof child.unref === "function") child.unref();
    return child;
  } catch {
    // Synchronous spawn errors (e.g. invalid arguments) — ignore.
    return null;
  }
}
