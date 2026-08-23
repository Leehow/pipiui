export type SearchMode = "auto" | "exact" | "symbol" | "semantic";
export type RoutedMode = "exact" | "symbol" | "semantic" | "hybrid";

const SYMBOL_HINT =
  /谁定义|谁引用|谁调用|定义在哪|引用了|where(?:'s| is) (?:it )?defined|who defines|who references|definition of|references to|find (?:the )?definition|go to definition/i;

const OPEN_QUESTION_EN =
  /^(how|why|what|when|where|which|explain|describe|compare)\b/i;

const OPEN_QUESTION_CJK = /^(设计|为什么|怎么|如何|什么是|什么|讲讲|解释|哪个|哪些|为何|怎样|何处)/;

const CJK_QUESTION = /哪个|哪些|什么是|为什么|怎么|如何|讲讲|解释|为何|怎样|何处/;

const CJK_CHAR = /[\u3400-\u9fff]/;

const ERROR_HINT =
  /\b(?:TypeError|ReferenceError|SyntaxError|Error|Exception|panic|traceback|E\d{3,4})\b|\bat [\w./-]+:\d+/i;

const PATH_HINT = /(?:[./\\][\w.-]+)+\.[A-Za-z][\w]*|^[\w.-]+\/[\w./-]+/;

const REGEX_META = /[.*+^${}()|[\]\\]/;

const PATH_TOKEN = /(?:[\w.-]+\/)+[\w.-]+(?:\.[A-Za-z][\w]*)?/g;

const IDENT_TOKEN = /[A-Za-z_$@][\w$]*(?:\.[A-Za-z_][\w$]*)*/g;

const EN_STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "in",
  "on",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "how",
  "why",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "does",
  "do",
  "did",
  "can",
  "could",
  "should",
  "would",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "this",
  "that",
  "these",
  "those",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "so",
  "as",
  "with",
  "from",
  "by",
  "about",
  "into",
  "over",
  "after",
  "before",
  "between",
  "under",
  "again",
  "further",
  "once",
  "here",
  "there",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "too",
  "very",
  "just",
  "also",
  "because",
  "while",
  "during",
  "both",
  "through",
  "please",
  "find",
  "show",
  "tell",
  "me",
  "us",
  "we",
  "you",
  "i",
  "it",
  "its",
  "their",
  "our",
  "your",
  "my",
  "work",
  "works",
  "working",
  "way",
  "ways",
  "thing",
  "things",
  "stuff",
  "using",
  "used",
  "use",
  "make",
  "made",
  "get",
  "got",
  "need",
  "needs",
]);

const CJK_KEEP = [
  "扩展",
  "禁用",
  "挂载",
  "模块",
  "工具",
  "会话",
  "索引",
  "符号",
  "检索",
  "配置",
  "代理",
  "定义",
  "引用",
  "调用",
  "启用",
  "卸载",
  "加载",
];

const CJK_STRIP = [
  "什么是",
  "为什么",
  "怎么样",
  "怎么",
  "如何",
  "讲讲",
  "解释",
  "为何",
  "怎样",
  "何处",
  "哪些",
  "哪个",
  "什么",
  "是否",
  "负责",
  "一下",
];

const CJK_PARTICLE = /[的了吗呢吧啊呀么在是和与或也都就还很把被让给对从到为及后不没无着过这那个些里中上下时会能要把]/g;

const MAX_TERMS = 8;

export const SEMANTIC_UNAVAILABLE_NOTE = "semantic unavailable; attempted lexical+symbol fallback";

export function routeQuery(query: string, mode?: SearchMode): RoutedMode {
  if (mode && mode !== "auto") return mode;
  const trimmed = query.trim();
  if (!trimmed) return "exact";
  if (SYMBOL_HINT.test(trimmed)) return "symbol";
  if (ERROR_HINT.test(trimmed) || PATH_HINT.test(trimmed) || REGEX_META.test(trimmed)) {
    return "exact";
  }
  if (looksLikeOpenQuery(trimmed) || looksLikeNaturalLanguage(trimmed)) return "hybrid";
  return "exact";
}

export function looksLikeOpenQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (OPEN_QUESTION_EN.test(trimmed) || OPEN_QUESTION_CJK.test(trimmed) || CJK_QUESTION.test(trimmed)) {
    return true;
  }
  return /[?？]/.test(trimmed) && (/\s/.test(trimmed) || CJK_CHAR.test(trimmed));
}

export function looksLikeNaturalLanguage(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (looksLikeOpenQuery(trimmed)) return true;
  if (isShortIdentifier(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;
  if (CJK_CHAR.test(trimmed) && trimmed.replace(/\s+/g, "").length >= 6) return true;
  return false;
}

export function isShortIdentifier(query: string): boolean {
  return /^[A-Za-z_$@][\w$]*(?:[.:][\w$]+)*$/.test(query.trim());
}

export function isIdentifierLike(token: string): boolean {
  if (token.length < 2) return false;
  if (/[./\\]/.test(token)) return false;
  return /[_$]/.test(token) || /[A-Z]/.test(token.slice(1)) || /[A-Za-z]+\d+/.test(token);
}

export function extractLexicalTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const paths: string[] = [];
  for (const match of trimmed.matchAll(PATH_TOKEN)) {
    if (match[0].length >= 3) paths.push(match[0]);
  }

  const identifiers: string[] = [];
  const english: string[] = [];
  for (const match of trimmed.matchAll(IDENT_TOKEN)) {
    const token = match[0];
    if (paths.some((path) => path.includes(token) && path !== token)) continue;
    if (isIdentifierLike(token)) identifiers.push(token);
    else if (token.length >= 3 && !EN_STOP.has(token.toLowerCase())) english.push(token);
  }

  const cjk = extractCjkTerms(trimmed, { skip: identifiers.length + english.length >= 2 });

  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of [...identifiers, ...paths, ...english, ...cjk]) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

function extractCjkTerms(query: string, opts: { skip: boolean }): string[] {
  if (opts.skip) return [];
  const keepHits = CJK_KEEP.filter((word) => query.includes(word));
  if (keepHits.length) return keepHits.slice(0, MAX_TERMS);

  let rest = query.replace(/[^\u3400-\u9fff]+/g, " ");
  for (const stop of CJK_STRIP) rest = rest.split(stop).join(" ");
  rest = rest.replace(CJK_PARTICLE, " ");
  return rest
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, MAX_TERMS);
}
