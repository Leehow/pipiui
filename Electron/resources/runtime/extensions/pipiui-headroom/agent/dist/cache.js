export class PreparedCache {
    #entries = new Map();
    #retrievals = new Map();
    #maxBytes;
    #bytes = 0;
    constructor(maxBytes) {
        if (!Number.isInteger(maxBytes) || maxBytes <= 0)
            throw new Error("maxBytes must be a positive integer");
        this.#maxBytes = maxBytes;
    }
    get(key) {
        const entry = this.#entries.get(key);
        if (!entry)
            return undefined;
        entry.lastAccessedAt = Date.now();
        this.#entries.delete(key);
        this.#entries.set(key, entry);
        return entry;
    }
    getRetrieval(hash) {
        const binding = this.#retrievals.get(hash);
        if (!binding)
            return undefined;
        const owner = binding.owners.values().next().value;
        if (typeof owner === "string")
            this.get(owner);
        return binding.text;
    }
    set(entry) {
        if (entry.sizeBytes <= 0 || entry.sizeBytes > this.#maxBytes)
            return false;
        for (const [hash, text] of entry.retrievals) {
            const existing = this.#retrievals.get(hash);
            const replacingOnlyOwner = existing?.owners.size === 1 && existing.owners.has(entry.key);
            if (existing && existing.text !== text && !replacingOnlyOwner)
                return false;
        }
        this.#delete(entry.key);
        while (this.#bytes + entry.sizeBytes > this.#maxBytes && this.#entries.size > 0) {
            const oldest = this.#entries.keys().next().value;
            if (typeof oldest !== "string")
                break;
            this.#delete(oldest);
        }
        this.#entries.set(entry.key, entry);
        this.#bytes += entry.sizeBytes;
        for (const [hash, text] of entry.retrievals) {
            const existing = this.#retrievals.get(hash);
            if (existing)
                existing.owners.add(entry.key);
            else
                this.#retrievals.set(hash, { text, owners: new Set([entry.key]) });
        }
        return true;
    }
    clear() {
        this.#entries.clear();
        this.#retrievals.clear();
        this.#bytes = 0;
    }
    stats() {
        return { entries: this.#entries.size, bytes: this.#bytes, maxBytes: this.#maxBytes };
    }
    #delete(key) {
        const entry = this.#entries.get(key);
        if (!entry)
            return;
        this.#entries.delete(key);
        this.#bytes -= entry.sizeBytes;
        for (const hash of entry.retrievals.keys()) {
            const binding = this.#retrievals.get(hash);
            if (!binding)
                continue;
            binding.owners.delete(key);
            if (binding.owners.size === 0)
                this.#retrievals.delete(hash);
        }
    }
}
