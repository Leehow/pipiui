import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeCodeSearch } from "./code-search.js";
import type { SidecarConnection } from "./types.js";
import { RefRegistry } from "./protocol.js";

async function withFixture<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "cr-prov-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "auth.ts"), "export function signToken() { return 1; }\n", "utf8");
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Fake sidecar HTTP surface: answers /search like a tantivy index would. */
async function startFakeTantivy(
  opts?: { hits?: unknown[]; degraded?: boolean },
): Promise<{ server: Server; port: number; searches: number[] }> {
  const searches: number[] = [];
  const hits =
    opts?.hits ?? [{ path: "src/auth.ts", startLine: 1, endLine: 3, symbol: "signToken", score: 2 }];
  const degraded = opts?.degraded === true;
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url?.startsWith("/search")) {
      searches.push(Date.now());
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            degraded,
            hits,
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return { server, port: addr.port, searches };
}

function connOn(port: number, provider: string): SidecarConnection {
  // pid: live but irrelevant here; only the /search endpoint is consulted.
  return { pid: process.pid, port, token: "test-token", provider };
}

const SEARCH_ARGS = (root: string) => ({
  query: "signToken",
  mode: "exact" as const,
  projectRoot: root,
  registry: new RefRegistry(),
  excludeGlobs: [] as string[],
});

test("tantivy sidecar answering normally is reported as the serving provider", async () => {
  await withFixture(async (root) => {
    const { server, port } = await startFakeTantivy();
    try {
      const result = await executeCodeSearch({
        ...SEARCH_ARGS(root),
        sidecar: connOn(port, "tantivy"),
        providerInfo: { requested: "auto", actual: "tantivy" },
      });
      assert.equal(result.details.degraded, false);
      assert.equal(result.details.provider, "tantivy");
      assert.doesNotMatch(result.content[0]!.text, /not available/);
      assert.match(result.content[0]!.text, /R1 src\/auth\.ts:1-3 signToken\(\)/);
    } finally {
      server.close();
    }
  });
});

test("after the tantivy layer fails and local grep serves hits, details.provider names rg — not the stale sidecar", async () => {
  await withFixture(async (root) => {
    // Advertised tantivy, but nothing listens on this port.
    const deadSidecar = connOn(9, "tantivy");
    const result = await executeCodeSearch({
      ...SEARCH_ARGS(root),
      sidecar: deadSidecar,
      providerInfo: { requested: "tantivy", actual: "tantivy" },
    });
    assert.ok(result.details.hits.length > 0, "local path keeps results flowing");
    assert.equal(result.details.degraded, true);
    // The regression this pins: even with an advertised tantivy connection the
    // reported provider must be the one that actually served the hits.
    assert.equal(result.details.provider, "rg");
    assert.match(
      result.content[0]!.text,
      /Requested exact provider tantivy[\s\S]*served by rg/,
      "the denial note must name rg",
    );
    assert.match(result.content[0]!.text, /details\.provider=rg/);
    assert.doesNotMatch(result.content[0]!.text, /served by tantivy/);
  });
});

