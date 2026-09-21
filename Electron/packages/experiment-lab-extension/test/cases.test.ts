import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandCases } from "../agent/cases.js";
import { ExperimentService } from "../agent/service.js";
import { readRegular } from "../agent/paths.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "experiment-cases-")); roots.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-b", "main"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Fixture");
  await writeFile(join(root, ".gitignore"), ".pi/\n"); await writeFile(join(root, "main.js"), "console.log('ok');\n");
  git("add", "."); git("commit", "-m", "fixture");
  return root;
}

it("测例规范化为明确命令、退出码、离线策略和固定文件检查", () => {
  const [value] = commandCases([{ id: "smoke", command: { executable: "node", args: ["main.js"] }, checks: [{ path: "result.txt", expectedText: "ok\n" }] }]);
  expect(value).toMatchObject({ id: "smoke", title: "smoke", command: { executable: "node", args: ["main.js"], shell: false }, expectedExitCode: 0, allowedDomains: [], checks: [{ path: "result.txt", expectedText: "ok\n" }] });
});

it("拒绝歧义shell、重复身份、越界产物、宽泛联网及过大定义", () => {
  expect(() => commandCases([{ id: "smoke", command: { executable: "echo ok", shell: true, args: ["extra"] } }])).toThrow(/invalid-command/);
  const item = { id: "smoke", command: { executable: "true" } };
  expect(() => commandCases([item, item])).toThrow(/invalid-case/);
  expect(() => commandCases([{ ...item, metricsFile: "../secrets" }])).toThrow(/invalid-path/);
  expect(() => commandCases([{ ...item, allowedDomains: ["*"] }])).toThrow(/invalid-domain/);
  expect(() => commandCases([{ ...item, allowedDomains: ["http://example.com"] }])).toThrow(/invalid-domain/);
  expect(() => commandCases([{ ...item, command: { executable: "node", args: Array(5).fill("x".repeat(4096)) } }])).toThrow(/case-limit/);
});

it("测例随修订冻结，checkpoint只存目录，完整定义仍可有界读取", async () => {
  const root = await fixture(); const service = new ExperimentService(root);
  const cases = commandCases([{ id: "smoke", title: "固定检查", command: { executable: "node", args: ["main.js"] } }]);
  await service.create({ experimentId: "command-check", question: "命令是否工作？", cases });
  const frozen = await service.freeze("command-check");
  await expect(service.update("command-check", { cases: [] })).rejects.toMatchObject({ code: "experiment-frozen" });
  const checkpoint = JSON.parse(await readFile(join(root, ".pi/agent/experiments/command-check.json"), "utf8"));
  expect(checkpoint.cases).toBeUndefined();
  expect(checkpoint.caseCatalog).toMatchObject([{ id: "smoke", networkDomains: 0 }]);
  const response = await service.execute({ action: "case", experimentId: "command-check", caseId: "smoke" });
  expect(response.definition).toEqual(cases[0]);
  const definition = JSON.parse(await readFile(join(root, `.pi/agent/experiments/command-check/cases/${frozen.sequence}/smoke.json`), "utf8"));
  expect(definition).toEqual(cases[0]);
  await service.revise("command-check"); await service.update("command-check", { cases: [] });
  expect((await service.get("command-check", 1)).cases).toEqual(cases);
});

it("非普通输出文件不会阻塞可信验证器，超限文件明确拒绝", async () => {
  const root = await fixture();
  if (process.platform !== "win32") {
    const pipe = join(root, "pipe"); execFileSync("mkfifo", [pipe]);
    await expect(readRegular(root, pipe, 1024)).rejects.toMatchObject({ code: "unsafe-path" });
  }
  await writeFile(join(root, "large.txt"), "x".repeat(1025));
  await expect(readRegular(root, join(root, "large.txt"), 1024)).rejects.toMatchObject({ code: "snapshot-limit" });
});
