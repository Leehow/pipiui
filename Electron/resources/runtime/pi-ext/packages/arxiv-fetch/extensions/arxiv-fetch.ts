// PipiUI official local package. No runtime npm install.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const API_GAP_MS = 3000;
const TOTAL_BUDGET_MS = 30000;

let lastAPIStart = 0;
const inflight = new Map<string, Promise<Paper>>();
const cache = new Map<string, { until: number; value: Paper }>();

type Target = {
  id: string;
  version?: string;
  requested: "abs" | "html" | "pdf";
};

type Paper = {
  id: string;
  resolved?: string;
  title: string;
  authors: string[];
  summary: string;
  categories: string[];
  primary?: string;
  published?: string;
  updated?: string;
  comment?: string;
  journal?: string;
  doi?: string;
  links: string[];
  withdrawn: boolean;
};

function result(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
    ...(isError ? { isError: true } : {}),
  };
}

function trunc(text: string, maxLength: number) {
  return text.length <= maxLength
    ? text
    : text.slice(0, maxLength - 15) + "\n\n[truncated]";
}

function decode(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);|&#(x[0-9a-f]+|\d+);/gi,
      (_: string, named: string, numeric: string) => named
        ? ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[named.toLowerCase()]
        : String.fromCodePoint(parseInt(
          numeric[0].toLowerCase() === "x" ? numeric.slice(1) : numeric,
          numeric[0].toLowerCase() === "x" ? 16 : 10,
        )),
    );
}

function strip(text: string) {
  return decode(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function tag(xml: string, name: string) {
  return xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1];
}

function attr(text: string, name: string) {
  return text.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
}

function parseArxivURL(raw: string): Target {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (!["arxiv.org", "www.arxiv.org", "export.arxiv.org", "ar5iv.labs.arxiv.org"].includes(host)) {
    throw new Error("unsupported URL: use fetch_content for non-arXiv URLs.");
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.some((part) => part === ".." || part.includes("\\") || part.includes("\0"))) {
    throw new Error("unsupported unsafe arXiv URL.");
  }

  let requested: Target["requested"];
  let token: string | undefined;
  const identifier = parts.slice(1).join("/");
  if (host === "ar5iv.labs.arxiv.org" && parts[0] === "html") {
    requested = "html";
    token = identifier;
  } else if (["abs", "pdf", "html"].includes(parts[0] || "")) {
    requested = parts[0] as Target["requested"];
    token = identifier.replace(/\.pdf$/i, "");
  } else if (["src", "e-print", "ps", "dvi"].includes(parts[0] || "")) {
    throw new Error("unsupported arXiv src/e-print/ps/dvi URL: source archives are not fetched.");
  } else {
    throw new Error("unsupported arXiv URL: expected /abs, /html, or /pdf.");
  }

  if (!token) throw new Error("unsupported arXiv paper URL.");
  const match = token.match(/^((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7}))(v\d+)?$/i);
  if (!match) throw new Error("invalid arXiv identifier.");
  return { id: match[1].toLowerCase(), version: match[2], requested };
}

