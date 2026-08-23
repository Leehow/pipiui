import assert from "node:assert/strict";
import { test } from "node:test";
import { SeenRangeLedger, hashContent } from "./ledger.js";

test("ledger remembers exact (path, start, end, hash) tuples only", () => {
  const ledger = new SeenRangeLedger();
  const hash = hashContent("body");
  ledger.remember("src/a.ts", 1, 10, hash);
  assert.equal(ledger.has({ path: "src/a.ts", startLine: 1, endLine: 10, contentHash: hash }), true);
  assert.equal(ledger.has({ path: "src/a.ts", startLine: 1, endLine: 10, contentHash: hashContent("other") }), false);
  assert.equal(ledger.has({ path: "src/a.ts", startLine: 1, endLine: 9, contentHash: hash }), false);
  assert.equal(ledger.size(), 1);
});
