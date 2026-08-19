import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

register("./test-shims/loader.mjs", pathToFileURL(join(root, "goal-vendor.test.ts")));

describe("vendored pi-goal package", () => {
  it("keeps the pi manifest and entry file", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(manifest.name, "@narumitw/pi-goal");
    assert.equal(manifest.version, "0.52.1");
    assert.equal(manifest.license, "MIT");
    const entry = manifest.pi?.extensions?.[0];
    assert.equal(typeof entry, "string");
    assert.ok(existsSync(join(root, entry)), `missing entry ${entry}`);
  });

  it("ships LICENSE", () => {
    assert.ok(existsSync(join(root, "LICENSE")));
    assert.match(readFileSync(join(root, "LICENSE"), "utf8"), /MIT License/);
  });

  it("registers the /goal slash command against a fake ExtensionAPI", async () => {
    const commands: string[] = [];
    const tools: string[] = [];
    const events: string[] = [];
    const bus: string[] = [];
    const fake = {
      registerCommand(name: string) {
        commands.push(name);
      },
      registerTool(tool: { name?: string }) {
        if (tool?.name) tools.push(tool.name);
      },
      on(name: string) {
        events.push(name);
      },
      events: {
        on(channel: string) {
          bus.push(channel);
        },
        emit() {},
      },
      getActiveTools() {
        return [];
      },
      setActiveTools() {},
    };
    const mod = await import("./src/index.ts");
    assert.equal(typeof mod.default, "function");
    mod.default(fake as never);
    assert.ok(commands.includes("goal"), `commands=${commands.join(",")}`);
  });
});

describe("goal feature wiring", () => {
  it("defaults ON and mounts like plan", async () => {
    const featuresUrl = new URL(
      "../../../packages/pi-backend/src/features.ts",
      import.meta.url,
    );
    const spawnUrl = new URL(
      "../../../packages/pi-backend/src/spawn-assembly.ts",
      import.meta.url,
    );
    const { DEFAULT_FEATURES } = await import(featuresUrl.href);
    const { assemblePiSpawn, resolveSpawnPaths } = await import(spawnUrl.href);
    assert.equal(DEFAULT_FEATURES.goal, true);
    assert.equal(DEFAULT_FEATURES.plan, true);

    const goalPath = "/runtime/pi-goal/src/index.ts";
    const withGoal = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { goal: true },
      paths: { goalRuntime: goalPath },
    });
    assert.ok(withGoal.args.includes("-e"));
    assert.ok(withGoal.args.includes(goalPath));

    const withoutGoal = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { goal: false },
      paths: { goalRuntime: goalPath },
    });
    assert.ok(!withoutGoal.args.includes(goalPath));

    const runtimeRoot = join(root, "..");
    const paths = resolveSpawnPaths(runtimeRoot);
    assert.equal(paths.goalRuntime, join(root, "src", "index.ts"));
  });
});
