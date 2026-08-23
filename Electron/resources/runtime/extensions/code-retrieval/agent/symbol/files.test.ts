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
