import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assemblePiSpawn, resolveSpawnPaths, sanitizeEnvironment } from "../src/spawn-assembly.js";
import { FROZEN_CORE_CAPABILITY_TOOL_NAMES } from "../src/extension-registry.js";
import { installRuntimeTree } from "../src/runtime-install.js";

/**
 * `pi-core-prompt/SYSTEM_BASE.md` is the one piece of prompt text no setting can remove, so
 * it is the one piece nothing else can guard. PipiUI's core is small by construction — Pi's
 * runtime plus this file — and that only stays true while the base stays closed: a rule added
 * here cannot be toggled, scoped to a model, or replaced without a rebuild, which is exactly
 * what the philosophy layers exist to avoid.
 *
 * These tests are the lock. They pin delivery (it reaches every session, first), the content
 * (a digest, so amending it shows up in review as a deliberate edit), and the two properties
 * that make it safe to be unconditional: it names no tool, and it does not grow.
 *
 * See `resources/runtime/pi-core-prompt/README.md` for where a change belongs instead.
 */
const RUNTIME_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime");
const BASE_PATH = join(RUNTIME_ROOT, "pi-core-prompt", "SYSTEM_BASE.md");
const BASE_TEXT = readFileSync(BASE_PATH, "utf8");

/**
 * Amending the base is a constitution-level change. When this fails, do not paste the new
 * digest reflexively: confirm the rule genuinely cannot live in a philosophy layer, an
 * extension layer directory, or a tool's `promptGuidelines`, then update it and say why in
 * the commit message.
 */
const EXPECTED_DIGEST = "ea2ab0330e487453f71f9408325d0ef6eae66bfb48f9a83941a778e763995a31";

/** Roughly Pi's own accounting, and the same estimator the philosophy layers are budgeted with. */
const estimateTokens = (text: string): number => Math.round(text.length / 4);

/**
 * Modest headroom over the current ~630, not a target. This is the one prompt every session
 * pays for and none can decline, so growth should be a decision someone makes rather than a
 * drift nobody notices. v1 shipped at ~1030 because it enumerated the coding pack's
 * extensions — prose that was both the largest section and false in every other product.
 */
const TOKEN_BUDGET = 800;

function appendSources(args: readonly string[]): string[] {
  return args.flatMap((arg, i) => (args[i - 1] === "--append-system-prompt" ? [arg] : []));
}

describe("locked base system prompt", () => {
  it("is byte-identical to the reviewed text", () => {
    expect(createHash("sha256").update(BASE_TEXT).digest("hex")).toBe(EXPECTED_DIGEST);
  });

  it("states the three things the base owns", () => {
    // Identity (the untitled opening), architecture, and the invariants — the split the
    // README makes normative.
    expect(BASE_TEXT).toContain("You are the agent of **PipiUI**");
    expect(BASE_TEXT).toContain("## Capabilities are mounted, never assumed");
    expect(BASE_TEXT).toContain("## Invariants");
  });

  it("names no extension that only ships in one product profile", () => {
    // `profiles/base` requires skill-loader alone; git, terminal, plan, goal, web access,
    // the browser and even the method extension are `profiles/coding`. Enumerating any of
    // them here would be false in every other product — and the roster is meant to grow,
    // so the base states the shape and lets the tool list carry the contents.
    const profiles = join(RUNTIME_ROOT, "profiles");
    const packScoped = readdirSync(profiles).flatMap((id) => {
      const manifest = JSON.parse(readFileSync(join(profiles, id, "pipiui-profile.json"), "utf8"));
      return [...(manifest.extensions?.required ?? []), ...(manifest.extensions?.recommended ?? [])]
        .map((entry: { id: string }) => entry.id);
    });
    expect(packScoped.length).toBeGreaterThan(0);
    for (const id of new Set(packScoped)) {
      expect(BASE_TEXT, `base prompt names the profile-scoped extension \`${id}\``).not.toContain(id);
    }
  });

  it("names no extension-owned tool", () => {
    // The base has to stay true in a session with everything unmounted, so it must not
    // promise a tool that ships with an extension. What counts as naming one is narrower
    // than the word appearing: `capabilities.json` already makes this distinction for
    // read/grep/write/edit, because some tools are also ordinary English. Describing "the
    // browser" as a capability is prose and stays; `browser` in backticks, or any of the
    // snake_case names that cannot occur in prose by accident, is a tool reference.
    const owned = [...FROZEN_CORE_CAPABILITY_TOOL_NAMES, "subagent", "code_search", "skill_search", "skill_load"];
    for (const tool of owned) {
      expect(BASE_TEXT, `base prompt names the extension-owned tool \`${tool}\``).not.toContain(`\`${tool}\``);
      if (!tool.includes("_")) continue;
      expect(BASE_TEXT, `base prompt names the extension-owned tool ${tool}`).not.toMatch(
        new RegExp(`\\b${tool}\\b`),
      );
    }
  });

  it("stays within its token budget", () => {
    expect(estimateTokens(BASE_TEXT)).toBeLessThanOrEqual(TOKEN_BUDGET);
  });
});

