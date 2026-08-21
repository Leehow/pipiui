/**
 * M4 — Session image storage.
 *
 * Official Grok Build writes `<session_folder>/images/<n>.jpg` via an
 * atomic SessionFileWriter. This package is mounted into arbitrary Pi
 * sessions, so the isolation root resolves from the agent home:
 *
 *   $PI_CODING_AGENT_DIR/attachments/images/   (PipiUI / pi-coc rpc)
 *   <cwd>/.pi/agent/attachments/images/        (terminal fallback)
 *
 * Invariants:
 * - Files are named `<n>.jpg` with a monotonically increasing counter
 *   resumed from the directory scan (official semantics).
 * - Atomic write: tmp file in same dir → write → fsync → chmod 0600 →
 *   rename over an O_EXCL placeholder (no overwrite races, no half writes).
 * - Directory is 0700.
 * - The resolved path is always contained in the isolation root — the
 *   filename is counter-generated, never user input (path traversal safe).
 */
import { chmodSync, mkdirSync } from "node:fs";
import { open, readdir, rename, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { sniffImageMime } from "./client.js";
export function resolveImagesRoot() {
    const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
    const agentDir = envDir || join(process.cwd(), ".pi", "agent");
    return join(agentDir, "attachments", "images");
}
export class SessionImageWriter {
    root;
    constructor(root) {
        this.root = resolve(root ?? resolveImagesRoot());
    }
    get rootDir() {
        return this.root;
    }
    /** Next 1-based counter, resumed from existing `<n>.jpg` files. */
    async nextIndex() {
        let entries = [];
        try {
            entries = await readdir(this.root);
        }
        catch {
            return 1;
        }
        let max = 0;
        for (const name of entries) {
            const m = /^(\d+)\.jpg$/.exec(name);
            if (m)
                max = Math.max(max, Number(m[1]));
        }
        return max + 1;
    }
    /**
     * Atomically save image bytes as the next numbered `<n>.jpg`.
     * Returns the absolute path and the sniffed mime type.
     */
    async save(bytes, opts = {}) {
        opts.signal?.throwIfAborted();
        if (!bytes || bytes.byteLength === 0) {
            throw new Error("refusing to write empty image");
        }
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        try {
            chmodSync(this.root, 0o700);
        }
        catch { }
        let n = await this.nextIndex();
        for (let attempt = 0; attempt < 100; attempt++) {
            opts.signal?.throwIfAborted();
            const finalName = `${n}.jpg`;
            const finalPath = join(this.root, finalName);
            // Containment guard (defense in depth; name is counter-generated).
            if (resolve(finalPath) !== join(this.root, finalName)) {
                throw new Error("image path escapes isolation root");
            }
            const tmp = join(this.root, `.${randomUUID()}.tmp`);
            let tmpWritten = false;
            try {
                const tmpFd = await open(tmp, "w", 0o600);
                try {
                    await tmpFd.writeFile(bytes);
                    await tmpFd.sync();
                    await tmpFd.chmod(0o600);
                }
                finally {
                    await tmpFd.close();
                }
                tmpWritten = true;
                // Reserve the final name exclusively, then rename over the placeholder.
                const placeholder = await open(finalPath, "wx", 0o600);
                await placeholder.close();
                await rename(tmp, finalPath);
                tmpWritten = false;
                try {
                    chmodSync(finalPath, 0o600);
                }
                catch { }
                return { path: finalPath, mime: sniffImageMime(bytes) };
            }
            catch (err) {
                if (tmpWritten) {
                    const { unlink } = await import("node:fs/promises");
                    await unlink(tmp).catch(() => { });
                }
                const code = err?.code;
                if (code === "EEXIST") {
                    n += 1; // someone else claimed this number; retry
                    continue;
                }
                throw err;
            }
        }
        throw new Error("failed to allocate an image file name");
    }
    /** For tests */
    async _exists(path) {
        try {
            await stat(path);
            return true;
        }
        catch {
            return false;
        }
    }
}
