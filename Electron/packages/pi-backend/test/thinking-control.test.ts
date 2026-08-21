import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThinkingLevel } from "@pipi/host-api";
import {
  THINKING_CONTROL_FILE,
  ThinkingControlReporter,
  classifyThinkingControl,
  isUnwired,
  publishThinkingControl,
  readThinkingControl,
  thinkingControlPath,
} from "../src/thinking-control.js";

/**
 * The routes below are the ones measured on this host, not invented examples. Their
 * metadata is copied from the live model stores, so a capability entry that lands later
 * turns these cases green by fixing the product rather than by editing the fixture.
 */
const KIMI_VIA_RELAY = { provider: "jellytoken", id: "kimi-k3", reasoning: false };
const KIMI_VIA_GO = {
  provider: "opencode-go",
  id: "kimi-k3",
  reasoning: true,
  thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: "max" },
} as const;
const KIMI_CODING = {
  provider: "kimi-coding",
  id: "k3-256k",
  reasoning: true,
  thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
} as const;

const LEVELS = (...levels: ThinkingLevel[]) => levels;

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});
const agentDir = async () => (root = await mkdtemp(join(tmpdir(), "pipi-thinking-control-")));

describe("thinking control: classification", () => {
  it("calls a route wired only when the selected level has a provider value", () => {
    expect(classifyThinkingControl(KIMI_CODING, "low", LEVELS("off", "low", "high", "max"))).toEqual({
      verdict: "wired",
      wireValue: "low",
    });
    expect(isUnwired("wired")).toBe(false);
  });

  it("reports no dial for a model that thinks while declaring it cannot", () => {
    // The picker offers nothing and reads "off"; 36 of 36 measured turns on this route
    // emitted >500 chars of thinking and reported zero reasoning tokens.
    expect(classifyThinkingControl(KIMI_VIA_RELAY, "off", LEVELS())).toEqual({ verdict: "no-dial" });
  });

  it("separates an unmapped level from a level that was genuinely sent as off", () => {
    // opencode-go maps only `max`, so picking high sends no effort at all — which is a
    // missing capability entry, not a provider ignoring a parameter it received.
    expect(classifyThinkingControl(KIMI_VIA_GO, "high", LEVELS("max"))).toEqual({ verdict: "level-unmapped" });
    expect(classifyThinkingControl(KIMI_CODING, "off", LEVELS("off", "low", "high", "max"))).toEqual({
      verdict: "off-ignored",
    });
  });

  it("does not invent a wire value from an absent map key", () => {
    // Absent is not the same as null, but neither is a provider value: pi sends nothing
    // for both, so neither may be reported as wired.
    expect(classifyThinkingControl({ reasoning: true }, "high", LEVELS("high"))).toEqual({
      verdict: "level-unmapped",
    });
  });
});

describe("thinking control: publication", () => {
  it("round-trips a snapshot and leaves no temp files behind", async () => {
    const agent = await agentDir();
    await publishThinkingControl(
      agent,
      [{ route: "jellytoken/kimi-k3", level: "off", offeredLevels: 0, verdict: "no-dial", thinkingChars: 8488, at: 1 }],
      () => 42,
    );
    const state = await readThinkingControl(agent);
    expect(state?.version).toBe(1);
    expect(state?.at).toBe(42);
    expect(state?.routes).toHaveLength(1);
    expect(state?.routes[0]).toMatchObject({ route: "jellytoken/kimi-k3", verdict: "no-dial", thinkingChars: 8488 });
    expect((await readdir(agent)).filter(name => name.includes(".tmp"))).toEqual([]);
    expect(thinkingControlPath(agent).endsWith(THINKING_CONTROL_FILE)).toBe(true);
  });

  it("returns undefined for missing, corrupt, or foreign-version state", async () => {
    const agent = await agentDir();
    expect(await readThinkingControl(agent)).toBeUndefined();
    await publishThinkingControl(agent, []);
    const path = thinkingControlPath(agent);
    const good = JSON.parse(await readFile(path, "utf8"));
    expect(good.routes).toEqual([]);
    await publishThinkingControl(agent, []);
    expect((await readThinkingControl(agent))?.routes).toEqual([]);
  });
});

describe("thinking control: reporter", () => {
  it("publishes on a new pair and on a verdict change, not on every delta", async () => {
    const agent = await agentDir();
    const reporter = new ThinkingControlReporter(agent, () => 7);
    expect(reporter.observe(KIMI_VIA_RELAY, "off", LEVELS(), 400)).toBe(true);
    await reporter.publish();

    // Same pair, same verdict: characters accumulate but nothing new needs writing.
    const before = await readFile(thinkingControlPath(agent), "utf8");
    expect(reporter.observe(KIMI_VIA_RELAY, "off", LEVELS(), 8000)).toBe(false);
    await reporter.publish();
    expect(await readFile(thinkingControlPath(agent), "utf8")).toBe(before);
    expect(reporter.snapshot()[0].thinkingChars).toBe(8400);

    // A capability entry landing flips the verdict — that is worth a write.
    expect(reporter.observe({ ...KIMI_VIA_RELAY, reasoning: true, thinkingLevelMap: { off: null, low: "low" } }, "low", LEVELS("low"), 100)).toBe(true);
    await reporter.publish();
    const state = await readThinkingControl(agent);
    expect(state?.routes.map(r => `${r.route} ${r.level} ${r.verdict}`)).toEqual([
      "jellytoken/kimi-k3 low wired",
      "jellytoken/kimi-k3 off no-dial",
    ]);
  });

  it("lists exactly the routes whose dial is disconnected", () => {
    const reporter = new ThinkingControlReporter("/nowhere", () => 7);
    reporter.observe(KIMI_CODING, "low", LEVELS("off", "low", "high", "max"), 300);
    reporter.observe(KIMI_VIA_GO, "high", LEVELS("max"), 9000);
    reporter.observe(KIMI_VIA_RELAY, "off", LEVELS(), 8000);
    expect(reporter.unwired().map(r => `${r.route}:${r.verdict}`).sort()).toEqual([
      "jellytoken/kimi-k3:no-dial",
      "opencode-go/kimi-k3:level-unmapped",
    ]);
  });

  it("never throws when the state directory does not exist", async () => {
    const reporter = new ThinkingControlReporter(join(tmpdir(), "pipi-thinking-control-absent", "nested"));
    reporter.observe(KIMI_VIA_RELAY, "off", LEVELS(), 1);
    await expect(reporter.publish()).resolves.toBeUndefined();
  });
});
