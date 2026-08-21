import { promises as fs } from "node:fs";
import { isAbsolute } from "node:path";
import {
  DOCUMENT_INJECTION_EXCERPT_LIMIT,
  documentKindForName,
  documentsOpenedInjection,
  type DocumentInjectionEntry,
  type DocumentInjectionSource,
} from "@pipi/host-api";
import { convertDocumentFileToMarkdown } from "./anydoc-convert.js";

export function truncateDocumentExcerpt(text: string, max = DOCUMENT_INJECTION_EXCERPT_LIMIT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(已截断)`;
}

export function prependDocumentInjection(userText: string, injection?: string): string {
  const extra = injection?.trim();
  if (!extra) return userText;
  return `${extra}\n\n${userText}`;
}

export class DocumentInjectionStore {
  private readonly pending = new Map<string, { text: string; paths: string[] }>();

  setPending(sessionId: string, text: string, paths: readonly string[]): void {
    const id = sessionId.trim();
    const injection = text.trim();
    if (!id || !injection) return;
    const incoming = paths.map(path => path.trim()).filter(Boolean);
    const previous = this.pending.get(id);
    if (!previous) {
      this.pending.set(id, { text: injection, paths: incoming });
      return;
    }
    const extra = incoming.filter(path => !previous.paths.includes(path));
    this.pending.set(id, {
      text: extra.length ? `${previous.text}\n\n${injection}` : previous.text,
      paths: [...previous.paths, ...extra],
    });
  }

  takePending(sessionId: string): string | undefined {
    const item = this.pending.get(sessionId);
    if (!item) return;
    this.pending.delete(sessionId);
    return item.text;
  }
}

export type BinaryMarkdownConverter = (path: string) => Promise<string | undefined>;

export async function buildDocumentsOpenedInjection(
  paths: readonly string[],
  options: {
    source?: DocumentInjectionSource;
    convertBinary?: BinaryMarkdownConverter;
    anydocRoot?: string;
  } = {},
): Promise<string> {
  const source = options.source === "composer" ? "composer" : "panel";
  const convertBinary = options.convertBinary
    ?? ((path: string) => convertDocumentFileToMarkdown(path, { anydocRoot: options.anydocRoot }));
  const entries: DocumentInjectionEntry[] = [];
  for (const raw of paths) {
    const path = raw.trim();
    if (!path || !isAbsolute(path)) continue;
    const kind = documentKindForName(path);
    if (!kind) continue;
    if (kind === "markdown" || kind === "plain") {
      try {
        const fileStat = await fs.stat(path);
        if (!fileStat.isFile()) {
          entries.push({ path, kind });
          continue;
        }
        const content = await fs.readFile(path, "utf8");
        entries.push({ path, kind, excerpt: truncateDocumentExcerpt(content) });
      } catch {
        entries.push({ path, kind });
      }
      continue;
    }
    if (kind !== "pdf") {
      const markdown = await convertBinary(path).catch(() => undefined);
      if (markdown?.trim()) {
        entries.push({ path, kind, excerpt: truncateDocumentExcerpt(markdown) });
        continue;
      }
    }
    try {
      const fileStat = await fs.stat(path);
      entries.push({ path, kind, binary: true, size: fileStat.size });
    } catch {
      entries.push({ path, kind, binary: true });
    }
  }
  return documentsOpenedInjection(entries, { source });
}
