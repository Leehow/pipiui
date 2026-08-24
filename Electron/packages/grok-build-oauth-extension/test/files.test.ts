import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileSourcesFromResponse } from "../agent/files/citations.js";
import { digestOf, FilesClient, normalizeFilesBaseUrl } from "../agent/files/client.js";
import { FilesError } from "../agent/files/errors.js";
import { applyMaterializedInputFiles, inputFileTranscriptNote, materializedInputFilesOf } from "../agent/files/input.js";
import { createInputFilesService } from "../agent/files/service.js";
import { SessionInputFileStore } from "../agent/files/state.js";
import {
  assertInputFileBounds,
  MAX_INPUT_FILE_BYTES,
  modelHasInputFiles,
  safeFileName,
} from "../agent/files/types.js";
import type { GrokCredentialBroker } from "../agent/oauth/broker.js";

const PDF = Buffer.from("%PDF-1.4 test file\n", "utf8");

type Recorded = { url: string; method?: string; headers: Record<string, string>; form?: FormData | null };

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { out[key.toLowerCase()] = value; });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key.toLowerCase()] = value;
    return out;
  }
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = String(value);
  return out;
}

function recordingFetch(responder: (url: string, init: RequestInit, call: number) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({
      url,
      method: init?.method,
      headers: headerRecord(init?.headers),
      form: init?.body instanceof FormData ? init.body : null,
    });
    return responder(url, init ?? {}, calls.length);
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("inputFiles capability gating", () => {
  it("is off unless inputFiles is explicitly declared", () => {
    expect(modelHasInputFiles(undefined)).toBe(false);
    expect(modelHasInputFiles({})).toBe(false);
    expect(modelHasInputFiles({ capabilities: {} })).toBe(false);
    expect(modelHasInputFiles({ capabilities: { hostedTools: { tools: ["code_interpreter"] } } })).toBe(false);
    expect(modelHasInputFiles({ capabilities: { inputFiles: false } })).toBe(false);
    expect(modelHasInputFiles({ capabilities: { inputFiles: true } })).toBe(true);
    expect(modelHasInputFiles({ capabilities: { inputFiles: { upload: true } } })).toBe(false);
    expect(modelHasInputFiles({ capabilities: { inputFiles: { upload: false } } })).toBe(false);
    expect(modelHasInputFiles({ capabilities: { inputFiles: [] } })).toBe(false);
    expect(modelHasInputFiles({ capabilities: { inputFiles: "true" } })).toBe(false);
  });
});

describe("safe file metadata", () => {
  it("strips absolute paths from display names", () => {
    expect(safeFileName("/Users/haoli/secret/report.pdf")).toBe("report.pdf");
    expect(safeFileName("C:\\\\abs\\\\notes.txt")).toBe("notes.txt");
    expect(safeFileName("../etc/passwd")).toBe("passwd");
    expect(safeFileName("ok.md")).toBe("ok.md");
  });

  it("rejects empty, huge, and unknown types", () => {
    expect(() => assertInputFileBounds({ name: "a.pdf", size: 0 })).toThrow(/空文件/);
    expect(() => assertInputFileBounds({ name: "a.pdf", size: MAX_INPUT_FILE_BYTES + 1 })).toThrow(/过大/);
    expect(() => assertInputFileBounds({ name: "payload.exe", size: 12 })).toThrow(/不支持/);
    expect(() => assertInputFileBounds({ name: "notes.md", size: 12 })).not.toThrow();
  });
});

describe("FilesClient", () => {
  it("uploads over HTTPS multipart and returns a provider file id", async () => {
    const { impl, calls } = recordingFetch(() =>
      new Response(JSON.stringify({ id: "file-abc", filename: "notes.md", bytes: PDF.length }), { status: 200 }),
    );
    const client = new FilesClient({ fetchImpl: impl });
    const uploaded = await client.upload({
      bytes: PDF,
      name: "/abs/hidden/notes.md",
      mimeType: "text/markdown",
      bearer: "at-secret",
    });
    expect(uploaded.fileId).toBe("file-abc");
    expect(uploaded.name).toBe("notes.md");
    expect(uploaded.digest).toBe(digestOf(PDF));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.x.ai/v1/files");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.authorization).toBe("Bearer at-secret");
    expect(calls[0].form).toBeInstanceOf(FormData);
    expect(calls[0].form?.get("purpose")).toBe("assistants");
    const file = calls[0].form?.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("notes.md");
  });

  it("rejects a missing bearer without sending a request", async () => {
    const { impl, calls } = recordingFetch(() => new Response(JSON.stringify({ id: "file-nope" }), { status: 200 }));
    const client = new FilesClient({ fetchImpl: impl });
    await expect(
      client.upload({ bytes: PDF, name: "notes.md", mimeType: "text/markdown", bearer: "   " }),
    ).rejects.toMatchObject({ code: "auth_expired" });
    expect(calls).toHaveLength(0);
  });

  it("refuses non-HTTPS bases and never echoes the bearer", () => {
    expect(() => normalizeFilesBaseUrl("http://127.0.0.1/v1")).toThrow(/HTTPS/);
    expect(() => new FilesClient({ baseUrl: "http://evil.test/v1" })).toThrow(/HTTPS/);
    try {
      normalizeFilesBaseUrl("http://127.0.0.1/v1?token=at-secret");
      throw new Error("expected throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("at-secret");
      expect(message).not.toContain("/Users/");
    }
  });

  it("redacts credentials and local paths from upload failures", async () => {
    const { impl } = recordingFetch(() =>
      new Response("denied bearer at-secret path=/Users/haoli/secret.pdf", { status: 401 }),
    );
    const client = new FilesClient({ fetchImpl: impl });
    try {
      await client.upload({ bytes: PDF, name: "/Users/haoli/secret.pdf", mimeType: "application/pdf", bearer: "at-secret" });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(FilesError);
      expect((error as FilesError).code).toBe("auth_expired");
      expect((error as Error).message).not.toContain("at-secret");
      expect((error as Error).message).not.toContain("/Users/haoli");
    }
  });

  it("cancels an in-flight upload", async () => {
    const controller = new AbortController();
    const { impl } = recordingFetch(async () => {
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify({ id: "file-late" }), { status: 200 });
    });
    const client = new FilesClient({ fetchImpl: impl });
    await expect(
      client.upload({ bytes: PDF, name: "notes.md", mimeType: "text/markdown", bearer: "at", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("times out a hung upload", async () => {
    const { impl } = recordingFetch(() => new Promise<Response>(() => undefined));
    const client = new FilesClient({ fetchImpl: impl, timeoutMs: 20 });
    await expect(
      client.upload({ bytes: PDF, name: "notes.md", mimeType: "text/markdown", bearer: "at" }),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("rejects non-2xx and malformed upload responses", async () => {
    const html = recordingFetch(() => new Response("<html>nope</html>", { status: 200 }));
    await expect(
      new FilesClient({ fetchImpl: html.impl }).upload({
        bytes: PDF, name: "notes.md", mimeType: "text/markdown", bearer: "at",
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    const missingId = recordingFetch(() => new Response(JSON.stringify({ filename: "notes.md" }), { status: 200 }));
    await expect(
      new FilesClient({ fetchImpl: missingId.impl }).upload({
        bytes: PDF, name: "notes.md", mimeType: "text/markdown", bearer: "at",
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    const badMeta = recordingFetch(() => new Response(JSON.stringify({ id: "file-abc", bytes: "12" }), { status: 200 }));
    await expect(
      new FilesClient({ fetchImpl: badMeta.impl }).upload({
        bytes: PDF, name: "notes.md", mimeType: "text/markdown", bearer: "at",
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    const serverError = recordingFetch(() => new Response("boom", { status: 500 }));
    await expect(
      new FilesClient({ fetchImpl: serverError.impl }).upload({
        bytes: PDF, name: "notes.md", mimeType: "text/markdown", bearer: "at",
      }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 500 });
  });

  it("deletes a remote file by id", async () => {
    const { impl, calls } = recordingFetch(() => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    const client = new FilesClient({ fetchImpl: impl });
    await client.remove({ fileId: "file-abc", bearer: "at-secret" });
    expect(calls[0].url).toBe("https://api.x.ai/v1/files/file-abc");
    expect(calls[0].method).toBe("DELETE");
  });

  it("surfaces a failed DELETE without retrying locally", async () => {
    const { impl, calls } = recordingFetch(() => new Response("nope", { status: 404 }));
    const client = new FilesClient({ fetchImpl: impl });
    await expect(client.remove({ fileId: "file-abc", bearer: "at" })).rejects.toMatchObject({
      code: "http_failure",
      status: 404,
    });
    expect(calls).toHaveLength(1);
  });
});

describe("InputFilesService", () => {
  it("routes upload through broker.with401Retry exactly once", async () => {
    const { impl, calls } = recordingFetch(() => new Response(JSON.stringify({ id: "file-abc" }), { status: 200 }));
    const client = new FilesClient({ fetchImpl: impl });
    let retryCalls = 0;
    const broker = {
      with401Retry: async <T>(operation: (token: string) => Promise<T>) => {
        retryCalls += 1;
        return operation("at-secret");
      },
    } as unknown as GrokCredentialBroker;
    const service = createInputFilesService({ client, broker, fetchImpl: impl });
    const uploaded = await service.upload({ bytes: PDF, name: "notes.md", mimeType: "text/markdown" });
    expect(uploaded.fileId).toBe("file-abc");
    expect(retryCalls).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.authorization).toBe("Bearer at-secret");
  });
});

describe("applyMaterializedInputFiles", () => {
  it("appends official input_file parts onto the last user message", () => {
    const payload = applyMaterializedInputFiles(
      {
        model: "grok-4.6",
        input: [{ role: "user", content: "summarize" }],
        tools: [{ type: "web_search" }],
      },
      [{ type: "input_file", file_id: "file-abc" }],
    );
    expect(payload.tools).toEqual([{ type: "web_search" }]);
    expect(payload.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "summarize" },
          { type: "input_file", file_id: "file-abc" },
        ],
      },
    ]);
  });

  it("ignores unready files and de-duplicates ids", () => {
    const parts = materializedInputFilesOf([
      { id: "1", name: "a.pdf", size: 1, mimeType: "application/pdf", status: "uploading" },
      { id: "2", name: "b.pdf", size: 1, mimeType: "application/pdf", status: "ready", fileId: "file-a" },
      { id: "3", name: "c.pdf", size: 1, mimeType: "application/pdf", status: "ready", fileId: "file-a" },
    ]);
    expect(parts).toEqual([{ type: "input_file", file_id: "file-a" }]);
  });

  it("does not put input_file onto chat/completions messages", () => {
    const payload = applyMaterializedInputFiles(
      {
        model: "grok-4.6",
        messages: [{ role: "user", content: "hi" }],
      },
      [{ type: "input_file", file_id: "file-abc" }],
    );
    expect(payload.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(payload.input).toEqual([
      { role: "user", content: [{ type: "input_file", file_id: "file-abc" }] },
    ]);
  });
});

describe("session input-file store", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("reuses a ready digest, marks sent files for replay, and drops unsent on remove", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipi-input-files-"));
    dirs.push(dir);
    const store = new SessionInputFileStore(dir);
    const digest = digestOf(PDF);
    await store.upsert("sess", {
      id: "a",
      name: "/abs/report.pdf",
      size: PDF.length,
      mimeType: "application/pdf",
      status: "ready",
      fileId: "file-1",
      digest,
    });
    const listed = await store.list("sess");
    expect(listed[0]?.name).toBe("report.pdf");
    expect(JSON.stringify(listed)).not.toContain("/abs/");
    expect(store.findReusable(listed, digest)?.fileId).toBe("file-1");

    await store.upsert("sess", { ...listed[0]!, sent: true });
    const replay = store.materialized(await store.list("sess"));
    expect(replay).toEqual([expect.objectContaining({ fileId: "file-1", sent: true, name: "report.pdf" })]);
    expect(inputFileTranscriptNote(replay)).toContain("report.pdf");
    expect(inputFileTranscriptNote(replay)).not.toContain("/abs/");

    const removed = await store.remove("sess", "a");
    expect(removed.removed?.fileId).toBe("file-1");
    expect(removed.attachments).toEqual([]);
    const stored = join(dir, "input-files", "sess.json");
    const raw = await readFile(stored, "utf8");
    expect(raw).not.toContain("/abs/");
    expect(raw).not.toContain("at-");
    expect((await stat(stored)).mode & 0o777).toBe(0o600);
    expect(stored.startsWith(dir)).toBe(true);
  });
});

describe("file citations", () => {
  it("maps file annotations to safe clickable sources and drops local paths", () => {
    const sources = fileSourcesFromResponse({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          annotations: [
            { type: "file_citation", file_id: "file-1", filename: "/secret/doc.pdf" },
            { type: "url_citation", url: "https://example.com/doc", title: "doc" },
            { type: "file_citation", file_id: "file-2", filename: "notes.md", url: "file:///Users/haoli/notes.md" },
          ],
        }],
      }],
    });
    expect(sources).toEqual([
      { fileId: "file-1", name: "doc.pdf" },
      { fileId: "file-2", name: "notes.md" },
    ]);
    expect(JSON.stringify(sources)).not.toContain("/Users/");
    expect(JSON.stringify(sources)).not.toContain("file://");
  });
});
