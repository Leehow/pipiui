import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXTENSION_SECRET_ENV,
  PDF_EXTENSION_ID,
  PADDLEOCR_TOKEN_FIELD,
  SETTINGS_SECRET_KEY,
  executeFirecrawlPdf,
  loadPaddleocrToken,
  resolvePaddleocrToken,
  sanitizePublicError,
} from "../agent/index.ts";

const STUB_PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

describe("extension-secret env with legacy paddleocr.json fallback", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env[EXTENSION_SECRET_ENV];
  });

  it("names the project-scoped secret setting after this extension", () => {
    expect(PDF_EXTENSION_ID).toBe("pdf-extension");
    expect(SETTINGS_SECRET_KEY).toBe("ext.pdf-extension.aistudioAccessToken");
    // Same derivation as pi-backend extension-settings secretEnvName(key):
    // non-alphanumerics -> "_", uppercased. Pinning the literal keeps the
    // agent half decoupled from any backend import.
    const derived = SETTINGS_SECRET_KEY
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
    expect(EXTENSION_SECRET_ENV).toBe(derived);
    expect(EXTENSION_SECRET_ENV).toBe("EXT_PDF_EXTENSION_AISTUDIOACCESSTOKEN");
  });

  it("prefers the injected extension-secret env over the legacy config file", async () => {
    root = await mkdtemp(join(tmpdir(), "pdf-tok-"));
    await writeFile(
      join(root, "paddleocr.json"),
      JSON.stringify({ [PADDLEOCR_TOKEN_FIELD]: "legacy-token" }),
      "utf8",
    );
    process.env.PI_CODING_AGENT_DIR = root;

    expect(await resolvePaddleocrToken({ [EXTENSION_SECRET_ENV]: "  host-injected  ", PATH: "/usr/bin" } as NodeJS.ProcessEnv)).toBe("host-injected");
    expect(await resolvePaddleocrToken({ PATH: "/usr/bin" } as NodeJS.ProcessEnv)).toBe("legacy-token");
    // With neither source configured: no env injection and no project config.
    delete process.env.PI_CODING_AGENT_DIR;
    expect(await resolvePaddleocrToken({} as NodeJS.ProcessEnv)).toBeUndefined();
    // Blank env values do not shadow the legacy file.
    process.env.PI_CODING_AGENT_DIR = root;
    expect(await resolvePaddleocrToken({ [EXTENSION_SECRET_ENV]: "" } as NodeJS.ProcessEnv)).toBe("legacy-token");
  });

  it("reads only the aistudioAccessToken field from the legacy file and tolerates junk", async () => {
    root = await mkdtemp(join(tmpdir(), "pdf-tok2-"));
    process.env.PI_CODING_AGENT_DIR = root;
    await writeFile(join(root, "paddleocr.json"), JSON.stringify({ firecrawlApiKey: "web-search-key", unrelated: true }), "utf8");
    expect(await loadPaddleocrToken()).toBeUndefined();

    await writeFile(join(root, "paddleocr.json"), "{ not json", "utf8");
    expect(await loadPaddleocrToken()).toBeUndefined();

    delete process.env.PI_CODING_AGENT_DIR;
    expect(await loadPaddleocrToken()).toBeUndefined();
  });

  it("uses the resolved token for routing without echoing it in results", async () => {
    root = await mkdtemp(join(tmpdir(), "pdf-tok3-"));
    await writeFile(
      join(root, "paddleocr.json"),
      JSON.stringify({ [PADDLEOCR_TOKEN_FIELD]: "ast-file-token" }),
      "utf8",
    );
    process.env.PI_CODING_AGENT_DIR = root;
    const pdf = join(root, "any.pdf");
    await writeFile(pdf, STUB_PDF);
    const seen: string[] = [];
    const failed = await executeFirecrawlPdf({ source: pdf, mode: "ocr" }, {
      ocrFn: async (_filePath, token) => {
        seen.push(token);
        return { ok: false, error: `denied ${token}` };
      },
    });
    expect(seen).toEqual(["ast-file-token"]);
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).not.toContain("ast-file-token");

    process.env[EXTENSION_SECRET_ENV] = "ast-env-token";
    try {
      const envSeen: string[] = [];
      await executeFirecrawlPdf({ source: pdf, mode: "ocr" }, {
        ocrFn: async (_filePath, token) => {
          envSeen.push(token);
          return { ok: true, text: "fine" };
        },
      });
      expect(envSeen).toEqual(["ast-env-token"]);
    } finally {
      delete process.env[EXTENSION_SECRET_ENV];
    }
  });

  it("sanitizePublicError redacts both the token and firecrawl-style key prefixes", () => {
    const out = sanitizePublicError("HTTP 401 fc-abcdef123456 near ast-plain-token end", "ast-plain-token");
    expect(out).not.toContain("ast-plain-token");
    expect(out).not.toContain("fc-abcdef123456");
    expect(out.match(/\[redacted\]/g)?.length).toBe(2);
  });
});
