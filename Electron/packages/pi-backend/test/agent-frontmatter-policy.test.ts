import { describe, expect, it } from "vitest";

import { validateAgentDefinition } from "../../../resources/runtime/pi-ext/subagent/agents.ts";

function parseLegacy(frontmatter: string) {
  return validateAgentDefinition({
    filePath: "/tmp/steward-init.md",
    content: `---\n${frontmatter}\n---\nbody\n`,
    source: "project",
    origin: "project",
    format: "legacy",
  });
}

describe("legacy agent execution-policy frontmatter", () => {
  it("accepts COC steward policy fields without unknown-field diagnostics", () => {
    const result = parseLegacy([
      "name: steward-init",
      "description: COC L0",
      "tools: read, grep, find, bash, subagent, subagent_wait",
      "model: grok-4.5",
      "thinking: medium",
      "systemPromptMode: replace",
      "inheritProjectContext: false",
      "inheritSkills: false",
      "async: true",
      'turnBudget: {"maxTurns":10,"graceTurns":2}',
      "maxSubagentDepth: 2",
    ].join("\n"));
    expect(result.agent?.name).toBe("steward-init");
    expect(result.diagnostics.filter((entry) => entry.code === "unknown-field")).toEqual([]);
  });

  it("still reports a truly unknown legacy field", () => {
    const result = parseLegacy("name: custom\ndescription: x\nnotARealField: yes");
    expect(result.diagnostics.some((entry) => (
      entry.code === "unknown-field" && entry.message.includes("notARealField")
    ))).toBe(true);
  });
});
