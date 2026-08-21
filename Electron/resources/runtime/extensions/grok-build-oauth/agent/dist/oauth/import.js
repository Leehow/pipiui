import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
export async function importFromGlobalGrok(opts) {
    if (!opts.confirm) {
        return { imported: false, reason: "confirm required" };
    }
    const home = opts.homedirOverride ?? homedir();
    const authPath = join(home, ".grok", "auth.json");
    let text;
    try {
        text = await readFile(authPath, "utf8");
    }
    catch {
        return { imported: false, reason: "no global auth file" };
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { imported: false, reason: "invalid auth.json" };
    }
    // Expect shape { key, refresh_token, expires_at, oidc_issuer... } or similar
    // We only copy if we can map to OAuth fields; caller will persist via Provider auth.
    if (!parsed || typeof parsed !== "object")
        return { imported: false, reason: "invalid auth shape" };
    const rec = parsed;
    // Support both legacy flat auth and nested by scope. Try to find a record
    // with access token. For simplicity, look for .key or .access or first string containing token.
    const key = typeof rec.key === "string" ? rec.key : typeof rec.access === "string" ? rec.access : undefined;
    if (!key)
        return { imported: false, reason: "no token in global auth" };
    // Signal that caller may proceed to persist; we don't write here.
    return { imported: true };
}
export function globalGrokAuthPath(homedirOverride) {
    const home = homedirOverride ?? homedir();
    return join(home, ".grok", "auth.json");
}
