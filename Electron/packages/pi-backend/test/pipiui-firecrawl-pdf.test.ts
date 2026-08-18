import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import firecrawlPdf, {
  FIRECRAWL_PARSE_URL,
  FIRECRAWL_PDF_TOOL,
  MAX_PDF_BYTES,
  OCR_KEY_HINT,
  OCR_MODE_NEEDS_KEY,
  downloadPdfBytes,
  executeFirecrawlPdf,
  resolvePdfSource,
} from "../../../resources/runtime/extensions/pipiui-firecrawl-pdf.ts";
import {
  PDF_INSPECTOR_VERSION,
  inspectPdfWithOfficial,
  normalizeInspectorResult,
} from "../../../resources/runtime/extensions/pdf-inspector-local.ts";

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

describe("pipiui-firecrawl-pdf local extraction", () => {
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

  it("registers a single focused tool", () => {
    expect(loadTool().name).toBe(FIRECRAWL_PDF_TOOL);
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
    const result = await executeFirecrawlPdf({ source: pdf }, { apiKey: null, inspect });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Hello Inspector");
    expect(inspect).toHaveBeenCalledOnce();
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
    expect(scanned.isError).toBe(true);
    expect(scanned.content[0].text).toBe(OCR_KEY_HINT);
    expect(scanned.content[0].text).not.toMatch(/未配置 Firecrawl API Key/);

    const mixed = await executeFirecrawlPdf(
      { source: pdf },
      {
        apiKey: null,
        inspect: async () => ({ engine: "native", pdfType: "Mixed", markdown: "visible text", pageCount: 4, pagesNeedingOcr: [3] }),
      },
    );
    expect(mixed.isError).toBeUndefined();
    expect(mixed.content[0].text).toContain("visible text");
    expect(mixed.content[0].text).toContain("建议 OCR");
    expect(mixed.content[0].text).toContain("无需 Key");
  });

  it("auto with a key calls cloud parse only when OCR is indicated", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-auto-"));
    const pdf = join(root, "a.pdf");
    await writeFile(pdf, TEXT_PDF);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { markdown: "ocr cloud" } }), { status: 200 }));
    const ocr = await executeFirecrawlPdf(
      { source: pdf, mode: "auto" },
      {
        apiKey: "fc-secret",
        fetchImpl: fetchImpl as never,
        inspect: async () => ({ engine: "native", pdfType: "Scanned", markdown: "", pageCount: 2, pagesNeedingOcr: [0, 1] }),
      },
    );
    expect(ocr.content[0].text).toBe("ocr cloud");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(FIRECRAWL_PARSE_URL);

    fetchImpl.mockClear();
    const text = await executeFirecrawlPdf(
      { source: pdf, mode: "auto" },
      {
        apiKey: "fc-secret",
        fetchImpl: fetchImpl as never,
        inspect: async () => ({ engine: "native", pdfType: "TextBased", markdown: "local only", pageCount: 1, pagesNeedingOcr: [] }),
      },
    );
    expect(text.content[0].text).toContain("local only");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fast never calls the cloud even with a key; ocr without a key keeps local extract available", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-fast-"));
    const pdf = join(root, "a.pdf");
    await writeFile(pdf, TEXT_PDF);
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const fast = await executeFirecrawlPdf(
      { source: pdf, mode: "fast" },
      {
        apiKey: "fc-secret",
        fetchImpl: fetchImpl as never,
        inspect: async () => ({ engine: "native", pdfType: "Scanned", markdown: "fast text", pageCount: 1, pagesNeedingOcr: [0] }),
      },
    );
    expect(fast.content[0].text).toContain("fast text");
    expect(fast.content[0].text).toContain("fast 模式不调用云端");
    expect(fetchImpl).not.toHaveBeenCalled();

    const ocr = await executeFirecrawlPdf({ source: pdf, mode: "ocr" }, { apiKey: null, fetchImpl: fetchImpl as never });
    expect(ocr.content[0].text).toBe(OCR_MODE_NEEDS_KEY);
    expect(ocr.content[0].text).toContain("auto/fast");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects oversize downloads, non-PDF bodies, and bad URLs", async () => {
    expect(resolvePdfSource("ftp://x")).toMatchObject({ error: expect.stringContaining("http/https") });
    const tooBig = await downloadPdfBytes({
      url: "https://example.com/huge.pdf",
      timeout: 1000,
      fetchImpl: (async () => new Response("x", { status: 200, headers: { "content-length": String(MAX_PDF_BYTES + 1) } })) as never,
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toContain("50MB");

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

  it("imports the official pdf-inspector adapter and returns its documented shape", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../../resources/runtime/pdf-inspector/node_modules/@firecrawl/pdf-inspector/package.json", import.meta.url), "utf8"));
    expect(manifest.version).toBe(PDF_INSPECTOR_VERSION);
    expect(manifest.version).toBe("1.15.0");
    const result = await inspectPdfWithOfficial(TEXT_PDF);
    expect(["native", "wasm"]).toContain(result.engine);
    expect(result).toEqual(expect.objectContaining({
      pdfType: expect.any(String),
      markdown: expect.any(String),
      pageCount: expect.any(Number),
      pagesNeedingOcr: expect.any(Array),
    }));
    expect(normalizeInspectorResult({ pdfType: "TextBased", markdown: "x", pageCount: 2, pagesNeedingOcr: [1] }, "native")).toEqual({
      engine: "native",
      pdfType: "TextBased",
      markdown: "x",
      pageCount: 2,
      pagesNeedingOcr: [1],
      confidence: undefined,
    });
    expect(result.pageCount).toBeGreaterThan(0);
    expect(typeof result.pdfType).toBe("string");
  });
});
