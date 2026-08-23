import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversationRequestAsync } from "../agent/conversation.js";
import { FileIdCache } from "../agent/files/cache.js";
import { FilesImageChannel, hashImageBytes } from "../agent/files/channel.js";
import { DeepSeekFilesClient } from "../agent/files/client.js";
import { DeepSeekFilesError, redactSecret } from "../agent/files/errors.js";
import { FILES_PURPOSE } from "../agent/files/types.js";
import {
  decideImageRoute,
  DeepSeekImageError,
  MAX_FILES_IMAGE_BYTES,
  MAX_INLINE_IMAGE_BYTES,
  rewritePayloadImagesAsync,
} from "../agent/images.js";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG_BYTES = Buffer.from(TINY_PNG_B64, "base64");
const SECRET = "sk-test-secret-do-not-leak";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("decideImageRoute", () => {
  it("keeps 32MiB inline, sends the next byte through Files API, and rejects above 64MiB", () => {
    expect(decideImageRoute(0)).toEqual({ kind: "inline", byteLength: 0 });
    expect(decideImageRoute(MAX_INLINE_IMAGE_BYTES)).toEqual({
      kind: "inline",
      byteLength: MAX_INLINE_IMAGE_BYTES,
    });
    expect(decideImageRoute(MAX_INLINE_IMAGE_BYTES + 1)).toEqual({
      kind: "files",
      byteLength: MAX_INLINE_IMAGE_BYTES + 1,
    });
    expect(decideImageRoute(MAX_FILES_IMAGE_BYTES)).toEqual({
      kind: "files",
      byteLength: MAX_FILES_IMAGE_BYTES,
    });
    expect(decideImageRoute(MAX_FILES_IMAGE_BYTES + 1)).toEqual({
      kind: "too_large",
      byteLength: MAX_FILES_IMAGE_BYTES + 1,
    });
  });
});

