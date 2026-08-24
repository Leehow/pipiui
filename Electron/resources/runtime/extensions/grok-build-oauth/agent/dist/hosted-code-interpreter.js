/**
 * Grok / xAI Responses hosted code interpreter protocol.
 *
 * Official request form is `{ type: "code_interpreter" }` plus
 * `include: ["code_interpreter_call.outputs"]` (xAI Agent Tools /
 * OpenAI-compatible Responses). Execution is always server-side — this module
 * never runs local Python. Inject only when `hostedTools.code_interpreter` is
 * declared; never infer from provider id or native search.
 *
 * Stream items are `code_interpreter_call` with official statuses
 * queued / in_progress / interpreting / completed / failed (plus OpenAI
 * `incomplete`, mapped to failed).
 */
export const HOSTED_CODE_INTERPRETER_TOOL = { type: "code_interpreter" };
export const HOSTED_CODE_INTERPRETER_INCLUDE = "code_interpreter_call.outputs";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringOf(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
function numberOf(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function redactSecrets(message) {
    return message
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted]")
        .replace(/\b(at|rt)-[A-Za-z0-9._-]+/g, "[redacted]")
        .replace(/\b(?:access|container|file|download)[_-]?token=([^&\s]+)/gi, (full, token) => full.replace(token, "[redacted]"));
}
function hostedToolsList(value) {
    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === "string");
    }
    if (isRecord(value) && Array.isArray(value.tools)) {
        return value.tools.filter((item) => typeof item === "string");
    }
    return undefined;
}
/** `true`/`false` when `hostedTools` is declared; otherwise `undefined` (do not infer). */
export function codeInterpreterFromCapabilities(capabilities) {
    if (!isRecord(capabilities) || capabilities.hostedTools === undefined)
        return undefined;
    const tools = hostedToolsList(capabilities.hostedTools);
    return tools?.includes("code_interpreter") === true;
}
export function modelHasCodeInterpreter(model) {
    return codeInterpreterFromCapabilities(model?.capabilities) === true;
}
function isClientNamedTool(tool, name) {
    if (tool.type === name && tool.function === undefined && (typeof tool.name !== "string" || tool.name === name)) {
        return false;
    }
    if (typeof tool.name === "string" && tool.name === name)
        return true;
    if (tool.type === "function") {
        const fn = isRecord(tool.function) ? tool.function : undefined;
        return typeof fn?.name === "string" && fn.name === name;
    }
    return false;
}
function isHostedCodeInterpreterTool(tool) {
    return tool.type === "code_interpreter"
        && tool.function === undefined
        && (typeof tool.name !== "string" || tool.name === "code_interpreter");
}
export function mergeCodeInterpreterTool(existing) {
    const current = Array.isArray(existing) ? [...existing] : [];
    const filtered = current.filter((tool) => {
        if (!isRecord(tool))
            return true;
        if (isClientNamedTool(tool, "code_interpreter"))
            return false;
        if (isHostedCodeInterpreterTool(tool))
            return false;
        return true;
    });
    return [...filtered, { ...HOSTED_CODE_INTERPRETER_TOOL }];
}
export function mergeCodeInterpreterInclude(existing) {
    const current = Array.isArray(existing) ? [...existing] : [];
    if (current.includes(HOSTED_CODE_INTERPRETER_INCLUDE))
        return current;
    return [...current, HOSTED_CODE_INTERPRETER_INCLUDE];
}
export function applyCodeInterpreterToPayload(payload, enabled) {
    if (!enabled)
        return payload;
    return {
        ...payload,
        tools: mergeCodeInterpreterTool(payload.tools),
        include: mergeCodeInterpreterInclude(payload.include),
    };
}
const PHASES = new Set([
    "queued",
    "in_progress",
    "interpreting",
    "completed",
    "failed",
]);
const CODE_EVENT_RE = /^response\.code_interpreter_call(?:_code)?\.(queued|in_progress|interpreting|completed|failed|incomplete|delta|done)$/;
function phaseOf(value) {
    if (value === "incomplete")
        return "failed";
    return typeof value === "string" && PHASES.has(value)
        ? value
        : undefined;
}
function isCodeInterpreterItem(item) {
    if (!item)
        return false;
    const type = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
    const name = typeof item.name === "string" ? item.name.trim().toLowerCase() : "";
    return type === "code_interpreter_call"
        || type === "code_interpreter"
        || name === "code_interpreter_call";
}
function safeHttpsUrl(value) {
    const url = stringOf(value);
    if (!url || !/^https:\/\//i.test(url))
        return undefined;
    if (/[?&](?:token|access_token|sig|signature|key)=/i.test(url)) {
        try {
            const parsed = new URL(url);
            for (const key of [...parsed.searchParams.keys()]) {
                if (/token|sig|signature|key|auth/i.test(key))
                    parsed.searchParams.delete(key);
            }
            return parsed.toString();
        }
        catch {
            return undefined;
        }
    }
    return url;
}
function fileFromUnknown(value) {
    if (!isRecord(value))
        return undefined;
    const filename = stringOf(value.filename) ?? stringOf(value.name) ?? stringOf(value.path);
    const mimeType = stringOf(value.mimeType) ?? stringOf(value.mime_type) ?? stringOf(value.content_type);
    const size = numberOf(value.size) ?? numberOf(value.bytes);
    const url = safeHttpsUrl(value.url) ?? safeHttpsUrl(value.uri);
    if (!filename && !mimeType && size === undefined && !url)
        return undefined;
    return {
        ...(filename ? { filename } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(url ? { url } : {}),
    };
}
function outputsAndFiles(record) {
    const raw = [record.outputs, record.results, record.output]
        .find((value) => Array.isArray(value));
    if (!raw?.length)
        return {};
    const outputs = [];
    const files = [];
    for (const item of raw) {
        if (typeof item === "string" && item.trim()) {
            outputs.push({ type: "logs", text: redactSecrets(item) });
            continue;
        }
        if (!isRecord(item))
            continue;
        const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
        const text = stringOf(item.logs) ?? stringOf(item.text) ?? stringOf(item.content) ?? stringOf(item.output);
        if (type === "logs" || type === "text" || (text && type !== "image" && type !== "file" && type !== "files")) {
            if (text)
                outputs.push({ type: "logs", text: redactSecrets(text) });
        }
        if (type === "image" || type === "file" || type === "files") {
            if (type === "files" && Array.isArray(item.files)) {
                for (const file of item.files) {
                    const next = fileFromUnknown(file);
                    if (next)
                        files.push(next);
                }
            }
            else {
                const next = fileFromUnknown(item);
                if (next)
                    files.push(next);
            }
        }
        else {
            const next = fileFromUnknown(item);
            if (next && (next.filename || next.url || next.mimeType))
                files.push(next);
        }
    }
    return {
        ...(outputs.length ? { outputs } : {}),
        ...(files.length ? { files } : {}),
    };
}
function errorOf(record, item) {
    const raw = isRecord(record.error) ? record.error : isRecord(item?.error) ? item.error : undefined;
    const message = stringOf(raw?.message) ?? (typeof record.error === "string" ? record.error : undefined)
        ?? (typeof item?.error === "string" ? item.error : undefined);
    if (!message)
        return undefined;
    return {
        ...(typeof raw?.code === "string" && raw.code ? { code: raw.code } : {}),
        message: redactSecrets(message),
    };
}
function codeOf(record, item) {
    const code = stringOf(record.code) ?? stringOf(item?.code) ?? stringOf(record.delta);
    return code ? redactSecrets(code) : undefined;
}
export function interpretCodeInterpreterEvent(event) {
    if (!isRecord(event) || typeof event.type !== "string")
        return undefined;
    const item = isRecord(event.item) ? event.item : undefined;
    const match = event.type.match(CODE_EVENT_RE);
    if (match) {
        const suffix = match[1];
        const phase = suffix === "delta" || suffix === "done"
            ? (phaseOf(item?.status) ?? "in_progress")
            : phaseOf(suffix);
        if (!phase)
            return undefined;
        const produced = outputsAndFiles(event);
        const fromItem = item ? outputsAndFiles(item) : {};
        const itemId = typeof event.item_id === "string" ? event.item_id : stringOf(item?.id);
        return {
            phase,
            ...(itemId ? { itemId } : {}),
            ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
            ...(codeOf(event, item) ? { code: codeOf(event, item) } : {}),
            ...(produced.outputs ?? fromItem.outputs ? { outputs: produced.outputs ?? fromItem.outputs } : {}),
            ...(produced.files ?? fromItem.files ? { files: produced.files ?? fromItem.files } : {}),
            ...(errorOf(event, item) ? { error: errorOf(event, item) } : {}),
        };
    }
    if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
        if (!isCodeInterpreterItem(item) || !item)
            return undefined;
        const produced = outputsAndFiles(item);
        const failed = item.status === "failed" || item.status === "incomplete" || Boolean(errorOf(event, item));
        return {
            phase: event.type === "response.output_item.done"
                ? (failed ? "failed" : phaseOf(item.status) ?? "completed")
                : (phaseOf(item.status) ?? "queued"),
            ...(stringOf(item.id) ? { itemId: stringOf(item.id) } : {}),
            ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
            ...(codeOf(event, item) ? { code: codeOf(event, item) } : {}),
            ...produced,
            ...(errorOf(event, item) ? { error: errorOf(event, item) } : {}),
        };
    }
    return undefined;
}
export function hostedCodeInterpreterCallId(call) {
    if (call.itemId)
        return call.itemId;
    if (typeof call.outputIndex === "number")
        return `hosted-code_interpreter-${call.outputIndex}`;
    return "hosted-code_interpreter";
}
export function codeInterpreterToolDelta(call) {
    const payload = { phase: call.phase };
    if (call.code)
        payload.code = call.code;
    if (call.outputs?.length)
        payload.outputs = call.outputs;
    if (call.files?.length)
        payload.files = call.files;
    if (call.error?.message)
        payload.error = call.error.message;
    return JSON.stringify(payload);
}
export function collectCodeInterpreterStream(events) {
    const calls = [];
    let error;
    const codeById = new Map();
    for (const event of events) {
        const call = interpretCodeInterpreterEvent(event);
        if (!call)
            continue;
        const id = hostedCodeInterpreterCallId(call);
        if (call.code) {
            const prev = codeById.get(id) ?? "";
            const next = isRecord(event) && typeof event.type === "string" && event.type.endsWith(".delta")
                ? `${prev}${call.code}`
                : call.code;
            codeById.set(id, next);
            call.code = next;
        }
        else if (codeById.has(id)) {
            call.code = codeById.get(id);
        }
        if (call.error && !error)
            error = call.error;
        calls.push(call);
    }
    return { calls, ...(error ? { error } : {}) };
}
export function extractHistoryCodeInterpreter(message) {
    const buckets = [];
    if (Array.isArray(message.output))
        buckets.push(...message.output);
    if (Array.isArray(message.content))
        buckets.push(...message.content);
    const calls = [];
    for (const item of buckets) {
        if (!isRecord(item) || !isCodeInterpreterItem(item))
            continue;
        const produced = outputsAndFiles(item);
        const failed = item.status === "failed" || item.status === "incomplete";
        calls.push({
            phase: failed ? "failed" : phaseOf(item.status) ?? "completed",
            ...(stringOf(item.id) ? { itemId: stringOf(item.id) } : {}),
            ...(codeOf(item) ? { code: codeOf(item) } : {}),
            ...produced,
            ...(errorOf(item) ? { error: errorOf(item) } : {}),
        });
    }
    return calls;
}
