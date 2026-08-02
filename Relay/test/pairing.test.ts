import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parsePairingFragment } from "../src/pairing.js";

const vectors = JSON.parse(readFileSync(
  new URL("../../Tests/Fixtures/P2PPairingFragmentVectors.json", import.meta.url),
  "utf8",
)) as Array<{ name: string; fragment: string; accepted: boolean }>;

test("shared pairing fragment vectors enforce canonical ordered raw grammar", () => {
  for (const vector of vectors) {
    assert.equal(
      parsePairingFragment(vector.fragment) !== null,
      vector.accepted,
      vector.name,
    );
  }
});
