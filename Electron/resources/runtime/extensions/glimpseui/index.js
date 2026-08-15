import { curatorUrlFromGlimpseHtml, openCuratorInBuiltinBrowser } from "../web-search-curator.mjs";

export function open(html) {
  const url = curatorUrlFromGlimpseHtml(typeof html === "string" ? html : "");
  if (!url) throw new Error("Search curator HTML did not contain a local session URL");
  if (!process.env.PIPIUI_BRIDGE_PORT) throw new Error("built-in browser bridge is unavailable");
  void openCuratorInBuiltinBrowser(url).catch((error) => {
    console.error(`[pipiui] failed to open search curator in the built-in browser: ${error instanceof Error ? error.message : String(error)}`);
  });
  return {
    on() {},
    close() {},
    _write() {},
  };
}
