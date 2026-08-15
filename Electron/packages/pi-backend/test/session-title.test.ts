import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import {
  isPlaceholderSessionTitle,
  parseModelSessionTitle,
  provisionalSessionTitle,
} from "../src/session-title.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("session title parity with Swift", () => {
  it("builds an immediate useful title from the first human message", () => {
    expect(provisionalSessionTitle("请问一下，为什么 Electron 点加号没有反应？"))
      .toBe("为什么 Electron 点加号");
    expect(provisionalSessionTitle("Could you fix the sidebar session button please"))
      .toBe("fix the sidebar session");
  });

  it("recognizes both Electron and Swift placeholder names", () => {
    expect(isPlaceholderSessionTitle(undefined)).toBe(true);
    expect(isPlaceholderSessionTitle("New session")).toBe(true);
    expect(isPlaceholderSessionTitle("新会话")).toBe(true);
    expect(isPlaceholderSessionTitle("真实标题")).toBe(false);
  });

  it("accepts one clean model title line and rejects prompt/path junk", () => {
    expect(parseModelSessionTitle("标题：Electron 会话创建修复\n额外解释"))
      .toBe("Electron 会话创建修复");
    expect(parseModelSessionTitle("Write a short session title for this user message"))
      .toBeUndefined();
    expect(parseModelSessionTitle("docs/session.jsonl")).toBeUndefined();
  });

  it("refines the provisional title through an isolated no-session Pi process", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-title-"));
    const projectPath = join(root, "project");
    await mkdir(projectPath, { recursive: true });
    const spawns: string[][] = [];
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      spawn: (_bin, args, options) => {
        spawns.push(args);
        return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any;
      },
      authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
    });
    const titles: Array<{ title: string; source: string }> = [];
    backend.subscribe(frame => {
      if (frame.channel === "stream" && frame.event.type === "session_title") titles.push(frame.event);
    });
    const project = await backend.handle("addProject", [projectPath]) as any;
    const session = await backend.handle("newSession", [project.id]) as any;

    await backend.handle("sendPrompt", [session.id, "帮我修复 Electron 会话创建"]);
    await expect.poll(() => titles).toEqual([
      expect.objectContaining({ title: "修复 Electron 会话创建", source: "provisional" }),
      expect.objectContaining({ title: "hello", source: "model" }),
    ]);
    await expect(backend.handle("listSessions", [project.id]))
      .resolves.toEqual([expect.objectContaining({ id: session.id, name: "hello" })]);
    expect(spawns.some(args => args.includes("--no-session") && args.includes("--no-tools") && args.includes("--no-extensions"))).toBe(true);
    await backend.close();
  });

  it("persists a manual rename for an idle session and emits the shared title event", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-title-"));
    const projectPath = join(root, "project");
    await mkdir(projectPath, { recursive: true });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any,
      authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
    });
    const titles: Array<{ title: string; source: string }> = [];
    backend.subscribe(frame => {
      if (frame.channel === "stream" && frame.event.type === "session_title") titles.push(frame.event);
    });
    const project = await backend.handle("addProject", [projectPath]) as any;
    const session = await backend.handle("newSession", [project.id, "Before rename"]) as any;

    await expect(backend.handle("renameSession", [session.id, "  Renamed from UI  "]))
      .resolves.toMatchObject({ id: session.id, name: "Renamed from UI" });
    await expect(backend.handle("listSessions", [project.id]))
      .resolves.toEqual([expect.objectContaining({ id: session.id, name: "Renamed from UI" })]);
    expect(titles).toEqual([expect.objectContaining({ title: "Renamed from UI", source: "manual" })]);
    await backend.close();
  });
});
