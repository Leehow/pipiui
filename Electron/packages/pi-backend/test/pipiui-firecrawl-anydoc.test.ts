import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import firecrawlAnydoc, {
  FIRECRAWL_ANYDOC_TOOL,
  executeFirecrawlAnydoc,
  resolveAnydocSource,
} from "../../../resources/runtime/extensions/pipiui-firecrawl-anydoc.ts";
import {
  ANYDOC_VERSION,
  anydocEngineAvailability,
  anydocNativePackageName,
  convertBytesWithAnydoc,
} from "../../../resources/runtime/extensions/anydoc-local.ts";

describe("pipiui-firecrawl-anydoc local extraction", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  function loadTool() {
    let tool: { name: string; execute: Function } | undefined;
    firecrawlAnydoc({ registerTool: (definition: { name: string; execute: Function }) => { tool = definition; } } as never);
    return tool!;
  }

  it("registers a single focused tool", () => {
    expect(loadTool().name).toBe(FIRECRAWL_ANYDOC_TOOL);
  });

  it("rejects uploads, PDFs, relative paths, and unknown formats", () => {
    expect(resolveAnydocSource("https://example.com/doc.docx")).toMatchObject({ error: expect.stringContaining("不会上传") });
    expect(resolveAnydocSource("ftp://x")).toMatchObject({ error: expect.stringContaining("不会上传") });
    expect(resolveAnydocSource("/abs/scan.pdf")).toMatchObject({ error: expect.stringContaining("pipiui_firecrawl_pdf") });
    expect(resolveAnydocSource("relative.docx")).toMatchObject({ error: expect.stringContaining("绝对路径") });
    expect(resolveAnydocSource("/abs/skip.js")).toMatchObject({ error: expect.stringContaining("不支持") });
    expect(resolveAnydocSource("")).toMatchObject({ error: expect.stringContaining("不能为空") });
    expect(resolveAnydocSource("/abs/form.docx")).toEqual({ kind: "local", path: "/abs/form.docx" });
    expect(resolveAnydocSource("file:///tmp/notes.odt")).toEqual({ kind: "local", path: "/tmp/notes.odt" });
  });

  it("extracts a local csv without uploading", async () => {
    root = await mkdtemp(join(tmpdir(), "anydoc-local-"));
    const csv = join(root, "table.csv");
    await writeFile(csv, "name,age\nAda,36\n");
    const convert = vi.fn(async () => ({ engine: "wasm" as const, markdown: "| name | age |\n| Ada | 36 |", format: "csv" }));
    const result = await executeFirecrawlAnydoc({ source: csv }, { convert });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Ada");
    expect(convert).toHaveBeenCalledOnce();
    expect(JSON.stringify(convert.mock.calls)).not.toMatch(/https?:\/\//i);
  });

  it("returns a clear error when convert yields no markdown", async () => {
    root = await mkdtemp(join(tmpdir(), "anydoc-empty-"));
    const doc = join(root, "empty.docx");
    await writeFile(doc, Buffer.from("PK"));
    const result = await executeFirecrawlAnydoc({ source: doc }, { convert: async () => ({ engine: "wasm", markdown: "  " }) });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("没有得到正文");
  });

  it("imports the official anydoc wasm adapter", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../../resources/runtime/anydoc/node_modules/@firecrawl/anydoc/package.json", import.meta.url), "utf8"));
    expect(manifest.version).toBe(ANYDOC_VERSION);
    expect(manifest.version).toBe("0.2.3");
    expect(anydocNativePackageName("darwin", "arm64")).toBe("@firecrawl/anydoc-darwin-arm64");
    const shipped = new URL("../../../resources/runtime/anydoc/node_modules", import.meta.url);
    const { fileURLToPath } = await import("node:url");
    const availability = anydocEngineAvailability(fileURLToPath(shipped));
    expect(availability.wasm).toBe(true);
    root = await mkdtemp(join(tmpdir(), "anydoc-csv-"));
    const csv = join(root, "people.csv");
    await writeFile(csv, "name,role\nPipi,agent\n");
    const result = await convertBytesWithAnydoc(await readFile(csv), { path: csv });
    expect(["native", "wasm"]).toContain(result.engine);
    expect(result.markdown).toMatch(/Pipi|name/i);
  });
});
