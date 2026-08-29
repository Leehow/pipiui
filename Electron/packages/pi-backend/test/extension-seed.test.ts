import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAssetIndex } from "../src/extension-update-engine.js";
import {
  SEED_MANAGED_EXTENSION_IDS,
  applySeedMountOverrides,
  extensionUpdateSigningKey,
  resolveSeedExtension,
  selectTransactionalUpdateComponent,
  withSeedVersionPriority,
} from "../src/extension-seed.js";

const repoSeedRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/extensions");
const SEED_IDS = [...SEED_MANAGED_EXTENSION_IDS];
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function pointer(contentHash: string, version: string) {
  return {
    contentHash,
    version,
    sha256: contentHash,
    updatedAt: new Date().toISOString(),
  };
}

/** Build a store tree: object dirs (with a manifest) plus optional slot pointers. */
async function makeStore(root: string, layout: {
  objects?: Record<string, { version: string; agentEntry?: string }>;
  active?: { hash: string; version: string } | "missing-object" | "corrupt";
  previous?: { hash: string; version: string } | "missing-object" | "corrupt";
}) {
  const storeRoot = join(root, "extension-store");
  for (const [hash, object] of Object.entries(layout.objects ?? {})) {
    const dir = join(storeRoot, "objects", hash);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pipiui-extension.json"), JSON.stringify({
      id: "web-access-extension",
      version: object.version,
      ...(object.agentEntry ? { agent: { extension: object.agentEntry } } : {}),
    }), "utf8");
  }
  const writeSlot = async (slot: "active" | "previous", value: NonNullable<typeof layout.active>) => {
    const slotFile = join(storeRoot, "extensions", "web-access-extension", `${slot}.json`);
    await mkdir(dirname(slotFile), { recursive: true });
    if (value === "corrupt") {
      await writeFile(slotFile, "{ not json", "utf8");
      return;
    }
    if (value === "missing-object") {
      await writeFile(slotFile, JSON.stringify(pointer("f".repeat(64), "9.9.9")), "utf8");
      return;
    }
    await writeFile(slotFile, JSON.stringify(pointer(value.hash, value.version)), "utf8");
  };
  if (layout.active) await writeSlot("active", layout.active);
  if (layout.previous) await writeSlot("previous", layout.previous);
  return storeRoot;
}

async function makeSeed(root: string, version = "0.1.0") {
  const seedRoot = join(root, "seed", "extensions");
  const dir = join(seedRoot, "web-access-extension");
  await mkdir(join(dir, "agent"), { recursive: true });
  await writeFile(join(dir, "pipiui-extension.json"), JSON.stringify({
    id: "web-access-extension",
    version,
    agent: { extension: "agent/index.ts" },
  }), "utf8");
  await writeFile(join(dir, "agent", "index.ts"), "export default () => {};", "utf8");
  return seedRoot;
}

