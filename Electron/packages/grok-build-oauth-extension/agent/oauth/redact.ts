const SECRET_KEYS = new Set([
  "access_token",
  "refresh_token",
  "access",
  "refresh",
  "id_token",
  "token",
]);

export function redactToken(token: string): string {
  if (!token) return "[redacted]";
  return "[redacted]";
}

export function redactMessage(message: string, tokens: string[]): string {
  let out = message;
  for (const tok of tokens) {
    if (!tok || tok.length < 4) continue;
    out = out.split(tok).join("[redacted]");
  }
  return out;
}

export function redactObject<T>(value: T, tokens: string[]): T {
  if (value == null) return value;
  if (typeof value === "string") {
    return redactMessage(value, tokens) as unknown as T;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => redactObject(v as unknown, tokens)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k) && typeof v === "string" && v.length) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactObject(v as unknown, tokens);
      }
    }
    return out as unknown as T;
  }
  return value;
}
