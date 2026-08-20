/** Stored/stream protocol from StreamRedactor / redactSessionJsonl. */
const SECRET_PLACEHOLDER_RE = /\{\{secret:([A-Z][A-Z0-9_]{0,63})\}\}/g

/** Show `[ENV_NAME]` instead of `{{secret:ENV_NAME}}`. Does not invent a second storage protocol. */
export function displaySecretPlaceholders(text: string): string {
  return text.replace(SECRET_PLACEHOLDER_RE, '[$1]')
}