describe("base prompt delivery", () => {
  const paths = resolveSpawnPaths(RUNTIME_ROOT);

  it("resolves from the runtime tree the packaged app ships", () => {
    expect(paths.corePrompt).toBe(BASE_PATH);
  });

  it("reaches a session with every feature off, before anything else appends", () => {
    // The failure this guards: a base gated behind a flag is not a base.
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", paths, features: {} });
    expect(appendSources(args)[0]).toBe(BASE_PATH);
  });

  it("is still first when the session mounts extensions", () => {
    const { args } = assemblePiSpawn({
      cwd: "/tmp/project",
      paths,
      features: { philosophy: true, skillLoader: true, webSearch: true },
    });
    expect(appendSources(args)[0]).toBe(BASE_PATH);
  });

  it("keeps the user's own append file, which passing the base explicitly would otherwise drop", () => {
    // Pi discovers `{agentDir}/APPEND_SYSTEM.md` only while nothing was passed on the command
    // line. Taking that seam over means re-adding the user's file by hand — after the base,
    // so the user's text still wins on anything the two both mention.
    const agentDir = mkdtempSync(join(tmpdir(), "pipiui-core-prompt-"));
    const userAppend = join(agentDir, "APPEND_SYSTEM.md");
    writeFileSync(userAppend, "user text\n", "utf8");
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", paths, agentDir, features: {} });
    expect(appendSources(args)).toEqual([BASE_PATH, userAppend]);
  });

  it("passes only the base when the user has no append file", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pipiui-core-prompt-"));
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", paths, agentDir, features: {} });
    expect(appendSources(args)).toEqual([BASE_PATH]);
  });

  it("is installed into the runtime root a real session mounts from", () => {
    // Sessions resolve against the installed tree, not this repository, and the installer
    // copies a named list of directories. A base prompt missing from that list resolves to
    // `undefined` and drops out of the args with nothing logged — the exact silent skip
    // `installRuntimeTree` was written to stop.
    const runtimeRoot = mkdtempSync(join(tmpdir(), "pipiui-runtime-"));
    const report = installRuntimeTree({ sourceRoot: RUNTIME_ROOT }, runtimeRoot);
    expect(report.failures).toEqual([]);
    const installed = join(runtimeRoot, "pi-core-prompt", "SYSTEM_BASE.md");
    expect(resolveSpawnPaths(runtimeRoot).corePrompt).toBe(installed);
    expect(readFileSync(installed, "utf8")).toBe(BASE_TEXT);
  });
});


/**
 * Workers do not go through `assemblePiSpawn`; the subagent extension builds their arguments
 * itself, in another process. So the base reaches a worker only if the host exports the path
 * and the subagent reads that exact name — a two-sided contract with no compiler between the
 * halves. The philosophy package already lost one of these: the runtime began injecting
 * `PIPI_PHILOSOPHY_AGENT` while the vendored composer predated the name, and agent-addressed
 * layers silently reached nobody.
 */
describe("base prompt reaches dispatched workers", () => {
  const paths = resolveSpawnPaths(RUNTIME_ROOT);
  const SUBAGENT = readFileSync(
    join(RUNTIME_ROOT, "pi-ext", "subagent", "index.ts"),
    "utf8",
  );

  it("exports the path for the worker assembler", () => {
    const { env } = assemblePiSpawn({ cwd: "/tmp/project", paths, features: {} });
    expect(env.PIPIUI_CORE_PROMPT).toBe(BASE_PATH);
  });

  it("exports nothing when there is no base to point at", () => {
    const { env } = assemblePiSpawn({ cwd: "/tmp/project", paths: {}, features: {} });
    expect(env.PIPIUI_CORE_PROMPT).toBeUndefined();
  });

  it("is a managed key, so a stale inherited value cannot reach a child", () => {
    // Without this the parent's old path survives into a session whose own base resolved to
    // nothing, and workers append a file the host never chose.
    expect(sanitizeEnvironment({ PIPIUI_CORE_PROMPT: "/stale/SYSTEM_BASE.md" })).toEqual({});
  });

  it("is read by the subagent under the name the host exports", () => {
    expect(SUBAGENT).toContain("process.env.PIPIUI_CORE_PROMPT");
    expect(SUBAGENT).toContain('args.push("--append-system-prompt", PIPIUI_CORE_PROMPT)');
  });

  it("mounts the worker prompt observer, and mounts it last", () => {
    // Both halves again: the host resolves and exports the path, the subagent mounts it. Last,
    // because pi chains before_agent_start in mount order — mounted earlier it would report a
    // prompt that later extensions were still writing.
    const { env } = assemblePiSpawn({ cwd: "/tmp/project", paths, features: {} });
    expect(env.PIPIUI_PROMPT_OBSERVER_EXT).toBe(
      join(RUNTIME_ROOT, "extensions", "pipiui-prompt-observer.ts"),
    );
    expect(SUBAGENT).toContain("process.env.PIPIUI_PROMPT_OBSERVER_EXT");
    expect(SUBAGENT).toContain('args.push("-e", PIPIUI_PROMPT_OBSERVER_EXT!)');

    const observer = SUBAGENT.indexOf('args.push("-e", PIPIUI_PROMPT_OBSERVER_EXT!)');
    const otherMounts = [...SUBAGENT.matchAll(/args\.push\("-e", /g)].map((m) => m.index ?? -1);
    expect(observer).toBe(Math.max(...otherMounts));
  });

  it("gives each dispatched run its own report file", () => {
    expect(SUBAGENT).toContain("PIPIUI_PROMPT_DEBUG_FILE: promptDebugPath");
    expect(SUBAGENT).toContain('path.join(PIPIUI_MAIN_CWD, ".pi", "agent-prompts"');
  });

  it("is appended before the agent's own prompt, so the agent stays more specific", () => {
    const base = SUBAGENT.indexOf('args.push("--append-system-prompt", PIPIUI_CORE_PROMPT)');
    const agentPrompt = SUBAGENT.indexOf('args.push("--append-system-prompt", tmpPromptPath)');
    expect(base).toBeGreaterThan(-1);
    expect(agentPrompt).toBeGreaterThan(-1);
    expect(base).toBeLessThan(agentPrompt);
  });
});
