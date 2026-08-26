import { readFile } from "node:fs/promises";
import { HEADROOM_UPSTREAM_VERSION, normalizeLoopbackUrl } from "./config.js";
const STATES = new Set([
    "installing",
    "starting",
    "ready",
    "failed",
    "stopped",
]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Read the host-owned rendezvous file. It contains no user credentials; it is
 * only a project-local lifecycle/loopback endpoint receipt.
 */
export async function readManagedServiceState(path, expectedEngineVersion = HEADROOM_UPSTREAM_VERSION) {
    if (!path)
        return undefined;
    let source;
    try {
        source = await readFile(path, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        return {
            state: "failed",
            baseUrl: "http://127.0.0.1:8787",
            engineVersion: expectedEngineVersion,
            error: "managed service state is unreadable",
        };
    }
    if (Buffer.byteLength(source) > 64 * 1024) {
        return {
            state: "failed",
            baseUrl: "http://127.0.0.1:8787",
            engineVersion: expectedEngineVersion,
            error: "managed service state is oversized",
        };
    }
    try {
        const value = JSON.parse(source);
        if (!isRecord(value) || value.schemaVersion !== 1 || !STATES.has(value.state)) {
            throw new Error("invalid schema");
        }
        const baseUrl = normalizeLoopbackUrl(value.baseUrl);
        if (!baseUrl || value.engineVersion !== expectedEngineVersion)
            throw new Error("invalid runtime identity");
        return {
            state: value.state,
            baseUrl,
            engineVersion: value.engineVersion,
            ...(typeof value.error === "string" && value.error.trim() ? { error: value.error.trim().slice(-1_000) } : {}),
        };
    }
    catch {
        return {
            state: "failed",
            baseUrl: "http://127.0.0.1:8787",
            engineVersion: expectedEngineVersion,
            error: "managed service state is invalid",
        };
    }
}
