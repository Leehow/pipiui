import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeHermesConfiguration } from "../src/hermes-adapter.ts";

test("PipiUI review model override is provider-neutral and preserves upstream config", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pipi-memory-review-"));
  try {
    await writeFile(join(agentDir, "hermes-memory-config.json"), JSON.stringify({ reviewEnabled: true, customFutureKey: 7 }));
    const result = await mergeHermesConfiguration({
      PI_CODING_AGENT_DIR: agentDir,
      PIPIUI_MEMORY_REVIEW_MODEL: "  any-provider/any-model-family/reviewer  ",
    });
    assert.equal(result.config.llmModelOverride, "any-provider/any-model-family/reviewer");
    assert.equal(result.config.customFutureKey, 7);
    assert.equal(result.config.memoryMode, "policy-only");
    assert.deepEqual(JSON.parse(await readFile(result.configPath, "utf8")), result.config);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("invalid or absent host override preserves an existing Hermes choice, while follow-main clears it", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pipi-memory-review-"));
  try {
    const configPath = join(agentDir, "hermes-memory-config.json");
    await writeFile(configPath, JSON.stringify({ llmModelOverride: "existing/model" }));
    const invalid = await mergeHermesConfiguration({ PI_CODING_AGENT_DIR: agentDir, PIPIUI_MEMORY_REVIEW_MODEL: "not canonical" });
    assert.equal(invalid.config.llmModelOverride, "existing/model");
    const absent = await mergeHermesConfiguration({ PI_CODING_AGENT_DIR: agentDir });
    assert.equal(absent.config.llmModelOverride, "existing/model");
    const followMain = await mergeHermesConfiguration({ PI_CODING_AGENT_DIR: agentDir, PIPIUI_MEMORY_REVIEW_MODEL: "" });
    assert.equal(followMain.config.llmModelOverride, undefined);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("missing overflow settings receive PipiUI product defaults", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pipi-memory-overflow-"));
  try {
    const result = await mergeHermesConfiguration({ PI_CODING_AGENT_DIR: agentDir });
    assert.equal(result.config.overflowGraceMs, 0);
    assert.equal(result.config.projectCharLimit, 8000);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("explicit overflow settings survive and global and project limits remain independent", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pipi-memory-overflow-"));
  try {
    const configPath = join(agentDir, "hermes-memory-config.json");
    await writeFile(configPath, JSON.stringify({
      overflowGraceMs: 1234,
      memoryCharLimit: 6100,
      projectCharLimit: 9200,
    }));
    const explicit = await mergeHermesConfiguration({ PI_CODING_AGENT_DIR: agentDir });
    assert.equal(explicit.config.overflowGraceMs, 1234);
    assert.equal(explicit.config.memoryCharLimit, 6100);
    assert.equal(explicit.config.projectCharLimit, 9200);

    await writeFile(configPath, JSON.stringify({ memoryCharLimit: 7300 }));
    const globalOnly = await mergeHermesConfiguration({ PI_CODING_AGENT_DIR: agentDir });
    assert.equal(globalOnly.config.memoryCharLimit, 7300);
    assert.equal(globalOnly.config.projectCharLimit, 8000);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});
