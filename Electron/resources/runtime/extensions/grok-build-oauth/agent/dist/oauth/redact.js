const SECRET_KEYS = new Set([
    "access_token",
    "refresh_token",
    "access",
    "refresh",
    "id_token",
    "token",
]);
export function redactToken(token) {
    if (!token)
        return "[redacted]";
    return "[redacted]";
}
export function redactMessage(message, tokens) {
    let out = message;
    for (const tok of tokens) {
        if (!tok || tok.length < 4)
            continue;
        out = out.split(tok).join("[redacted]");
    }
    return out;
}
export function redactObject(value, tokens) {
    if (value == null)
        return value;
    if (typeof value === "string") {
        return redactMessage(value, tokens);
    }
    if (Array.isArray(value)) {
        return value.map((v) => redactObject(v, tokens));
    }
    if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (SECRET_KEYS.has(k) && typeof v === "string" && v.length) {
                out[k] = "[redacted]";
            }
            else {
                out[k] = redactObject(v, tokens);
            }
        }
        return out;
    }
    return value;
}
