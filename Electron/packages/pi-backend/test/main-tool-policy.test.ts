import { describe, expect, it } from "vitest";
import { assemblePiSpawn, sanitizeEnvironment } from "../src/spawn-assembly.js";
import { DEFAULT_FEATURES } from "../src/features.js";
import {
  BOSS_MUTATION_TOOL_NAMES,
  mainSessionExcludeToolArgs,
  resolveMainSessionExcludedTools,
} from "../src/main-tool-policy.js";

describe("boss read-only tool policy", () => {
  it("removes every mutation path, not only the two file tools", () => {
    // A denylist holding edit/write but not bash is theatre: `sed -i` reaches the same disk.
    expect(resolveMainSessionExcludedTools({ bossReadOnly: true })).toEqual(["bash", "edit", "write"]);
    expect([...BOSS_MUTATION_TOOL_NAMES].sort()).toEqual(["bash", "edit", "write"]);
  });

  it("keeps the Boss's read and verification tools", () => {
    const excluded = new Set(resolveMainSessionExcludedTools({ bossReadOnly: true }));
    for (const kept of ["read", "grep", "find", "ls", "git", "web_search", "browser", "browser_search", "browser_fetch", "subagent", "subagent_status", "ledger_note"]) {
      expect(excluded.has(kept)).toBe(false);
    }
  });

  it("leaves the legacy fully-capable main session untouched when disabled", () => {
    expect(resolveMainSessionExcludedTools({ bossReadOnly: false })).toEqual([]);
    expect(mainSessionExcludeToolArgs({ bossReadOnly: false })).toEqual([]);
  });

  it("merges the user's own denylist and expands the browser group id", () => {
    // The browser group covers every tool driven by the built-in browser surface,
    // including the bridge-backed search/fetch route.
    expect(resolveMainSessionExcludedTools({ bossReadOnly: true, disabledToolNames: ["browser_*", "generate_image"] }))
      .toEqual(["bash", "browser", "browser_fetch", "browser_search", "edit", "generate_image", "write"]);
  });

  it("never denies the desktop tools, which only the global Computer Use toggle controls", () => {
    expect(resolveMainSessionExcludedTools({ bossReadOnly: true, disabledToolNames: ["computer", "open_application"] }))
      .toEqual(["bash", "edit", "write"]);
  });

  it("emits a stable sorted argv so the prompt cache is not invalidated by ordering", () => {
    const a = mainSessionExcludeToolArgs({ bossReadOnly: true, disabledToolNames: ["zed", "abacus"] });
    const b = mainSessionExcludeToolArgs({ bossReadOnly: true, disabledToolNames: ["abacus", "zed"] });
    expect(a).toEqual(b);
    expect(a).toEqual(["--exclude-tools", "abacus,bash,edit,write,zed"]);
  });
});

describe("main session spawn", () => {
  const paths = { git: "/runtime/git.ts" };

  it("is read-only by default in this host", () => {
    expect(DEFAULT_FEATURES.bossReadOnly).toBe(true);
    const runtimeInfo = "/runtime/pipiui-runtime-info.ts";
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", features: DEFAULT_FEATURES, paths: { runtimeInfo } });
    expect(args).toEqual(expect.arrayContaining(["--exclude-tools", "bash,edit,write"]));
    expect(args).toEqual(expect.arrayContaining(["-e", runtimeInfo]));
    expect(args.join(" ")).not.toContain("pipiui_runtime_info,");
  });

  it("passes no tool flag at all when nothing is excluded", () => {
    // pi rejects an empty --exclude-tools list, so the flag must be absent rather than blank.
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", features: { git: true }, paths });
    expect(args).not.toContain("--exclude-tools");
  });

  it("does not set a terminal action gate on the Boss spawn", () => {
    const { env } = assemblePiSpawn({ cwd: "/tmp/project", features: DEFAULT_FEATURES, paths: {}, bridgePort: 1234, sessionCapability: "cap" });
    expect(env.PIPIUI_BOSS_READ_ONLY).toBeUndefined();
    expect(assemblePiSpawn({ cwd: "/tmp/project", features: { terminal: true }, paths: {} }).env.PIPIUI_BOSS_READ_ONLY).toBeUndefined();
  });

  it("never inherits a leftover PIPIUI_BOSS_READ_ONLY marker from an outer shell", () => {
    expect(sanitizeEnvironment({ PIPIUI_BOSS_READ_ONLY: "0", HOME: "/home/x" })).toEqual({ HOME: "/home/x" });
  });

  it("does not leak the Boss policy into a worker's tool selection", () => {
    // Workers assemble their own args from their agent definition; this asserts the host
    // never writes the Boss denylist into the settings file children read.
    const { args, env } = assemblePiSpawn({ cwd: "/tmp/project", features: DEFAULT_FEATURES, paths });
    expect(args.filter((a) => a === "--exclude-tools")).toHaveLength(1);
    expect(Object.values(env)).not.toContain("bash,edit,write");
  });
});
