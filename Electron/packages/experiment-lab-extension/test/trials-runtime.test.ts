import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ExperimentService } from "../agent/service.js";
import { commandCases } from "../agent/cases.js";
import { TrialCoordinator } from "../agent/trials.js";
// Actual shipped JS is required: supervisors run in a separate Node process.
import { createSandboxDriver } from "../agent/dist/sandbox-driver.js";

let root = "";
let coordinator: TrialCoordinator | undefined;
afterEach(async () => { await coordinator?.shutdown(); coordinator = undefined; if (root) await rm(root, { recursive: true, force: true }); root = ""; });

it("真实Node命令在OS沙盒中运行，经协调器形成可追溯数值记录", async () => {
  const driver = createSandboxDriver();
  const probe = await driver.probe();
  if (process.platform !== "darwin" && process.platform !== "linux") { expect(probe.available).toBe(false); return; }
  expect(probe.available, JSON.stringify(probe)).toBe(true);
  root = await realpath(await mkdtemp(join(tmpdir(), "experiment-real-trial-")));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-b", "main"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Fixture");
  await writeFile(join(root, ".gitignore"), ".pi/\n"); await writeFile(join(root, "input.txt"), "must stay private\n"); git("add", "."); git("commit", "-m", "fixture");
  const script = `const fs=require('node:fs'); let denied=true;
try { fs.readFileSync(${JSON.stringify(join(root, "input.txt"))}); denied=false; } catch {}
try { fs.writeFileSync(${JSON.stringify(join(root, "touched.txt"))},'bad'); denied=false; } catch {}
if(process.env.PIPIUI_SESSION_CAPABILITY) denied=false;
fs.writeFileSync('result.txt',denied?'ok\\n':'bad\\n'); fs.writeFileSync('metrics.json',JSON.stringify({score:denied?1:0})); console.log('trial-ok');`;
  const store = new ExperimentService(root);
  await store.create({ experimentId: "real-check", question: "真实沙盒能保护正式树吗？", metrics: [{ id: "score", unit: "ratio", direction: "higher" }], cases: commandCases([{ id: "node-check", command: { executable: "node", args: ["-e", script] }, checks: [{ path: "result.txt", expectedText: "ok\n" }], metricsFile: "metrics.json" }]) });
  await store.freeze("real-check");
  coordinator = new TrialCoordinator(root, { store, driver, availability: async () => ({ enabled: true }) });
  const started = await coordinator.start({ experimentId: "real-check", caseId: "node-check", requestId: "real-once" });
  const result = await coordinator.wait("real-check", started.trial.id);
  expect(result, JSON.stringify(result)).toMatchObject({ state: "succeeded", quality: "pass", sandbox: { applied: true, version: "0.0.77" } });
  expect(result.metrics).toContainEqual({ id: "score", value: 1, unit: "ratio", source: "workload-output" });
  expect(result.totalMs).toBeGreaterThan(0);
  expect(await readFile(join(root, "input.txt"), "utf8")).toBe("must stay private\n");
  await expect(readFile(join(root, "touched.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  const stdout = result.artifacts.find((item) => item.kind === "stdout" && item.phase === "workload")!;
  expect(await readFile(join(root, stdout.path), "utf8")).toContain("trial-ok");
  expect(JSON.stringify(result)).not.toContain(homedir() + "/.ssh");
}, 30000);
