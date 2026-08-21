import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-document-read-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  return createPiHostBackend({ agentDir });
}

describe("explicit local document reads", () => {
  it("returns the real requested Markdown file without scanning a project", async () => {
    const backend = await fixture();
    const path = join(root, "notes.markdown");
    await writeFile(path, "# Real document\n\nLoaded from disk.\n");

    expect(await backend.handle("listDocuments", [])).toEqual([]);
    await backend.handle("watchDocument", [path]);
    expect(await backend.handle("listDocuments", [])).toMatchObject([{ id: path, path, name: "notes.markdown", kind: "markdown" }]);
    expect(await backend.handle("readDocument", [path])).toMatchObject({
      id: path,
      name: "notes.markdown",
      path,
      kind: "markdown",
      content: "# Real document\n\nLoaded from disk.\n",
    });
    await backend.close();
  });

  it("returns TXT as text and PDF/Office as Uint8Array without base64", async () => {
    const backend = await fixture();
    const text = join(root, "notes.txt");
    await writeFile(text, "plain text");
    expect(await backend.handle("readDocument", [text])).toMatchObject({ kind: "plain", content: "plain text" });
    const csv = join(root, "table.csv");
    await writeFile(csv, "name,age\n");
    expect(await backend.handle("readDocument", [csv])).toMatchObject({ kind: "plain", content: "name,age\n" });

    const fixtures = [
      ["report.pdf", "pdf"],
      ["contract.doc", "word"],
      ["contract.docx", "word"],
      ["budget.xls", "spreadsheet"],
      ["budget.xlsx", "spreadsheet"],
      ["deck.ppt", "presentation"],
      ["deck.pptx", "presentation"],
      ["notes.odt", "word"],
      ["book.epub", "word"],
      ["table.ods", "spreadsheet"],
    ] as const;
    for (const [name, kind] of fixtures) {
      const path = join(root, name);
      await writeFile(path, new Uint8Array([0, 1, 2, 255]));
      const result = await backend.handle("readDocument", [path]) as any;
      expect(result).toMatchObject({ id: path, name, path, kind, size: 4 });
      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(result.bytes)).toEqual([0, 1, 2, 255]);
      expect(result).not.toHaveProperty("content");
      expect(result).not.toHaveProperty("base64");
    }
    await backend.close();
  });

  it("rejects missing, relative, unsupported, non-file, and proportionally oversized inputs", async () => {
    const backend = await fixture();
    const directory = join(root, "folder.md");
    const unsupported = join(root, "notes.js");
    const oversized = join(root, "large.md");
    const oversizedPdf = join(root, "large.pdf");
    await mkdir(directory);
    await writeFile(unsupported, "plain");
    await writeFile(oversized, Buffer.alloc(2 * 1024 * 1024 + 1));
    await writeFile(oversizedPdf, "");
    await truncate(oversizedPdf, 50 * 1024 * 1024 + 1);

    await expect(backend.handle("readDocument", [""])).rejects.toMatchObject({ code: "document_invalid_path" });
    await expect(backend.handle("readDocument", ["relative.md"])).rejects.toMatchObject({ code: "document_invalid_path" });
    await expect(backend.handle("readDocument", [unsupported])).rejects.toMatchObject({ code: "document_unsupported_type" });
    await expect(backend.handle("readDocument", [directory])).rejects.toMatchObject({ code: "document_not_file" });
    await expect(backend.handle("readDocument", [join(root, "missing.md")])).rejects.toMatchObject({ code: "document_not_found" });
    await expect(backend.handle("readDocument", [oversized])).rejects.toMatchObject({ code: "document_too_large" });
    await expect(backend.handle("readDocument", [oversizedPdf])).rejects.toMatchObject({ code: "document_too_large" });
    await backend.close();
  });

  it("notifyDocumentsDropped without a session degrades without throwing", async () => {
    const backend = await fixture();
    await expect(backend.handle("notifyDocumentsDropped", ["", [join(root, "notes.md")]])).resolves.toBeUndefined();
    await backend.close();
  });

  it("notifyComposerDocumentsDropped injects without remembering opened documents", async () => {
    const backend = await fixture();
    const path = join(root, "form.docx");
    await writeFile(path, Buffer.alloc(64));
    await expect(backend.handle("notifyComposerDocumentsDropped", ["s1", [path]])).resolves.toBeUndefined();
    expect(await backend.handle("listDocuments", [])).toEqual([]);
    await backend.close();
  });

  it("does not enqueue a queued user message when the session is already busy", async () => {
    const backend = await fixture();
    const path = join(root, "notes.md");
    await writeFile(path, "# Visible from the panel\n\n幼儿姓名：测试。\n");
    (backend as { queue: { markBusy(sessionId: string): number } }).queue.markBusy("s1");
    await backend.handle("notifyDocumentsDropped", ["s1", [path]]);
    expect(await backend.handle("listQueue", ["s1"])).toEqual([]);
    await backend.close();
  });
});
