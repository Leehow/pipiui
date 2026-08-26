import type { PreparedEntry } from "./types.js";
export declare class PreparedCache {
    #private;
    constructor(maxBytes: number);
    get(key: string): PreparedEntry | undefined;
    getRetrieval(hash: string): string | undefined;
    set(entry: PreparedEntry): boolean;
    clear(): void;
    stats(): {
        entries: number;
        bytes: number;
        maxBytes: number;
    };
}
