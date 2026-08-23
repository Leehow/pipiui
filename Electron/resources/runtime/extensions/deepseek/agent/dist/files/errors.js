export class DeepSeekFilesError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.name = "DeepSeekFilesError";
        this.code = code;
        this.status = status;
    }
}
export function classifyFilesStatus(status) {
    if (status === 401 || status === 403)
        return "auth";
    if (status === 429)
        return "rate_limited";
    if (status >= 500)
        return "upstream_error";
    if (status >= 400)
        return "http_failure";
    return "upstream_error";
}
/** Strip bearer tokens / sk- keys from an upstream snippet. Never log the raw secret. */
export function redactSecret(text, secret) {
    let next = text;
    if (secret)
        next = next.split(secret).join("[redacted]");
    return next
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted]");
}
