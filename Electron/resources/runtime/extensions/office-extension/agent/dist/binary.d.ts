export declare const PIPIUI_OFFICECLI_BINARY_ENV = "PIPIUI_OFFICECLI_BINARY";
export declare const OFFICECLI_RECEIPT_NAME = "receipt.json";
export type OfficeCliReceipt = {
    version: string;
    asset: string;
    sha256: string;
    target: string;
    bytes: number;
    generatedAt?: string;
};
export type BinaryLocator = () => string | null | undefined;
export type ResolveBinaryOptions = {
    extensionRoot?: string;
    packaged?: boolean;
    locateBinary?: BinaryLocator;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    arch?: string;
};
export declare function packageRoot(from?: string): string;
export declare function bundledOfficeCliCandidate(options: {
    extensionRoot: string;
    platform?: NodeJS.Platform;
    arch?: string;
}): string;
/** Machine-readable receipt beside the binary. Never treat it as the executable. */
export declare function readOfficeCliReceipt(binaryPath: string): OfficeCliReceipt | null;
/**
 * Resolve the OfficeCLI native binary.
 * Order: injected locator → bundled bin/<platform>-<arch>/officecli →
 * dev-only PIPIUI_OFFICECLI_BINARY when not packaged.
 * Never PATH, never ~/.local/bin, never network, never MCP config.
 */
export declare function resolveOfficeCliBinary(options?: ResolveBinaryOptions): string | null;
