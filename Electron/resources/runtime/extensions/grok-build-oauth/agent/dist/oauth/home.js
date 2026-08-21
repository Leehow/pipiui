/**
 * Pi agent home resolution (spec §D9) — single source for every module in
 * this package.
 *
 * Precedence: `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`.
 * When neither is set we fail closed: no silent fallback to the global
 * `~/.pi/agent` (project isolation hard rule). Hosts are responsible for
 * exporting one of these variables; terminal pi-coc exports
 * `PI_COC_AGENT_DIR` (repo-local `.pi/coc-agent`), PipiUI exports
 * `PI_CODING_AGENT_DIR` (project `.pi/agent`).
 */
import { join } from "node:path";
export class NoAgentHomeError extends Error {
    constructor() {
        super("未检测到 PI_COC_AGENT_DIR / PI_CODING_AGENT_DIR — 拒绝回退到全局 ~/.pi/agent（项目隔离）。请在宿主环境中设置其一后再试。");
        this.name = "NoAgentHomeError";
    }
}
/** Resolved home dir, or undefined when neither variable is set. */
export function tryResolveAgentHome() {
    const coc = process.env.PI_COC_AGENT_DIR?.trim();
    if (coc)
        return coc;
    const coding = process.env.PI_CODING_AGENT_DIR?.trim();
    if (coding)
        return coding;
    return undefined;
}
/** Resolved home dir; throws NoAgentHomeError (fail closed) when unset. */
export function resolveAgentHome() {
    const home = tryResolveAgentHome();
    if (!home)
        throw new NoAgentHomeError();
    return home;
}
/** `auth.json` path inside the resolved home. */
export function authJsonPath(home) {
    return join(home ?? resolveAgentHome(), "auth.json");
}
/** Attachments root inside the resolved home (image isolation root). */
export function attachmentsRoot(home) {
    return join(home ?? resolveAgentHome(), "attachments");
}
