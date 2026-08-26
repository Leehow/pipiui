import { createDirectOfficeAdapter } from "./adapter.js";
import { packageRoot } from "./binary.js";
import { DIRECT_OFFICECLI_TOOL, OFFICE_COMMAND_INPUT_SCHEMA, } from "./tool-contract.js";
import { ensureOfficeCliUpdateDisabled } from "./sdk.js";
export const OFFICE_EXTENSION_ID = "office-extension";
export function createOfficeAdapter(overrides) {
    return createDirectOfficeAdapter({
        projectRoot: process.env.PIPIUI_MAIN_CWD || process.cwd(),
        extensionRoot: packageRoot(),
        ...overrides,
    });
}
export function registerOfficeDirectTool(pi, adapter) {
    pi.registerTool({
        name: DIRECT_OFFICECLI_TOOL,
        label: "OfficeCLI",
        description: "Direct OfficeCLI tool (the only Office tool). Runs officecli argv through @officecli/sdk and a resident native process. No MCP server, no bash, no credentials. Input: { command: string | string[] }.",
        parameters: OFFICE_COMMAND_INPUT_SCHEMA,
        async execute(_toolCallId, params, signal) {
            const command = params?.command;
            const result = await adapter.execute({ command: command }, signal);
            const text = JSON.stringify(result);
            return {
                content: [{ type: "text", text }],
                details: result,
            };
        },
    });
}
export default function officeExtension(pi) {
    ensureOfficeCliUpdateDisabled();
    registerOfficeDirectTool(pi, createOfficeAdapter());
}
