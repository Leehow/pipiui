import { createHash } from "node:crypto";
import { HEADROOM_POLICY_VERSION } from "./types.js";
const CCR_PREFIX_RE = /Retrieve (?:more|original): hash=|<<ccr:/gi;
const CCR_HASH_RE = /(?:Retrieve (?:more|original): hash=|<<ccr:)([a-f0-9]{12,24})(?=$|[\s,>\].])/gi;
const MODEL_FACING_CCR_RE = /Retrieve (?:more|original): hash=[a-f0-9]{12,24}|<<ccr:[a-f0-9]{12,24}(?:[^>\n]*)?>>/gi;
export const HEADROOM_EXACT_RETRIEVAL_NOTICE = "[Full original tool result available. Call headroom_retrieve with no arguments to retrieve it exactly.]";
function nonnegativeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
export function buildCompressPayload(candidate, modelId) {
    const callId = `call_${candidate.key.slice(0, 12)}`;
    return {
        model: modelId,
        messages: [
            { role: "assistant", tool_calls: [{ id: callId, type: "function", function: { name: candidate.toolName, arguments: "{}" } }] },
            { role: "tool", tool_call_id: callId, content: candidate.originalText },
        ],
        config: { compress_user_messages: false, mode: "ccr" },
    };
}
function discoverHashes(text) {
    const prefixCount = text.match(CCR_PREFIX_RE)?.length ?? 0;
    const hashes = [...text.matchAll(CCR_HASH_RE)].flatMap(match => match[1] ? [match[1].toLowerCase()] : []);
    return hashes.length === prefixCount ? hashes : undefined;
}
function hashesFromMarkers(markers) {
    const hashes = [];
    for (const marker of markers) {
        if (/^[a-f0-9]{12,24}$/i.test(marker)) {
            hashes.push(marker.toLowerCase());
            continue;
        }
        for (const match of marker.matchAll(CCR_HASH_RE))
            if (match[1])
                hashes.push(match[1].toLowerCase());
    }
    return hashes;
}
function hideInternalCcrIds(text) {
    return text.replace(MODEL_FACING_CCR_RE, "Exact source available through headroom_retrieve");
}
function retrievalResolvesIntoSource(hash, retrievals, originalText, visiting = new Set(), memo = new Map()) {
    const cached = memo.get(hash);
    if (cached !== undefined)
        return cached;
    if (visiting.has(hash))
        return false;
    const retrieved = retrievals.get(hash);
    if (retrieved === undefined)
        return false;
    if (originalText.includes(retrieved)) {
        memo.set(hash, true);
        return true;
    }
    // Headroom can emit nested CCR: one marker retrieves an intermediate
    // compressed layer whose marker then retrieves exact source text. Accept
    // that real upstream shape only when every nested edge stays inside this
    // response and the graph terminates in the candidate source.
    const nestedHashes = discoverHashes(retrieved);
    if (!nestedHashes || nestedHashes.length === 0) {
        memo.set(hash, false);
        return false;
    }
    const nextVisiting = new Set(visiting).add(hash);
    const valid = nestedHashes.every(nestedHash => retrievals.has(nestedHash) && retrievalResolvesIntoSource(nestedHash, retrievals, originalText, nextVisiting, memo));
    memo.set(hash, valid);
    return valid;
}
function parseCompression(value, candidate) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return undefined;
    const body = value;
    if (!Array.isArray(body.messages) || body.messages.length !== 2)
        return undefined;
    const assistant = body.messages[0];
    const tool = body.messages[1];
    const callId = `call_${candidate.key.slice(0, 12)}`;
    const calls = assistant && Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    const call = calls[0];
    const fn = call && typeof call.function === "object" && call.function !== null ? call.function : undefined;
    if (assistant?.role !== "assistant" || calls.length !== 1 || call?.id !== callId || call?.type !== "function" ||
        fn?.name !== candidate.toolName || fn?.arguments !== "{}" || tool?.role !== "tool" ||
        tool.tool_call_id !== callId || typeof tool.content !== "string")
        return undefined;
    if (!nonnegativeNumber(body.tokens_before) || !nonnegativeNumber(body.tokens_after) ||
        !nonnegativeNumber(body.tokens_saved) || !nonnegativeNumber(body.compression_ratio) ||
        !Array.isArray(body.ccr_hashes) || !body.ccr_hashes.every(hash => typeof hash === "string" && hash.length > 0))
        return undefined;
    const markerHashes = discoverHashes(tool.content);
    if (!markerHashes)
        return undefined;
    return {
        compressedText: tool.content,
        ccrHashes: [...new Set([...hashesFromMarkers(body.ccr_hashes), ...markerHashes])],
        tokensBefore: body.tokens_before,
        tokensAfter: body.tokens_after,
        tokensSaved: body.tokens_saved,
        compressionRatio: body.compression_ratio,
    };
}
export async function validateCompression(candidate, response, retrieve) {
    const parsed = parseCompression(response, candidate);
    if (!parsed)
        return { status: "rejected", reason: "invalid_response" };
    if (parsed.tokensSaved === 0 && parsed.compressedText === candidate.originalText)
        return { status: "skipped", reason: "noop" };
    if (!parsed.compressedText)
        return { status: "rejected", reason: "empty_output" };
    if (Buffer.byteLength(parsed.compressedText) >= Buffer.byteLength(candidate.originalText))
        return { status: "rejected", reason: "grew" };
    if (parsed.tokensBefore === 0)
        return { status: "rejected", reason: "zero_tokens" };
    if (parsed.tokensSaved < 256)
        return { status: "rejected", reason: "insufficient_savings" };
    if (parsed.tokensAfter / parsed.tokensBefore > 0.9 || parsed.compressionRatio > 0.9)
        return { status: "rejected", reason: "ratio_too_high" };
    if (parsed.ccrHashes.some(hash => !parsed.compressedText.includes(hash)))
        return { status: "rejected", reason: "hash_missing" };
    const retrievals = new Map();
    const originalBytes = Buffer.byteLength(candidate.originalText);
    let sizeBytes = originalBytes;
    for (const hash of parsed.ccrHashes) {
        let original;
        try {
            original = await retrieve(hash);
        }
        catch {
            return { status: "rejected", reason: "retrieval_failed" };
        }
        if (!original)
            return { status: "rejected", reason: "retrieval_miss" };
        retrievals.set(hash, original);
        sizeBytes += Buffer.byteLength(original);
    }
    if (parsed.ccrHashes.some(hash => !retrievalResolvesIntoSource(hash, retrievals, candidate.originalText))) {
        return { status: "rejected", reason: "retrieval_mismatch" };
    }
    // Upstream CCR hashes remain an internal validation detail. PipiUI exposes a
    // no-argument retrieval tool and resolves it against the substituted entry,
    // so the model never needs to read, copy, or emit opaque identifiers.
    const originalSha256 = createHash("sha256").update(candidate.originalText).digest("hex");
    const compressedText = `${hideInternalCcrIds(parsed.compressedText)}\n${HEADROOM_EXACT_RETRIEVAL_NOTICE}`;
    const compressedBytes = Buffer.byteLength(compressedText);
    if (compressedBytes >= originalBytes)
        return { status: "rejected", reason: "grew" };
    sizeBytes += compressedBytes;
    const now = Date.now();
    return {
        ...candidate,
        compressedText,
        ccrHashes: parsed.ccrHashes,
        retrievals,
        tokensBefore: parsed.tokensBefore,
        tokensAfter: parsed.tokensAfter,
        tokensSaved: parsed.tokensSaved,
        originalBytes,
        compressedBytes,
        sizeBytes,
        originalSha256,
        policyVersion: HEADROOM_POLICY_VERSION,
        createdAt: now,
        lastAccessedAt: now,
    };
}
export class HeadroomClient {
    #baseUrl;
    #healthTimeoutMs;
    #requestTimeoutMs;
    #fetch;
    constructor(options) {
        this.#baseUrl = options.baseUrl.replace(/\/$/, "");
        this.#healthTimeoutMs = options.healthTimeoutMs;
        this.#requestTimeoutMs = options.requestTimeoutMs;
        this.#fetch = options.fetchImpl ?? fetch;
    }
    async health(signal) {
        const timeout = AbortSignal.timeout(this.#healthTimeoutMs);
        const response = await this.#fetch(`${this.#baseUrl}/readyz`, {
            method: "GET",
            redirect: "error",
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        return response.ok;
    }
    async compress(candidate, modelId, signal) {
        const timeout = AbortSignal.timeout(this.#requestTimeoutMs);
        const response = await this.#fetch(`${this.#baseUrl}/v1/compress`, {
            method: "POST",
            redirect: "error",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(buildCompressPayload(candidate, modelId)),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok)
            throw new Error(`Headroom compression failed with HTTP ${response.status}`);
        try {
            return await response.json();
        }
        catch {
            throw new Error("Headroom compression returned malformed JSON");
        }
    }
    async retrieve(hash, signal) {
        const timeout = AbortSignal.timeout(this.#requestTimeoutMs);
        const response = await this.#fetch(`${this.#baseUrl}/v1/retrieve`, {
            method: "POST",
            redirect: "error",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hash }),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (response.status === 404)
            return undefined;
        if (!response.ok)
            throw new Error(`Headroom retrieval failed with HTTP ${response.status}`);
        let body;
        try {
            body = await response.json();
        }
        catch {
            throw new Error("Headroom retrieval returned malformed JSON");
        }
        if (typeof body !== "object" || body === null || Array.isArray(body) ||
            body.hash !== hash || typeof body.original_content !== "string") {
            throw new Error("Headroom retrieval returned an invalid response");
        }
        return body.original_content;
    }
}
