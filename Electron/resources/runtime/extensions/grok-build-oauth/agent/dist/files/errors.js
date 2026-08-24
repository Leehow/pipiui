export class FilesError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.name = "FilesError";
        this.code = code;
        this.status = status;
    }
}
export function classifyFilesStatus(status) {
    if (status === 401 || status === 403)
        return { code: "auth_expired" };
    if (status === 429)
        return { code: "rate_limited" };
    if (status >= 500)
        return { code: "upstream_error" };
    if (status >= 400)
        return { code: "http_failure" };
    return { code: "upstream_error" };
}
