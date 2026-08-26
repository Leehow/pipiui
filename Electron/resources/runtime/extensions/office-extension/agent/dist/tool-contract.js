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
};
export function officeCommandFixture(command) {
    return { command };
}
/** Run a `{ command }` fixture through the direct adapter (tests and host library). */
export function createDirectOfficeTrack(adapter) {
    return {
        name: DIRECT_OFFICECLI_TOOL,
        run: (fixture, signal) => adapter.execute(fixture, signal),
    };
}
