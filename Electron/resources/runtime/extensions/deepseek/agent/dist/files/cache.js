/**
 * In-memory file_id cache keyed by image content hash.
 * Session-scoped: never written to disk.
 */
export class FileIdCache {
    map = new Map();
    get(hash) {
        const key = hash.trim();
        if (!key)
            return undefined;
        return this.map.get(key);
    }
    set(hash, fileId) {
        const key = hash.trim();
        const id = fileId.trim();
        if (!key || !id)
            return;
        this.map.set(key, id);
    }
    has(hash) {
        return this.get(hash) !== undefined;
    }
    get size() {
        return this.map.size;
    }
    clear() {
        this.map.clear();
    }
}
let shared;
/** Process-lifetime default cache (one Pi session child). Tests should inject their own. */
export function defaultFileIdCache() {
    return (shared ??= new FileIdCache());
}
export function resetDefaultFileIdCache() {
    shared = new FileIdCache();
}
