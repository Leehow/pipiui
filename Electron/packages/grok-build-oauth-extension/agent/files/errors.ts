export type FilesErrorCode =
  | "invalid_params"
  | "unsupported_model"
  | "invalid_response"
  | "auth_expired"
  | "rate_limited"
  | "upstream_error"
  | "http_failure"
  | "aborted";

export class FilesError extends Error {
  readonly code: FilesErrorCode;
  readonly status?: number;

  constructor(code: FilesErrorCode, message: string, status?: number) {
    super(message);
    this.name = "FilesError";
    this.code = code;
    this.status = status;
  }
}

export function classifyFilesStatus(status: number): { code: FilesErrorCode } {
  if (status === 401 || status === 403) return { code: "auth_expired" };
  if (status === 429) return { code: "rate_limited" };
  if (status >= 500) return { code: "upstream_error" };
  if (status >= 400) return { code: "http_failure" };
  return { code: "upstream_error" };
}
