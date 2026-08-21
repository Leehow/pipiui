import type { GrokCredentialBroker } from "./broker.js";
export type GlobalGrokAuthShape = {
    access: string;
    refresh?: string;
    expiresAtMs: number;
    issuer?: string;
    clientId?: string;
};
export type ImportResult = {
    imported: boolean;
    reason?: string;
    expiresAtMs?: number;
    issuer?: string;
};
export declare function globalGrokAuthPath(homedirOverride?: string): string;
/**
 * Read and validate `~/.grok/auth.json` once. Returns the mapped credential
 * fields or a refusal reason. Never touches the source file.
 */
export declare function readGlobalGrokAuth(opts: {
    homedirOverride?: string;
    sourcePath?: string;
    nowMs?: () => number;
}): Promise<{
    ok: true;
    credential: GlobalGrokAuthShape;
} | {
    ok: false;
    reason: string;
}>;
/**
 * Full import flow: confirm -> read once -> validate -> broker-controlled
 * persist. The source file is never modified.
 */
export declare function importFromGlobalGrok(opts: {
    confirm: boolean;
    broker: GrokCredentialBroker;
    homedirOverride?: string;
    sourcePath?: string;
    nowMs?: () => number;
}): Promise<ImportResult>;
/**
 * Parse slash-command args into an explicit confirmation. Pi delivers command
 * args as a raw string; `--confirm` / `confirm=true` / `confirm` all confirm.
 */
export declare function parseImportConfirm(args: unknown): {
    confirm: boolean;
};
