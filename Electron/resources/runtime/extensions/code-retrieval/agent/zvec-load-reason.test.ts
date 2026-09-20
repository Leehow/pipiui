import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  classifyZvecLoadError,
  zvecLoadFailureReason,
} from "./zvec-semantic.js";

test("classifies missing module codes without leaking paths or stacks", () => {
  const secret = "/secret/home/.env KEY=sk-live-not-real require stack:\n    at /secret/mod.js";
  for (const code of ["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"] as const) {
    const err = Object.assign(new Error(`Cannot find package '@zvec/zvec' imported from ${secret}`), { code });
    assert.equal(classifyZvecLoadError(err), "missing_module");
    const reason = zvecLoadFailureReason("missing_module");
    assert.equal(reason, "zvec dependency missing");
    assert.equal(reason.includes(secret), false);
    assert.equal(reason.includes("sk-live"), false);
    assert.equal(reason.includes("require stack"), false);
  }
});

test("classifies native load failures without leaking messages", () => {
  const err = Object.assign(new Error("dlopen(/Users/haoli/secret.node): image not found"), {
    code: "ERR_DLOPEN_FAILED",
  });
  assert.equal(classifyZvecLoadError(err), "native_load");
  const reason = zvecLoadFailureReason("native_load");
  assert.equal(reason, "zvec native binding or platform package failed to load");
  assert.equal(reason.includes("/Users/haoli"), false);
  assert.equal(classifyZvecLoadError(new Error("Zvec Error: Failed to load prebuilt binary for darwin-arm64")), "native_load");
});

test("unknown errors stay generic and do not echo sensitive text", () => {
  const err = new Error("PIPIUI_API_KEY=abc123 cannot open /etc/passwd");
  assert.equal(classifyZvecLoadError(err), "unknown");
  const reason = zvecLoadFailureReason("unknown");
  assert.equal(reason, "zvec failed to load");
  assert.equal(reason.includes("PIPIUI_API_KEY"), false);
  assert.equal(reason.includes("abc123"), false);
  assert.equal(reason.includes("/etc/passwd"), false);
});

test("PIPIUI_CODE_RETRIEVAL_ZVEC=0 uses the disabled reason via a real load path", () => {
  const moduleUrl = new URL("./zvec-semantic.js", import.meta.url).href;
  const script = `
    process.env.PIPIUI_CODE_RETRIEVAL_ZVEC = "0";
    const { searchSemantic, rebuildZvecIndex, zvecLoadFailureReason } = await import(${JSON.stringify(moduleUrl)});
    const expected = zvecLoadFailureReason("disabled");
    const search = await searchSemantic({ query: "x", projectRoot: "/tmp/zvec-disabled-probe", topK: 1 });
    const rebuild = await rebuildZvecIndex("/tmp/zvec-disabled-probe");
    console.log(JSON.stringify({ expected, searchReason: search.reason, rebuildReason: rebuild.reason, available: search.available, ok: rebuild.ok }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      ELECTRON_RUN_AS_NODE: "1",
      PIPIUI_CODE_RETRIEVAL_ZVEC: "0",
    },
    cwd: fileURLToPath(new URL(".", import.meta.url)),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim()) as {
    expected: string;
    searchReason: string;
    rebuildReason: string;
    available: boolean;
    ok: boolean;
  };
  assert.equal(payload.expected, "zvec disabled (PIPIUI_CODE_RETRIEVAL_ZVEC=0)");
  assert.equal(payload.searchReason, payload.expected);
  assert.equal(payload.rebuildReason, payload.expected);
  assert.equal(payload.available, false);
  assert.equal(payload.ok, false);
  assert.equal(payload.searchReason.includes(process.env.HOME ?? "___"), false);
});
