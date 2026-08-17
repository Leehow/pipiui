import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCappedStreamText } from "../stream-part-text.ts";

describe("applyCappedStreamText", () => {
	it("keeps preview at STREAM_THINKING_CAP while charCount is the full length", () => {
		const part = { text: "", charCount: 0 };
		applyCappedStreamText(part, "a".repeat(400), 600);
		applyCappedStreamText(part, "b".repeat(400), 600);
		assert.equal(part.text.length, 600);
		assert.equal(part.charCount, 800);
		applyCappedStreamText(part, "", 600, "c".repeat(2400));
		assert.equal(part.text.length, 600);
		assert.equal(part.charCount, 2400);
	});
});
