import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocumentsOpenedInjection, DocumentInjectionStore, prependDocumentInjection } from "../src/document-inject.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

describe("document injection", () => {
  it("prepends pending context once onto the next user prompt", () => {
    const store = new DocumentInjectionStore();
    store.setPending("s1", "[文档面板] 用户打开了文档：/a.md\n--- 文档内容 ---\nhello", ["/a.md"]);
    expect(prependDocumentInjection("你能看到吗？", store.takePending("s1"))).toBe(
      "[文档面板] 用户打开了文档：/a.md\n--- 文档内容 ---\nhello\n\n你能看到吗？",
    );
    expect(store.takePending("s1")).toBeUndefined();
  });

  it("reads markdown text and only summarizes binary office files", async () => {
    root = await mkdtemp(join(tmpdir(), "doc-inject-"));
    const md = join(root, "notes.md");
    const doc = join(root, "form.doc");
    await writeFile(md, "# 幼儿\n可见正文");
    await writeFile(doc, Buffer.alloc(2048));
    const text = await buildDocumentsOpenedInjection([md, doc]);
    expect(text).toContain("可见正文");
    expect(text).toContain(md);
    expect(text).toContain(doc);
    expect(text).toContain("请用 read 工具");
    expect(text).not.toMatch(/\0/);
  });

  it("tells the model to parse opened PDFs with pipiui_firecrawl_pdf instead of read", async () => {
    root = await mkdtemp(join(tmpdir(), "doc-inject-pdf-"));
    const pdf = join(root, "scan.pdf");
    await writeFile(pdf, Buffer.from("%PDF-1.4\n"));
    const text = await buildDocumentsOpenedInjection([pdf]);
    expect(text).toContain(pdf);
    expect(text).toContain("pipiui_firecrawl_pdf");
    expect(text).toContain("默认本地提取文字");
    expect(text).not.toContain("请用 read 工具");
  });
});
