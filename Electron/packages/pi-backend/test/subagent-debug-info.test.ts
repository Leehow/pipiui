import { link, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_RUNTIME_DEBUG_BYTES,
  readSubagentDebugInfo,
  runtimeDebugSidecarPath,
} from "../src/subagent-debug-info.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("subagent debug runtime snapshot", () => {
  it("returns active Boss tools plus the safe tool and Skill catalog", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-subagent-debug-"));
    const sessionPath = join(root, "session.jsonl");
    await writeFile(runtimeDebugSidecarPath(sessionPath), JSON.stringify({
      version: 1,
      sessionId: "session-1",
      capturedAt: 1234,
      activeTools: ["read", "skill_search", "read"],
      tools: [
        { name: "read", description: "Read files", source: "builtin", scope: "temporary", path: "/secret" },
        { name: "skill_search", description: "Search skills", source: "pipiui-skillloader" },
      ],
      skills: [
        { name: "tdd", description: "Test driven development", userInvoked: false, file: "/secret/SKILL.md" },
      ],
      subagents: [
        { name: "explore", toolPolicy: "allowlist", tools: ["read", "grep", "skill_load", "read"] },
        { name: "legacy", toolPolicy: "unrestricted", tools: ["read", "edit"], excludedTools: ["computer"] },
      ],
    }));

    const result = await readSubagentDebugInfo(sessionPath, "session-1");
    expect(result).toEqual({
      available: true,
      source: "live",
      sessionId: "session-1",
      capturedAt: 1234,
      bossTools: [
        { name: "read", description: "Read files", source: "builtin", scope: "temporary" },
        { name: "skill_search", description: "Search skills", source: "pipiui-skillloader" },
      ],
      toolCatalog: [
        { name: "read", description: "Read files", source: "builtin", scope: "temporary" },
        { name: "skill_search", description: "Search skills", source: "pipiui-skillloader" },
      ],
      skills: [{ name: "tdd", description: "Test driven development", userInvoked: false }],
      subagents: [
        { name: "explore", toolPolicy: "allowlist", tools: ["read", "grep", "skill_load"] },
        { name: "legacy", toolPolicy: "unrestricted", tools: ["read", "edit"], excludedTools: ["computer"] },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("/secret");
  });

  it("fails closed for missing or mismatched snapshots", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-subagent-debug-invalid-"));
    const sessionPath = join(root, "session.jsonl");
    expect(await readSubagentDebugInfo(sessionPath, "session-1")).toMatchObject({
      available: false,
      reason: "snapshot-not-ready",
    });

    await writeFile(runtimeDebugSidecarPath(sessionPath), JSON.stringify({ version: 1, sessionId: "other" }));
    expect(await readSubagentDebugInfo(sessionPath, "session-1")).toMatchObject({
      available: false,
      reason: "snapshot-invalid",
    });
  });

  it("uses the same 1 MiB hard cap and rejects writer overflow sentinels", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-subagent-debug-budget-"));
    const sessionPath = join(root, "session.jsonl");
    expect(MAX_RUNTIME_DEBUG_BYTES).toBe(1024 * 1024);

    await writeFile(runtimeDebugSidecarPath(sessionPath), "x".repeat(MAX_RUNTIME_DEBUG_BYTES + 1));
    expect(await readSubagentDebugInfo(sessionPath, "session-1")).toMatchObject({
      available: false,
      reason: "snapshot-invalid",
    });

    await writeFile(runtimeDebugSidecarPath(sessionPath), JSON.stringify({
      version: 1,
      sessionId: "session-1",
      unavailable: "snapshot-too-large",
      capturedAt: 1234,
    }));
    expect(await readSubagentDebugInfo(sessionPath, "session-1")).toMatchObject({
      available: false,
      reason: "snapshot-too-large",
    });
  });

  it("refuses a symlinked snapshot instead of reading another file", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-subagent-debug-symlink-"));
    const sessionPath = join(root, "session.jsonl");
    const target = join(root, "target.json");
    await writeFile(target, JSON.stringify({ version: 1, sessionId: "session-1", activeTools: ["read"] }));
    await symlink(target, runtimeDebugSidecarPath(sessionPath));
    expect(await readSubagentDebugInfo(sessionPath, "session-1")).toMatchObject({
      available: false,
      reason: "snapshot-invalid",
    });
  });

  it("refuses a multiply-linked snapshot", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-subagent-debug-hardlink-"));
    const sessionPath = join(root, "session.jsonl");
    const target = join(root, "target.json");
    await writeFile(target, JSON.stringify({ version: 1, sessionId: "session-1", activeTools: ["read"] }));
    await link(target, runtimeDebugSidecarPath(sessionPath));
    expect(await readSubagentDebugInfo(sessionPath, "session-1")).toMatchObject({
      available: false,
      reason: "snapshot-invalid",
    });
  });
});
