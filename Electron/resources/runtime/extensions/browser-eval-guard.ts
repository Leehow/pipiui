/** Conservative detector: reject keep-alive / constant IIFE evals that never touch the page. */

function stripCommentsAndWhitespace(js: string): string {
  let s = js.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
  return s.replace(/\s+/g, "");
}

const LITERAL =
  /^(?:undefined|null|true|false|void0|NaN|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|'[^'\\]*'|"[^"\\]*"|`[^`\\$]*`)$/;

function unwrapParens(s: string): string {
  let cur = s;
  while (cur.length >= 2 && cur.startsWith("(") && cur.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] === "(") depth++;
      else if (cur[i] === ")") {
        depth--;
        if (depth < 0) {
          wrapsAll = false;
          break;
        }
        if (depth === 0 && i !== cur.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (!wrapsAll || depth !== 0) break;
    cur = cur.slice(1, -1);
  }
  return cur;
}

function literalBody(body: string | undefined): string | null {
  if (!body || !LITERAL.test(body)) return null;
  return body;
}

/** Peel one trivial no-arg IIFE; return inner literal or remaining expr. */
function unwrapTrivialIife(s: string): string | null {
  const cur = unwrapParens(s);

  const patterns = [
    /^\(\(\)=>\{return(.+?)\}\)\(\)$/, // (()=>{return LIT})()
    /^\(\(\)=>(.+?)\)\(\)$/, // (()=>LIT)()
    /^\(\)=>\{return(.+)\}$/, // ()=>{return LIT}
    /^\(\)=>(.+)$/, // ()=>LIT
    /^\(function\(\)\{return(.+?)\}\)\(\)$/, // (function(){return LIT})()
    /^\(function\(\)\{return(.+?)\}\(\)\)$/, // (function(){return LIT}())
    /^function\(\)\{return(.+?)\}\(\)$/, // function(){return LIT}()
  ];
  for (const re of patterns) {
    const m = re.exec(cur);
    const lit = m ? literalBody(m[1]) : null;
    if (lit) return lit;
  }

  return null;
}

export function isTrivialBrowserEval(js: string): boolean {
  if (typeof js !== "string") return true;
  let compact = stripCommentsAndWhitespace(js);
  if (!compact) return true;

  for (let i = 0; i < 8; i++) {
    compact = unwrapParens(compact);
    if (LITERAL.test(compact)) return true;
    const inner = unwrapTrivialIife(compact);
    if (inner == null) return false;
    compact = inner;
  }
  return LITERAL.test(compact);
}