test("provider truth flips with the serving layer inside one session's settings lifetime", async () => {
  await withFixture(async (root) => {
    const { server, port, searches } = await startFakeTantivy();
    try {
      const conn = connOn(port, "tantivy");
      const served = await executeCodeSearch({
        ...SEARCH_ARGS(root),
        sidecar: conn,
        providerInfo: { requested: "tantivy", actual: "tantivy" },
      });
      assert.equal(served.details.provider, "tantivy");

      server.closeAllConnections();
      server.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      searches.length = 0;
      const afterFallback = await executeCodeSearch({
        ...SEARCH_ARGS(root),
        sidecar: conn,
        providerInfo: { requested: "tantivy", actual: "tantivy" },
      });
      assert.ok(afterFallback.details.hits.length > 0);
      assert.equal(afterFallback.details.provider, "rg");
      assert.equal(afterFallback.details.degraded, true);
      assert.match(afterFallback.content[0]!.text, /served by rg/);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});

test("provider-less legacy sidecar stays identity-unknown and degraded under an explicit tantivy request", async () => {
  await withFixture(async (root) => {
    const { server, port } = await startFakeTantivy();
    try {
      // Exactly what attachSidecar annotates for a legacy sidecar (types.ts):
      // no provider field, but a truthful providerFallback reason.
      const legacyConn: SidecarConnection = {
        pid: process.pid,
        port,
        token: "test-token",
        requestedProvider: "tantivy",
        providerFallback: {
          requested: "tantivy",
          reason:
            "Running sidecar predates provider reporting; identity unknown and not trusted as tantivy (degraded).",
        },
      };
      const result = await executeCodeSearch({
        ...SEARCH_ARGS(root),
        sidecar: legacyConn,
        providerInfo: { requested: "tantivy" },
      });
      assert.ok(result.details.hits.length > 0, "the legacy sidecar still serves results");
      assert.equal(result.details.degraded, true);
      // The regression this pins: details.provider must NOT be inferred from
      // the requested mode — an unknown identity reports no provider at all.
      assert.ok(!("provider" in result.details), "unknown identity must not be reported as any provider");
      assert.match(result.content[0]!.text, /identity unknown and not trusted as tantivy/);
      assert.doesNotMatch(result.content[0]!.text, /served by tantivy/);
    } finally {
      server.close();
    }
  });
});

test("provider-less legacy sidecar is degraded with no provider claim even under auto", async () => {
  await withFixture(async (root) => {
    const { server, port } = await startFakeTantivy();
    try {
      const result = await executeCodeSearch({
        ...SEARCH_ARGS(root),
        // No provider field and no providerInfo: the auto path on a legacy conn.
        sidecar: { pid: process.pid, port, token: "test-token" },
      });
      assert.ok(result.details.hits.length > 0);
      assert.equal(result.details.degraded, true);
      assert.ok(!("provider" in result.details));
      assert.match(result.content[0]!.text, /identity unknown/i);
    } finally {
      server.close();
    }
  });
});

test("tantivy request served by a live rg sidecar reports provider rg AND degraded=true with a truthful note", async () => {
  await withFixture(async (root) => {
    // A working rg sidecar spawned because Tantivy could not start: healthy
    // /search answers, identity rg, spawn-time fallback annotated on the conn.
    const { server, port } = await startFakeTantivy();
    try {
      const rgConn: SidecarConnection = {
        ...connOn(port, "rg"),
        requestedProvider: "tantivy",
        providerFallback: {
          requested: "tantivy",
          actual: "rg",
          reason:
            "Tantivy was selected but is unavailable or failed to start; exact search is served by rg (details.provider).",
        },
      };
      const result = await executeCodeSearch({
        ...SEARCH_ARGS(root),
        sidecar: rgConn,
        providerInfo: { requested: "tantivy", actual: "rg" },
      });
      assert.ok(result.details.hits.length > 0);
      assert.equal(result.details.provider, "rg");
      assert.equal(result.details.degraded, true, "falling off the requested selection is degraded");
      assert.match(result.content[0]!.text, /Requested exact provider tantivy[\s\S]*served by rg/);
      assert.match(result.content[0]!.text, /exact search is served by rg \(details\.provider\)/);
      assert.doesNotMatch(result.content[0]!.text, /served by tantivy/);
    } finally {
      server.close();
    }
  });
});

test("zero hits from a serving sidecar claim no provider and do not degrade", async () => {
  await withFixture(async (root) => {
    const { server, port } = await startFakeTantivy({ hits: [] });
    try {
      const result = await executeCodeSearch({
        query: "signToken",
        mode: "exact",
        projectRoot: root,
        registry: new RefRegistry(),
        excludeGlobs: [],
        sidecar: connOn(port, "tantivy"),
        providerInfo: { requested: "tantivy", actual: "tantivy" },
      });
      assert.equal(result.details.hits.length, 0);
      // Zero-hit provider semantics: no indexed hits were SERVED, so there is
      // no serving-provider claim to make; a working requested layer does not
      // turn an honest miss into a degradation either.
      assert.ok(!("provider" in result.details));
      assert.equal(result.details.degraded, false);
      assert.match(result.content[0]!.text, /No hits for/);
    } finally {
      server.close();
    }
  });
});

test("zero hits after dead-sidecar → local-rg stay degraded with the truthful fallback note", async () => {
  await withFixture(async (root) => {
    // Advertised tantivy, nothing listening: the scan that produces the empty
    // answer actually runs on the local rg path.
    const result = await executeCodeSearch({
      query: "zzqqNoSuchTokenAnywhere",
      mode: "exact",
      projectRoot: root,
      registry: new RefRegistry(),
      excludeGlobs: [],
      sidecar: connOn(9, "tantivy"),
      providerInfo: { requested: "tantivy", actual: "tantivy" },
    });
    assert.equal(result.details.hits.length, 0);
    assert.equal(result.details.degraded, true);
    assert.ok(!("provider" in result.details), "nothing was served, so no serving-provider claim");
    assert.match(
      result.content[0]!.text,
      /used local rg fallback[\s\S]*details\.provider=rg|details\.provider=rg[\s\S]*details\.degraded=true/,
      "the note must truthfully name the layer that ran the empty scan",
    );
  });
});
