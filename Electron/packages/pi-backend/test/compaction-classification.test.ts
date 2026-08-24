import { describe, expect, it } from "vitest";
import { classifyCompactionTrigger } from "../src/index.js";

/**
 * Pure classification unit tests; the end-to-end paths (fake pi lifecycle,
 * scheduler attribution, fold detection) live in compaction-backend.test.ts.
 */

describe("classifyCompactionTrigger", () => {
  it("attributes reason manual through the recorded host intent", () => {
    // The UI /compact and the idle scheduler issue the same compact RPC; only
    // the intent the host recorded before issuing it tells them apart.
    expect(classifyCompactionTrigger({ reason: "manual", intent: "manual" })).toBe("manual");
    expect(classifyCompactionTrigger({ reason: "manual", intent: "proactive_idle" })).toBe("proactive_idle");
    // No recorded intent (e.g. pi-internal /compact): default to manual.
    expect(classifyCompactionTrigger({ reason: "manual", busy: true })).toBe("manual");
  });

  it("maps overflow recovery directly", () => {
    expect(classifyCompactionTrigger({ reason: "overflow", busy: false })).toBe("overflow");
    expect(classifyCompactionTrigger({ reason: "overflow", busy: true })).toBe("overflow");
  });

  it("splits threshold by whether a turn is streaming", () => {
    expect(classifyCompactionTrigger({ reason: "threshold", busy: true })).toBe("mid_turn");
    expect(classifyCompactionTrigger({ reason: "threshold", busy: false })).toBe("near_overflow");
  });

  it("leaves unknown or missing reasons unclassified for the renderer's 自动压缩 fallback", () => {
    expect(classifyCompactionTrigger({ reason: "something-new", busy: false })).toBeUndefined();
    expect(classifyCompactionTrigger({ busy: false })).toBeUndefined();
    expect(classifyCompactionTrigger({})).toBeUndefined();
  });
});
