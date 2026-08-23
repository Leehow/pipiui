import { describe, expect, it } from "vitest";
import {
  assertInlineImageWithinLimit,
  assertRequestBodySize,
  assertRequestBodyWithinLimit,
  decodedBase64ByteLength,
  DeepSeekImageError,
  inlineImageByteLength,
  MAX_INLINE_IMAGE_BYTES,
  MAX_REQUEST_BODY_BYTES,
  rewritePayloadImages,
  toDataUrl,
  toInlineDataUrl,
} from "../agent/images.js";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("DeepSeek inline image conversion", () => {
  it("converts a pi image block to a data URL", () => {
    const url = toInlineDataUrl({ type: "image", data: TINY_PNG_B64, mimeType: "image/png" });
    expect(url).toBe(`data:image/png;base64,${TINY_PNG_B64}`);
    expect(inlineImageByteLength(url!)).toBe(decodedBase64ByteLength(TINY_PNG_B64));
    expect(inlineImageByteLength(url!)).toBeGreaterThan(0);
    expect(inlineImageByteLength(url!)).toBeLessThan(1024);
  });

  it("passes through an existing data URL and http(s) URL", () => {
    const dataUrl = `data:image/jpeg;base64,${TINY_PNG_B64}`;
    expect(toInlineDataUrl(dataUrl)).toBe(dataUrl);
    expect(toInlineDataUrl("https://example.com/cat.png")).toBe("https://example.com/cat.png");
    expect(toDataUrl("image/png", dataUrl)).toBe(dataUrl);
  });

  it("rewrites Chat Completions messages to image_url data URLs", () => {
    const payload = {
      model: "deepseek-v4-flash-vision-exp",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image", data: TINY_PNG_B64, mimeType: "image/png" },
          ],
        },
      ],
    };
    const next = rewritePayloadImages(payload);
    expect(next.messages[0].content[0]).toEqual({ type: "text", text: "what is this?" });
    expect(next.messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` },
    });
    expect(payload.messages[0].content[1]).toEqual({
      type: "image",
      data: TINY_PNG_B64,
      mimeType: "image/png",
    });
  });

  it("rewrites Responses input to input_image data URLs", () => {
    const payload = {
      input: [
        {
          role: "user",
          content: [{ type: "image", data: TINY_PNG_B64, mimeType: "image/webp", detail: "low" }],
        },
      ],
    };
    const next = rewritePayloadImages(payload);
    expect(next.input[0].content[0]).toEqual({
      type: "input_image",
      image_url: `data:image/webp;base64,${TINY_PNG_B64}`,
      detail: "low",
    });
  });

  it("leaves Files API file_id parts untouched", () => {
    const part = { type: "input_image", file_id: "file-api-abc" };
    expect(toInlineDataUrl(part)).toBeUndefined();
    const next = rewritePayloadImages({ input: [{ role: "user", content: [part] }] });
    expect(next.input[0].content[0]).toEqual(part);
  });

  it("rejects a single inline image above 32MiB without allocating one", () => {
    expect(() => assertInlineImageWithinLimit(MAX_INLINE_IMAGE_BYTES)).not.toThrow();
    expect(() => assertInlineImageWithinLimit(MAX_INLINE_IMAGE_BYTES + 1)).toThrow(DeepSeekImageError);
    try {
      assertInlineImageWithinLimit(MAX_INLINE_IMAGE_BYTES + 1);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DeepSeekImageError);
      expect((error as DeepSeekImageError).code).toBe("image_too_large");
      expect((error as Error).message).toMatch(/32MiB/);
    }
  });

  it("rejects an oversized data URL through rewritePayloadImages", () => {
    const oversized = `data:image/png;base64,${"A".repeat(Math.ceil(((MAX_INLINE_IMAGE_BYTES + 1) * 4) / 3))}`;
    expect(() => rewritePayloadImages({
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: oversized } }] }],
    })).toThrow(/32MiB/);
  });

  it("rejects a request body above 48MiB", () => {
    expect(() => assertRequestBodyWithinLimit(MAX_REQUEST_BODY_BYTES)).not.toThrow();
    expect(() => assertRequestBodyWithinLimit(MAX_REQUEST_BODY_BYTES + 1)).toThrow(/48MiB/);
    expect(() => assertRequestBodySize({ ok: true })).not.toThrow();
  });

  it("throws a clear error for empty image data", () => {
    expect(() => toInlineDataUrl({ type: "image", data: "  ", mimeType: "image/png" })).toThrow(/空/);
  });
});
