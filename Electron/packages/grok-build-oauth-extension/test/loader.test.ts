import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createExtensionLoader } from "../../pi-backend/src/extension-loader.js";
import { createExtensionRegistry } from "../../pi-backend/src/extension-registry.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let tmp = "";
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  tmp = "";
});

describe("grok-build-oauth loader / spawn assembly (M1)", () => {
  it("scans as app-origin package and validates without error", async () => {
    tmp = await mkdtemp(join(tmpdir(), "grok-loader-m1-"));
    const appRoot = join(tmp, "app-ext");
    const builtinRoot = join(tmp, "builtin");
    await cp(pkgRoot, join(appRoot, "grok-build-oauth"), { recursive: true });

    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({ registry, builtinRoot, appRoot });
    const records = loader.scan();
    const rec = records.find((r) => r.id === "grok-build-oauth") ?? registry.get("grok-build-oauth");
    expect(rec).toBeTruthy();
    expect(rec?.state).not.toBe("error");
    expect(rec?.state).toBe("loaded");
    expect(rec?.error).toBeUndefined();
    // loader list surfaces manifest summary
    const listed = loader.list().find((i) => i.id === "grok-build-oauth");
    expect(listed?.source).toBe("app");
    expect(listed?.capabilities).toEqual(expect.arrayContaining(["bridge.emit", "invoke.agent"]));
    expect(listed?.ui?.panels?.[0]?.slot).toBe("toolPanel");
  });

  it("spawnPackages exposes agent entry only when enabled (D3/D9)", async () => {
    tmp = await mkdtemp(join(tmpdir(), "grok-spawn-m1-"));
    const appRoot = join(tmp, "app-ext");
    const builtinRoot = join(tmp, "builtin");
    await cp(pkgRoot, join(appRoot, "grok-build-oauth"), { recursive: true });

    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({ registry, builtinRoot, appRoot });
    loader.scan();

    const disabled = loader.spawnPackages().find((p) => p.id === "grok-build-oauth");
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.extensionPath).toMatch(/grok-build-oauth\/agent\/dist\/index\.js$/);

    const enabled = loader.spawnPackages({ "grok-build-oauth": true }).find((p) => p.id === "grok-build-oauth");
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.extensionPath).toBe(disabled?.extensionPath);
  });
});
