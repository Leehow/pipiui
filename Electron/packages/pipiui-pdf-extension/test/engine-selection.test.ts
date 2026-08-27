import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_PAGES,
  MAX_PDF_BYTES,
  MAX_TIMEOUT_MS,
  MIN_PAGES,
  executeFirecrawlPdf,
  normalizeMaxPages,
  normalizeTimeoutMs,
  readLocalPdfBytes,
} from "../agent/index.ts";
import { inspectPdfWithOfficial } from "../agent/pdf-inspector-local.ts";

/**
 * Engine selection and resource-bound integration coverage that the contract
 * tests above deliberately skip: param normalization bounds, oversized local
 * rejection, native→wasm fallback (and the fail-loud no-engine error), plus the
 * temporary remote-file lifecycle behind OCR of downloaded PDFs.
 */

function buildMinimalPdf(text = "Hello Inspector") {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${text.length + 20} >>\nstream\nBT /F1 24 Tf 100 700 Td (${text}) Tj ET\nendstream\nendobj\n`,
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

let roots: string[] = [];
afterEach(async () => {
  for (const dir of roots.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }).catch(() => undefined);
  }
});

async function scratch(prefix = "pdf-engine-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/** Fake owned-dependency tree: a controllable native binding plus optional real wasm. */
async function makeFakeInspectorNodeModules(native: "succeed" | "throw", withWasm: boolean) {
  const nm = join(await scratch(), "node_modules");
  const scoped = join(nm, "@firecrawl");
  await mkdir(join(scoped, "pdf-inspector"), { recursive: true });
  // Availability marker: the darwin-arm64 optional dependency directory exists…
  await mkdir(join(scoped, "pdf-inspector-darwin-arm64"), { recursive: true });
  await writeFile(
    join(scoped, "pdf-inspector", "package.json"),
    JSON.stringify({ name: "@firecrawl/pdf-inspector", version: "1.15.0", main: "index.js" }),
  );
  const body =
    native === "throw"
      ? "module.exports = { processPdf() { throw new Error('dlopen: symbol not found'); } };"
      : "module.exports = { processPdf() { return { markdown: 'native extract', pdfType: 'TextBased', pageCount: 2, pagesNeedingOcr: [] }; } };";
  await writeFile(join(scoped, "pdf-inspector", "index.js"), body);
  if (withWasm) {
    // …while the wasm slice symlinks the real vendored engine so the fallback runs for real.
    const realWasm = new URL("../vendor/pdf-inspector/node_modules/@firecrawl/pdf-inspector-wasm/", import.meta.url)
      .pathname;
    await symlink(realWasm, join(scoped, "pdf-inspector-wasm"), "dir");
  }
  return nm;
}

describe("parameter and size bounds", () => {
  it("clamps timeout into [1s, 300s] and defaults invalid input to 30s", () => {
    expect(normalizeTimeoutMs(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normalizeTimeoutMs(Number.NaN)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normalizeTimeoutMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normalizeTimeoutMs(0)).toBe(1000);
    expect(normalizeTimeoutMs(-99)).toBe(1000);
    expect(normalizeTimeoutMs(MAX_TIMEOUT_MS + 1)).toBe(MAX_TIMEOUT_MS);
    expect(normalizeTimeoutMs(45_678)).toBe(45_678);
  });

  it("accepts whole maxPages within [1, 10000] and rejects junk and out-of-range values", () => {
    expect(normalizeMaxPages(undefined)).toBeUndefined();
    expect(normalizeMaxPages(null)).toBeUndefined();
    expect(normalizeMaxPages(2.9)).toBe(2);
    expect(normalizeMaxPages(MAX_PAGES)).toBe(MAX_PAGES);
    for (const bad of ["5", 0, -1, MAX_PAGES + 1]) {
      const verdict = normalizeMaxPages(bad);
      expect(verdict && typeof verdict === "object" && "error" in verdict, `${String(bad)} must error`).toBe(true);
      if (typeof verdict === "object" && verdict && "error" in verdict) {
        expect(verdict.error).toContain(`maxPages 必须是 ${MIN_PAGES} 到 ${MAX_PAGES} 的整数`);
      }
    }
  });

  it("rejects an oversized local PDF before reading it and refuses non-file paths", async () => {
    const huge = (async () => ({ isFile: () => true, size: MAX_PDF_BYTES + 1 })) as never;
    expect(await readLocalPdfBytes("/somewhere/big.pdf", { stat: huge }))
      .toMatchObject({ ok: false, error: expect.stringContaining("50MB 上限") });

    const directory = (async () => ({ isFile: () => false, size: 12 })) as never;
    expect(await readLocalPdfBytes("/somewhere/dir", { stat: directory }))
      .toMatchObject({ ok: false, error: expect.stringContaining("普通 PDF 文件") });
  });
});

describe("native/wasm engine selection", () => {
  it("uses the native binding when it loads and answers", async () => {
    const nm = await makeFakeInspectorNodeModules("succeed", false);
    const result = await inspectPdfWithOfficial(new Uint8Array(TEXT_PDF), { nodeModules: nm });
    expect(result.engine).toBe("native");
    expect(result.markdown).toBe("native extract");
    expect(result.pageCount).toBe(2);
  });

  it("falls back to the real wasm engine when the native binding fails to load", async () => {
    const nm = await makeFakeInspectorNodeModules("throw", true);
    const result = await inspectPdfWithOfficial(new Uint8Array(TEXT_PDF), { nodeModules: nm });
    expect(result.engine).toBe("wasm");
    expect(typeof result.markdown).toBe("string");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("fails loud instead of pretending when neither engine is usable", async () => {
    const emptyNm = join(await scratch(), "empty-node_modules");
    await mkdir(emptyNm, { recursive: true });
    const bytes = new Uint8Array(TEXT_PDF);
    // Shipped-native platform whose optional dependency is missing AND wasm absent:
    await expect(inspectPdfWithOfficial(bytes, { nodeModules: emptyNm, platform: "win32", arch: "x64" }))
      .rejects.toThrow(/no usable engine/);
    // Platforms with no native vendor at all degrade to the same loud error:
    await expect(inspectPdfWithOfficial(bytes, { nodeModules: emptyNm, platform: "sunos", arch: "x64" }))
      .rejects.toThrow(/no usable engine/);
    // And the surfaced tool payload reports isError instead of throwing across the boundary.
    const realPdf = join(await scratch("pdf-engine-loud-"), "scan.pdf");
    await writeFile(realPdf, TEXT_PDF);
    const surfaced = await executeFirecrawlPdf(
      { source: realPdf },
      {
        apiKey: null,
        inspect: () => Promise.reject(new Error("pdf-inspector has no usable engine")),
      },
    );
    expect(surfaced.isError).toBe(true);
    expect(surfaced.content[0].text).toContain("本地 PDF 提取失败");
    expect(surfaced.content[0].text).toContain("no usable engine");
  });
});

describe("temporary remote-file cleanup during OCR", () => {
  it("removes the downloaded PDF's scratch file after OCR succeeds and after it fails", async () => {
    const fetchImpl = (async () =>
      new Response(TEXT_PDF, { status: 200, headers: { "content-type": "application/pdf" } })) as never;
    const scanned = (async () => ({
      engine: "native",
      pdfType: "Scanned",
      markdown: "",
      pageCount: 1,
      pagesNeedingOcr: [0],
    })) as never;

    const failurePaths: string[] = [];
    const failed = await executeFirecrawlPdf(
      { source: "https://example.com/report.pdf", mode: "auto" },
      {
        apiKey: "ast-cleanup-token",
        fetchImpl,
        inspect: scanned,
        ocrFn: async (filePath) => {
          failurePaths.push(filePath);
          return { ok: false as const, error: `quota exhausted for ${filePath}` };
        },
      },
    );
    expect(failed.isError).toBe(true);
    expect(failurePaths).toHaveLength(1);
    expect(dirname(failurePaths[0])).toMatch(/pipiui-paddleocr-/);

    const successPaths: string[] = [];
    const okResult = await executeFirecrawlPdf(
      { source: "https://example.com/report.pdf", mode: "auto" },
      {
        apiKey: "ast-cleanup-token",
        fetchImpl,
        inspect: scanned,
        ocrFn: async (filePath) => {
          successPaths.push(filePath);
          // While OCR runs, the scratch copy exists beside nothing else.
          expect(existsSync(filePath)).toBe(true);
          return { ok: true as const, text: "ocr done" };
        },
      },
    );
    expect(okResult.isError).toBeUndefined();
    expect(okResult.content[0].text).toBe("ocr done");
    expect(successPaths).toHaveLength(1);
    // Remote downloads OCR from a generic-named scratch copy (no path-shaped user data leaks).
    expect(successPaths[0].split("/").pop()).toMatch(/\.pdf$/);

    for (const path of [...failurePaths, ...successPaths]) {
      expect(existsSync(path), `scratch file ${path} must be cleaned`).toBe(false);
      expect(existsSync(dirname(path)), `scratch dir ${dirname(path)} must be cleaned`).toBe(false);
    }
  });
});
