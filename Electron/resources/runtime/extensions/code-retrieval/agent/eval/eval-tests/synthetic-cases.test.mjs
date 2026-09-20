import assert from "node:assert/strict";
import { test } from "node:test";
import { SYNTHETIC_CASES, generatedFiles, liveSyntheticAllowed } from "../eval-lib/synthetic-cases.mjs";

test("synthetic corpus has ten distinct operational tasks and no repository inputs", () => {
  assert.equal(SYNTHETIC_CASES.length, 10);
  assert.equal(new Set(SYNTHETIC_CASES.map(c => c.id)).size, 10);
  assert.equal(new Set(SYNTHETIC_CASES.map(c => c.query)).size, 10);
  for (const def of SYNTHETIC_CASES) {
    assert.equal(def.variants.length, 2);
    const files = generatedFiles(def);
    assert.equal(files.length, 4);
    assert.equal(files[0].path, `${def.id}/work.ts`);
    assert.ok(files[0].text.includes(def.code));
    assert.ok(files.every(f => !f.path.startsWith("/") && !f.path.includes("..") && !f.path.includes(".pi")));
    assert.ok(files.slice(1).every(f => /Audit only|No operational code/.test(f.text)));
  }
});

test("an environment key alone cannot enable live synthetic calls", () => {
  const env = { TYPESAFE_API_KEY: "fixture-not-a-real-key" };
  assert.equal(liveSyntheticAllowed([], env), false);
  assert.equal(liveSyntheticAllowed(["--live-synthetic"], env), true);
  assert.throws(() => liveSyntheticAllowed(["--live-synthetic"], {}), /secure environment/);
  for (const arg of ["--project", "--project=/private", "--source", "--source=/private"]) {
    assert.throws(() => liveSyntheticAllowed(["--live-synthetic", arg], env), /never accepts/);
  }
});
