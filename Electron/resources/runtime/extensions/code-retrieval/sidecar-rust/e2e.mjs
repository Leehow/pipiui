#!/usr/bin/env node
/**
 * Phase 2 e2e: Tantivy hit (degraded=false), overlay immediacy, D8 degrade.
 * Exits explicitly with 0/1. Does not leave the sidecar running.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeCodeSearch } from "../agent/dist/code-search.js";
import { RefRegistry } from "../agent/dist/protocol.js";
import {
  attachSidecar,
  detachSidecar,
  pingSidecar,
  readSidecarSnapshot,
  sidecarSearch,
} from "../agent/dist/sidecar-lifecycle.js";

const here = dirname(fileURLToPath(import.meta.url));
const FASTAPI = "/private/tmp/pipiui-eval/fastapi";
const PROBE = `PIPIUI_TANTIVY_OVERLAY_PROBE_${Date.now()}`;
const READY_MS = 180_000;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function waitReady(conn, budgetMs) {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const live = await pingSidecar(conn, 1500);
    if (live && live.ready !== false) {
      // pingSidecar maps ready !== false; confirm provider via raw health.
      try {
        const res = await fetch(`http://127.0.0.1:${conn.port}/health`, {
          headers: { authorization: `Bearer ${conn.token}` },
        });
        const body = await res.json();
        if (body.ok === true && body.ready === true) return body;
      } catch {
        // retry
      }
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  return undefined;
}

function runCapture(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", () => undefined);
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, text: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

function median(ns) {
  const s = ns.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function timeRg(root, query, n) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await runCapture("rg", ["-n", "--color", "never", "-e", query, root], root);
    times.push(performance.now() - t0);
  }
  return times;
}

async function timeTantivy(conn, query, n) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const remote = await sidecarSearch(conn, { query, topK: 20 });
    times.push(performance.now() - t0);
    if (!remote || remote.degraded) fail("tantivy search degraded during bench");
  }
  return times;
}

async function makeLargeRepo() {
  const root = join(tmpdir(), `cr-large-${Date.now()}`);
  await mkdir(join(root, "src"), { recursive: true });
  const needle = "UNIQUE_TANTIVY_NEEDLE_TOKEN";
  const files = 4000;
  const writes = [];
  for (let i = 0; i < files; i++) {
    const dir = join(root, "src", `mod${i % 40}`);
    writes.push(
      mkdir(dir, { recursive: true }).then(() =>
        writeFile(
          join(dir, `f${i}.py`),
          `# file ${i}\n` +
            `def fn_${i}():\n    return ${i}\n` +
            (i === 7 ? `${needle} = ${i}\n` : "x = 1\n") +
            "payload = '" + "abcd ".repeat(40) + "'\n",
          "utf8",
        ),
      ),
    );
  }
  await Promise.all(writes);
  return { root, needle, files };
}

async function main() {
  const report = {
    binary: join(here, "../agent/sidecar/bin/darwin-arm64/tantivy-sidecar"),
    fastapi: FASTAPI,
  };
  if (!existsSync(report.binary)) fail(`missing binary ${report.binary}`);
  if (!existsSync(FASTAPI)) fail(`missing eval repo ${FASTAPI}`);

  process.env.PIPIUI_CODE_RETRIEVAL_IDLE_MS = "120000";

  // ---------- (a) index + tantivy hit ----------
  const indexStarted = Date.now();
  const conn = await attachSidecar({
    projectRoot: FASTAPI,
    sessionId: "e2e-a",
    idleMs: 120000,
  });
  if (!conn) fail("attachSidecar returned undefined");
  const health = await waitReady(conn, READY_MS);
  if (!health) fail("index did not become ready");
  report.indexBuildMs = Date.now() - indexStarted;
  report.provider = health.provider;
  report.baselineDocs = health.baselineDocs;
  report.overlayDocs = health.overlayDocs;
  report.head = health.head;
  if (health.provider !== "tantivy") fail(`expected provider=tantivy, got ${health.provider}`);

  const search = await sidecarSearch(conn, { query: "APIRouter", topK: 10 });
  if (!search) fail("/search failed after ready");
  if (search.degraded) fail("/search returned degraded=true after ready");
  if (!search.hits.length) fail("APIRouter produced zero tantivy hits");
  const first = search.hits[0];
  if (!first.path || !Number.isFinite(first.startLine)) fail("hit missing path/startLine");
  report.hit = {
    path: first.path,
    startLine: first.startLine,
    endLine: first.endLine,
    text: String(first.text || "").slice(0, 80),
    count: search.hits.length,
    degraded: search.degraded,
  };

  const tool = await executeCodeSearch({
    query: "APIRouter",
    mode: "exact",
    projectRoot: FASTAPI,
    registry: new RefRegistry(),
    excludeGlobs: [],
    sidecar: conn,
  });
  if (tool.details.degraded) fail("executeCodeSearch degraded after tantivy ready");
  if (!tool.details.hits.length) fail("executeCodeSearch empty after tantivy ready");
  report.toolDegraded = tool.details.degraded;
  report.toolHits = tool.details.hits.length;

  // ---------- perf vs rg ----------
  const rgTimes = await timeRg(FASTAPI, "APIRouter", 5);
  const tvTimes = await timeTantivy(conn, "APIRouter", 5);
  report.rgMs = { samples: rgTimes.map((n) => +n.toFixed(2)), median: +median(rgTimes).toFixed(2) };
  report.tantivyMs = { samples: tvTimes.map((n) => +n.toFixed(2)), median: +median(tvTimes).toFixed(2) };

  // Larger synthetic corpus if fastapi is too small for rg to lose.
  const large = await makeLargeRepo();
  let largeConn;
  try {
    const tBuild0 = Date.now();
    largeConn = await attachSidecar({
      projectRoot: large.root,
      sessionId: "e2e-large",
      idleMs: 120000,
    });
    if (!largeConn) fail("large-repo attach failed");
    const largeHealth = await waitReady(largeConn, READY_MS);
    if (!largeHealth) fail("large-repo index not ready");
    report.large = {
      files: large.files,
      indexBuildMs: Date.now() - tBuild0,
      baselineDocs: largeHealth.baselineDocs,
    };
    const largeRg = await timeRg(large.root, large.needle, 5);
    const largeTv = await timeTantivy(largeConn, large.needle, 5);
    report.large.rgMs = { samples: largeRg.map((n) => +n.toFixed(2)), median: +median(largeRg).toFixed(2) };
    report.large.tantivyMs = {
      samples: largeTv.map((n) => +n.toFixed(2)),
      median: +median(largeTv).toFixed(2),
    };
    report.large.faster = report.large.tantivyMs.median < report.large.rgMs.median;
  } finally {
    if (largeConn) {
      try {
        process.kill(largeConn.pid, "SIGTERM");
      } catch {
        // gone
      }
    }
    await rm(large.root, { recursive: true, force: true });
  }

  // ---------- (b) overlay immediacy ----------
  const probeRel = "PIPIUI_OVERLAY_PROBE.py";
  const probeAbs = join(FASTAPI, probeRel);
  await writeFile(probeAbs, `${PROBE} = True\n`, "utf8");
  const overlayDeadline = Date.now() + 4000;
  let overlay;
  let overlayWaitMs = 0;
  const overlayStarted = Date.now();
  while (Date.now() < overlayDeadline) {
    overlay = await sidecarSearch(conn, { query: PROBE, topK: 5 });
    overlayWaitMs = Date.now() - overlayStarted;
    if (overlay && !overlay.degraded && overlay.hits.some((h) => String(h.text || "").includes(PROBE))) {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  await rm(probeAbs, { force: true });
  if (!overlay || overlay.degraded || !overlay.hits.some((h) => String(h.text || "").includes(PROBE))) {
    fail(`overlay did not see ${PROBE} within 4s (last=${JSON.stringify(overlay)})`);
  }
  report.overlay = {
    visible: true,
    waitMs: overlayWaitMs,
    path: overlay.hits[0]?.path,
    degraded: overlay.degraded,
  };

  // ---------- (c) kill sidecar → grep fallback ----------
  const stale = { ...conn };
  process.kill(conn.pid, "SIGKILL");
  const deadBy = Date.now() + 2000;
  while (Date.now() < deadBy) {
    try {
      process.kill(conn.pid, 0);
      await new Promise((r) => setTimeout(r, 20));
    } catch {
      break;
    }
  }
  const degraded = await executeCodeSearch({
    query: "APIRouter",
    mode: "exact",
    projectRoot: FASTAPI,
    registry: new RefRegistry(),
    excludeGlobs: [],
    sidecar: stale,
  });
  if (!degraded.details.degraded) fail("expected details.degraded after killed sidecar");
  if (!degraded.details.hits.length) fail("degraded search returned empty (must not disguise miss)");
  report.degrade = {
    degraded: degraded.details.degraded,
    hits: degraded.details.hits.length,
    contentHasFallback: /degraded|fallback|grep/i.test(degraded.content[0]?.text ?? ""),
  };

  try {
    await detachSidecar(FASTAPI, "e2e-a");
  } catch {
    // process already dead
  }

  console.log(JSON.stringify(report, null, 2));
  const largeFaster = report.large?.faster === true;
  const fastapiFaster = report.tantivyMs.median < report.rgMs.median;
  if (!largeFaster && !fastapiFaster) {
    fail(
      `time-to-first-result did not drop (fastapi tv=${report.tantivyMs.median} rg=${report.rgMs.median}; large tv=${report.large?.tantivyMs.median} rg=${report.large?.rgMs.median})`,
    );
  }
  console.log("E2E_OK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
