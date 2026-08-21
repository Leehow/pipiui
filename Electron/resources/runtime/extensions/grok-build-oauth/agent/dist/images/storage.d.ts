export declare function resolveImagesRoot(): string;
export declare class SessionImageWriter {
    private readonly root;
    constructor(root?: string);
    get rootDir(): string;
    /** Next 1-based counter, resumed from existing `<n>.jpg` files. */
    private nextIndex;
    /**
     * Atomically save image bytes as the next numbered `<n>.jpg`.
     * Returns the absolute path and the sniffed mime type.
     */
    save(bytes: Uint8Array, opts?: {
        signal?: AbortSignal;
    }): Promise<{
        path: string;
        mime: string;
    }>;
    /** For tests */
    _exists(path: string): Promise<boolean>;
}
