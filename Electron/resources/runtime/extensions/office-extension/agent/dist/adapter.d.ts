import { type BinaryLocator } from "./binary.js";
import { type GateKind } from "./command.js";
import { type OfficeFormatPolicy } from "./edit-policy.js";
import { OFFICECLI_WRITE_ATOMICITY } from "./provenance.js";
import { type OfficeCliSdk } from "./sdk.js";
export declare const DEFAULT_STARTUP_TIMEOUT_MS = 15000;
export declare const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
export declare const DEFAULT_OUTPUT_LIMIT: number;
export declare const DEFAULT_DIAGNOSTIC_LIMIT: number;
export type OfficeCommandInput = {
    command: string | string[];
};
export type DirectOfficeErrorCode = "ok" | "invalid_command" | "unknown_verb" | "control_chars" | "path_rejected" | "unsupported_extension" | "read_only_format" | "binary_missing" | "timeout" | "cancelled" | "crashed" | "sdk_error" | "command_failed" | "disposed";
export type GateMetadata = {
    kind: GateKind;
    targetPaths: string[];
    isCreate: boolean;
    isWrite: boolean;
    isQualifyingScreenshot: boolean;
    policies: Array<Pick<OfficeFormatPolicy, "extension" | "tier" | "editContract" | "macroContainer" | "shotGateCovered" | "writesAllowed">>;
};
export type WriteSemantics = {
    flush: typeof OFFICECLI_WRITE_ATOMICITY.flush;
    atomicRename: false;
    limitation: typeof OFFICECLI_WRITE_ATOMICITY.limitation;
    persisted?: boolean;
};
export type DirectOfficeResult = {
    ok: boolean;
    code: DirectOfficeErrorCode;
    message: string;
    argv: string[];
    stdout: string;
    stderr: string;
    truncated: {
        stdout: boolean;
        stderr: boolean;
        diagnostics: boolean;
    };
    gate: GateMetadata;
    writeSemantics?: WriteSemantics;
    pathReason?: string;
    diagnostics: string;
};
export type DirectOfficeAdapterOptions = {
    projectRoot: string;
    extensionRoot?: string;
    packaged?: boolean;
    locateBinary?: BinaryLocator;
    sdk?: OfficeCliSdk;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    arch?: string;
    startupTimeoutMs?: number;
    commandTimeoutMs?: number;
    outputLimit?: number;
    diagnosticLimit?: number;
};
export declare class DirectOfficeAdapter {
    private readonly projectRoot;
    private readonly options;
    private readonly sdk;
    private readonly outputLimit;
    private readonly diagnosticLimit;
    private readonly startupTimeoutMs;
    private readonly commandTimeoutMs;
    private readonly docs;
    private readonly queues;
    private crashed;
    private disposed;
    private disposing;
    private processGeneration;
    constructor(options: DirectOfficeAdapterOptions);
    get residentGenerations(): number;
    execute(input: OfficeCommandInput, signal?: AbortSignal): Promise<DirectOfficeResult>;
    dispose(): Promise<void>;
    private fail;
    private enqueue;
    /** Never await an unbounded SDK close on the response path. */
    private discardHandle;
    private runSdk;
    private recheckWrites;
    private ensureDocument;
}
export declare function createDirectOfficeAdapter(options: DirectOfficeAdapterOptions): DirectOfficeAdapter;
