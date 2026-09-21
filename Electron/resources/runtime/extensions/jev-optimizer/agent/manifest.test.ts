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

test("manifest is optional with separate default-off browser cloud consent and no tools or models", async () => {
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
  assert.match(String(secret?.title), /TypeSafe/);
  assert.match(description, /共用此 key/);
  assert.match(description, /加密持久保存/);
  assert.match(String(manifest.description), /无 key.*基础检索/);
  assert.match(description, /新会话/);
  const browser = app.settings?.schema?.properties?.["ext.jev-optimizer.browserEnabled"];
  assert.equal(browser?.type, "boolean");
  assert.equal(browser?.default, false);
  assert.match(String(browser?.title), /Choice.*Score/);
  assert.match(String(browser?.description), /TypeSafe/);
  assert.match(String(browser?.description), /收费/);
  assert.match(String(browser?.description), /不(?:会)?发送截图或整个页面/);
  assert.match(String(browser?.description), /显式调用 browser goal/);
  assert.equal(app.ui, undefined);
});
