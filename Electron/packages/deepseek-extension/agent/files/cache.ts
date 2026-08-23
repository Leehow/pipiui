/**
 * In-memory file_id cache keyed by image content hash.
 * Session-scoped: never written to disk.
 */
export class FileIdCache {
  private readonly map = new Map<string, string>();

  get(hash: string): string | undefined {
    const key = hash.trim();
    if (!key) return undefined;
    return this.map.get(key);
  }

  set(hash: string, fileId: string): void {
    const key = hash.trim();
    const id = fileId.trim();
    if (!key || !id) return;
    this.map.set(key, id);
  }

  has(hash: string): boolean {
    return this.get(hash) !== undefined;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

let shared: FileIdCache | undefined;

/** Process-lifetime default cache (one Pi session child). Tests should inject their own. */
export function defaultFileIdCache(): FileIdCache {
  return (shared ??= new FileIdCache());
}

export function resetDefaultFileIdCache(): void {
  shared = new FileIdCache();
}
