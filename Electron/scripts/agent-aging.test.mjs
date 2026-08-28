import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_AGING_CHECKPOINTS,
  parseAgentAgingArgs,
} from "./agent-aging.mjs";

describe("agent-aging benchmark CLI", () => {
  it("defaults npm runs to the full checkpoint matrix", () => {
    expect(parseAgentAgingArgs([])).toEqual({
      checkpoints: DEFAULT_AGENT_AGING_CHECKPOINTS,
      help: false,
    });
    expect(parseAgentAgingArgs(["--full"])).toEqual({
      checkpoints: "1,10,100,1000",
      help: false,
    });
  });

  it("accepts turns and checkpoints in separate and equals forms", () => {
    expect(parseAgentAgingArgs(["--turns", "1,10"])).toEqual({ checkpoints: "1,10", help: false });
    expect(parseAgentAgingArgs(["--turns=1,10"])).toEqual({ checkpoints: "1,10", help: false });
    expect(parseAgentAgingArgs(["--checkpoints", "1,100"])).toEqual({ checkpoints: "1,100", help: false });
    expect(parseAgentAgingArgs(["--checkpoints=10,1000"])).toEqual({ checkpoints: "10,1000", help: false });
    expect(parseAgentAgingArgs(["-c", "10"])).toEqual({ checkpoints: "10", help: false });
  });

  it("rejects missing values and unknown options without starting a run", () => {
    expect(() => parseAgentAgingArgs(["--turns"])).toThrow(/requires a comma-separated list/);
    expect(() => parseAgentAgingArgs(["--checkpoints="])).toThrow(/requires a comma-separated list/);
    expect(() => parseAgentAgingArgs(["--no-network"])).toThrow(/unknown Agent Aging option/);
    expect(parseAgentAgingArgs(["--help"])).toEqual({
      checkpoints: DEFAULT_AGENT_AGING_CHECKPOINTS,
      help: true,
    });
  });
});
