import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentHome, tryResolveAgentHome, NoAgentHomeError, authJsonPath } from "../agent/oauth/home.js";
import { resolveImagesRoot } from "../agent/images/storage.js";
import { resolveSessionId } from "../agent/images/config.js";

describe("agent home precedence (reviewer MUST-FIX #3)", () => {
  let dir = "";
  const keys = ["PI_COC_AGENT_DIR", "PI_CODING_AGENT_DIR"] as const;
  let saved: Record<string, string | undefined> = {};
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-home-"));
    saved = {};
    for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(async () => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("PI_COC_AGENT_DIR wins over PI_CODING_AGENT_DIR", () => {
    process.env.PI_COC_AGENT_DIR = join(dir, "coc");
    process.env.PI_CODING_AGENT_DIR = join(dir, "coding");
    expect(resolveAgentHome()).toBe(join(dir, "coc"));
    expect(authJsonPath()).toBe(join(dir, "coc", "auth.json"));
  });

  it("falls back to PI_CODING_AGENT_DIR when PI_COC_AGENT_DIR is unset", () => {
    process.env.PI_CODING_AGENT_DIR = join(dir, "coding");
    expect(resolveAgentHome()).toBe(join(dir, "coding"));
  });

  it("fails closed when both are missing — never the global ~/.pi/agent", () => {
    expect(tryResolveAgentHome()).toBeUndefined();
    expect(() => resolveAgentHome()).toThrow(NoAgentHomeError);
    expect(() => authJsonPath()).toThrow(NoAgentHomeError);
    expect(() => resolveImagesRoot()).toThrow(/PI_COC_AGENT_DIR|PI_CODING_AGENT_DIR/);
  });

  it("empty-string values are ignored (treated as unset)", () => {
    process.env.PI_COC_AGENT_DIR = "  ";
    process.env.PI_CODING_AGENT_DIR = "";
    expect(() => resolveAgentHome()).toThrow(NoAgentHomeError);
  });

  it("session id degrades to a transient UUID instead of touching a global dir", () => {
    const first = resolveSessionId();
    const second = resolveSessionId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("session id persists inside the resolved home when present", async () => {
    process.env.PI_COC_AGENT_DIR = join(dir, "coc");
    const first = resolveSessionId();
    const second = resolveSessionId();
    expect(second).toBe(first);
    // Persisted inside the resolved home — not the global ~/.pi/agent.
    const { readFile } = await import("node:fs/promises");
    const persisted = (await readFile(join(dir, "coc", "grok-build-session-id"), "utf8")).trim();
    expect(persisted).toBe(first);
  });
});
