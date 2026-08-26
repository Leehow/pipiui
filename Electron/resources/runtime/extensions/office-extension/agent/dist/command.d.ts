export declare const READ_VERBS: readonly string[];
export declare const WRITE_VERBS: readonly string[];
export declare const CREATE_VERBS: readonly string[];
export declare const PATHLESS_VERBS: readonly string[];
export type GateKind = "write" | "screenshot" | "create" | "other";
export type PathSpec = {
    raw: string;
    mustExist: boolean;
    requireOfficeExtension: boolean;
};
export type ParsedOfficeCommand = {
    verb: string;
    argv: string[];
    positionals: string[];
    flags: Map<string, string | true>;
    pathSpecs: PathSpec[];
    rawTargets: string[];
    isCreate: boolean;
    isWrite: boolean;
    isQualifyingScreenshot: boolean;
    asJson: boolean;
};
export type CommandErrorCode = "invalid_command" | "unknown_verb" | "control_chars";
export declare class CommandParseError extends Error {
    readonly code: CommandErrorCode;
    constructor(code: CommandErrorCode, message: string);
}
export declare function hasForbiddenChars(value: string): boolean;
/** Strict string lexer: no shell, fail closed on unterminated quotes or dangling escapes. */
export declare function tokenizeString(command: string): string[];
export declare function tokenizeCommand(command: string | string[]): string[];
export declare function stripOfficecliPrefix(tokens: string[]): string[];
export declare function looksLikePathToken(token: string): boolean;
/**
 * Exact parity with `parseOfficecliCommand` in office-doc-shot-gate.ts:
 * `view <file> screenshot --grid auto` qualifies; `--page` / `--range` do not.
 */
export declare function isQualifyingScreenshot(verb: string, positionals: string[], flags: Map<string, string | true>): boolean;
export declare function parseOfficeCommand(command: string | string[]): ParsedOfficeCommand;
export declare function gateKind(parsed: ParsedOfficeCommand): GateKind;
