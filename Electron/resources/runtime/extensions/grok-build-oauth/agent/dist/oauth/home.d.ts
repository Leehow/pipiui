export declare class NoAgentHomeError extends Error {
    constructor();
}
/** Resolved home dir, or undefined when neither variable is set. */
export declare function tryResolveAgentHome(): string | undefined;
/** Resolved home dir; throws NoAgentHomeError (fail closed) when unset. */
export declare function resolveAgentHome(): string;
/** `auth.json` path inside the resolved home. */
export declare function authJsonPath(home?: string): string;
/** Attachments root inside the resolved home (image isolation root). */
export declare function attachmentsRoot(home?: string): string;
