// @vitest-environment node
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { validateExtensionManifest } from "../../pi-backend/src/extension-manifest.js";
import { createExtensionLoader } from "../../pi-backend/src/extension-loader.js";
import { createExtensionRegistry } from "../../pi-backend/src/extension-registry.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(pkgRoot, "../../resources/runtime/extensions/office-extension");

describe("runtime mirror is loadable without source node_modules", () => {
  let tmp = "";
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("has synced manifest, agent/host, NOTICE, LICENSE, and bin contract", () => {
    expect(existsSync(join(runtimeRoot, "pipiui-extension.json"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "agent/dist/index.js"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "agent/dist/host.js"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "agent/dist/officecli-sdk.cjs"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "app/dist/office-renderer.js"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "NOTICE"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "LICENSE-OFFICECLI"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "THIRD-PARTY-NOTICES-OFFICECLI.md"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "bin/README.md"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "licenses/officecli/LICENSE"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "licenses/officecli/NOTICE"))).toBe(true);
    const bundledSdk = readFileSync(join(runtimeRoot, "agent/dist/officecli-sdk.cjs"), "utf8");
    expect(bundledSdk).toContain("OFFICECLI_SKIP_UPDATE");
    expect(bundledSdk).toContain("pipiuiDisabledInstall");
    const sdk = createRequire(join(runtimeRoot, "package.json"))(join(runtimeRoot, "agent/dist/officecli-sdk.cjs")) as { install: () => void };
    expect(() => sdk.install()).toThrow(/disables @officecli\/sdk install/);
    const raw = JSON.parse(readFileSync(join(runtimeRoot, "pipiui-extension.json"), "utf8"));
    const result = validateExtensionManifest(raw);
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(pkgRoot, "pipiui-extension.json"), "utf8"))).toEqual(raw);
  });

  it("mounts through the extension loader and dynamically imports runtime agent/host", async () => {
    tmp = await mkdtemp(join(tmpdir(), "office-runtime-"));
    const appRoot = join(tmp, "app-ext");
    const builtinRoot = join(tmp, "builtin");
    await cp(runtimeRoot, join(appRoot, "office-extension"), { recursive: true });

    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({ registry, builtinRoot, appRoot });
    const records = loader.scan();
    const rec = records.find((row) => row.id === "office-extension") ?? registry.get("office-extension");
    expect(rec?.state).toBe("loaded");
    const listed = loader.list().find((row) => row.id === "office-extension");
    expect(listed?.ui?.documentRenderers?.[0]?.id).toBe("office");
    const spawned = loader.spawnPackages({ "office-extension": true }).find((row) => row.id === "office-extension");
    expect(spawned?.extensionPath).toMatch(/office-extension\/agent\/dist\/index\.js$/);

    const isolated = join(tmp, "isolated");
    await cp(runtimeRoot, isolated, { recursive: true });
    const host = await import(pathToFileURL(join(isolated, "agent/dist/host.js")).href);
    expect(typeof host.createDirectOfficeAdapter).toBe("function");
    expect(host.DIRECT_OFFICECLI_TOOL).toBe("pipiui_officecli");
    // The host library exports exactly the direct tool contract — nothing else.
    expect(Object.keys(host).sort()).toEqual([
      "DEFAULT_COMMAND_TIMEOUT_MS",
      "DEFAULT_OUTPUT_LIMIT",
      "DEFAULT_STARTUP_TIMEOUT_MS",
      "DIRECT_OFFICECLI_TOOL",
      "DirectOfficeAdapter",
      "OFFICECLI_PROVENANCE",
      "OFFICECLI_RECEIPT_NAME",
      "OFFICECLI_SKIP_UPDATE_ENV",
      "OFFICECLI_WRITE_ATOMICITY",
      "OFFICE_COMMAND_INPUT_SCHEMA",
      "OFFICE_FORMAT_POLICIES",
      "PIPIUI_OFFICECLI_BINARY_ENV",
      "SDK_FORCED_OPEN_OPTIONS",
      "bundledOfficeCliCandidate",
      "createDirectOfficeAdapter",
      "createDirectOfficeTrack",
      "ensureOfficeCliUpdateDisabled",
      "officeCommandFixture",
      "officeFormatPolicy",
      "packageRoot",
      "parseOfficeCommand",
      "readOfficeCliReceipt",
      "resolveOfficeCliBinary",
    ]);
    const agent = await import(pathToFileURL(join(isolated, "agent/dist/index.js")).href);
    expect(typeof agent.default).toBe("function");
    const tools: string[] = [];
    agent.default({ registerTool: (tool: { name: string }) => tools.push(tool.name) });
    expect(tools).toEqual(["pipiui_officecli"]);

    const require = createRequire(join(isolated, "agent/dist/sdk.js"));
    let resolvedSdk = "";
    try {
      resolvedSdk = require.resolve("@officecli/sdk");
    } catch {
      resolvedSdk = "";
    }
    expect(resolvedSdk.includes("node_modules/@officecli/sdk") && resolvedSdk.includes("pipiui-office-extension")).toBe(false);
  });
});
