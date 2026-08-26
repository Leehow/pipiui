import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export const SDK_FORCED_OPEN_OPTIONS = { autoInstall: false };
export const OFFICECLI_SKIP_UPDATE_ENV = "OFFICECLI_SKIP_UPDATE";
/** Stable process-level invariant: OfficeCLI must not self-update or download. */
export function ensureOfficeCliUpdateDisabled(env = process.env) {
    if (env[OFFICECLI_SKIP_UPDATE_ENV] !== "1")
        env[OFFICECLI_SKIP_UPDATE_ENV] = "1";
    return env;
}
export function loadOfficeCliSdk() {
    ensureOfficeCliUpdateDisabled();
    const require = createRequire(import.meta.url);
    try {
        return require("@officecli/sdk");
    }
    catch {
        const bundled = join(dirname(fileURLToPath(import.meta.url)), "officecli-sdk.cjs");
        if (!existsSync(bundled))
            throw new Error("@officecli/sdk is not available");
        return require(bundled);
    }
}
export function sdkOptions(binary, timeoutMs) {
    return { binary, timeoutMs, autoInstall: false };
}
