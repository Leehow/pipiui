const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export function isWebSearchCuratorUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!url.searchParams.has("session")) return false;
    return LOOPBACK.has(url.hostname) || url.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function firstCuratorUrl(values) {
  for (const value of values) {
    if (typeof value === "string" && isWebSearchCuratorUrl(value)) return value;
  }
  return undefined;
}

export function curatorUrlFromOpenCommand(command, args = []) {
  const name = command === "cmd.exe" ? "cmd" : command;
  if (name === "open" || name === "xdg-open") return firstCuratorUrl(args);
  if (name === "cmd") return firstCuratorUrl(args);
  return undefined;
}

export function curatorUrlFromGlimpseHtml(html) {
  if (typeof html !== "string") return undefined;
  const match = /window\.location\.replace\((.*)\)\s*;/.exec(html);
  if (!match) return undefined;
  try {
    const url = JSON.parse(match[1]);
    return typeof url === "string" && isWebSearchCuratorUrl(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

export function wrapExecForCurator(exec, open = openCuratorInBuiltinBrowser) {
  return async (command, args = [], options) => {
    const url = curatorUrlFromOpenCommand(command, args);
    if (!url) return exec(command, args, options);
    await open(url);
    return { code: 0, stdout: "", stderr: "" };
  };
}

export async function openCuratorInBuiltinBrowser(url, env = process.env) {
  const port = env.PIPIUI_BRIDGE_PORT;
  if (!port) throw new Error("built-in browser bridge is unavailable");
  const requestID = crypto.randomUUID();
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      sessionCapability: env.PIPIUI_SESSION_CAPABILITY,
      action: "browser_action",
      event: { action: "navigate", requestID, url, scope: "viewport" },
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!payload?.ok) throw new Error(payload?.error || "built-in browser navigate failed");
  return payload;
}
