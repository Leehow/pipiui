import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createExtensionLoader } from "../../pi-backend/src/extension-loader.js";
import { createExtensionRegistry } from "../../pi-backend/src/extension-registry.js";
import { validateExtensionManifest } from "../../pi-backend/src/extension-manifest.js";
import { experimentParameters } from "../agent/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const skillPath = "skills/prototype-experiments/SKILL.md";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const json = async (path: string) => JSON.parse(await readFile(join(root, path), "utf8"));

it("有效manifest声明专属skill根和bundled资源，frontmatter可按需发现", async () => {
  const manifest = await json("pipiui-extension.json");
  const result = validateExtensionManifest(manifest);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.manifest.agentSkills).toEqual(["skills"]);
  expect(manifest.defaultEnabled).toBe(false);
  expect(manifest.runtimeAssets).toContain("skills");
  const skill = await readFile(join(root, skillPath), "utf8");
  expect(skill).toMatch(/^---\nname: prototype-experiments\ndescription: .+\n---\n/);
  expect(skill).not.toContain("disable-model-invocation: true");
  expect(skill).toContain("不是普通修 bug 的必经流程");
  expect(skill).toContain("只讨论设计时先答，不自动收费");
});

it("真实loader仅在启用时提供该skill给spawn；关闭不引入实验流程", async () => {
  const temp = await mkdtemp(join(tmpdir(), "experiment-skill-loader-")); roots.push(temp);
  const appRoot = join(temp, ".pi/agent/extensions"), pkg = join(appRoot, "experiment-lab");
  const manifest = await json("pipiui-extension.json");
  for (const [path, content] of [
    ["pipiui-extension.json", JSON.stringify(manifest)],
    [manifest.agent.extension, "export default () => {};"],
    [manifest.app.ui.panels[0].entry, "export const createComponent = () => () => null;"],
    [skillPath, await readFile(join(root, skillPath), "utf8")],
  ]) { await mkdir(dirname(join(pkg, path)), { recursive: true }); await writeFile(join(pkg, path), content); }
  const loader = createExtensionLoader({ registry: createExtensionRegistry([]), appRoot, builtinRoot: join(temp, "runtime/extensions") });
  loader.scan();
  const enabledRoots = (enabled: boolean) => loader.spawnPackages({ "experiment-lab": enabled }).filter((entry) => entry.enabled).flatMap((entry) => entry.skillRoots ?? []);
  expect(enabledRoots(false)).toEqual([]);
  expect(enabledRoots(true)).toEqual([await realpath(join(pkg, "skills"))]);
  expect(loader.skillRootEntries({ "experiment-lab": false })).toEqual([expect.objectContaining({ id: "experiment-lab", enabled: false })]);
});

it("Skill操作名来自实际experiment schema，不文档先行虚构工具", async () => {
  const skill = await readFile(join(root, skillPath), "utf8");
  const actions = ["create", "update", "freeze", "read", "inventory", "revise", "variant_prepare", "variant_freeze", "variant_read", "variant_list", "batch_run", "batch_status", "batch_list", "batch_logs", "batch_respond", "batch_cancel", "batch_view", "preview_start", "preview_status", "preview_list", "preview_stop", "preview_evidence", "batch_report", "adopt"];
  for (const action of actions) {
    expect(experimentParameters.properties.action.enum, action).toContain(action);
    expect(skill, action).toContain(`\`${action}\``);
  }
  for (const boundary of ["inputRequestId", "不是 PTY attach", "不启动第二个 Pi", "target=both", "tabId", "viewport", "suggestion-draft", "不静默换模型", "never", "未知用量／费用不补零"]) expect(skill).toContain(boundary);
  const panel = await readFile(join(root, "app/panel.tsx"), "utf8");
  expect(panel).not.toMatch(/from\s+["'][^"']*agent\//);
});

it("workspace build的bundled镜像包含同一Skill资源与manifest声明", async () => {
  const mirror = fileURLToPath(new URL("../../../resources/runtime/extensions/experiment-lab/", import.meta.url));
  const manifest = JSON.parse(await readFile(join(mirror, "pipiui-extension.json"), "utf8"));
  expect(manifest.agent.skills).toEqual(["skills"]);
  expect(await readFile(join(mirror, skillPath), "utf8")).toBe(await readFile(join(root, skillPath), "utf8"));
});

it("npm pack dry-run包含Skill和声明的编译入口，不生成App", async () => {
  const pkg = await json("package.json");
  expect(pkg.files).toContain("skills");
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts", "--workspaces=false"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const packed = JSON.parse(output);
  // npm versions return either an array or an object keyed by package name.
  const receipt = Array.isArray(packed) ? packed[0] : packed[pkg.name];
  const files = receipt.files.map((entry: { path: string }) => entry.path);
  expect(files).toContain(skillPath);
  expect(files).toContain("pipiui-extension.json");
  expect(files).toContain("agent/dist/index.js");
  expect(files).toContain("app/dist/panel.js");
  expect(files).not.toContain("test/skill.test.ts");
}, 30000);
