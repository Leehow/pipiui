import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionRuntime } from "./index.js";
import {
  attachSidecar,
  defaultHeartbeatMs,
  defaultIdleMs,
  defaultSessionTtlMs,
  detachSidecar,
  heartbeatSidecar,
  heartbeatSidecarOutcome,
  pidAlive,
  pingSidecar,
  readSidecarSnapshot,
  startSidecarHeartbeat,
} from "./sidecar-lifecycle.js";
import type { SidecarSnapshot } from "./types.js";

type Provider = "rust" | "node";

const SHARED_HEALTH_KEYS = [
  "ok",
  "ready",
  "pid",
  "port",
  "refcount",
  "lastUsed",
  "sessionTtlMs",
  "oldestExpiresAt",
  "sessions",
] as const;

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    prev.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of prev) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function applyProvider(provider: Provider): Record<string, string | undefined> {
  return provider === "node"
    ? { PIPIUI_CODE_RETRIEVAL_FORCE_RG: "1", PIPIUI_CODE_RETRIEVAL_SIDECAR: undefined }
    : { PIPIUI_CODE_RETRIEVAL_FORCE_RG: undefined };
}

async function waitDead(pid: number, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (pidAlive(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 40));
  }
  return !pidAlive(pid);
}

async function sidecarJson(
  snap: SidecarSnapshot,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${snap.port}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${snap.token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function asSessions(value: unknown): Array<Record<string, unknown>> {
  assert.ok(Array.isArray(value), "health.sessions must be an array");
  return value as Array<Record<string, unknown>>;
}

function assertHealthShape(body: Record<string, unknown>, expectedTtl: number, token?: string): void {
  for (const key of SHARED_HEALTH_KEYS) {
    assert.ok(key in body, `health missing ${key}`);
  }
  assert.equal(body.ok, true);
  assert.equal("token" in body, false, "authenticated health must not leak token");
  if (token) {
    assert.equal(JSON.stringify(body).includes(token), false, "health body must not contain the bearer token");
  }
  assert.equal(body.sessionTtlMs, expectedTtl);
  const sessions = asSessions(body.sessions);
  assert.equal(body.refcount, sessions.length);
  for (const row of sessions) {
    assert.equal(typeof row.sessionId, "string");
    assert.equal(typeof row.lastSeenAt, "number");
    assert.equal(typeof row.expiresAt, "number");
    assert.equal("token" in row, false);
  }
}

test("default idle and session ttl are conservative; heartbeat is a fraction of ttl", () => {
  delete process.env.PIPIUI_CODE_RETRIEVAL_IDLE_MS;
  delete process.env.PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS;
  delete process.env.PIPIUI_CODE_RETRIEVAL_HEARTBEAT_MS;
  assert.ok(defaultIdleMs() >= 1000);
  assert.ok(defaultSessionTtlMs() >= 60_000, "default lease must be minute-level");
  assert.ok(defaultHeartbeatMs() < defaultSessionTtlMs());
  assert.ok(defaultHeartbeatMs() >= Math.floor(defaultSessionTtlMs() / 3));
});

for (const provider of ["rust", "node"] as const) {
  test(`${provider}: two sessions reuse one sidecar; explicit detach then idle exit`, async () => {
    const root = await mkdtemp(join(tmpdir(), `cr-side-${provider}-`));
    const idleMs = 400;
    await withEnv(
      {
        ...applyProvider(provider),
        PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
        PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: "30000",
      },
      async () => {
        try {
          const a = await attachSidecar({ projectRoot: root, sessionId: "A", idleMs });
          assert.ok(a, "first session should spawn sidecar");
          assert.ok(pidAlive(a.pid));
          const snapA = await readSidecarSnapshot(root);
          assert.ok(snapA);
          assert.equal(snapA!.pid, a.pid);
          assert.equal(snapA!.port, a.port);
          assert.ok(snapA!.token);

          const b = await attachSidecar({ projectRoot: root, sessionId: "B", idleMs });
          assert.ok(b, "second session should reuse");
          assert.equal(b.pid, a.pid);
          assert.equal(b.port, a.port);

          const live = await pingSidecar(b);
          assert.ok(live);
          assert.ok((live.refcount ?? 0) >= 2);

          const health = await sidecarJson(a, "GET", "/health");
          assert.equal(health.status, 200);
          assertHealthShape(health.body, 30_000, a.token);
          const ids = asSessions(health.body.sessions)
            .map((row) => row.sessionId)
            .sort();
          assert.deepEqual(ids, ["A", "B"]);

          const afterA = await detachSidecar(root, "A");
          assert.ok(pidAlive(a.pid), "must not kill a process others still hold");
          assert.ok((afterA ?? 1) >= 1);
          const afterDetach = await sidecarJson(a, "GET", "/health");
          assert.equal(afterDetach.body.refcount, 1);
          assert.deepEqual(
            asSessions(afterDetach.body.sessions).map((row) => row.sessionId),
            ["B"],
          );

          await detachSidecar(root, "B");
          assert.equal(await waitDead(a.pid, idleMs + 2500), true, "idle timeout should self-exit after refcount 0");
          const leftover = await readSidecarSnapshot(root);
          if (leftover) {
            assert.equal(pidAlive(leftover.pid), false);
          }
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  });

  test(`${provider}: abandoned session expires without detach and sidecar exits`, async () => {
    const root = await mkdtemp(join(tmpdir(), `cr-expire-${provider}-`));
    const idleMs = 250;
    const ttlMs = 250;
    await withEnv(
      {
        ...applyProvider(provider),
        PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
        PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: String(ttlMs),
      },
      async () => {
        try {
          const a = await attachSidecar({ projectRoot: root, sessionId: "orphan", idleMs });
          assert.ok(a, "sidecar should spawn");
          const pid = a.pid;
          assert.equal(
            await waitDead(pid, ttlMs + idleMs + 2500),
            true,
            "stale lease must expire and idle-exit without detach",
          );
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  });

  test(`${provider}: heartbeat keeps the lease; stopping it allows recycle`, async () => {
    const root = await mkdtemp(join(tmpdir(), `cr-beat-${provider}-`));
    const idleMs = 250;
    const ttlMs = 400;
    await withEnv(
      {
        ...applyProvider(provider),
        PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
        PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: String(ttlMs),
        PIPIUI_CODE_RETRIEVAL_HEARTBEAT_MS: "80",
      },
      async () => {
        try {
          const a = await attachSidecar({ projectRoot: root, sessionId: "live", idleMs });
          assert.ok(a);
          const beat = startSidecarHeartbeat({
            projectRoot: root,
            sessionId: "live",
            intervalMs: 80,
          });
          await new Promise((r) => setTimeout(r, ttlMs * 2 + 200));
          assert.ok(pidAlive(a.pid), "continuous heartbeat must not expire the session");
          const mid = await sidecarJson(a, "GET", "/health");
          assertHealthShape(mid.body, ttlMs, a.token);
          assert.equal(mid.body.refcount, 1);
          beat.stop();
          assert.equal(
            await waitDead(a.pid, ttlMs + idleMs + 2500),
            true,
            "stopping heartbeat should let the lease expire",
          );
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  });

  test(`${provider}: heartbeat is idempotent; missing sessionId is 400`, async () => {
    const root = await mkdtemp(join(tmpdir(), `cr-hbapi-${provider}-`));
    const idleMs = 400;
    await withEnv(
      {
        ...applyProvider(provider),
        PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
        PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: "8000",
      },
      async () => {
        try {
          const a = await attachSidecar({ projectRoot: root, sessionId: "H", idleMs });
          assert.ok(a);
          const first = await sidecarJson(a, "POST", "/heartbeat", { sessionId: "H" });
          const second = await sidecarJson(a, "POST", "/heartbeat", { sessionId: "H" });
          assert.equal(first.status, 200);
          assert.equal(second.status, 200);
          assert.equal(first.body.ok, true);
          assert.equal(second.body.refcount, 1);
          assert.ok(Number(second.body.expiresAt) >= Number(first.body.expiresAt));
          const missing = await sidecarJson(a, "POST", "/heartbeat", {});
          assert.equal(missing.status, 400);
          assert.equal(missing.body.ok, false);
          const counted = await heartbeatSidecar(root, "H");
          assert.equal(counted, 1);
          const ghost = await sidecarJson(a, "POST", "/heartbeat", { sessionId: "nope" });
          assert.equal(ghost.status, 404);
          assert.equal(ghost.body.ok, false);
          assert.equal((await sidecarJson(a, "GET", "/health")).body.refcount, 1);
          const missingOutcome = await heartbeatSidecarOutcome(root, "nope");
          assert.equal(missingOutcome.kind, "missing");
          await detachSidecar(root, "H");
          assert.equal(await waitDead(a.pid, idleMs + 2500), true);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  });
}

test("rust and node health share lease fields and never leak the token", async () => {
  const rustRoot = await mkdtemp(join(tmpdir(), "cr-parity-rust-"));
  const nodeRoot = await mkdtemp(join(tmpdir(), "cr-parity-node-"));
  const idleMs = 8000;
  const ttlMs = 30000;
  try {
    const rust = await withEnv(
      { ...applyProvider("rust"), PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs), PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: String(ttlMs) },
      () => attachSidecar({ projectRoot: rustRoot, sessionId: "P", idleMs }),
    );
    const node = await withEnv(
      { ...applyProvider("node"), PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs), PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: String(ttlMs) },
      () => attachSidecar({ projectRoot: nodeRoot, sessionId: "P", idleMs }),
    );
    assert.ok(rust);
    assert.ok(node);
    assert.notEqual(rust.pid, node.pid);
    const rustHealth = await sidecarJson(rust, "GET", "/health");
    const nodeHealth = await sidecarJson(node, "GET", "/health");
    assertHealthShape(rustHealth.body, ttlMs, rust.token);
    assertHealthShape(nodeHealth.body, ttlMs, node.token);
    for (const key of SHARED_HEALTH_KEYS) {
      assert.equal(typeof rustHealth.body[key], typeof nodeHealth.body[key], `typeof ${key}`);
    }
    const unauth = await fetch(`http://127.0.0.1:${rust.port}/health`);
    assert.equal(unauth.status, 401);
    const unauthBody = (await unauth.json()) as Record<string, unknown>;
    assert.equal("token" in unauthBody, false);
    assert.equal("sessions" in unauthBody, false);
    await detachSidecar(rustRoot, "P");
    await detachSidecar(nodeRoot, "P");
  } finally {
    await rm(rustRoot, { recursive: true, force: true });
    await rm(nodeRoot, { recursive: true, force: true });
  }
});

for (const provider of ["rust", "node"] as const) {
  test(`${provider}: heartbeat of unknown/detached session is 404 and does not resurrect`, async () => {
    const root = await mkdtemp(join(tmpdir(), `cr-hb404-${provider}-`));
    const idleMs = 400;
    await withEnv(
      {
        ...applyProvider(provider),
        PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
        PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: "8000",
      },
      async () => {
        try {
          const a = await attachSidecar({ projectRoot: root, sessionId: "H", idleMs });
          assert.ok(a);
          const inflight = sidecarJson(a, "POST", "/heartbeat", { sessionId: "H" });
          await detachSidecar(root, "H");
          const raced = await inflight;
          const health = await sidecarJson(a, "GET", "/health");
          assert.equal(health.body.refcount, 0, "in-flight heartbeat must not resurrect after detach");
          assert.deepEqual(asSessions(health.body.sessions), []);
          if (raced.status === 200) {
            assert.equal(raced.body.ok, true);
          } else {
            assert.equal(raced.status, 404);
            assert.equal(raced.body.ok, false);
          }
          const late = await sidecarJson(a, "POST", "/heartbeat", { sessionId: "H" });
          assert.equal(late.status, 404);
          assert.equal(late.body.ok, false);
          assert.equal((await sidecarJson(a, "GET", "/health")).body.refcount, 0);
          const rustLike = {
            ok: late.body.ok,
            error: late.body.error,
          };
          assert.deepEqual(rustLike, { ok: false, error: "session not found" });
          await detachSidecar(root, "H");
          assert.equal(await waitDead(a.pid, idleMs + 2500), true);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  });
}

test("SessionRuntime starts unref heartbeat and shutdown detaches first", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-runtime-"));
  const idleMs = 400;
  const ttlMs = 500;
  await withEnv(
    {
      ...applyProvider("node"),
      PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
      PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: String(ttlMs),
      PIPIUI_CODE_RETRIEVAL_HEARTBEAT_MS: "80",
    },
    async () => {
      const runtime = new SessionRuntime();
      try {
        await runtime.ensure(root);
        assert.ok(runtime.sidecar);
        const pid = runtime.sidecar!.pid;
        await new Promise((r) => setTimeout(r, ttlMs + 150));
        assert.ok(pidAlive(pid), "runtime heartbeat should keep the lease alive");
        const health = await sidecarJson(runtime.sidecar!, "GET", "/health");
        assertHealthShape(health.body, ttlMs, runtime.sidecar!.token);
        assert.equal(
          asSessions(health.body.sessions).some((row) => row.sessionId === runtime.sessionId),
          true,
        );
        await runtime.shutdown();
        assert.equal(await waitDead(pid, idleMs + 2500), true);
      } finally {
        await runtime.shutdown();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

test("SessionRuntime ensure/shutdown race does not start a zombie heartbeat", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-runtime-race-"));
  const idleMs = 400;
  await withEnv(
    {
      ...applyProvider("node"),
      PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
      PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: "8000",
      PIPIUI_CODE_RETRIEVAL_HEARTBEAT_MS: "50",
    },
    async () => {
      const runtime = new SessionRuntime();
      let releaseAttach!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseAttach = resolve;
      });
      runtime.attachSidecarFn = async (opts) => {
        await gate;
        return attachSidecar(opts);
      };
      try {
        const ensuring = runtime.ensure(root);
        await runtime.shutdown();
        releaseAttach();
        await ensuring;
        assert.equal(runtime.started, false);
        assert.equal(runtime.heartbeatRunning, false);
        assert.equal(runtime.sidecar, undefined);
        const snap = await readSidecarSnapshot(root);
        if (snap && pidAlive(snap.pid)) {
          const health = await sidecarJson(snap, "GET", "/health");
          assert.equal(health.body.refcount, 0);
          const late = await sidecarJson(snap, "POST", "/heartbeat", {
            sessionId: runtime.sessionId,
          });
          assert.equal(late.status, 404);
          assert.equal(await waitDead(snap.pid, idleMs + 2500), true);
        }
      } finally {
        await runtime.shutdown();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

test("SessionRuntime root-switch detach pending then shutdown does not attach B", async () => {
  const first = await mkdtemp(join(tmpdir(), "cr-runtime-switch-a-"));
  const second = await mkdtemp(join(tmpdir(), "cr-runtime-switch-b-"));
  const idleMs = 8000;
  await withEnv(
    {
      ...applyProvider("node"),
      PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
      PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: "30000",
      PIPIUI_CODE_RETRIEVAL_HEARTBEAT_MS: "50",
    },
    async () => {
      const runtime = new SessionRuntime();
      let releaseDetach!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseDetach = resolve;
      });
      let attachedB = false;
      runtime.detachSidecarFn = async (root, sessionId) => {
        await gate;
        return detachSidecar(root, sessionId);
      };
      runtime.attachSidecarFn = async (opts) => {
        if (opts.projectRoot === second) attachedB = true;
        return attachSidecar(opts);
      };
      try {
        await runtime.ensure(first);
        assert.ok(runtime.sidecar);
        assert.equal(runtime.started, true);
        const switching = runtime.ensure(second);
        await runtime.shutdown();
        releaseDetach();
        await switching;
        assert.equal(runtime.started, false);
        assert.equal(runtime.heartbeatRunning, false);
        assert.equal(runtime.sidecar, undefined);
        assert.equal(attachedB, false, "shutdown must prevent attach of root B");
        const snapB = await readSidecarSnapshot(second);
        if (snapB && pidAlive(snapB.pid)) {
          const health = await sidecarJson(snapB, "GET", "/health");
          assert.equal(health.body.refcount, 0);
          assert.equal(
            asSessions(health.body.sessions).some((row) => row.sessionId === runtime.sessionId),
            false,
          );
        }
      } finally {
        await runtime.shutdown();
        await rm(first, { recursive: true, force: true });
        await rm(second, { recursive: true, force: true });
      }
    },
  );
});

test("SessionRuntime missing heartbeat allows same-root reattach", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-runtime-missing-"));
  const idleMs = 8000;
  await withEnv(
    {
      ...applyProvider("node"),
      PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
      PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: "30000",
      PIPIUI_CODE_RETRIEVAL_HEARTBEAT_MS: "40",
    },
    async () => {
      const runtime = new SessionRuntime();
      try {
        await runtime.ensure(root);
        assert.ok(runtime.sidecar);
        const firstPid = runtime.sidecar.pid;
        await detachSidecar(root, runtime.sessionId);
        const deadline = Date.now() + 1500;
        while (runtime.started && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 20));
        }
        assert.equal(runtime.started, false, "missing must clear started so ensure can reattach");
        assert.equal(runtime.heartbeatRunning, false);
        await runtime.ensure(root);
        assert.equal(runtime.started, true);
        assert.ok(runtime.sidecar);
        assert.equal(runtime.heartbeatRunning, true);
        const health = await sidecarJson(runtime.sidecar, "GET", "/health");
        assert.equal(health.body.refcount, 1);
        assert.equal(
          asSessions(health.body.sessions).some((row) => row.sessionId === runtime.sessionId),
          true,
        );
        assert.equal(runtime.sidecar.pid, firstPid, "same sidecar process, new lease");
        await runtime.shutdown();
      } finally {
        await runtime.shutdown();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

test("SessionRuntime treat attach failure as not started (no health-only lease)", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-runtime-noattach-"));
  await withEnv(
    {
      ...applyProvider("node"),
      PIPIUI_CODE_RETRIEVAL_IDLE_MS: "8000",
      PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: "30000",
    },
    async () => {
      const runtime = new SessionRuntime();
      runtime.attachSidecarFn = async () => undefined;
      try {
        await runtime.ensure(root);
        assert.equal(runtime.started, false);
        assert.equal(runtime.sidecar, undefined);
        assert.equal(runtime.heartbeatRunning, false);
      } finally {
        await runtime.shutdown();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

test("SessionRuntime root switch detaches the old lease", async () => {
  const first = await mkdtemp(join(tmpdir(), "cr-runtime-root-a-"));
  const second = await mkdtemp(join(tmpdir(), "cr-runtime-root-b-"));
  const idleMs = 8000;
  await withEnv(
    {
      ...applyProvider("node"),
      PIPIUI_CODE_RETRIEVAL_IDLE_MS: String(idleMs),
      PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS: "30000",
    },
    async () => {
      const runtime = new SessionRuntime();
      try {
        await runtime.ensure(first);
        assert.ok(runtime.sidecar);
        const firstHealth = await sidecarJson(runtime.sidecar, "GET", "/health");
        assert.equal(firstHealth.body.refcount, 1);
        await runtime.ensure(second);
        assert.ok(runtime.sidecar);
        const oldSnap = await readSidecarSnapshot(first);
        if (oldSnap && pidAlive(oldSnap.pid)) {
          const oldHealth = await sidecarJson(oldSnap, "GET", "/health");
          assert.equal(oldHealth.body.refcount, 0);
        }
        const newHealth = await sidecarJson(runtime.sidecar, "GET", "/health");
        assert.equal(newHealth.body.refcount, 1);
        await runtime.shutdown();
      } finally {
        await runtime.shutdown();
        await rm(first, { recursive: true, force: true });
        await rm(second, { recursive: true, force: true });
      }
    },
  );
});
