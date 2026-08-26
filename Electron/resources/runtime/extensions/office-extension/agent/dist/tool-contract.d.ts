import type { DirectOfficeAdapter, DirectOfficeResult, OfficeCommandInput } from "./adapter.js";
export type { OfficeCommandInput };
/** The one and only OfficeCLI tool name this extension registers. */
export declare const DIRECT_OFFICECLI_TOOL = "pipiui_officecli";
export declare const OFFICE_COMMAND_INPUT_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly command: {
            readonly anyOf: readonly [{
                readonly type: "string";
            }, {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
            }];
            readonly description: "officecli argv or a quoted command string. Parsed without a shell.";
        };
    };
    readonly required: readonly ["command"];
    readonly additionalProperties: false;
};
export declare function officeCommandFixture(command: string | string[]): OfficeCommandInput;
/** Run a `{ command }` fixture through the direct adapter (tests and host library). */
export declare function createDirectOfficeTrack(adapter: DirectOfficeAdapter): {
    name: typeof DIRECT_OFFICECLI_TOOL;
    run: (fixture: OfficeCommandInput, signal?: AbortSignal) => Promise<DirectOfficeResult>;
};
