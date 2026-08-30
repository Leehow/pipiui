/**
 * Grok / xAI Responses hosted-search protocol.
 *
 * Upstream Agent Tools on `/v1/responses` accept raw hosted entries
 * `{ type: "web_search" }` and `{ type: "x_search" }`. Domain policy maps
 * onto official `filters.allowed_domains` / `filters.excluded_domains`
 * (max 5 each) and applies only when native `web_search` is declared.
 *
 * This module is the testable seam. Live injection lives in the generalized
 * `pipiui-xai-server-tools` hook so we do not fork the request rewrite.
 */
export const NATIVE_SEARCH_TOOLS = ["web_search", "x_search"];
export const GROK_BUILD_NATIVE_SEARCH = {
    tools: ["web_search", "x_search"],
};
/**
 * Local tools whose job is taken over by the hosted built-in: the PipiUI
 * generic web search plus the browser-search route. Mirrors host-api's
 * `NATIVE_SEARCH_EXCLUDED_LOCAL_TOOLS`; enforced here so a stale spawn's tool
 * list can never leak the local tools to the wire.
 */
const LOCAL_SEARCH_FUNCTION_TOOL_NAMES = new Set([
    "web_search",
    "browser_search",
    "browser_fetch",
]);
/** Official Responses cap for web_search domain lists. */
export const WEB_SEARCH_DOMAIN_LIMIT = 5;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uniqueTrimmed(list, limit) {
    if (!list)
        return undefined;
    const next = [...new Set(list.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
    return next.length ? next : undefined;
}
export function nativeSearchFromUnknown(value) {
    if (Array.isArray(value)) {
        const tools = value.filter((item) => item === "web_search" || item === "x_search");
        const unique = [...new Set(tools)];
        return unique.length ? { tools: unique } : undefined;
    }
    if (!isRecord(value))
        return undefined;
    const rawTools = Array.isArray(value.tools) ? value.tools : undefined;
    if (!rawTools)
        return undefined;
    const tools = rawTools.filter((item) => item === "web_search" || item === "x_search");
    const unique = [...new Set(tools)];
    if (!unique.length)
        return undefined;
    const capability = { tools: unique };
    if (isRecord(value.domains)) {
        const allow = uniqueTrimmed(Array.isArray(value.domains.allow)
            ? value.domains.allow.filter((item) => typeof item === "string")
            : undefined, WEB_SEARCH_DOMAIN_LIMIT);
        const deny = uniqueTrimmed(Array.isArray(value.domains.deny)
            ? value.domains.deny.filter((item) => typeof item === "string")
            : undefined, WEB_SEARCH_DOMAIN_LIMIT);
        if (allow || deny)
            capability.domains = { ...(allow ? { allow } : {}), ...(deny ? { deny } : {}) };
    }
    return capability;
}
export function nativeSearchOfModel(model) {
    if (!isRecord(model?.capabilities))
        return undefined;
    return nativeSearchFromUnknown(model.capabilities.nativeSearch)
        ?? nativeSearchFromUnknown(model.capabilities.hostedTools);
}
export function hidesGenericWebSearch(capability) {
    return capability?.tools.includes("web_search") === true;
}
export function hostedWebSearchTool(domains) {
    const allow = uniqueTrimmed(domains?.allow ? [...domains.allow] : undefined, WEB_SEARCH_DOMAIN_LIMIT);
    const deny = uniqueTrimmed(domains?.deny ? [...domains.deny] : undefined, WEB_SEARCH_DOMAIN_LIMIT);
    if (!allow && !deny)
        return { type: "web_search" };
    return {
        type: "web_search",
        filters: {
            ...(allow ? { allowed_domains: allow } : {}),
            ...(deny ? { excluded_domains: deny } : {}),
        },
    };
}
export function hostedSearchToolsOf(capability) {
    if (!capability)
        return [];
    const tools = [];
    if (capability.tools.includes("web_search")) {
        tools.push(hostedWebSearchTool(capability.domains));
    }
    if (capability.tools.includes("x_search")) {
        tools.push({ type: "x_search" });
    }
    return tools;
}
/**
 * True only for function tools whose exact name is a local search tool, in
 * either Responses shape (`{type:"function", name}`) or Chat Completions
 * shape (`{type:"function", function:{name}}`). Hosted built-ins and other
 * typed tools (e.g. `{type:"custom", name:"web_search"}`) are never matched,
 * and merely similar names (e.g. `web_search_preview`) never match either.
 */
function isLocalSearchFunctionTool(tool) {
    if (!isRecord(tool) || tool.type !== "function")
        return false;
    if (typeof tool.name === "string")
        return LOCAL_SEARCH_FUNCTION_TOOL_NAMES.has(tool.name);
    if (isRecord(tool.function)) {
        const { name } = tool.function;
        return typeof name === "string" && LOCAL_SEARCH_FUNCTION_TOOL_NAMES.has(name);
    }
    return false;
}
function isHostedTool(tool, type) {
    return tool.type === type && tool.function === undefined && (typeof tool.name !== "string" || tool.name === type);
}
export function mergeHostedSearchTools(existing, capability) {
    const current = Array.isArray(existing) ? [...existing] : [];
    const hosted = hostedSearchToolsOf(capability);
    const dropWeb = hidesGenericWebSearch(capability);
    const filtered = current.filter((tool) => {
        if (!isRecord(tool))
            return true;
        // Effective native web_search hides every PipiUI local search function
        // tool (web_search, browser_search, browser_fetch) so the hosted tools
        // are the only search channel. x_search-only capabilities keep them all.
        if (dropWeb && isLocalSearchFunctionTool(tool))
            return false;
        if (hosted.some((item) => isHostedTool(tool, item.type)))
            return false;
        return true;
    });
    return [...filtered, ...hosted];
}
export function applyHostedSearchToPayload(payload, capability) {
    const next = { ...payload };
    if (Object.prototype.hasOwnProperty.call(next, "search_parameters")) {
        delete next.search_parameters;
    }
    if (capability)
        next.tools = mergeHostedSearchTools(next.tools, capability);
    return next;
}
function numberOf(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
export function normalizeResponsesUsage(usage) {
    if (!isRecord(usage))
        return undefined;
    const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : undefined;
    const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : undefined;
    const cached = numberOf(inputDetails?.cached_tokens);
    const cacheWrite = numberOf(inputDetails?.cache_write_tokens);
    const inputTokens = numberOf(usage.input_tokens ?? usage.prompt_tokens);
    const outputTokens = numberOf(usage.output_tokens ?? usage.completion_tokens);
    const serverSide = isRecord(usage.server_side_tool_usage)
        ? Object.fromEntries(Object.entries(usage.server_side_tool_usage).filter((entry) => typeof entry[1] === "number" && Number.isFinite(entry[1])))
        : undefined;
    return {
        input: Math.max(0, inputTokens - cached - cacheWrite),
        output: outputTokens,
        cacheRead: cached,
        cacheWrite,
        reasoning: numberOf(outputDetails?.reasoning_tokens),
        totalTokens: numberOf(usage.total_tokens) || inputTokens + outputTokens,
        ...(serverSide && Object.keys(serverSide).length ? { serverSideToolUsage: serverSide } : {}),
    };
}
function redactSecrets(message) {
    return message
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted]")
        .replace(/\b(at|rt)-[A-Za-z0-9._-]+/g, "[redacted]");
}
export function interpretResponsesError(event) {
    if (!isRecord(event))
        return undefined;
    if (event.type === "error") {
        const message = typeof event.message === "string" && event.message.trim()
            ? event.message
            : "Unknown Responses error";
        return {
            ...(typeof event.code === "string" && event.code ? { code: event.code } : {}),
            message: redactSecrets(message),
        };
    }
    if (event.type === "response.failed") {
        const response = isRecord(event.response) ? event.response : undefined;
        const error = isRecord(response?.error) ? response.error : undefined;
        const details = isRecord(response?.incomplete_details) ? response.incomplete_details : undefined;
        if (error && typeof error.message === "string" && error.message.trim()) {
            return {
                ...(typeof error.code === "string" && error.code ? { code: error.code } : {}),
                message: redactSecrets(error.message),
            };
        }
        if (typeof details?.reason === "string" && details.reason.trim()) {
            return { code: "incomplete", message: redactSecrets(details.reason) };
        }
        return { message: "Unknown error (no error details in response)" };
    }
    return undefined;
}
const SEARCH_EVENT_RE = /^response\.(web_search|x_search|x_keyword_search)_call\.(in_progress|searching|completed|failed)$/;
const INLINE_CITATION_RE = /\[\[(\d+)\]\]\((https?:\/\/[^\s)]+)\)/g;
function hostedKindOf(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === "web_search" || normalized === "web_search_call")
        return "web_search";
    if (normalized === "x_search"
        || normalized === "x_search_call"
        || normalized === "x_keyword_search"
        || normalized === "x_keyword_search_call")
        return "x_search";
    return undefined;
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value;
    }
    return undefined;
}
function queryOf(record, item) {
    const action = isRecord(record.action) ? record.action : isRecord(item?.action) ? item.action : undefined;
    return firstString(record.query, action?.query, action?.q, item?.query, isRecord(record.arguments) ? record.arguments.query : undefined);
}
function sourceFromUnknown(value) {
    if (typeof value === "string") {
        const url = value.trim();
        return /^https?:\/\//i.test(url) ? { url } : undefined;
    }
    if (!isRecord(value))
        return undefined;
    const url = firstString(value.url, value.uri, value.link);
    if (!url || !/^https?:\/\//i.test(url))
        return undefined;
    const title = firstString(value.title, value.name);
    const snippet = firstString(value.snippet, value.text, value.description);
    return { url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) };
}
function sourcesOf(record, item) {
    const action = isRecord(record.action) ? record.action : isRecord(item?.action) ? item.action : undefined;
    const raw = [record.sources, action?.sources, item?.sources, record.results, action?.results]
        .find((value) => Array.isArray(value));
    if (!raw)
        return undefined;
    const sources = raw.map(sourceFromUnknown).filter((source) => Boolean(source));
    return sources.length ? sources : undefined;
}
function citationFromUnknown(value) {
    if (typeof value === "string") {
        const url = value.trim();
        return /^https?:\/\//i.test(url) ? { url } : undefined;
    }
    if (!isRecord(value))
        return undefined;
    const url = firstString(value.url, value.uri, value.link);
    if (!url || !/^https?:\/\//i.test(url))
        return undefined;
    const title = firstString(value.title, value.name);
    const startIndex = typeof value.start_index === "number" ? value.start_index : typeof value.startIndex === "number" ? value.startIndex : undefined;
    const endIndex = typeof value.end_index === "number" ? value.end_index : typeof value.endIndex === "number" ? value.endIndex : undefined;
    const type = firstString(value.type);
    return {
        url,
        ...(title ? { title } : {}),
        ...(startIndex !== undefined ? { startIndex } : {}),
        ...(endIndex !== undefined ? { endIndex } : {}),
        ...(type ? { type } : {}),
    };
}
export function extractInlineCitations(text) {
    if (typeof text !== "string" || !text.includes("[["))
        return [];
    const citations = [];
    const seen = new Set();
    INLINE_CITATION_RE.lastIndex = 0;
    for (const match of text.matchAll(INLINE_CITATION_RE)) {
        const url = match[2];
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        citations.push({ url, type: "url_citation" });
    }
    return citations;
}
export function citationsFromUnknown(value) {
    if (!value)
        return [];
    if (Array.isArray(value)) {
        return value.map(citationFromUnknown).filter((item) => Boolean(item));
    }
    const single = citationFromUnknown(value);
    return single ? [single] : [];
}
function citationsFromMessageItem(item) {
    const content = Array.isArray(item.content) ? item.content : [];
    const collected = [];
    for (const part of content) {
        if (!isRecord(part))
            continue;
        if (Array.isArray(part.annotations))
            collected.push(...citationsFromUnknown(part.annotations));
        collected.push(...extractInlineCitations(part.text));
    }
    return collected;
}
export function interpretCitations(event) {
    if (!isRecord(event) || typeof event.type !== "string")
        return [];
    if (event.type === "response.output_text.annotation.added") {
        return citationsFromUnknown(event.annotation ?? event);
    }
    if (event.type === "response.output_item.done") {
        const item = isRecord(event.item) ? event.item : undefined;
        return item ? citationsFromMessageItem(item) : [];
    }
    if (event.type === "response.completed" || event.type === "response.done" || event.type === "response.incomplete") {
        const response = isRecord(event.response) ? event.response : undefined;
        const fromResponse = citationsFromUnknown(response?.citations ?? event.citations);
        const output = Array.isArray(response?.output) ? response.output : [];
        const fromOutput = output.flatMap((item) => isRecord(item) ? citationsFromMessageItem(item) : []);
        return [...fromResponse, ...fromOutput];
    }
    return [];
}
export function interpretHostedSearchEvent(event) {
    if (!isRecord(event) || typeof event.type !== "string")
        return undefined;
    const match = event.type.match(SEARCH_EVENT_RE);
    if (match) {
        const kind = hostedKindOf(match[1]);
        const phase = match[2];
        if (!kind)
            return undefined;
        const item = isRecord(event.item) ? event.item : undefined;
        return {
            kind,
            phase,
            ...(typeof event.item_id === "string" ? { itemId: event.item_id } : firstString(item?.id) ? { itemId: firstString(item?.id) } : {}),
            ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
            ...(queryOf(event, item) ? { query: queryOf(event, item) } : {}),
            ...(sourcesOf(event, item) ? { sources: sourcesOf(event, item) } : {}),
        };
    }
    if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
        const item = isRecord(event.item) ? event.item : undefined;
        const kind = hostedKindOf(item?.type) ?? hostedKindOf(item?.name);
        if (!kind || !item)
            return undefined;
        return {
            kind,
            phase: event.type === "response.output_item.done"
                ? (item.status === "failed" ? "failed" : "completed")
                : "in_progress",
            ...(firstString(item.id) ? { itemId: firstString(item.id) } : {}),
            ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
            ...(queryOf(event, item) ? { query: queryOf(event, item) } : {}),
            ...(sourcesOf(event, item) ? { sources: sourcesOf(event, item) } : {}),
        };
    }
    if (event.type === "response.custom_tool_call_input.done" || event.type === "response.custom_tool_call_input.delta") {
        const kind = hostedKindOf(event.name);
        if (!kind)
            return undefined;
        return {
            kind,
            phase: event.type.endsWith(".done") ? "completed" : "in_progress",
            ...(typeof event.item_id === "string" ? { itemId: event.item_id } : {}),
            ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
            ...(queryOf(event) ? { query: queryOf(event) } : {}),
        };
    }
    return undefined;
}
export function collectResponsesStream(events) {
    const searches = [];
    const citations = [];
    const seenCitations = new Set();
    let error;
    let usage;
    for (const event of events) {
        const search = interpretHostedSearchEvent(event);
        if (search)
            searches.push(search);
        for (const citation of interpretCitations(event)) {
            const exact = `${citation.url}\0${citation.startIndex ?? ""}\0${citation.endIndex ?? ""}`;
            if (seenCitations.has(exact) || seenCitations.has(citation.url))
                continue;
            if (citation.startIndex === undefined && citation.endIndex === undefined && citations.some((item) => item.url === citation.url))
                continue;
            seenCitations.add(exact);
            seenCitations.add(citation.url);
            citations.push(citation);
        }
        const nextError = interpretResponsesError(event);
        if (nextError && !error)
            error = nextError;
        if (isRecord(event) && (event.type === "response.completed" || event.type === "response.done" || event.type === "response.incomplete")) {
            const response = isRecord(event.response) ? event.response : undefined;
            const nextUsage = normalizeResponsesUsage(response?.usage ?? event.usage);
            if (nextUsage)
                usage = nextUsage;
        }
    }
    return { searches, citations, ...(error ? { error } : {}), ...(usage ? { usage } : {}) };
}
