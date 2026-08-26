import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createDirectOfficeAdapter, type DirectOfficeAdapter, type DirectOfficeAdapterOptions } from "./adapter.js";
import { packageRoot } from "./binary.js";
import {
  DIRECT_OFFICECLI_TOOL,
  OFFICE_COMMAND_INPUT_SCHEMA,
  type OfficeCommandInput,
} from "./tool-contract.js";
import { ensureOfficeCliUpdateDisabled } from "./sdk.js";

export const OFFICE_EXTENSION_ID = "office-extension";

export function createOfficeAdapter(overrides?: Partial<DirectOfficeAdapterOptions>): DirectOfficeAdapter {
  return createDirectOfficeAdapter({
    projectRoot: process.env.PIPIUI_MAIN_CWD || process.cwd(),
    extensionRoot: packageRoot(),
    ...overrides,
  });
}

export function registerOfficeDirectTool(pi: Pick<ExtensionAPI, "registerTool">, adapter: DirectOfficeAdapter): void {
  pi.registerTool({
    name: DIRECT_OFFICECLI_TOOL,
    label: "OfficeCLI",
    description:
      "Direct OfficeCLI tool (the only Office tool). Runs officecli argv through @officecli/sdk and a resident native process. No MCP server, no bash, no credentials. Input: { command: string | string[] }.",
    parameters: OFFICE_COMMAND_INPUT_SCHEMA,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const command = (params as OfficeCommandInput | undefined)?.command;
      const result = await adapter.execute({ command: command as string | string[] }, signal);
      const text = JSON.stringify(result);
      return {
        content: [{ type: "text" as const, text }],
        details: result,
      };
    },
  });
}

export default function officeExtension(pi: ExtensionAPI): void {
  ensureOfficeCliUpdateDisabled();
  registerOfficeDirectTool(pi, createOfficeAdapter());
}
