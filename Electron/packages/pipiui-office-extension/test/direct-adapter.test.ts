// @vitest-environment node
import { chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createDirectOfficeAdapter } from "../agent/adapter.js";
import { bundledOfficeCliCandidate, OFFICECLI_RECEIPT_NAME, readOfficeCliReceipt, resolveOfficeCliBinary } from "../agent/binary.js";
import { DIRECT_OFFICECLI_TOOL, createDirectOfficeTrack, officeCommandFixture } from "../agent/tool-contract.js";
import { OFFICE_FORMAT_POLICIES } from "../agent/edit-policy.js";
import { OFFICECLI_PROVENANCE, OFFICECLI_WRITE_ATOMICITY } from "../agent/provenance.js";
import { createFakeOfficeSdk } from "./fake-office-sdk.js";
import { readFileSync } from "node:fs";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "office-t5-"));
  await writeFile(join(dir, "a.docx"), "doc-a");
  await writeFile(join(dir, "b.docx"), "doc-b");
  await mkdir(join(dir, "文档"));
  await writeFile(join(dir, "文档", "我的 文件.docx"), "zh");
  return dir;
}

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const root = await project();
  temps.push(root);
  const sdk = createFakeOfficeSdk();
  const adapter = createDirectOfficeAdapter({
    projectRoot: root,
    extensionRoot: pkgRoot,
    packaged: false,
    locateBinary: () => join(root, "officecli-bin"),
    sdk,
    commandTimeoutMs: 200,
    startupTimeoutMs: 200,
  });
  await writeFile(join(root, "officecli-bin"), "#!/bin/sh\n");
  return { root, sdk, adapter };
}

describe("installed @officecli/sdk contract", () => {
  it("exposes create/open/Document/OfficeCliError/install from 0.1.2", () => {
    const sdk = createRequire(import.meta.url)("@officecli/sdk") as Record<string, unknown>;
    expect(typeof sdk.create).toBe("function");
    expect(typeof sdk.open).toBe("function");
    expect(typeof sdk.install).toBe("function");
    expect(typeof sdk.Document).toBe("function");
    expect(typeof sdk.OfficeCliError).toBe("function");
    expect(OFFICECLI_PROVENANCE.sdkVersion).toBe("0.1.2");
    expect(OFFICECLI_PROVENANCE.sdkLicense).toBe("Apache-2.0");
    expect(OFFICECLI_PROVENANCE.autoInstall).toBe(false);
    expect(OFFICECLI_PROVENANCE.mcpTransport).toBe(false);
  });
});