describe("seed fallback path (active → previous → bundled seed)", () => {
  it("resolves the bundled seed when the store has no slots", async () => {
    const root = await mkdtemp(join(tmpdir(), "extension-seed-"));
    try {
      const storeRoot = await makeStore(root, {});
      const seedRoot = await makeSeed(root);
      const resolved = await resolveSeedExtension({ storeRoot, seedRoot, extensionId: "web-access-extension" });
      expect(resolved?.slot).toBe("seed");
      expect(resolved?.objectDir).toBe(join(seedRoot, "web-access-extension"));
      expect(resolved?.version).toBe("0.1.0");
      expect(resolved?.agentEntry).toBe("agent/index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers the active slot object and reports its manifest version", async () => {
    const root = await mkdtemp(join(tmpdir(), "extension-seed-"));
    try {
      const storeRoot = await makeStore(root, {
        objects: { [HASH_A]: { version: "0.2.0", agentEntry: "agent/index.ts" } },
        active: { hash: HASH_A, version: "0.2.0" },
      });
      const seedRoot = await makeSeed(root);
      const resolved = await resolveSeedExtension({ storeRoot, seedRoot, extensionId: "web-access-extension" });
      expect(resolved?.slot).toBe("active");
      expect(resolved?.objectDir).toBe(join(storeRoot, "objects", HASH_A));
      expect(resolved?.version).toBe("0.2.0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the previous slot when the active object is missing or the pointer is corrupt", async () => {
    const root = await mkdtemp(join(tmpdir(), "extension-seed-"));
    try {
      const seedRoot = await makeSeed(root);
      for (const active of ["missing-object", "corrupt"] as const) {
        const storeRoot = await makeStore(root, {
          objects: { [HASH_B]: { version: "0.1.5", agentEntry: "agent/index.ts" } },
          active,
          previous: { hash: HASH_B, version: "0.1.5" },
        });
        const resolved = await resolveSeedExtension({ storeRoot, seedRoot, extensionId: "web-access-extension" });
        expect(resolved?.slot).toBe("previous");
        expect(resolved?.version).toBe("0.1.5");
        await rm(join(root, "extension-store"), { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the seed when both slots are unusable and returns undefined with no seed", async () => {
    const root = await mkdtemp(join(tmpdir(), "extension-seed-"));
    try {
      const storeRoot = await makeStore(root, { active: "corrupt" });
      expect(await resolveSeedExtension({ storeRoot, seedRoot: join(root, "absent"), extensionId: "web-access-extension" })).toBeUndefined();
      const seedRoot = await makeSeed(root);
      const resolved = await resolveSeedExtension({ storeRoot, seedRoot, extensionId: "web-access-extension" });
      expect(resolved?.slot).toBe("seed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores ids outside the seed-managed set", async () => {
    const root = await mkdtemp(join(tmpdir(), "extension-seed-"));
    try {
      const storeRoot = await makeStore(root, {});
      const seedRoot = await makeSeed(root);
      expect(await resolveSeedExtension({ storeRoot, seedRoot, extensionId: "pipiui-headroom" })).toBeUndefined();
      expect(SEED_IDS.sort()).toEqual([
        "cua-extension",
        "memory-extension",
        "office-extension",
        "pdf-extension",
        "web-access-extension",
        "webview-browser-extension",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("version priority (store install supersedes the bundled seed)", () => {
  const item = (version: string) => ({
    id: "web-access-extension",
    version,
    updateComponents: [{
      id: "web-access-extension",
      name: "PipiUI Web Access",
      version,
      source: { type: "githubReleases", owner: "Leehow", repo: "pipiui" } as const,
    }],
  });

  it("overrides the item and package-component version from the active slot", () => {
    const resolved = { extensionId: "web-access-extension", objectDir: "/x", slot: "active" as const, version: "0.2.0" };
    const out = withSeedVersionPriority(item("0.1.0"), resolved);
    expect(out.version).toBe("0.2.0");
    expect(out.updateComponents?.[0].version).toBe("0.2.0");
  });

  it("uses the previous slot when active is gone", () => {
    const resolved = { extensionId: "web-access-extension", objectDir: "/x", slot: "previous" as const, version: "0.1.5" };
    expect(withSeedVersionPriority(item("0.1.0"), resolved).version).toBe("0.1.5");
  });

  it("keeps the bundled declaration for seed-slot or unreadable resolutions", () => {
    const base = item("0.1.0");
    const seed = { extensionId: "web-access-extension", objectDir: "/x", slot: "seed" as const, version: "0.1.0" };
    expect(withSeedVersionPriority(base, seed)).toBe(base);
    expect(withSeedVersionPriority(base, undefined)).toBe(base);
    const unreadable = { extensionId: "web-access-extension", objectDir: "/x", slot: "active" as const };
    expect(withSeedVersionPriority(base, unreadable)).toBe(base);
  });

  it("leaves upstream-artifact component versions (e.g. officecli) untouched", () => {
    const officeItem = {
      id: "office-extension",
      version: "1.0.0",
      updateComponents: [{
        id: "officecli",
        name: "OfficeCLI",
        version: "1.0.144",
        source: { type: "githubReleases", owner: "iOfficeAI", repo: "OfficeCLI" } as const,
      }],
    };
    const resolved = { extensionId: "office-extension", objectDir: "/x", slot: "active" as const, version: "1.1.0" };
    const out = withSeedVersionPriority(officeItem, resolved);
    expect(out.version).toBe("1.1.0");
    expect(out.updateComponents?.[0].version).toBe("1.0.144");
  });
});

describe("mount overrides (agent halves resolve to the shared store)", () => {
  it("repoints seed-managed mounts to the store object's declared agent entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "extension-seed-"));
    try {
      const storeRoot = await makeStore(root, {
        objects: { [HASH_A]: { version: "0.2.0", agentEntry: "agent/index.ts" } },
        active: { hash: HASH_A, version: "0.2.0" },
      });
      const seedRoot = await makeSeed(root);
      const packages = [
        { id: "web-access-extension", enabled: true, extensionPath: join(seedRoot, "web-access-extension", "agent", "index.ts") },
        { id: "memory-extension", enabled: true, extensionPath: "/bundled/memory/agent.ts" },
      ];
      const out = await applySeedMountOverrides({ storeRoot, seedRoot, extensions: packages });
      expect(out[0].extensionPath).toBe(join(storeRoot, "objects", "a".repeat(64), "agent", "index.ts"));
      expect(out[1].extensionPath).toBe("/bundled/memory/agent.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the bundled path for seed-slot resolutions and objects without an agent entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "extension-seed-"));
    try {
      const storeRoot = await makeStore(root, {});
      const seedRoot = await makeSeed(root);
      const bundledPath = join(seedRoot, "web-access-extension", "agent", "index.ts");
      const packages = [{ id: "web-access-extension", enabled: true, extensionPath: bundledPath }];
      expect((await applySeedMountOverrides({ storeRoot, seedRoot, extensions: packages }))[0].extensionPath).toBe(bundledPath);
      const hostOnlyStore = await makeStore(root, {
        objects: { [HASH_C]: { version: "0.3.0" } },
        active: { hash: HASH_C, version: "0.3.0" },
      });
      expect((await applySeedMountOverrides({ storeRoot: hostOnlyStore, seedRoot, extensions: packages }))[0].extensionPath).toBe(bundledPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("transactional component selection (githubReleases package artifacts only)", () => {
  const packageComponent = {
    id: "web-access-extension",
    name: "PipiUI Web Access",
    version: "0.1.0",
    source: { type: "githubReleases", owner: "Leehow", repo: "pipiui" } as const,
  };
  const npmComponent = {
    id: "firecrawl-pdf-inspector",
    name: "@firecrawl/pdf-inspector",
    version: "1.15.0",
    source: { type: "npm", packageName: "@firecrawl/pdf-inspector" } as const,
  };

  it("accepts the package component (id equals the extension id, fixed githubReleases source)", () => {
    const selection = selectTransactionalUpdateComponent({ extensionId: "web-access-extension", components: [packageComponent] });
    expect(selection.ok).toBe(true);
    if (selection.ok) expect(selection.component.source).toEqual({ type: "githubReleases", owner: "Leehow", repo: "pipiui" });
  });

  it("rejects npm/pypi discovery, upstream-artifact components, and missing declarations", () => {
    const office = { ...packageComponent, id: "officecli" };
    expect(selectTransactionalUpdateComponent({ extensionId: "pdf-extension", components: [npmComponent] }))
      .toMatchObject({ ok: false, code: "unsupported_source" });
    expect(selectTransactionalUpdateComponent({ extensionId: "office-extension", components: [office] }))
      .toMatchObject({ ok: false, code: "unsupported_source" });
    expect(selectTransactionalUpdateComponent({ extensionId: "office-extension" }))
      .toMatchObject({ ok: false, code: "unsupported_source" });
    expect(selectTransactionalUpdateComponent({ extensionId: "office-extension", components: [office], componentId: "nope" }))
      .toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("packaged resource manifest (recovery seed inventory)", () => {
  const PACKAGE_COMPONENT_IDS = ["web-access-extension", "webview-browser-extension", "cua-extension", "memory-extension"];

  it("ships a complete, self-consistent seed package for each managed extension", async () => {
    for (const id of SEED_IDS) {
      const manifestPath = join(repoSeedRoot, id, "pipiui-extension.json");
      expect(existsSync(manifestPath), `missing seed manifest for ${id}`).toBe(true);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      expect(manifest.id).toBe(id);
      expect(typeof manifest.version).toBe("string");
      if (id !== "office-extension" && id !== "pdf-extension") {
        // Contract-generation manifests (contract-scaffold wave) carry the
        // frozen hostApi range; office/pdf predate it and are read as-is.
        expect(typeof manifest.hostApi).toBe("string");
      }
      if (id === "memory-extension") {
        expect(manifest.agent.extension).toBe("agent/memory-broker-extension.ts");
      } else if (id !== "office-extension" && id !== "pdf-extension") {
        expect(manifest.agent.extension).toBe("agent/index.ts");
      }
      if (manifest.agent?.extension) {
        expect(existsSync(join(repoSeedRoot, id, manifest.agent.extension)), `${id} agent entry missing`).toBe(true);
      }
    }
  });

  it("declares one-click updateComponents for the four migrated extensions", async () => {
    for (const id of PACKAGE_COMPONENT_IDS) {
      const manifest = JSON.parse(await readFile(join(repoSeedRoot, id, "pipiui-extension.json"), "utf8"));
      const component = manifest.updateComponents?.find((entry: { id: string }) => entry.id === id);
      expect(component, `${id} lacks a package updateComponent`).toBeDefined();
      expect(component.version).toBe(manifest.version);
      expect(component.source).toEqual({ type: "githubReleases", owner: "Leehow", repo: "pipiui" });
      expect(manifest.update).toEqual({ channel: "stable", signature: "ed25519" });
    }
    // office/pdf keep their upstream-artifact declarations (discovery-only).
    const office = JSON.parse(await readFile(join(repoSeedRoot, "office-extension", "pipiui-extension.json"), "utf8"));
    expect(office.updateComponents?.[0].id).toBe("officecli");
  });
});

describe("official release pipeline (Office release-chain pattern)", () => {
  it("packs a signed artifact whose index the update engine accepts", async () => {
    const root = await mkdtemp(join(tmpdir(), "extension-seed-release-"));
    try {
      const packageDir = join(root, "web-access-extension");
      await mkdir(join(packageDir, "agent"), { recursive: true });
      await writeFile(join(packageDir, "pipiui-extension.json"), JSON.stringify({
        id: "web-access-extension", version: "0.2.0", agent: { extension: "agent/index.ts" },
      }), "utf8");
      await writeFile(join(packageDir, "agent", "index.ts"), "export default () => {};", "utf8");
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const keyPath = join(root, "signing-key.pem");
      await writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }), "utf8");
      const outDir = join(root, "out");
      const pack = spawnSync(process.execPath, [
        "scripts/pack-extension-release.mjs", packageDir,
        "--version", "0.2.0",
        "--base-url", "https://github.com/Leehow/pipiui/releases/download/web-access-extension-v0.2.0",
        "--out", outDir,
        "--signing-key", keyPath,
      ], { cwd: join(dirname(fileURLToPath(import.meta.url)), "../../.."), encoding: "utf8" });
      expect(pack.status).toBe(0);
      const receipt = JSON.parse(pack.stdout);
      expect(receipt.signed).toBe(true);
      const artifact = await readFile(receipt.artifact);
      expect(artifact.byteLength).toBe(receipt.bytes);
      expect(createHash("sha256").update(artifact).digest("hex")).toBe(receipt.sha256);

      const index = parseAssetIndex(JSON.parse(await readFile(receipt.index, "utf8")), "0.2.0");
      const entry = index.assets["darwin-arm64"];
      expect(entry.asset).toBe("web-access-extension-0.2.0.tar.gz");
      expect(entry.bytes).toBe(receipt.bytes);
      expect(entry.sha256).toBe(receipt.sha256);
      // The engine's own verification shape: ed25519 over the raw artifact bytes.
      expect(entry.signature).toBeDefined();
      expect(cryptoVerify(null, artifact, publicKey, Buffer.from(entry.signature!, "base64"))).toBe(true);
      void cryptoSign; // (shape parity with the engine's verifier: ed25519 over raw bytes)
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses mutable release URLs and version drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "extension-seed-release-bad-"));
    try {
      const packageDir = join(root, "memory-extension");
      await mkdir(packageDir, { recursive: true });
      await writeFile(join(packageDir, "pipiui-extension.json"), JSON.stringify({ id: "memory-extension", version: "0.1.0" }), "utf8");
      const electronRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
      const run = (extra: string[]) => spawnSync(process.execPath, ["scripts/pack-extension-release.mjs", packageDir, ...extra], { cwd: electronRoot, encoding: "utf8" });
      expect(run(["--version", "0.1.0", "--base-url", "https://github.com/Leehow/pipiui/releases/latest/download/x"]).status).not.toBe(0);
      expect(run(["--version", "9.9.9", "--base-url", "https://github.com/Leehow/pipiui/releases/download/v9.9.9"]).status).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("official signing key seam", () => {
  it("parses the env-pinned SPKI key and fails closed when unset", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    process.env.PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY = spki;
    expect(extensionUpdateSigningKey()?.type).toBe("public");
    delete process.env.PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY;
    expect(extensionUpdateSigningKey()).toBeUndefined();
    process.env.PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY = "!!!not base64 spki!!!";
    expect(() => extensionUpdateSigningKey()).toThrow(/PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY/);
    delete process.env.PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY;
  });
});