async function fetchText(
  url: string,
  deadline: number,
  accept = "text/html,application/xml;q=0.9,*/*;q=0.1",
) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("shared 30s request budget exhausted");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "PipiUI-arxiv-fetch/0.1 (+local Pi package)",
        Accept: accept,
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function metadata(target: Target, deadline: number): Promise<Paper> {
  const key = target.id + (target.version || "");
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  if (inflight.has(key)) return inflight.get(key)!;

  const job = (async () => {
    const delay = Math.max(0, lastAPIStart + API_GAP_MS - Date.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastAPIStart = Date.now();

    const response = await fetchText(
      `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(target.id + (target.version || ""))}`,
      deadline,
      "application/atom+xml",
    );
    const xml = await response.text();
    const entry = tag(xml, "entry");
    if (!entry) throw new Error("arXiv Atom API returned no entry");

    const links = [...entry.matchAll(/<link\b[^>]*>/gi)]
      .map((match) => attr(match[0], "href"))
      .filter(Boolean) as string[];
    const categories = [...entry.matchAll(/<category\b[^>]*>/gi)]
      .map((match) => attr(match[0], "term"))
      .filter(Boolean) as string[];
    const paper: Paper = {
      id: target.id,
      resolved: tag(entry, "id")?.match(/\/abs\/([^\s<]+)/)?.[1],
      title: strip(tag(entry, "title") || "Untitled"),
      authors: [...entry.matchAll(/<author\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
        .map((match) => strip(match[1])),
      summary: strip(tag(entry, "summary") || ""),
      categories,
      primary: attr(entry.match(/<arxiv:primary_category\b[^>]*>/i)?.[0] || "", "term"),
      published: strip(tag(entry, "published") || ""),
      updated: strip(tag(entry, "updated") || ""),
      comment: strip(tag(entry, "arxiv:comment") || ""),
      journal: strip(tag(entry, "arxiv:journal_ref") || ""),
      doi: strip(tag(entry, "arxiv:doi") || ""),
      links,
      withdrawn: /withdrawn/i.test(
        strip(tag(entry, "summary") || "") + " " + strip(tag(entry, "title") || ""),
      ),
    };
    cache.set(key, { value: paper, until: Date.now() + (target.version ? 3_600_000 : 60_000) });
    return paper;
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

function htmlMarkdown(raw: string) {
  const main = raw.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] || raw;
  let text = main.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, "");
  text = text
    .replace(/<math[^>]*alttext=["']([^"']+)["'][^>]*>[\s\S]*?<\/math>/gi, " $1 ")
    .replace(/<(h[1-6])[^>]*>/gi, (_: string, heading: string) => "\n\n" + "#".repeat(+heading[1]) + " ")
    .replace(/<\/(p|div|section|figure|table|figcaption|caption|li|h[1-6])>/gi, "\n\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<pre[^>]*>/gi, "\n```\n")
    .replace(/<\/pre>/gi, "\n```\n");
  return strip(text.replace(/\n/g, " \n "))
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

async function html(id: string, host: string, deadline: number) {
  const response = await fetchText(`${host}/html/${encodeURIComponent(id)}`, deadline);
  const text = htmlMarkdown(await response.text());
  if (text.replace(/\s/g, "").length < 160) throw new Error("HTML quality gate failed");
  return text;
}

function render(
  paper: Paper,
  source: string,
  body: string,
  warning?: string,
  requestedVersion = paper.id,
) {
  return [
    `# ${paper.title}`,
    "",
    `paper_id: ${paper.id}`,
    `requested_version: ${requestedVersion}`,
    `resolved_version: ${paper.resolved || "unknown"}`,
    `authors: ${paper.authors.join(", ")}`,
    `categories: ${paper.categories.join(", ")}`,
    `primary_category: ${paper.primary || ""}`,
    `published: ${paper.published || ""}`,
    `updated: ${paper.updated || ""}`,
    `doi: ${paper.doi || ""}`,
    `journal_ref: ${paper.journal || ""}`,
    `links: ${paper.links.join(" ")}`,
    `content_source: ${source}`,
    paper.withdrawn ? "> Warning: arXiv metadata indicates this paper may be withdrawn." : "",
    warning ? `> Warning: ${warning}` : "",
    "## Abstract",
    "",
    paper.summary,
    "",
    "## Body",
    "",
    body,
  ].filter(Boolean).join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "arxiv_fetch",
    label: "arXiv Fetch",
    description: "Fetch arXiv paper metadata and readable content. Use for arxiv.org/export.arxiv.org/ar5iv URLs; use fetch_content for other URLs.",
    promptSnippet: "Fetch an arXiv paper with metadata and readable HTML",
    promptGuidelines: [
      "Route arXiv domains to arxiv_fetch; use fetch_content for all other URLs.",
      "Never use source/e-print routes. For direct PDF extraction, use fetch_content when pi-web-access is mounted.",
    ],
    parameters: Type.Object({
      url: Type.String(),
      max_length: Type.Optional(Type.Integer({ minimum: 1000, maximum: 100000 })),
    }),
    async execute(_id, params) {
      const deadline = Date.now() + TOTAL_BUDGET_MS;
      const maxLength = Math.min(Math.max(Number(params.max_length || 20000), 1000), 100000);
      try {
        const target = parseArxivURL(String(params.url || ""));
        const paper = await metadata(target, deadline);
        const id = paper.resolved || target.id;
        let body = "";
        let source = "abstract-only";
        let warning = "";

        try {
          body = await html(id, "https://arxiv.org", deadline);
          source = "arxiv-html";
        } catch {
          try {
            body = await html(id, "https://ar5iv.labs.arxiv.org", deadline);
            source = "ar5iv";
            warning = "ar5iv does not guarantee the requested version.";
          } catch {
            if (target.requested === "pdf") {
              warning = "PDF content is available through fetch_content when pi-web-access is mounted.";
            }
          }
        }

        return result(trunc(
          render(paper, source, body, warning, target.id + (target.version || "")),
          maxLength,
        ));
      } catch (error: any) {
        return result(`arxiv_fetch failed: ${error.message || error}`, true);
      }
    },
  });
}
