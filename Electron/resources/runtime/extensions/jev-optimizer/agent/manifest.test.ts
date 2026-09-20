import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

function manifestPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const up = basename(here) === "dist" ? "../.." : "..";
  return resolve(here, up, "pipiui-extension.json");
}

test("manifest is an optional secret-only extension with no tools or models", async () => {
  const manifest = JSON.parse(await readFile(manifestPath(), "utf8")) as Record<string, unknown>;
  assert.equal(manifest.id, "jev-optimizer");
  assert.equal(manifest.name, "Jev 优化");
  assert.equal(manifest.defaultEnabled, false);
  assert.equal(manifest.agent && (manifest.agent as { extension?: string }).extension, "agent/dist/index.js");
  assert.deepEqual(manifest.capabilities, []);
  assert.equal(manifest.auth, undefined);
  const app = manifest.app as {
    settings?: { scope?: string; schema?: { properties?: Record<string, Record<string, unknown>> } };
    ui?: unknown;
  };
  assert.equal(app.settings?.scope, "project");
  const secret = app.settings?.schema?.properties?.["ext.jev-optimizer.apiKey"];
  assert.equal(secret?.format, "secret");
  assert.equal(secret?.type, "string");
  const description = String(secret?.description ?? "");
  assert.match(description, /TypeSafe/);
  assert.match(description, /未配置 key|基础检索/);
  assert.match(description, /新会话/);
  assert.equal(app.ui, undefined);
});