describe("FileIdCache + Files API channel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses a cached file_id on the same image hash and does not upload again", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.deepseek.com/files");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${SECRET}`);
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("purpose")).toBe(FILES_PURPOSE);
      const file = form.get("file");
      expect(file).toBeInstanceOf(Blob);
      return jsonResponse({
        id: "file-api-cached-1",
        bytes: TINY_PNG_BYTES.byteLength,
        filename: "image.png",
        purpose: FILES_PURPOSE,
      });
    });
    const cache = new FileIdCache();
    const channel = new FilesImageChannel(
      new DeepSeekFilesClient({ apiKey: SECRET, fetchImpl: fetchImpl as typeof fetch }),
      cache,
    );
    const first = await rewritePayloadImagesAsync(
      {
        input: [
          {
            role: "user",
            content: [{ type: "image", data: TINY_PNG_B64, mimeType: "image/png" }],
          },
        ],
      },
      { files: channel, limits: { maxInlineBytes: 1 } },
    );
    const second = await rewritePayloadImagesAsync(
      {
        input: [
          {
            role: "user",
            content: [{ type: "image", data: TINY_PNG_B64, mimeType: "image/png" }],
          },
        ],
      },
      { files: channel, limits: { maxInlineBytes: 1 } },
    );
    expect(first.input[0].content[0]).toEqual({ type: "input_image", file_id: "file-api-cached-1" });
    expect(second.input[0].content[0]).toEqual({ type: "input_image", file_id: "file-api-cached-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cache.get(hashImageBytes(TINY_PNG_BYTES))).toBe("file-api-cached-1");
  });

  it("rejects images above the 64MiB Files API cap without calling upload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "file-api-should-not" }));
    const channel = new FilesImageChannel(
      new DeepSeekFilesClient({ apiKey: SECRET, fetchImpl: fetchImpl as typeof fetch }),
    );
    await expect(
      rewritePayloadImagesAsync(
        {
          messages: [
            {
              role: "user",
              content: [{ type: "image", data: TINY_PNG_B64, mimeType: "image/png" }],
            },
          ],
        },
        { files: channel, limits: { maxInlineBytes: 1, maxFilesBytes: 10 } },
      ),
    ).rejects.toMatchObject({
      name: "DeepSeekImageError",
      code: "image_too_large",
    });
    await expect(
      rewritePayloadImagesAsync(
        {
          messages: [
            {
              role: "user",
              content: [{ type: "image", data: TINY_PNG_B64, mimeType: "image/png" }],
            },
          ],
        },
        { files: channel, limits: { maxInlineBytes: 1, maxFilesBytes: 10 } },
      ),
    ).rejects.toThrow(/64MiB/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(decideImageRoute(MAX_FILES_IMAGE_BYTES + 1).kind).toBe("too_large");
    expect(() => {
      throw new DeepSeekImageError(
        "image_too_large",
        `单张图片超过 64MiB Files API 上限（当前 ${MAX_FILES_IMAGE_BYTES + 1} bytes）。`,
      );
    }).toThrow(/64MiB/);
  });

  it("does not silently fall back to inline when Files upload fails", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: `bad key ${SECRET}` } }, 500),
    );
    const channel = new FilesImageChannel(
      new DeepSeekFilesClient({ apiKey: SECRET, fetchImpl: fetchImpl as typeof fetch }),
    );
    await expect(
      rewritePayloadImagesAsync(
        {
          input: [
            {
              role: "user",
              content: [{ type: "image", data: TINY_PNG_B64, mimeType: "image/png", detail: "low" }],
            },
          ],
        },
        { files: channel, limits: { maxInlineBytes: 1 } },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(DeepSeekFilesError);
      const err = error as DeepSeekFilesError;
      expect(err.code).toBe("upload_failed");
      expect(err.message).toMatch(/无法以内联方式发送/);
      expect(err.message).not.toContain(SECRET);
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uploads, retrieves, and deletes through the Files client without leaking the key", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST" && href.endsWith("/files")) {
        return jsonResponse({ id: "file-api-xyz", bytes: 4, filename: "image.png", purpose: FILES_PURPOSE });
      }
      if (method === "GET" && href.endsWith("/files/file-api-xyz")) {
        return jsonResponse({ id: "file-api-xyz", bytes: 4, filename: "image.png", purpose: FILES_PURPOSE });
      }
      if (method === "DELETE" && href.endsWith("/files/file-api-xyz")) {
        return jsonResponse({ id: "file-api-xyz", deleted: true, object: "file" });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    const client = new DeepSeekFilesClient({
      apiKey: SECRET,
      baseUrl: "https://api.deepseek.com",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const uploaded = await client.upload({ bytes: TINY_PNG_BYTES, mimeType: "image/png" });
    expect(uploaded.id).toBe("file-api-xyz");
    const got = await client.retrieve({ fileId: "file-api-xyz" });
    expect(got.id).toBe("file-api-xyz");
    const removed = await client.remove({ fileId: "file-api-xyz" });
    expect(removed).toEqual({ id: "file-api-xyz", deleted: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const leaked = JSON.stringify(fetchImpl.mock.calls.map((call) => call[0]));
    expect(leaked).not.toContain(SECRET);
    expect(redactSecret(`Bearer ${SECRET} sk-abc`, SECRET)).not.toContain(SECRET);
  });

  it("wires conversation credentials into the Files upload and injects file_id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: "file-api-from-conversation", bytes: TINY_PNG_BYTES.byteLength }),
    );
    const request = await buildConversationRequestAsync({
      modelId: "deepseek-v4-flash-vision-exp",
      credentials: { type: "api_key", key: SECRET },
      fetchImpl: fetchImpl as typeof fetch,
      fileCache: new FileIdCache(),
      limits: { maxInlineBytes: 1 },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "what is this?" },
            { type: "image", data: TINY_PNG_B64, mimeType: "image/png" },
          ],
        },
      ],
    });
    expect(request.url).toBe("https://api.deepseek.com/responses");
    expect(request.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(request.body.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "what is this?" },
          { type: "input_image", file_id: "file-api-from-conversation" },
        ],
      },
    ]);
    expect(JSON.stringify(request.body)).not.toContain(SECRET);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
