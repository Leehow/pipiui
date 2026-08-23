export type SearchMode = "auto" | "exact" | "symbol" | "semantic";
export type RoutedMode = "exact" | "symbol" | "semantic" | "hybrid";

const SYMBOL_HINT =
  /谁定义|谁引用|谁调用|定义在哪|引用了|where(?:'s| is) (?:it )?defined|who defines|who references|definition of|references to|find (?:the )?definition|go to definition/i;

const OPEN_QUESTION =
  /^(how|why|what|when|where|which|explain|describe|compare|设计|为什么|怎么|如何|什么是|讲讲|解释)\b/i;

const ERROR_HINT =
  /\b(?:TypeError|ReferenceError|SyntaxError|Error|Exception|panic|traceback|E\d{3,4})\b|\bat [\w./-]+:\d+/i;

const PATH_HINT = /(?:[./\\][\w.-]+)+\.[A-Za-z][\w]*|^[\w.-]+\/[\w./-]+/;

const REGEX_META = /[.*+^${}()|[\]\\]/;

export function routeQuery(query: string, mode?: SearchMode): RoutedMode {
  if (mode && mode !== "auto") return mode;
  const trimmed = query.trim();
  if (!trimmed) return "exact";
  if (SYMBOL_HINT.test(trimmed)) return "symbol";
  const looksLikeQuestion = OPEN_QUESTION.test(trimmed) || (/[?？]$/.test(trimmed) && /\s/.test(trimmed));
  if (looksLikeQuestion) return "semantic";
  if (ERROR_HINT.test(trimmed) || PATH_HINT.test(trimmed) || REGEX_META.test(trimmed)) return "exact";
  if (trimmed.split(/\s+/).length >= 6) return "hybrid";
  return "exact";
}
