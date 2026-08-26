import type { DirectOfficeAdapter, DirectOfficeResult, OfficeCommandInput } from "./adapter.js";
export type { OfficeCommandInput };

/** The one and only OfficeCLI tool name this extension registers. */
export const DIRECT_OFFICECLI_TOOL = "pipiui_officecli";

export const OFFICE_COMMAND_INPUT_SCHEMA = {
  type: "object",
  properties: {
    command: {
      anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
      description: "officecli argv or a quoted command string. Parsed without a shell.",
    },
  },
  required: ["command"],
  additionalProperties: false,
} as const;

export function officeCommandFixture(command: string | string[]): OfficeCommandInput {
  return { command };
}

/** Run a `{ command }` fixture through the direct adapter (tests and host library). */
export function createDirectOfficeTrack(adapter: DirectOfficeAdapter): {
  name: typeof DIRECT_OFFICECLI_TOOL;
  run: (fixture: OfficeCommandInput, signal?: AbortSignal) => Promise<DirectOfficeResult>;
} {
  return {
    name: DIRECT_OFFICECLI_TOOL,
    run: (fixture, signal) => adapter.execute(fixture, signal),
  };
}
