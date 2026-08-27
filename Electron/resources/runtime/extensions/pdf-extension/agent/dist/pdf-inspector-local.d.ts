export declare const PDF_INSPECTOR_VERSION = "1.15.0";
/**
 * Directory (relative to this compiled file) of the vendored dependency tree
 * owned by this package. `<pkg>/agent/dist` -> `<pkg>/vendor/pdf-inspector`;
 * inside the runtime mirror the depth is identical
 * (`extensions/pdf-extension/agent/dist` -> `extensions/pdf-extension/vendor/pdf-inspector`).
 */
export declare function ownedPdfInspectorNodeModules(fromUrl?: string): string;
export type LocalInspectEngine = "native" | "wasm";
export type LocalInspectResult = {
    engine: LocalInspectEngine;
    pdfType: string;
    markdown: string;
    pageCount: number;
    pagesNeedingOcr: number[];
    confidence?: number;
};
/**
 * Resolve the node_modules root that carries `@firecrawl/pdf-inspector`.
 *
 * This package owns its dependency tree: self-relative resolution only, with no host
 * path contract. A missing engine surfaces as a normal tool error instead of silently
 * loading a different tree.
 */
export declare function pdfInspectorNodeModules(fromUrl?: string): string;
/** Optional native vendor; win32-x64-msvc is in the lockfile but not committed. */
export declare function pdfInspectorNativePackageName(platform: NodeJS.Platform, arch: string): string | undefined;
export declare function pdfInspectorEngineAvailability(nodeModules: string, platform?: NodeJS.Platform, arch?: string): {
    native: boolean;
    wasm: boolean;
    nativePackage?: string;
};
export declare function normalizeInspectorResult(raw: unknown, engine: LocalInspectEngine): LocalInspectResult;
export declare function isScanLike(result: LocalInspectResult): boolean;
export declare function indicatesOcr(result: LocalInspectResult): boolean;
export declare function inspectPdfWithOfficial(bytes: Uint8Array, options?: {
    maxPages?: number;
    nodeModules?: string;
    platform?: NodeJS.Platform;
    arch?: string;
}): Promise<LocalInspectResult>;
