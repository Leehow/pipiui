import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSandboxDriver } from "../agent/dist/sandbox-driver.js";
import type { SandboxRunRequest } from "../agent/sandbox-contract.js";

const roots: string[] = [];
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(script = "printf ok"): Promise<SandboxRunRequest & { root: string; formal: string; privateRoot: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pipiui-lab-os-")));
  roots.push(root);
  const formal = join(root, "formal");
  const workspaceRoot = join(formal, ".scratch", "workspace");
  const homeRoot = join(root, "scratch", "home");
  const tempRoot = join(root, "scratch", "tmp");
  const privateRoot = join(root, "private-home");
  for (const path of [workspaceRoot, homeRoot, tempRoot, privateRoot, join(formal, "records")]) await mkdir(path, { recursive: true });
  for (const path of [join(formal, "sentinel"), join(formal, "records", "sentinel"), join(privateRoot, "sentinel")]) await writeFile(path, "untouched");
  return { root, formal, privateRoot, trialId: "sandbox-os", command: { executable: script, args: [], shell: true }, workspaceRoot, cwd: workspaceRoot,
    homeRoot, tempRoot, protectedReadRoots: [formal, join(formal, "records"), privateRoot], trustedReadRoots: [], allowedDomains: [], env: {}, timeoutMs: 8000, terminationGraceMs: 100 };
}
const driver = createSandboxDriver();

