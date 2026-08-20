import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

describe("sidebar sessionOrderVersion 2 | 3", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });

  async function backend() {
    root = await mkdtemp(join(tmpdir(), "pipi-sidebar-order-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    return { backend: createPiHostBackend({ agentDir: agent }), agent };
  }

  it("still accepts version-2 writes with orderedSessionIds", async () => {
    const { backend: host, agent } = await backend();
    const saved = await host.handle("setSidebarSessionPreferences", [{
      pinnedSessionIds: ["p1"],
      archivedSessionIds: [],
      orderedSessionIds: ["s2", "s1"],
      sessionOrderVersion: 2,
    }]);
    expect(saved).toEqual({
      pinnedSessionIds: ["p1"],
      archivedSessionIds: [],
      orderedSessionIds: ["s2", "s1"],
      sessionOrderVersion: 2,
    });
    const onDisk = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(onDisk.sidebarSessionPreferences).toEqual(saved);
  });

  it("accepts version-3 with empty orderedSessionIds and persists it", async () => {
    const { backend: host, agent } = await backend();
    const saved = await host.handle("setSidebarSessionPreferences", [{
      pinnedSessionIds: ["p1"],
      archivedSessionIds: ["a1"],
      archivedSessionTimestamps: { a1: 99 },
      orderedSessionIds: [],
      sessionOrderVersion: 3,
    }]);
    expect(saved).toEqual({
      pinnedSessionIds: ["p1"],
      archivedSessionIds: ["a1"],
      archivedSessionTimestamps: { a1: 99 },
      orderedSessionIds: [],
      sessionOrderVersion: 3,
    });
    const onDisk = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(onDisk.sidebarSessionPreferences).toEqual(saved);
    expect(await host.handle("getSidebarSessionPreferences", [])).toEqual(saved);
  });

  it("does not require unique non-empty ordered ids on version 3", async () => {
    const { backend: host } = await backend();
    const saved = await host.handle("setSidebarSessionPreferences", [{
      pinnedSessionIds: [],
      archivedSessionIds: [],
      orderedSessionIds: ["", "dup", "dup"],
      sessionOrderVersion: 3,
    }]);
    expect(saved).toEqual({
      pinnedSessionIds: [],
      archivedSessionIds: [],
      orderedSessionIds: ["", "dup", "dup"],
      sessionOrderVersion: 3,
    });
  });
});
