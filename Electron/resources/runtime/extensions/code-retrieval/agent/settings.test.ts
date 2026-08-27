import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DEFAULT_TOKEN_BUDGET,
  loadRetrievalSettings,
  normalizeExactProvider,
} from "./settings.js";

/** Works whether this test runs from agent/ sources or the compiled agent/dist. */
function manifestPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const up = basename(here) === "dist" ? "../.." : "..";
  return resolve(here, up, "pipiui-extension.json");
}

async function writeSettings(root: string, document: unknown): Promise<void> {
  const dir = join(root, ".pi", "agent", "ext-settings");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "code-retrieval.json"), JSON.stringify(document), "utf8");
}

async function withProjectRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "cr-settings-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("missing or unreadable settings fall back to safe defaults", async () => {
  await withProjectRoot(async (root) => {
    const s = await loadRetrievalSettings(root);
    assert.equal(s.exactProvider, "auto");
    assert.equal(s.tokenBudget, DEFAULT_TOKEN_BUDGET);
    assert.deepEqual(s.excludeGlobs, []);
  });
});

test("host document shape { settings: {...} } is honored", async () => {
  await withProjectRoot(async (root) => {
    await writeSettings(root, {
      settingsVersion: 1,
      settings: {
        "ext.code-retrieval.tokenBudget": 8000,
        "ext.code-retrieval.exactProvider": "rg",
        "ext.code-retrieval.excludeGlobs": ["dist/**"],
      },
    });
    const s = await loadRetrievalSettings(root);
    assert.equal(s.exactProvider, "rg");
    assert.equal(s.tokenBudget, 8000);
    assert.deepEqual(s.excludeGlobs, ["dist/**"]);
  });
});

test("legacy flat key maps still parse", async () => {
  await withProjectRoot(async (root) => {
    await writeSettings(root, {
      "ext.code-retrieval.tokenBudget": 1200,
      "ext.code-retrieval.exactProvider": "tantivy",
    });
    const s = await loadRetrievalSettings(root);
    assert.equal(s.exactProvider, "tantivy");
    assert.equal(s.tokenBudget, 1200);
  });
});

test("removed semanticApiKey and unsupported zoekt collapse safely", async () => {
  await withProjectRoot(async (root) => {
    await writeSettings(root, {
      settingsVersion: 1,
      settings: {
        // Left behind by an older schema; must be ignored, never destructive.
        "ext.code-retrieval.semanticApiKey": "sk-dead",
        "ext.code-retrieval.exactProvider": "zoekt",
      },
    });
    const s = await loadRetrievalSettings(root);
    assert.equal(s.exactProvider, "auto");
    assert.equal("semanticApiKey" in s, false, "dead key must not leak into parsed settings");
  });
});

test("invalid values fall back per key without discarding valid ones", async () => {
  await withProjectRoot(async (root) => {
    await writeSettings(root, {
      settings: {
        "ext.code-retrieval.exactProvider": 42,
        "ext.code-retrieval.tokenBudget": -5,
        "ext.code-retrieval.excludeGlobs": ["ok/**", 7, null],
      },
    });
    const s = await loadRetrievalSettings(root);
    assert.equal(s.exactProvider, "auto");
    assert.equal(s.tokenBudget, DEFAULT_TOKEN_BUDGET);
    assert.deepEqual(s.excludeGlobs, ["ok/**"]);
  });
});

test("normalizeExactProvider rejects everything but auto|rg|tantivy", () => {
  assert.equal(normalizeExactProvider("auto"), "auto");
  assert.equal(normalizeExactProvider("rg"), "rg");
  assert.equal(normalizeExactProvider("tantivy"), "tantivy");
  for (const bad of ["zoekt", "semantic", "RG", "", undefined, null, 0]) {
    assert.equal(
      normalizeExactProvider(bad as unknown as string),
      "auto",
      String(bad),
    );
  }
});

test("manifest is truthful: no dead secret field, enum advertises only supported providers", async () => {
  const manifest = JSON.parse(await readFile(manifestPath(), "utf8")) as {
    app?: { settings?: { scope?: string; schema?: { properties?: Record<string, unknown> } } };
    settingsVersion?: number;
    migrations?: unknown[];
  };
  const properties = manifest.app?.settings?.schema?.properties ?? {};
  const keys = Object.keys(properties);
  assert.equal(
    keys.some((key) => /semantic/i.test(key)),
    false,
    `no unimplemented semantic setting may be advertised, found in ${keys.join(",")}`,
  );
  const provider = properties["ext.code-retrieval.exactProvider"] as
    | { enum?: string[]; default?: string }
    | undefined;
  assert.ok(provider, "exactProvider must stay declared");
  assert.deepEqual(provider.enum, ["auto", "rg", "tantivy"]);
  assert.equal(provider.default, "auto");
  for (const spec of Object.values(properties)) {
    const record = spec as { format?: string; type?: string };
    if (record.type === "string") {
      assert.notEqual(record.format, "secret", "no secret field is implemented in this build");
    }
  }
  assert.equal(manifest.settingsVersion, 1);
  assert.deepEqual(manifest.migrations, []);
});
