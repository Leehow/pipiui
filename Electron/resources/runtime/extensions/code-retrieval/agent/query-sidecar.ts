/**
 * Minimal loopback query sidecar (spec D2).
 *
 * Discovery file: {project}/.pi/agent/code-retrieval/sidecar.json
 * Real index work is filled in later; /search currently wraps rg.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { exactSearch } from "./grep-exact.js";
import { sidecarJsonPath } from "./paths.js";

type AttachBody = { sessionId?: string };
type SessionLease = { lastSeenAt: number; expiresAt: number };
type SearchBody = {
  query?: string;
  path?: string;
  glob?: string;
  topK?: number;
  excludeGlobs?: string[];
};

const projectRoot = process.env.PIPIUI_CODE_RETRIEVAL_PROJECT ?? process.cwd();
const idleMs = Math.max(50, Number(process.env.PIPIUI_CODE_RETRIEVAL_IDLE_MS ?? 60_000) || 60_000);
const sessionTtlMs = Math.max(
  50,
  Number(process.env.PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS ?? 300_000) || 300_000,
);
const token = process.env.PIPIUI_CODE_RETRIEVAL_TOKEN || randomBytes(24).toString("base64url");

const sessions = new Map<string, SessionLease>();
let lastUsed = Date.now();
let idleTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

function authorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  const alt = req.headers["x-pipiui-token"];
  const presented = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : typeof alt === "string" ? alt : "";
  if (presented.length !== token.length) return false;
  return Buffer.from(presented).equals(Buffer.from(token));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function touch(): void {
  lastUsed = Date.now();
  scheduleIdle();
}

function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  const slice = Math.max(40, Math.min(idleMs, 250));
  idleTimer = setTimeout(() => {
    void maybeIdleExit();
  }, slice);
}

function expireSessions(now = Date.now()): void {
  for (const [id, lease] of sessions) {
    if (lease.expiresAt <= now) sessions.delete(id);
  }
}

function renewLease(sessionId: string, now = Date.now()): SessionLease {
  const lease = { lastSeenAt: now, expiresAt: now + sessionTtlMs };
  sessions.set(sessionId, lease);
  return lease;
}

/** Renew an existing session only. Unknown / detached ids must not upsert. */
function touchLease(sessionId: string, now = Date.now()): SessionLease | undefined {
  expireSessions(now);
  if (!sessions.has(sessionId)) return undefined;
  return renewLease(sessionId, now);
}

function liveSessionPayload(now = Date.now()): Array<{ sessionId: string; lastSeenAt: number; expiresAt: number }> {
  expireSessions(now);
  return [...sessions.entries()].map(([sessionId, lease]) => ({
    sessionId,
    lastSeenAt: lease.lastSeenAt,
    expiresAt: lease.expiresAt,
  }));
}

async function maybeIdleExit(): Promise<void> {
  expireSessions();
  if (sessions.size > 0) {
    scheduleIdle();
    return;
  }
  if (Date.now() - lastUsed < idleMs) {
    scheduleIdle();
    return;
  }
  await shutdown("idle");
}

async function writeSnapshot(port: number): Promise<void> {
  const dest = sidecarJsonPath(projectRoot);
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
const body = JSON.stringify({ pid: process.pid, port, token, startedAt: Date.now(), provider: "rg" });
  await writeFile(tmp, body, "utf8");
  await rename(tmp, dest);
}

async function invalidateSnapshot(): Promise<void> {
  try {
    await unlink(sidecarJsonPath(projectRoot));
  } catch {
    // already gone
  }
}

async function shutdown(_reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (idleTimer) clearTimeout(idleTimer);
  await invalidateSnapshot();
  process.exit(0);
}

const server = createServer((req, res) => {
  void handle(req, res);
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!authorized(req)) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      touch();
      const live = liveSessionPayload();
      const oldestExpiresAt = live.reduce<number | null>(
        (min, row) => (min === null || row.expiresAt < min ? row.expiresAt : min),
        null,
      );
      json(res, 200, {
        ok: true,
        ready: true,
        pid: process.pid,
        port: listenPort(),
        refcount: live.length,
        lastUsed,
        sessionTtlMs,
        oldestExpiresAt,
        sessions: live,
        provider: "rg",
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/attach") {
      const body = parseJson<AttachBody>(await readBody(req));
      const sessionId = body.sessionId || `anon-${Date.now()}`;
      expireSessions();
      const lease = renewLease(sessionId);
      touch();
      json(res, 200, {
        ok: true,
        sessionId,
        refcount: sessions.size,
        pid: process.pid,
        port: listenPort(),
        lastSeenAt: lease.lastSeenAt,
        expiresAt: lease.expiresAt,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/heartbeat") {
      const body = parseJson<AttachBody>(await readBody(req));
      const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
      if (!sessionId) {
        json(res, 400, { ok: false, error: "sessionId required" });
        return;
      }
      const lease = touchLease(sessionId);
      if (!lease) {
        json(res, 404, { ok: false, error: "session not found" });
        return;
      }
      touch();
      json(res, 200, {
        ok: true,
        sessionId,
        refcount: sessions.size,
        pid: process.pid,
        port: listenPort(),
        lastSeenAt: lease.lastSeenAt,
        expiresAt: lease.expiresAt,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/detach") {
      const body = parseJson<AttachBody>(await readBody(req));
      expireSessions();
      if (body.sessionId) sessions.delete(body.sessionId);
      touch();
      json(res, 200, { ok: true, refcount: sessions.size, pid: process.pid });
      return;
    }
    if (req.method === "POST" && url.pathname === "/search") {
      const body = parseJson<SearchBody>(await readBody(req));
      const query = typeof body.query === "string" ? body.query : "";
      if (!query) {
        json(res, 400, { ok: false, error: "query required" });
        return;
      }
      touch();
      const hits = await exactSearch({
        query,
        projectRoot,
        path: typeof body.path === "string" ? body.path : undefined,
        glob: typeof body.glob === "string" ? body.glob : undefined,
        topK: typeof body.topK === "number" ? body.topK : undefined,
        excludeGlobs: Array.isArray(body.excludeGlobs) ? body.excludeGlobs.filter((g) => typeof g === "string") : undefined,
      });
      json(res, 200, { ok: true, hits, degraded: false });
      return;
    }
    json(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 500, { ok: false, error: message });
  }
}

function parseJson<T>(raw: string): T {
  if (!raw.trim()) return {} as T;
  return JSON.parse(raw) as T;
}

function listenPort(): number {
  const addr = server.address();
  if (!addr || typeof addr === "string") return 0;
  return addr.port;
}

process.on("SIGTERM", () => {
  void shutdown("sigterm");
});
process.on("SIGINT", () => {
  void shutdown("sigint");
});

server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
  const port = listenPort();
  void writeSnapshot(port).then(() => {
    process.stdout.write(JSON.stringify({ ok: true, pid: process.pid, port, token, provider: "rg" }) + "\n");
    scheduleIdle();
  });
});