describe("DirectOfficeAdapter", () => {
  it("creates a new tier-1 file through sdk.create", async () => {
    const { adapter, sdk, root } = await setup();
    const result = await adapter.execute({ command: ["create", "new.docx", "--force"] });
    expect(result.ok).toBe(true);
    expect(result.gate.isCreate).toBe(true);
    expect(result.gate.kind).toBe("create");
    expect(sdk.creates).toBe(1);
    expect(sdk.autoInstallSeen).toEqual([false]);
    expect(result.gate.targetPaths[0]).toBe(join(await realpath(root), "new.docx"));
  });

  it("runs argv through the injected SDK with autoInstall false and one resident process", async () => {
    const { adapter, sdk } = await setup();
    const first = await adapter.execute({ command: ["view", "a.docx"] });
    const second = await adapter.execute({ command: ["get", "a.docx", "/body"] });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(sdk.processStarts).toBe(1);
    expect(sdk.opens).toBe(1);
    expect(sdk.autoInstallSeen.every((flag) => flag === false)).toBe(true);
    expect(sdk.binaries).toHaveLength(1);
    expect(sdk.sends.map((item) => item.command)).toEqual(["view", "get"]);
    await adapter.dispose();
    await adapter.dispose();
  });

  it("serializes same-file commands and lets other files proceed independently", async () => {
    const { adapter, sdk, root } = await setup();
    sdk.sendDelayMs = 40;
    const a1 = adapter.execute({ command: ["set", "a.docx", "/body/p[1]", "--prop", "text=one"] });
    const a2 = adapter.execute({ command: ["set", "a.docx", "/body/p[1]", "--prop", "text=two"] });
    const b = adapter.execute({ command: ["view", "b.docx"] });
    const results = await Promise.all([a1, a2, b]);
    expect(results.every((row) => row.ok)).toBe(true);
    expect(sdk.maxInflightByPath.get(results[0]!.gate.targetPaths[0]!)).toBe(1);
    expect(sdk.maxInflight).toBeGreaterThanOrEqual(2);
    expect(results[0]?.writeSemantics).toMatchObject(OFFICECLI_WRITE_ATOMICITY);
    expect(OFFICECLI_WRITE_ATOMICITY.atomicRename).toBe(false);
  });

  it("times out, cancels, restarts after crash, and disposes idempotently", async () => {
    const { adapter, sdk } = await setup();
    sdk.hangNext = true;
    const timed = await adapter.execute({ command: ["view", "a.docx"] });
    expect(timed.code).toBe("timeout");

    sdk.hangNext = false;
    const ok = await adapter.execute({ command: ["view", "a.docx"] });
    expect(ok.ok).toBe(true);
    const startedAfterTimeout = sdk.processStarts;

    const controller = new AbortController();
    sdk.hangNext = true;
    const pending = adapter.execute({ command: ["view", "a.docx"] }, controller.signal);
    controller.abort();
    const cancelled = await pending;
    expect(cancelled.code).toBe("cancelled");

    sdk.hangNext = false;
    sdk.crash();
    const afterCrash = await adapter.execute({ command: ["view", "b.docx"] });
    expect(afterCrash.ok).toBe(true);
    expect(sdk.processStarts).toBeGreaterThan(startedAfterTimeout);

    await adapter.dispose();
    await adapter.dispose();
    const disposed = await adapter.execute({ command: ["view", "a.docx"] });
    expect(disposed.code).toBe("disposed");
  });

  it("fails closed on unknown verbs and NUL/control characters", async () => {
    const { adapter, sdk } = await setup();
    const mcp = await adapter.execute({ command: ["mcp"] });
    expect(mcp.code).toBe("unknown_verb");
    const nul = await adapter.execute({ command: "view a.docx\0.xlsx" });
    expect(nul.code).toBe("control_chars");
    expect(sdk.sends).toEqual([]);
  });

  it("exposes qualifying screenshot metadata for the existing gate", async () => {
    const { adapter, root } = await setup();
    const shot = await adapter.execute({ command: ["view", "a.docx", "screenshot", "--grid", "auto"] });
    expect(shot.ok).toBe(true);
    expect(shot.gate).toMatchObject({
      kind: "screenshot",
      isQualifyingScreenshot: true,
      isWrite: false,
      targetPaths: [await realpath(join(root, "a.docx"))],
    });
  });

  it("parses without a shell and never launches bash", async () => {
    const { adapter, sdk } = await setup();
    const injected = await adapter.execute({ command: 'view a.docx; rm -rf /' });
    expect(injected.ok).toBe(false);
    expect(sdk.sends).toEqual([]);
    const quoted = await adapter.execute({ command: ['view', 'a.docx', '&&', 'true'] });
    expect(quoted.ok).toBe(true);
    expect(sdk.sends[0]?.command).toBe("view");
    expect(sdk.sends[0]?.mode).toBe("&&");
  });

  it("accepts project-relative Chinese and space paths", async () => {
    const { adapter, root } = await setup();
    const result = await adapter.execute({ command: ["view", "文档/我的 文件.docx"] });
    expect(result.ok).toBe(true);
    expect(result.gate.targetPaths[0]).toBe(await realpath(join(root, "文档", "我的 文件.docx")));
  });

  it("rejects absolute outside, traversal, symlink escape, and directories", async () => {
    const { adapter, root } = await setup();
    const outside = await adapter.execute({ command: ["view", "/tmp/outside.docx"] });
    expect(outside.code).toBe("path_rejected");
    expect(outside.pathReason).toBe("absolute_outside");

    const traversal = await adapter.execute({ command: ["view", "../a.docx"] });
    expect(traversal.code).toBe("path_rejected");
    expect(traversal.pathReason).toBe("traversal");

    const dir = join(root, "folder.docx");
    await mkdir(dir);
    const asDir = await adapter.execute({ command: ["view", "folder.docx"] });
    expect(asDir.code).toBe("path_rejected");
    expect(asDir.pathReason).toBe("is_directory");

    const outsideFile = join(root, "..", `office-t5-out-${Date.now()}.docx`);
    await writeFile(outsideFile, "x");
    temps.push(outsideFile);
    await symlink(outsideFile, join(root, "escape.docx"));
    const linked = await adapter.execute({ command: ["view", "escape.docx"] });
    expect(linked.code).toBe("path_rejected");
    expect(linked.pathReason).toBe("symlink_escape");
  });

  it("validates every path on multi-path verbs", async () => {
    const { adapter, root, sdk } = await setup();
    const missingOut = await adapter.execute({ command: ["merge", "a.docx", "/etc/passwd.docx"] });
    expect(missingOut.code).toBe("path_rejected");
    const ok = await adapter.execute({ command: ["merge", "a.docx", "b.docx", "--data", "{\"k\":1}"] });
    expect(ok.ok).toBe(true);
    expect(ok.gate.targetPaths).toEqual([
      await realpath(join(root, "a.docx")),
      await realpath(join(root, "b.docx")),
    ]);
    expect(sdk.sends[0]).toMatchObject({
      command: "merge",
      template: await realpath(join(root, "a.docx")),
      output: await realpath(join(root, "b.docx")),
      data: "{\"k\":1}",
    });
  });

  it("caps stdout/stderr/diagnostics", async () => {
    const { adapter, sdk, root } = await setup();
    sdk.sendHook = async () => "x".repeat(200);
    const tiny = createDirectOfficeAdapter({
      projectRoot: root,
      locateBinary: () => join(root, "officecli-bin"),
      sdk,
      outputLimit: 16,
      diagnosticLimit: 8,
    });
    const result = await tiny.execute({ command: ["view", "a.docx"] });
    expect(result.ok).toBe(true);
    expect(result.stdout.length).toBe(16);
    expect(result.truncated.stdout).toBe(true);
  });

  it("never falls back to PATH or homedir binaries", async () => {
    const root = await project();
    temps.push(root);
    const pathDir = await mkdtemp(join(tmpdir(), "office-path-"));
    temps.push(pathDir);
    const decoy = join(pathDir, "officecli");
    await writeFile(decoy, "#!/bin/sh\n");
    await chmod(decoy, 0o755);
    const resolved = resolveOfficeCliBinary({
      extensionRoot: pkgRoot,
      packaged: false,
      env: { PATH: pathDir, HOME: pathDir },
    });
    expect(resolved).toBeNull();
  });

  it("uses bundled candidate then dev-only env override, never when packaged", async () => {
    const root = await project();
    temps.push(root);
    const ext = await mkdtemp(join(tmpdir(), "office-ext-"));
    temps.push(ext);
    const bundled = bundledOfficeCliCandidate({ extensionRoot: ext, platform: "darwin", arch: "arm64" });
    await mkdir(dirname(bundled), { recursive: true });
    await writeFile(bundled, "bin");
    expect(resolveOfficeCliBinary({ extensionRoot: ext, platform: "darwin", arch: "arm64", packaged: true })).toBe(bundled);

    const override = join(root, "dev-officecli");
    await writeFile(override, "dev");
    expect(
      resolveOfficeCliBinary({
        extensionRoot: pkgRoot,
        packaged: false,
        env: { PIPIUI_OFFICECLI_BINARY: override },
      }),
    ).toBe(override);
    expect(
      resolveOfficeCliBinary({
        extensionRoot: pkgRoot,
        packaged: true,
        env: { PIPIUI_OFFICECLI_BINARY: override },
      }),
    ).toBeNull();
  });

  it("ignores receipt.json as an executable and reads checksum provenance from it", async () => {
    const ext = await mkdtemp(join(tmpdir(), "office-ext-receipt-"));
    temps.push(ext);
    const bundled = bundledOfficeCliCandidate({ extensionRoot: ext, platform: "darwin", arch: "arm64" });
    await mkdir(dirname(bundled), { recursive: true });
    const receipt = join(dirname(bundled), OFFICECLI_RECEIPT_NAME);
    await writeFile(receipt, JSON.stringify({
      version: "1.0.144",
      asset: "officecli-mac-arm64",
      sha256: "abc",
      target: "darwin-arm64",
      bytes: 1,
    }));
    expect(resolveOfficeCliBinary({
      extensionRoot: ext,
      platform: "darwin",
      arch: "arm64",
      packaged: true,
      env: { PIPIUI_OFFICECLI_BINARY: receipt },
    })).toBeNull();
    await writeFile(bundled, "bin");
    expect(resolveOfficeCliBinary({
      extensionRoot: ext,
      platform: "darwin",
      arch: "arm64",
      packaged: true,
    })).toBe(bundled);
    expect(readOfficeCliReceipt(bundled)).toMatchObject({ version: "1.0.144", target: "darwin-arm64", sha256: "abc" });
    expect(readOfficeCliReceipt(receipt)).toBeNull();
  });
});

