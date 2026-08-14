import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

describe("vision model persistence", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("round-trips the selected vision model into pipiui-settings.json and the vision.json bridge, and clears on null", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vision-model-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    const backend = createPiHostBackend({ agentDir: agent });
    // Unset by default.
    expect(await backend.handle("getVisionModel", [])).toBeNull();
    // Select: settings + bridge are written atomically (no .tmp leftovers).
    expect(await backend.handle("setVisionModel", ["anthropic/claude-sonnet-4"])).toBe("anthropic/claude-sonnet-4");
    expect(await backend.handle("getVisionModel", [])).toBe("anthropic/claude-sonnet-4");
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(settings.visionModel).toBe("anthropic/claude-sonnet-4");
    const bridge = JSON.parse(await readFile(join(agent, "vision.json"), "utf8"));
    expect(bridge).toEqual({ provider: "anthropic", model: "claude-sonnet-4" });
    expect((await readdir(agent)).filter(name => name.includes(".tmp-"))).toEqual([]);
    // A fresh backend re-reads the persisted selection.
    const fresh = createPiHostBackend({ agentDir: agent });
    expect(await fresh.handle("getVisionModel", [])).toBe("anthropic/claude-sonnet-4");
    // Clearing sets both stores back to none.
    expect(await fresh.handle("setVisionModel", [null])).toBeNull();
    expect(await fresh.handle("getVisionModel", [])).toBeNull();
    expect(JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8")).visionModel).toBeUndefined();
    expect(JSON.parse(await readFile(join(agent, "vision.json"), "utf8"))).toEqual({});
    // Invalid refs are rejected and never touch the stores.
    await expect(fresh.handle("setVisionModel", ["nope"])).rejects.toThrow("visionModel 必须是");
    await expect(fresh.handle("setVisionModel", ["/gpt-5"])).rejects.toThrow("visionModel 必须是");
  });
  it("merges into pipiui-settings without clobbering other fields", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vision-merge-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    const backend = createPiHostBackend({ agentDir: agent });
    await backend.handle("setHiddenModelIds", [["openai/gpt-5"]]);
    await backend.handle("setVisionModel", ["openai/gpt-5"]);
    const saved = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(saved).toMatchObject({ hiddenModelIds: ["openai/gpt-5"], visionModel: "openai/gpt-5" });
  });
  it("round-trips the vision-enabled master switch, defaulting to false", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vision-enabled-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    const backend = createPiHostBackend({ agentDir: agent });
    // Missing = disabled by default.
    expect(await backend.handle("getVisionEnabled", [])).toBe(false);
    expect(await backend.handle("setVisionEnabled", [true])).toBe(true);
    expect(await backend.handle("getVisionEnabled", [])).toBe(true);
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(settings.visionEnabled).toBe(true);
    // A fresh backend re-reads the persisted switch.
    const fresh = createPiHostBackend({ agentDir: agent });
    expect(await fresh.handle("getVisionEnabled", [])).toBe(true);
    // Explicit off round-trips and persists.
    expect(await fresh.handle("setVisionEnabled", [false])).toBe(false);
    expect(await fresh.handle("getVisionEnabled", [])).toBe(false);
    expect(JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8")).visionEnabled).toBe(false);
    // Non-boolean values are rejected and never touch the store.
    await expect(fresh.handle("setVisionEnabled", ["yes"])).rejects.toThrow("visionEnabled 必须是");
  });
  it("persists visionEnabled alongside visionModel without clobbering either", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-vision-both-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    const backend = createPiHostBackend({ agentDir: agent });
    await backend.handle("setVisionModel", ["openai/gpt-5"]);
    await backend.handle("setVisionEnabled", [true]);
    const saved = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(saved).toMatchObject({ visionModel: "openai/gpt-5", visionEnabled: true });
    const fresh = createPiHostBackend({ agentDir: agent });
    expect(await fresh.handle("getVisionModel", [])).toBe("openai/gpt-5");
    expect(await fresh.handle("getVisionEnabled", [])).toBe(true);
  });
});
