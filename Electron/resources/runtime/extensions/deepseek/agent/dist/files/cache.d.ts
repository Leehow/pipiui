/**
 * In-memory file_id cache keyed by image content hash.
 * Session-scoped: never written to disk.
 */
export declare class FileIdCache {
    private readonly map;
    get(hash: string): string | undefined;
    set(hash: string, fileId: string): void;
    has(hash: string): boolean;
    get size(): number;
    clear(): void;
}
/** Process-lifetime default cache (one Pi session child). Tests should inject their own. */
export declare function defaultFileIdCache(): FileIdCache;
export declare function resetDefaultFileIdCache(): void;