describe("format policy including .ppsm discrepancy", () => {
  it("matches the frozen matrix for every extension", () => {
    const matrix = JSON.parse(readFileSync(join(pkgRoot, "../../../docs/office/format-matrix.json"), "utf8")) as {
      formats: Array<{
        extension: string;
        tier: string;
        editContract: string;
        macroContainer: boolean;
        shotGateCovered: boolean;
      }>;
    };
    expect(OFFICE_FORMAT_POLICIES).toHaveLength(matrix.formats.length);
    for (const row of matrix.formats) {
      const policy = OFFICE_FORMAT_POLICIES.find((item) => item.extension === row.extension);
      expect(policy, row.extension).toMatchObject({
        extension: row.extension,
        tier: row.tier,
        editContract: row.editContract,
        macroContainer: row.macroContainer,
        shotGateCovered: row.shotGateCovered,
        writesAllowed: row.editContract === "guaranteed",
      });
    }
    const ppsm = OFFICE_FORMAT_POLICIES.find((row) => row.extension === ".ppsm");
    expect(ppsm).toMatchObject({ shotGateCovered: false, writesAllowed: false, macroContainer: true });
  });

  it("allows tier-1 writes and rejects macro/tier-2 including .ppsm", async () => {
    const { adapter, root } = await setup();
    for (const ext of [".docx", ".xlsx", ".pptx"]) {
      await writeFile(join(root, `t${ext}`), "x");
      const result = await adapter.execute({ command: ["set", `t${ext}`, "/a", "--prop", "text=1"] });
      expect(result.ok, ext).toBe(true);
    }
    for (const ext of [".docm", ".xlsm", ".pptm", ".doc", ".ppsm", ".dotx"]) {
      await writeFile(join(root, `t${ext}`), "x");
      const result = await adapter.execute({ command: ["set", `t${ext}`, "/a", "--prop", "text=1"] });
      expect(result.code, ext).toBe("read_only_format");
      const view = await adapter.execute({ command: ["view", `t${ext}`] });
      expect(view.ok, `view ${ext}`).toBe(true);
    }
  });
});