describe("per-trial OS sandbox", () => {
  it("probes the pinned, licensed vendored dependency", async () => {
    const probe = await driver.probe();
    expect(probe, JSON.stringify(probe)).toMatchObject({ available: true, version: "0.0.77", errors: [] });
  });

  it("runs actual code with nested writable carve-outs and denied formal/record/private reads and writes", async () => {
    const request = await fixture();
    const forbidden = [join(request.formal, "sentinel"), join(request.formal, "records", "sentinel"), join(request.privateRoot, "sentinel")];
    await writeFile(join(request.workspaceRoot, "checks.sh"), `set -e\nprintf allowed > allowed\nprintf scratch > "$TMPDIR/allowed"\n${forbidden.map(path => `if cat ${quote(path)}; then exit 41; fi\nif (printf changed > ${quote(path)}); then exit 42; fi`).join("\n")}\nprintf passed`);
    request.command = { executable: "/bin/sh", args: ["checks.sh"], shell: false };
    const result = await driver.run(request);
    expect(result, JSON.stringify(result)).toMatchObject({ state: "exited", exitCode: 0, sandbox: { applied: true } });
    expect(result.stdout).toContain("passed");
    expect(result.stderr).toMatch(/Operation not permitted|Permission denied/);
    expect(await readFile(join(request.workspaceRoot, "allowed"), "utf8")).toBe("allowed");
    expect(await readFile(join(request.tempRoot, "allowed"), "utf8")).toBe("scratch");
    for (const path of forbidden) expect(await readFile(path, "utf8")).toBe("untouched");
  });

  it("reads exact protected verifier inputs without granting adjacent secrets or verifier writes", async () => {
    const request = await fixture();
    const verifier = join(request.formal, "records", "verifier.sh");
    const localVerifier = join(request.workspaceRoot, "fixed.sh");
    for (const path of [verifier, localVerifier]) await writeFile(path, "printf verified");
    request.trustedReadRoots = [verifier, localVerifier];
    request.command.executable = `/bin/sh ${quote(verifier)}; /bin/sh ${quote(localVerifier)}; if cat ${quote(join(request.formal, "records", "sentinel"))}; then exit 51; fi; ${[verifier, localVerifier].map(path => `if (printf corrupt > ${quote(path)}); then exit 52; fi`).join("; ")}`;
    const result = await driver.run(request);
    expect(result, JSON.stringify(result)).toMatchObject({ state: "exited", exitCode: 0, stdout: "verifiedverified" });
    for (const path of [verifier, localVerifier]) expect(await readFile(path, "utf8")).toBe("printf verified");
    request.trustedReadRoots = [join(request.formal, "records")];
    expect(await driver.run(request)).toMatchObject({ state: "sandbox-unavailable", sandbox: { applied: false } });
    const secret = join(request.formal, "records", ".env.local"); await writeFile(secret, "never-read");
    request.trustedReadRoots = [secret];
    expect(await driver.run(request)).toMatchObject({ state: "sandbox-unavailable", sandbox: { applied: false } });
  });

  it("blocks a live local HTTP server unless explicitly authorized, including concurrent different policies", async () => {
    let hits = 0;
    const server = createServer((_request, response) => { hits++; response.end("local-ok"); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number };
      const script = `/usr/bin/curl --fail --silent --show-error --max-time 2 http://127.0.0.1:${address.port}/`;
      const allowed = await fixture(script); allowed.allowedDomains = ["127.0.0.1"];
      const denied = await fixture(script);
      const [yes, no] = await Promise.all([driver.run(allowed), driver.run(denied)]);
      expect(yes, JSON.stringify(yes)).toMatchObject({ state: "exited", exitCode: 0 });
      expect(yes.stdout).toBe("local-ok");
      expect(no.state).toBe("exited"); expect(no.exitCode).not.toBe(0); expect(no.stdout).not.toContain("local-ok");
      expect(hits).toBe(1);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it("does not cross concurrent filesystem policies", async () => {
    const a = await fixture(); const b = await fixture();
    a.command.executable = `sleep 0.15; printf a > own; if (printf escape > ${quote(join(b.workspaceRoot, "escaped"))}); then exit 45; fi`;
    b.command.executable = `sleep 0.15; printf b > own; if (printf escape > ${quote(join(a.workspaceRoot, "escaped"))}); then exit 45; fi`;
    const results = await Promise.all([driver.run(a), driver.run(b)]);
    for (const result of results) expect(result, JSON.stringify(result)).toMatchObject({ state: "exited", exitCode: 0 });
    expect(await readFile(join(a.workspaceRoot, "own"), "utf8")).toBe("a");
    expect(await readFile(join(b.workspaceRoot, "own"), "utf8")).toBe("b");
    await expect(readFile(join(a.workspaceRoot, "escaped"))).rejects.toThrow();
    await expect(readFile(join(b.workspaceRoot, "escaped"))).rejects.toThrow();
  });

  for (const mode of ["timed-out", "cancelled", "exited"] as const) {
    it(`cleans descendants after ${mode}, even a TERM-ignoring background child`, async () => {
      const request = await fixture(`(trap '' TERM; while :; do printf x >> heartbeat; sleep 0.04; done) & ${mode === "exited" ? "sleep 0.2; exit 0" : "wait"}`);
      if (mode === "timed-out") request.timeoutMs = 900;
      const controller = new AbortController();
      let cancelled = false;
      const result = await driver.run(request, { signal: controller.signal, onProgress(progress) {
        if (mode === "cancelled" && progress.phase === "running" && !cancelled) { cancelled = true; setTimeout(() => controller.abort(), 200); }
      } });
      expect(result, JSON.stringify(result)).toMatchObject({ state: mode, sandbox: { applied: true } });
      const heartbeat = join(request.workspaceRoot, "heartbeat");
      const before = await readFile(heartbeat, "utf8"); expect(before.length).toBeGreaterThan(0);
      await sleep(300);
      expect(await readFile(heartbeat, "utf8")).toBe(before);
    });
  }

  it("stops its child tree when the parent process exits and IPC disconnects", async () => {
    const request = await fixture("(trap '' TERM; while :; do printf x >> heartbeat; sleep 0.04; done) & wait");
    const module = pathToFileURL(resolve(import.meta.dirname, "../agent/dist/sandbox-driver.js")).href;
    const runner = spawn(process.execPath, ["--input-type=module", "-e", `import {createSandboxDriver} from ${JSON.stringify(module)}; await createSandboxDriver().run(${JSON.stringify(request)});`], {
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", ELECTRON_RUN_AS_NODE: "1" }, stdio: "ignore",
    });
    const exited = once(runner, "exit");
    const heartbeat = join(request.workspaceRoot, "heartbeat");
    try {
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        try { if ((await readFile(heartbeat)).length) { ready = true; break; } } catch { /* startup */ }
        await sleep(50);
      }
      expect(ready).toBe(true);
      runner.kill("SIGKILL"); // Only this test's explicitly owned runner, never PipiUI.
      await exited;
      await sleep(400);
      const before = await readFile(heartbeat, "utf8");
      await sleep(350);
      expect(await readFile(heartbeat, "utf8")).toBe(before);
    } finally { if (runner.exitCode === null && runner.signalCode === null) { runner.kill("SIGKILL"); await exited; } }
  });

  it("bounds logs, redacts split secrets/proxy credentials and isolates workload environment/IPC", async () => {
    const request = await fixture("/usr/bin/env; printf 'sensitive-'; sleep 0.02; printf 'split-secret'; printf '\\n'; i=0; while [ $i -lt 200 ]; do printf x; i=$((i+1)); done");
    request.command.executable += `; proxy="\${HTTP_PROXY#*://}"; auth="\${proxy%%@*}"; printf '\\nTOKEN=%s\\n' "\${auth#*:}"; printf 'Proxy-Authorization: Basic '; printf '%s' "$auth" | /usr/bin/base64; printf '\\n'`;
    request.allowedDomains = ["example.com"];
    request.redactValues = ["sensitive-split-secret"];
    request.maxOutputBytes = 4096;
    const previousNodeOptions = process.env.NODE_OPTIONS;
    process.env.PIPIUI_SANDBOX_TEST_SECRET = "host-env-must-not-leak";
    process.env.NODE_OPTIONS = "--no-warnings";
    try {
      const result = await driver.run(request);
      expect(result, JSON.stringify(result)).toMatchObject({ state: "exited", exitCode: 0 });
      expect(result.stdout).toContain("TOKEN=[REDACTED]");
      expect(result.stdout).toContain("Proxy-Authorization: [REDACTED]");
      expect(result.stdout).not.toContain("sensitive-split-secret");
      expect(result.stdout).not.toMatch(/PIPIUI_|NODE_OPTIONS|NODE_CHANNEL_FD|host-env-must-not-leak/);
      expect(result.stdout).toContain("ELECTRON_RUN_AS_NODE=1");
      expect(result.stdout).not.toMatch(/(?:http|socks5):\/\/[^\s]*:[a-f0-9]{32,}@/);
      request.command.executable = "i=0; while [ $i -lt 400 ]; do printf x; i=$((i+1)); done; exit 7";
      request.maxOutputBytes = 64;
      const bounded = await driver.run(request);
      expect(bounded).toMatchObject({ state: "exited", exitCode: 7, stdoutBytes: 400, stdoutTruncated: true });
      expect(Buffer.byteLength(bounded.stdout)).toBe(64);
    } finally {
      delete process.env.PIPIUI_SANDBOX_TEST_SECRET;
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
    }
  });

  it("fails closed for unsupported platforms and recursive supervisors", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    const request = await fixture();
    try {
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      expect(await driver.probe()).toMatchObject({ available: false, platform: "win32" });
      expect(await driver.run(request)).toMatchObject({ state: "sandbox-unavailable", sandbox: { applied: false } });
      Object.defineProperty(process, "platform", platform);
      process.env.PIPIUI_EXPERIMENT_SANDBOX_SUPERVISOR = "1";
      expect(await driver.run(await fixture())).toMatchObject({ state: "sandbox-unavailable", sandbox: { applied: false } });
    } finally { Object.defineProperty(process, "platform", platform); delete process.env.PIPIUI_EXPERIMENT_SANDBOX_SUPERVISOR; }
  });

  it("resolves from an independently copied runtime mirror and fails closed when its dependency is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipiui-lab-mirror-")); roots.push(root);
    const source = resolve(import.meta.dirname, "../../../resources/runtime/extensions/experiment-lab");
    const mirror = join(root, "installed");
    await cp(source, mirror, { recursive: true });
    const { createSandboxDriver: installedDriver } = await import(pathToFileURL(join(mirror, "agent/dist/sandbox-driver.js")).href);
    expect(await installedDriver().probe()).toMatchObject({ available: true });
    const result = await installedDriver().run(await fixture());
    expect(result, JSON.stringify(result)).toMatchObject({ state: "exited", exitCode: 0, stdout: "ok" });
    await rm(join(mirror, "vendor/sandbox-runtime/node_modules"), { recursive: true, force: true });
    expect(await installedDriver().run(await fixture())).toMatchObject({ state: "sandbox-unavailable", sandbox: { applied: false } });
  });
});
