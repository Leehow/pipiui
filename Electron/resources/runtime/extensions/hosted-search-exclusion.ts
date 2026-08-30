// Shared request-time exclusion of PipiUI local generic search tools.
//
// When a hosted-search provider adapter enables provider-native web search on
// the wire, the PipiUI local search function tools must not ride along in the
// same payload: the provider hosted tool is then the only search channel.
// Mirrors host-api's NATIVE_SEARCH_EXCLUDED_LOCAL_TOOLS (kept there for spawn
// argv / UI catalogs); enforced here so a stale spawn's tool list can never
// leak the local tools to the wire.
export const LOCAL_SEARCH_FUNCTION_TOOL_NAMES: readonly string[] = [
  "web_search",
  "browser_search",
  "browser_fetch",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLocalSearchFunctionToolName(name: string): boolean {
  return (LOCAL_SEARCH_FUNCTION_TOOL_NAMES as readonly string[]).includes(name);
}

function functionNameOf(tool: Record<string, unknown>): string | undefined {
  if (typeof tool.name === "string") return tool.name;
  if (isRecord(tool.function) && typeof tool.function.name === "string") return tool.function.name;
  return undefined;
}

function isLocalSearchNamed(tool: Record<string, unknown>): boolean {
  const name = functionNameOf(tool);
  return name !== undefined && isLocalSearchFunctionToolName(name);
}

/**
 * Function tools whose exact name is a local search tool, in the Responses
 * (`{type:"function", name}`) or Chat Completions (`{type:"function",
 * function:{name}}`) shape. Anything that is not a `type:"function"` tool —
 * hosted built-ins (`{type:"web_search"}`, `{type:"web_search_20250305",
 * name:"web_search"}`) and other typed tools such as `{type:"custom",
 * name:"web_search"}` — is never matched, however its name reads. Merely
 * similar names (e.g. `web_search_preview`) never match either.
 */
export function isLocalSearchFunctionTool(tool: unknown): boolean {
  if (!isRecord(tool) || tool.type !== "function") return false;
  return isLocalSearchNamed(tool);
}

/**
 * Anthropic Messages variant: pi sends function tools flat, without a type
 * field (`{name, description, input_schema}`). Server tools always carry a
 * `type` (`web_search_20250305`, `custom`, `code_execution`, …), so those are
 * never matched.
 */
export function isLocalSearchMessagesFunctionTool(tool: unknown): boolean {
  if (!isRecord(tool)) return false;
  if (tool.type !== undefined && tool.type !== "function") return false;
  return isLocalSearchNamed(tool);
}
