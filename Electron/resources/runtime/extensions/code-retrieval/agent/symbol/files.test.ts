import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { test } from "node:test";

import { collectSourceEntries, DEFAULT_SKIP_DIRS } from "./files.js";
import { computeRepoMap } from "./repomap.js";

const REQUIRED_SKIP = [
  "out",
  "dist",
  "build",
  "release",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "target",
  "node_modules",
  ".git",
  ".pi",
] as const;

const SRC_APP = `export function keepSource() {
  return helper();
}
export function helper() {
  return 1;
}
`;

const SRC_TIMEOUT = `export function timeoutMs(ms: number) {
  return ms;
}
`;

const SRC_DISTUTILS = `export class DistUtils {
  normalize() {
    return "ok";
  }
}
`;

const BUNDLE = `export function bundledGiant() {
  return 42;
}
export class BundledApp {
  start() {
    return bundledGiant();
  }
}
`;

const BUNDLE_MIN_BYTES = 128 * 1024;

const BUNDLER_WRAPPER = `"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`;

const HASHED_CHUNK = `function loadSessionManager() {
  return require("./index-CAG480R2.js");
}
`;

const BUNDLER_HELPERS = `const import_fs = __toESM(require("node:fs"));
var __defProp = Object.defineProperty;
`;

const SRC_INDEX_JS = `export function greet(name) {
  return "hi " + name;
}
`;

function padToBytes(body: string, minBytes: number): string {
  const line = "\n// pad-" + "x".repeat(100);
  let out = body;
  while (Buffer.byteLength(out) < minBytes) out += line;
  return out;
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body, "utf8");
  }
}

test("DEFAULT_SKIP_DIRS lists generated path segments", () => {
  for (const name of REQUIRED_SKIP) {
    assert.ok(DEFAULT_SKIP_DIRS.includes(name), `missing default skip: ${name}`);
  }
});

test("source collection skips generated dirs but keeps filenames containing out/dist", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-skip-"));
  try {
    await writeTree(root, {
      "src/app.ts": SRC_APP,
      "src/timeout.ts": SRC_TIMEOUT,
      "src/distutils.ts": SRC_DISTUTILS,
      "out/index-abc.js": BUNDLE,
      "dist/bundle.js": BUNDLE,
      "build/gen.ts": BUNDLE,
      "release/app.js": BUNDLE,
      "coverage/report.ts": BUNDLE,
      "target/debug.rs": "fn bundled() {}",
      "node_modules/pkg/index.js": BUNDLE,
      ".next/server.js": BUNDLE,
      ".turbo/cache.ts": BUNDLE,
      ".cache/tmp.ts": BUNDLE,
      ".git/hooks.ts": BUNDLE,
      ".pi/agent/x.ts": BUNDLE,
    });

    const entries = collectSourceEntries(root);
    const paths = entries.map((e) => e.path).sort();
    assert.deepEqual(paths, ["src/app.ts", "src/distutils.ts", "src/timeout.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("user excludeGlobs stack on top of generated-dir defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-skip-user-"));
  try {
    await writeTree(root, {
      "src/app.ts": SRC_APP,
      "src/timeout.ts": SRC_TIMEOUT,
      "fixtures/demo.ts": SRC_APP,
      "out/index-abc.js": BUNDLE,
    });

    const entries = collectSourceEntries(root, ["fixtures"]);
    const paths = entries.map((e) => e.path).sort();
    assert.deepEqual(paths, ["src/app.ts", "src/timeout.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo_map source collection only keeps src, not out/dist/build", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-skip-map-"));
  try {
    await writeTree(root, {
      "src/app.ts": SRC_APP,
      "src/timeout.ts": SRC_TIMEOUT,
      "out/index-abc.js": BUNDLE,
      "dist/bundle.js": BUNDLE,
      "build/gen.ts": BUNDLE,
    });

    const map = await computeRepoMap(root, { tokenBudget: 1200, excludeGlobs: [] });
    assert.equal(map.degraded, false, map.reason ?? "repo_map degraded");
    assert.ok(map.entries.length > 0, "repo_map should have src entries");
    for (const entry of map.entries) {
      assert.ok(entry.path.startsWith("src/"), `unexpected generated path: ${entry.path}`);
      assert.ok(!/(^|\/)(out|dist|build)(\/|$)/.test(entry.path), entry.path);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source collection skips a large generated single-file bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-skip-bundle-"));
  try {
    await writeTree(root, {
      "index.js": padToBytes(BUNDLER_WRAPPER + HASHED_CHUNK, BUNDLE_MIN_BYTES),
      "src/index.js": SRC_INDEX_JS,
      "src/app.ts": SRC_APP,
    });

    const paths = collectSourceEntries(root).map((e) => e.path).sort();
    assert.deepEqual(paths, ["src/app.ts", "src/index.js"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("single bundle signals do not exclude ordinary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-skip-bundle-single-"));
  try {
    await writeTree(root, {
      "src/index.js": SRC_INDEX_JS,
      "large-plain.js": padToBytes(SRC_INDEX_JS, BUNDLE_MIN_BYTES),
      "wrapper-only.js": BUNDLER_WRAPPER + SRC_INDEX_JS,
      "chunk-only.js": HASHED_CHUNK + SRC_INDEX_JS,
      "helper-only.js": BUNDLER_HELPERS + SRC_INDEX_JS,
      "large-wrapper.js": padToBytes(BUNDLER_WRAPPER + SRC_INDEX_JS, BUNDLE_MIN_BYTES),
      "large-chunk.js": padToBytes(HASHED_CHUNK + SRC_INDEX_JS, BUNDLE_MIN_BYTES),
    });

    const paths = collectSourceEntries(root).map((e) => e.path).sort();
    assert.deepEqual(paths, [
      "chunk-only.js",
      "helper-only.js",
      "large-chunk.js",
      "large-plain.js",
      "large-wrapper.js",
      "src/index.js",
      "wrapper-only.js",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("user excludeGlobs still stack when a generated bundle is present", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-skip-bundle-user-"));
  try {
    await writeTree(root, {
      "index.js": padToBytes(BUNDLER_WRAPPER + BUNDLER_HELPERS, BUNDLE_MIN_BYTES),
      "src/index.js": SRC_INDEX_JS,
      "src/keep.ts": SRC_APP,
      "fixtures/demo.ts": SRC_APP,
    });

    const paths = collectSourceEntries(root, ["fixtures"]).map((e) => e.path).sort();
    assert.deepEqual(paths, ["src/index.js", "src/keep.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo_map drops generated bundle but keeps src/index.js", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-skip-bundle-map-"));
  try {
    await writeTree(root, {
      "index.js": padToBytes(BUNDLER_WRAPPER + HASHED_CHUNK, BUNDLE_MIN_BYTES),
      "src/index.js": SRC_INDEX_JS,
      "src/app.ts": SRC_APP,
    });

    const map = await computeRepoMap(root, { tokenBudget: 1200, excludeGlobs: [] });
    assert.equal(map.degraded, false, map.reason ?? "repo_map degraded");
    const paths = map.entries.map((e) => e.path);
    assert.ok(!paths.includes("index.js"), `bundle leaked into repo_map: ${paths.join(",")}`);
    assert.ok(paths.includes("src/index.js") || paths.includes("src/app.ts"), `missing src: ${paths.join(",")}`);
    for (const entry of map.entries) {
      assert.ok(entry.path.startsWith("src/"), `unexpected path: ${entry.path}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