describe("direct tool contract", () => {
  it("runs a command fixture through the direct track", async () => {
    const { adapter } = await setup();
    const track = createDirectOfficeTrack(adapter);
    expect(track.name).toBe(DIRECT_OFFICECLI_TOOL);
    const result = await track.run(officeCommandFixture(["view", "a.docx"]));
    expect(result.ok).toBe(true);
    expect(result.gate.isQualifyingScreenshot).toBe(false);
  });
});

describe("SDK success, validate, and bounded hang", () => {
  it("maps {success:false} to ok:false command_failed", async () => {
    const { adapter, sdk } = await setup();
    sdk.sendHook = async () => ({ success: false, error: "invalid selector" });
    const result = await adapter.execute({ command: ["get", "a.docx", "/nope"] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("command_failed");
    expect(result.message).toContain("invalid selector");
  });

  it("runs validate as a read verb", async () => {
    const { adapter, sdk } = await setup();
    const result = await adapter.execute({ command: ["validate", "a.docx"] });
    expect(result.ok).toBe(true);
    expect(result.gate.isWrite).toBe(false);
    expect(sdk.sends[0]?.command).toBe("validate");
  });

  it("returns timeout even when send and close never resolve", async () => {
    const { adapter, sdk } = await setup();
    sdk.hangNext = true;
    sdk.hangClose = true;
    const started = Date.now();
    const timed = await adapter.execute({ command: ["view", "a.docx"] });
    const elapsed = Date.now() - started;
    expect(timed.code).toBe("timeout");
    expect(elapsed).toBeLessThan(1500);
    sdk.hangNext = false;
    sdk.hangClose = false;
    const ok = await adapter.execute({ command: ["view", "a.docx"] });
    expect(ok.ok).toBe(true);
  });

  it("rejects unclosed quotes without launching the SDK", async () => {
    const { adapter, sdk } = await setup();
    const result = await adapter.execute({ command: 'view "a.docx' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_command");
    expect(sdk.sends).toEqual([]);
    expect(sdk.opens).toBe(0);
  });
});
