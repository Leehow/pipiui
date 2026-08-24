import { describe, expect, it } from "vitest";

import { normalizeSteerText, previewSteerText, snapshotAttachments } from "../src/index.js";

describe("steer helpers", () => {
  it("normalizes blank and ordinary text without mutating the source", () => {
    const blank = "   \n\t  ";
    expect(normalizeSteerText("")).toBe("");
    expect(normalizeSteerText(blank)).toBe("");
    expect(blank).toBe("   \n\t  ");

    const ordinary = "  hello   world\nnext";
    expect(normalizeSteerText(ordinary)).toBe("hello world next");
    expect(ordinary).toBe("  hello   world\nnext");
  });

  it("previews steer text after safe normalization without mutating the source", () => {
    const blank = " \n ";
    expect(previewSteerText(blank)).toBe("");
    expect(blank).toBe(" \n ");

    const ordinary = "  short note  ";
    expect(previewSteerText(ordinary)).toBe("short note");
    expect(ordinary).toBe("  short note  ");

    const long = `${"word ".repeat(20)}end`;
    const preview = previewSteerText(long);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBe(61);
    expect(long.endsWith("end")).toBe(true);
  });

  it("snapshots attachments without mutating the source", () => {
    expect(snapshotAttachments(undefined)).toEqual([]);
    expect(snapshotAttachments([])).toEqual([]);

    const attachments = [{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "shot.png", width: 1200 }];
    const copy = snapshotAttachments(attachments);
    expect(copy).toEqual(attachments);
    expect(copy).not.toBe(attachments);
    expect(copy[0]).not.toBe(attachments[0]);

    copy[0].dataBase64 = "MUTATED";
    copy[0].name = "changed.png";
    copy.push({ dataBase64: "extra", mimeType: "image/gif" });
    expect(attachments).toEqual([{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "shot.png", width: 1200 }]);
  });
});
