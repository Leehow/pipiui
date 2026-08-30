import { describe, expect, it } from "vitest";
import { assemblePiSpawn, sanitizeEnvironment } from "../src/spawn-assembly.js";
import { DEFAULT_FEATURES } from "../src/features.js";
import {
  mainSessionExcludeToolArgs,
  resolveMainSessionExcludedTools,
} from "../src/main-tool-policy.js";

describe("main session tool policy", () => {
  it("withholds nothing from the Boss by default", () => {
    // The inverse of the rule this file used to pin. `bossReadOnly` removed bash/edit/write so
    // the Boss could not work the floor; the Boss now owns the mainline and implements it, so
    // a denylist here would block the work it is supposed to be doing. Drift is bought by the
    // mainline philosophy layer, not by an argv flag.
    expect(resolveMainSessionExcludedTools({})).toEqual([]);
    expect(mainSessionExcludeToolArgs({})).toEqual([]);
  });

  it("keeps every tool the Boss needs to hold a mainline", () => {
    const excluded = new Set(resolveMainSessionExcludedTools({ disabledToolNames: ["generate_image"] }));
    for (const kept of [
      "bash", "edit", "write",
      "read", "grep", "find", "ls", "git",
      "web_search", "browser", "browser_search", "browser_fetch",
      "subagent", "subagent_status", "ledger_note", "context_doc",
    ]) {
      expect(excluded.has(kept), kept).toBe(false);
    }
  });

  it("merges the user's own denylist and expands the browser group id", () => {
    // The browser group covers every tool driven by the built-in browser surface,
    // including the bridge-backed search/fetch route.
    expect(resolveMainSessionExcludedTools({ disabledToolNames: ["browser_*", "generate_image"] }))
      .toEqual(["browser", "browser_fetch", "browser_search", "generate_image"]);
  });

  it("still honours a user who denies the mutation tools themselves", () => {
    // The host no longer imposes this, but the user's own 工具开关 remains authoritative.
    expect(resolveMainSessionExcludedTools({ disabledToolNames: ["bash", "edit", "write"] }))
      .toEqual(["bash", "edit", "write"]);
  });

  it("never denies the desktop tools, which only the global Computer Use toggle controls", () => {
    expect(resolveMainSessionExcludedTools({ disabledToolNames: ["computer", "open_application"] }))
      .toEqual([]);
  });

  it("emits a stable sorted argv so the prompt cache is not invalidated by ordering", () => {
    const a = mainSessionExcludeToolArgs({ disabledToolNames: ["zed", "abacus"] });
    const b = mainSessionExcludeToolArgs({ disabledToolNames: ["abacus", "zed"] });
    expect(a).toEqual(b);
    expect(a).toEqual(["--exclude-tools", "abacus,zed"]);
  });

  it("hides generic web_search and the local browser-search route only when effective native web_search is present", () => {
    const nativeWeb = { capabilities: { nativeSearch: { tools: ["web_search", "x_search"] as const } } };
    const xOnly = { capabilities: { nativeSearch: { tools: ["x_search"] as const } } };
    const ordinary = { provider: "anthropic", id: "claude" };
    const undeclaredXai = { provider: "xai", id: "grok-3" };
    const excluded = ["browser_fetch", "browser_search", "web_search"];
    expect(resolveMainSessionExcludedTools({ model: nativeWeb })).toEqual(excluded);
    expect(resolveMainSessionExcludedTools({ model: xOnly })).toEqual([]);
    expect(resolveMainSessionExcludedTools({ model: ordinary })).toEqual([]);
    expect(resolveMainSessionExcludedTools({ model: undeclaredXai })).toEqual([]);
    expect(resolveMainSessionExcludedTools({
      model: { capabilities: { hostedTools: { tools: ["web_search"] as const } } },
    })).toEqual(excluded);
    expect(resolveMainSessionExcludedTools({
      model: { capabilities: { hostedTools: { tools: ["code_interpreter"] as const } } },
    })).toEqual([]);
    expect(mainSessionExcludeToolArgs({ model: nativeWeb })).toEqual([
      "--exclude-tools", excluded.join(","),
    ]);
    expect(mainSessionExcludeToolArgs({ model: xOnly })).toEqual([]);
  });
});

describe("main session spawn", () => {
  const paths = { git: "/runtime/git.ts" };

  it("is fully capable by default in this host", () => {
    const runtimeInfo = "/runtime/pipiui-runtime-info.ts";
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", features: DEFAULT_FEATURES, paths: { runtimeInfo } });
    expect(args).not.toContain("--exclude-tools");
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
    // The feature is gone, but the scrub stays: a stale marker in the user's shell must not
    // reach a child that might one day read it again.
    expect(sanitizeEnvironment({ PIPIUI_BOSS_READ_ONLY: "0", HOME: "/home/x" })).toEqual({ HOME: "/home/x" });
  });

  it("does not write a host tool denylist into the settings a worker reads", () => {
    // Workers assemble their own args from their agent definition; this asserts the host
    // never leaks a main-session denylist into the child environment.
    const { args, env } = assemblePiSpawn({ cwd: "/tmp/project", features: DEFAULT_FEATURES, paths });
    expect(args).not.toContain("--exclude-tools");
    expect(Object.values(env)).not.toContain("bash,edit,write");
  });

  it("excludes generic web_search from the main spawn when the model hides it", () => {
    const { args } = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { git: true },
      paths,
      model: { capabilities: { nativeSearch: { tools: ["web_search"] } } },
    });
    expect(args).toEqual(expect.arrayContaining([
      "--exclude-tools", "browser_fetch,browser_search,web_search",
    ]));
    expect(assemblePiSpawn({
      cwd: "/tmp/project",
      features: { git: true },
      paths,
      model: { capabilities: { nativeSearch: { tools: ["x_search"] } } },
    }).args).not.toContain("--exclude-tools");
  });
});
