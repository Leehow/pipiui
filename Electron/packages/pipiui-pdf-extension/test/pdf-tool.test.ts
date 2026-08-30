import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import firecrawlPdf, {
  FIRECRAWL_PDF_TOOL,
  MAX_PDF_BYTES,
  MAX_PDF_MB_LABEL,
  OCR_MODE_NEEDS_KEY,
  OCR_SKIPPED_NOTE,
  downloadPdfBytes,
  executeFirecrawlPdf,
  resolvePdfSource,
} from "../agent/index.ts";

function buildMinimalPdf() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    "4 0 obj\n<< /Length 55 >>\nstream\nBT /F1 24 Tf 100 700 Td (Hello Inspector) Tj ET\nendstream\nendobj\n",
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body);
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let index = 1; index <= 5; index += 1) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  body += `${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body);
}
const TEXT_PDF = buildMinimalPdf();

describe("pipiui_firecrawl_pdf tool contract", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
    delete process.env.PI_CODING_AGENT_DIR;
  });

  function loadTool() {
    let tool: { name: string; execute: Function } | undefined;
    firecrawlPdf({ registerTool: (definition: { name: string; execute: Function }) => { tool = definition; } } as never);
    return tool!;
  }

  it("registers a single focused tool and keeps the public name stable", () => {
    expect(loadTool().name).toBe(FIRECRAWL_PDF_TOOL);
    expect(FIRECRAWL_PDF_TOOL).toBe("pipiui_firecrawl_pdf");
  });

  it("extracts a local text PDF without any API key", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-local-"));
    const pdf = join(root, "hello.pdf");
    await writeFile(pdf, TEXT_PDF);
    const inspect = vi.fn(async () => ({
      engine: "native" as const,
      pdfType: "TextBased",
      markdown: "# Hello Inspector",
      pageCount: 1,
      pagesNeedingOcr: [],
    }));
    const ocrFn = vi.fn(async () => ({ ok: true as const, text: "should not run" }));
    const result = await executeFirecrawlPdf({ source: pdf }, { apiKey: null, inspect, ocrFn });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Hello Inspector");
    expect(inspect).toHaveBeenCalledOnce();
    expect(ocrFn).not.toHaveBeenCalled();
  });

  it("downloads a URL PDF and extracts it locally without a key", async () => {
    const fetchImpl = vi.fn(async () => new Response(TEXT_PDF, { status: 200, headers: { "content-type": "application/pdf" } }));
    const inspect = vi.fn(async () => ({
      engine: "wasm" as const,
      pdfType: "TextBased",
      markdown: "from url",
      pageCount: 1,
      pagesNeedingOcr: [],
    }));
    const result = await executeFirecrawlPdf(
      { source: "https://example.com/doc" },
      { apiKey: null, inspect, fetchImpl: fetchImpl as never },
    );
    expect(result.content[0].text).toContain("from url");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(fetchImpl.mock.calls[0]?.[1] ?? {})).not.toMatch(/Authorization/i);
  });

  it("without a key, a scanned PDF reports OCR as optional and still treats local parse as available", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-scan-"));
    const pdf = join(root, "scan.pdf");
    await writeFile(pdf, TEXT_PDF);
    const scanned = await executeFirecrawlPdf(
      { source: pdf },
      {
        apiKey: null,
        inspect: async () => ({ engine: "native", pdfType: "Scanned", markdown: "", pageCount: 3, pagesNeedingOcr: [0, 1, 2] }),
      },
    );
    expect(scanned.isError).toBeUndefined();
    expect(scanned.content[0].text).toContain(OCR_SKIPPED_NOTE);
    expect(scanned.content[0].text).toContain("OCR 未执行");

    const mixed = await executeFirecrawlPdf(
      { source: pdf },
      {
        apiKey: null,
        inspect: async () => ({ engine: "native", pdfType: "Mixed", markdown: "visible text", pageCount: 4, pagesNeedingOcr: [3] }),
      },
    );
    expect(mixed.isError).toBeUndefined();
    expect(mixed.content[0].text).toContain("visible text");
    expect(mixed.content[0].text).toContain("OCR 未执行");
  });

  it("auto with a token calls PaddleOCR only when OCR is indicated", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-auto-"));
    const pdf = join(root, "a.pdf");
    await writeFile(pdf, TEXT_PDF);
    const ocrFn = vi.fn(async (filePath: string) => {
      expect(filePath).toBe(pdf);
      return { ok: true as const, text: "ocr paddle" };
    });
    const ocr = await executeFirecrawlPdf(
      { source: pdf, mode: "auto" },
      {
        apiKey: "ast-secret",
        ocrFn,
        inspect: async () => ({ engine: "native", pdfType: "Scanned", markdown: "", pageCount: 2, pagesNeedingOcr: [0, 1] }),
      },
    );
    expect(ocr.content[0].text).toBe("ocr paddle");
    expect(ocrFn).toHaveBeenCalledOnce();

    ocrFn.mockClear();
    const text = await executeFirecrawlPdf(
      { source: pdf, mode: "auto" },
      {
        apiKey: "ast-secret",
        ocrFn,
        inspect: async () => ({ engine: "native", pdfType: "TextBased", markdown: "local only", pageCount: 1, pagesNeedingOcr: [] }),
      },
    );
    expect(text.content[0].text).toContain("local only");
    expect(ocrFn).not.toHaveBeenCalled();
  });

  it("fast never calls OCR even with a token; ocr without a token errors clearly", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-fast-"));
    const pdf = join(root, "a.pdf");
    await writeFile(pdf, TEXT_PDF);
    const ocrFn = vi.fn(async () => ({ ok: true as const, text: "nope" }));
    const fast = await executeFirecrawlPdf(
      { source: pdf, mode: "fast" },
      {
        apiKey: "ast-secret",
        ocrFn,
        inspect: async () => ({ engine: "native", pdfType: "Scanned", markdown: "fast text", pageCount: 1, pagesNeedingOcr: [0] }),
      },
    );
    expect(fast.content[0].text).toContain("fast text");
    expect(fast.content[0].text).toContain("fast 模式永不调用 OCR");
    expect(ocrFn).not.toHaveBeenCalled();

    const ocr = await executeFirecrawlPdf({ source: pdf, mode: "ocr" }, { apiKey: null, ocrFn });
    expect(ocr.content[0].text).toBe(OCR_MODE_NEEDS_KEY);
    expect(ocr.content[0].text).toContain("缺少 PaddleOCR Token");
    expect(ocrFn).not.toHaveBeenCalled();
  });

  it("rejects oversize downloads, non-PDF bodies, and bad URLs", async () => {
    expect(resolvePdfSource("ftp://x")).toMatchObject({ error: expect.stringContaining("http/https") });
    const tooBig = await downloadPdfBytes({
      url: "https://example.com/huge.pdf",
      timeout: 1000,
      fetchImpl: (async () => new Response("x", { status: 200, headers: { "content-length": String(MAX_PDF_BYTES + 1) } })) as never,
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toContain(MAX_PDF_MB_LABEL);

    const notPdf = await downloadPdfBytes({
      url: "https://example.com/page",
      timeout: 1000,
      fetchImpl: (async () => new Response("<html></html>", { status: 200 })) as never,
    });
    expect(notPdf.ok).toBe(false);
    if (!notPdf.ok) expect(notPdf.error).toContain("%PDF-");

    const badStatus = await downloadPdfBytes({
      url: "https://example.com/missing.pdf",
      timeout: 1000,
      fetchImpl: (async () => new Response("nope", { status: 404 })) as never,
    });
    expect(badStatus.ok).toBe(false);
    if (!badStatus.ok) expect(badStatus.error).toContain("404");
  });

  it("cancels a remote stream when successive chunks cross a lying Content-Length", async () => {
    const limit = 32;
    let cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(20).fill(0x61));
        controller.enqueue(new Uint8Array(20).fill(0x62));
        controller.enqueue(new Uint8Array(20).fill(0x63));
      },
      cancel() {
        cancelled += 1;
      },
    });
    const result = await downloadPdfBytes({
      url: "https://example.com/grew.pdf",
      timeout: 1000,
      maxBytes: limit,
      fetchImpl: (async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-length": "12" },
        })) as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(MAX_PDF_MB_LABEL);
      expect(result.error).toMatch(/下载中 \d+ 字节/);
    }
    expect(cancelled).toBe(1);
  });

  it("validates local sources before touching them", async () => {
    expect(resolvePdfSource("")).toMatchObject({ error: expect.stringContaining("不能为空") });
    expect(resolvePdfSource("relative/path.pdf")).toMatchObject({ error: expect.stringContaining("绝对路径") });
    expect(resolvePdfSource("file:///tmp/x.pdf")).toMatchObject({ kind: "local", path: "/tmp/x.pdf" });
    expect(resolvePdfSource("/tmp/x.PDF?q=1")).toMatchObject({ kind: "local", path: "/tmp/x.PDF?q=1" });

    const missing = await executeFirecrawlPdf({ source: "/definitely/not/here.pdf" }, { apiKey: null });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("找不到本地 PDF");

    root = await mkdtemp(join(tmpdir(), "fc-badmagic-"));
    const notPdfPath = join(root, "fake.pdf");
    await writeFile(notPdfPath, "NOT A PDF");
    const fake = await executeFirecrawlPdf({ source: notPdfPath }, { apiKey: null });
    expect(fake.isError).toBe(true);
    expect(fake.content[0].text).toContain("%PDF-");
  });

  it("redacts tokens from surfaced OCR failures and caps error length", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-redact-"));
    const pdf = join(root, "a.pdf");
    await writeFile(pdf, TEXT_PDF);
    const failed = await executeFirecrawlPdf(
      { source: pdf, mode: "ocr" },
      {
        apiKey: "ast-leak-token",
        ocrFn: async () => ({ ok: false as const, error: "boom ast-leak-token fc-abcdef123456 traceback" }),
      },
    );
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).not.toContain("ast-leak-token");
    expect(failed.content[0].text).not.toContain("fc-abcdef123456");
    expect(failed.content[0].text).toContain("[redacted]");
  });
});
