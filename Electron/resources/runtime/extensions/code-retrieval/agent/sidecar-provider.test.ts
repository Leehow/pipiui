import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionRuntime } from "./index.js";
import {
  attachSidecar,
  detachSidecar,
} from "./sidecar-lifecycle.js";
import type { ExactProvider } from "./settings.js";
import type { SidecarSnapshot } from "./types.js";

type SeenRequest = { method: string; path: string };

/**
 * A controllable stand-in sidecar process: live pid, HTTP health/attach/search.
 * provider === undefined emulates a legacy pre-provider snapshot.
 */
async function startFakeSidecar(provider: string | undefined): Promise<{
  port: number;
  token: string;
  requests: SeenRequest[];
  stop: () => Promise<void>;
}> {
  const requests: SeenRequest[] = [];
  const token = "fake-sidecar-token";
  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? "?", path: req.url ?? "" });
    if (req.method === "GET" && req.url?.startsWith("/health")) {
      res.end(
        JSON.stringify({
          ok: true,
          ready: true,
          pid: process.pid,
          refcount: 0,
          lastUsed: Date.now(),
          sessionTtlMs: 30000,
          oldestExpiresAt: Date.now() + 30000,
          sessions: [],
          ...(provider !== undefined ? { provider } : {}),
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/attach")) {
      res.end(JSON.stringify({ ok: true, refcount: 1 }));
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/search")) {
      res.end(JSON.stringify({ ok: true, degraded: false, hits: [] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return {
    port: addr.port,
    token,
    requests,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function writeSnapshot(
  root: string,
  snap: Pick<SidecarSnapshot, "pid" | "port" | "token"> & Partial<Pick<SidecarSnapshot, "provider">>,
): Promise<void> {
  const dir = join(root, ".pi", "agent", "code-retrieval");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sidecar.json"), JSON.stringify(snap), "utf8");
}

function readSnapshot(root: string): Promise<SidecarSnapshot> {
  return readFile(join(root, ".pi", "agent", "code-retrieval", "sidecar.json"), "utf8").then(
    (raw) => JSON.parse(raw) as SidecarSnapshot,
  );
}

async function withRoot<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "cr-attach-"));
  try {
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("requested rg does not attach to nor disturb a running tantivy sidecar owned by another session", async () => {
  await withRoot(async (root) => {
    const fake = await startFakeSidecar("tantivy");
    try {
      await writeSnapshot(root, { pid: process.pid, port: fake.port, token: fake.token, provider: "tantivy" });
      const before = fake.requests.length;
      const conn = await attachSidecar({
        projectRoot: root,
        sessionId: "rg-session",
        spawn: false,
        provider: "rg",
      });
      assert.equal(conn, undefined, "rg selection must refuse a foreign-provider sidecar");
      // The only contact is the health probe; no lease, no detach, no search.
      assert.deepEqual(
        fake.requests.slice(before).map((r) => r.path.split("?")[0]),
        ["/health"],
      );
      // The refusal also never spawns a competing writer over the shared slot.
      const snap = await readSnapshot(root);
      assert.equal(snap.port, fake.port, "shared snapshot still points at the original owner");
      assert.equal(snap.provider, "tantivy");
    } finally {
      await fake.stop();
    }
  });
});

test("requested rg reuses an rg sidecar that is genuinely rg", async () => {
  await withRoot(async (root) => {
    const fake = await startFakeSidecar("rg");
    try {
      await writeSnapshot(root, { pid: process.pid, port: fake.port, token: fake.token, provider: "rg" });
      const conn = await attachSidecar({
        projectRoot: root,
        sessionId: "rg-session",
        spawn: false,
        provider: "rg",
      });
      assert.ok(conn);
      assert.equal(conn!.provider, "rg");
      assert.equal(conn!.requestedProvider, "rg");
      assert.equal(conn!.providerFallback, undefined);
      assert.ok(fake.requests.some((r) => r.path.startsWith("/attach")));
      await detachSidecar(root, "rg-session").catch(() => undefined);
    } finally {
      await fake.stop();
    }
  });
});

for (const requested of ["auto", "rg", "tantivy"] as const) {
  test(`legacy provider-less sidecar is unknown under ${requested}, never silently trusted`, async () => {
    await withRoot(async (root) => {
      const fake = await startFakeSidecar(undefined);
      try {
        await writeSnapshot(root, { pid: process.pid, port: fake.port, token: fake.token });
        const conn = await attachSidecar({
          projectRoot: root,
          sessionId: `legacy-${requested}`,
          spawn: false,
          provider: requested as ExactProvider,
        });
        if (requested === "rg") {
          // Unknown identity must NOT be trusted to be rg: stay local instead.
          assert.equal(conn, undefined);
          assert.deepEqual(fake.requests.filter((r) => r.path.startsWith("/attach")), []);
        } else {
          assert.ok(conn);
          assert.equal(conn!.provider, undefined);
          assert.equal(conn!.requestedProvider, requested);
          assert.ok(conn!.providerFallback, "the legacy identity gap must be surfaced");
          assert.equal(conn!.providerFallback!.actual, undefined);
          assert.match(conn!.providerFallback!.reason, /unknown/i);
          if (requested === "tantivy") {
            assert.match(conn!.providerFallback!.reason, /tantivy/i);
          }
        }
        await detachSidecar(root, `legacy-${requested}`).catch(() => undefined);
      } finally {
        await fake.stop();
      }
    });
  });
}

test("SessionRuntime status reports an attached unknown-identity sidecar as degraded without leaking the token", async () => {
  await withRoot(async (root) => {
    const fake = await startFakeSidecar(undefined);
    try {
      await writeSnapshot(root, { pid: process.pid, port: fake.port, token: fake.token });
      const runtime = new SessionRuntime();
      runtime.projectRoot = root;
      runtime.requestedProvider = "tantivy";
      runtime.started = true;
      // What ensure() produces after attaching a legacy sidecar for tantivy.
      runtime.sidecar = {
        pid: process.pid,
        port: fake.port,
        token: fake.token,
        requestedProvider: "tantivy",
        providerFallback: {
          requested: "tantivy",
          reason:
            "Running sidecar predates provider reporting; identity unknown and not trusted as tantivy (degraded).",
        },
      };
      const status = await runtime.sidecarStatus();
      assert.equal(status.provider, undefined, "unknown identity stays unknown");
      assert.equal(status.providerDegraded, true);
      assert.match(String(status.reason), /unknown/i);
      assert.equal(JSON.stringify(status).includes(fake.token), false);
      await runtime.shutdown();
    } finally {
      await fake.stop();
    }
  });
});

test("ensure with rg selection over a running tantivy sidecar stays local, usable, and says why", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-runtime-rg-"));
  const settingsDir = join(root, ".pi", "agent", "ext-settings");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(
    join(settingsDir, "code-retrieval.json"),
    JSON.stringify({
      settingsVersion: 1,
      settings: { "ext.code-retrieval.exactProvider": "rg" },
    }),
    "utf8",
  );
  const fake = await startFakeSidecar("tantivy");
  try {
    await writeSnapshot(root, { pid: process.pid, port: fake.port, token: fake.token, provider: "tantivy" });
    const runtime = new SessionRuntime();
    try {
      await runtime.ensure(root);
      assert.equal(runtime.requestedProvider, "rg");
      assert.equal(runtime.sidecar, undefined, "foreign-provider sidecar is refused");
      assert.equal(runtime.heartbeatRunning, false);
      const status = await runtime.sidecarStatus();
      // A foreign live sidecar is reachable (ready describes the slot), but the
      // rg selection could not be honored by attachment -> providerDegraded + note.
      assert.equal(status.ready, true);
      assert.equal(status.providerDegraded, true);
      assert.equal(status.provider, "tantivy", "status names who actually owns the slot");
      assert.match(String(status.reason), /does not borrow|stays on local rg/);
      assert.match(String(status.reason), /sidecar reachable/);

      // Search remains usable through the provider-correct local rg path.
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "auth.ts"), "export function signToken() { return 1; }\n", "utf8");
      const { executeCodeSearch } = await import("./code-search.js");
      const { RefRegistry } = await import("./protocol.js");
      const result = await executeCodeSearch({
        query: "signToken",
        mode: "exact",
        projectRoot: root,
        registry: new RefRegistry(),
        excludeGlobs: [],
        sidecar: runtime.sidecar,
      });
      assert.ok(result.details.hits.length > 0, "local path keeps the rg selection usable");
      assert.equal(result.details.provider, "rg");
    } finally {
      await runtime.shutdown();
    }
  } finally {
    await fake.stop();
    await rm(root, { recursive: true, force: true });
  }
});
