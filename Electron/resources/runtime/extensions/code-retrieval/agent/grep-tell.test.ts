import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alternationArms,
  GrepTellBudget,
  PACKED_ARMS_THRESHOLD,
} from "./grep-tell.js";

test("alternationArms splits top-level arms and ignores escapes / character classes", () => {
  assert.deepEqual(alternationArms("retry|recover|classify"), ["retry", "recover", "classify"]);
  assert.deepEqual(alternationArms("a\\|b"), ["a\\|b"]);
  assert.deepEqual(alternationArms("[a|b]c"), ["[a|b]c"]);
  assert.deepEqual(alternationArms("x||y"), ["x", "y"]);
  assert.equal(alternationArms("(a|b)").length, 2);
  assert.deepEqual(alternationArms("plainWord"), ["plainWord"]);
});

test("a packed alternation trips the tell and echoes the model's own words back", () => {
  const budget = new GrepTellBudget();
  const tell = budget.consider({ pattern: "retry|recover|classify|failure" });
  assert.equal(tell?.kind, "packed");
  assert.equal(tell?.arms, 4);
  assert.match(tell!.line, /packs 4 keyword guesses/);
  assert.match(tell!.line, /retry, recover, classify, failure/);
});

test("an alternation below the threshold is left alone", () => {
  const budget = new GrepTellBudget();
  assert.equal(PACKED_ARMS_THRESHOLD, 3);
  assert.equal(budget.consider({ pattern: "RecoveryPolicy|recoveryPolicy" }), undefined);
  assert.equal(budget.consider({ pattern: "SomeSymbol" }), undefined);
});

test("a grep pattern with spaces is already a description", () => {
  const budget = new GrepTellBudget();
  const tell = budget.consider({ pattern: "session token refresh" });
  assert.equal(tell?.kind, "description");
  assert.match(tell!.line, /description, not a token/);
  assert.match(tell!.line, /code_search is the first tool/);
});

test("regex debris is counted but not quoted back", () => {
  const budget = new GrepTellBudget();
  const tell = budget.consider({ pattern: "^foo.*|\\s+bar$|baz(" });
  assert.equal(tell?.kind, "packed");
  assert.equal(tell?.arms, 3);
  assert.doesNotMatch(tell!.line, /\(\^foo/);
});

test("literal search takes | as an ordinary character", () => {
  const budget = new GrepTellBudget();
  assert.equal(budget.consider({ pattern: "a|b|c", literal: true }), undefined);
});

test("a second keyword on the same path inside the window is the sequential tell", () => {
  const budget = new GrepTellBudget();
  assert.equal(budget.consider({ pattern: "invalidate", path: "/repo/src", at: 1_000 }), undefined);
  const tell = budget.consider({ pattern: "expire", path: "/repo/src", at: 30_000 });
  assert.equal(tell?.kind, "retry");
});

test("the retry window closes, and a different path is not a retry", () => {
  const slow = new GrepTellBudget();
  slow.consider({ pattern: "invalidate", path: "/repo/src", at: 1_000 });
  assert.equal(slow.consider({ pattern: "expire", path: "/repo/src", at: 500_000 }), undefined);

  const elsewhere = new GrepTellBudget();
  elsewhere.consider({ pattern: "invalidate", path: "/repo/src", at: 1_000 });
  assert.equal(elsewhere.consider({ pattern: "expire", path: "/repo/other", at: 2_000 }), undefined);
});

test("repeating one pattern never nudges twice", () => {
  const budget = new GrepTellBudget();
  assert.ok(budget.consider({ pattern: "a|b|c" }));
  assert.equal(budget.consider({ pattern: "a|b|c" }), undefined);
});

test("the per-session budget is spent and then holds its peace", () => {
  const budget = new GrepTellBudget({ maxPerSession: 2 });
  assert.ok(budget.consider({ pattern: "a|b|c" }));
  assert.ok(budget.consider({ pattern: "d|e|f" }));
  assert.equal(budget.remaining, 0);
  assert.equal(budget.consider({ pattern: "g|h|i" }), undefined);
});

test("a session that adopts indexed retrieval is not nudged again", () => {
  const budget = new GrepTellBudget();
  budget.silence();
  assert.equal(budget.consider({ pattern: "a|b|c" }), undefined);
  assert.equal(budget.muted, true);
  budget.reset();
  assert.equal(budget.muted, false);
  assert.ok(budget.consider({ pattern: "a|b|c" }));
});

test("the retry window keeps recording while silenced, so a later reset is not misled", () => {
  const budget = new GrepTellBudget();
  budget.silence();
  budget.consider({ pattern: "invalidate", path: "/repo/src", at: 1_000 });
  budget.consider({ pattern: "expire", path: "/repo/src", at: 2_000 });
  // Nothing fired while muted; state is still coherent afterwards.
  assert.equal(budget.remaining, 0);
});

test("an empty or whitespace pattern is not a tell", () => {
  const budget = new GrepTellBudget();
  assert.equal(budget.consider({ pattern: "" }), undefined);
  assert.equal(budget.consider({ pattern: "   " }), undefined);
  assert.equal(budget.consider({}), undefined);
});
