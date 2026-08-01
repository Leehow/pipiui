import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(
  repositoryRoot,
  "Sources/PipiUI/PiExt/subagent",
);
const piPackageRoot = join(
  homedir(),
  ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent",
);
const piNodeModules = join(piPackageRoot, "node_modules");

async function linkRuntimePackages(directory) {
  const scoped = join(directory, "node_modules/@earendil-works");
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(
      join(piNodeModules, "@earendil-works/pi-agent-core"),
      join(scoped, "pi-agent-core"),
      "dir",
    ),
    symlink(
      join(piNodeModules, "@earendil-works/pi-ai"),
      join(scoped, "pi-ai"),
      "dir",
    ),
    symlink(
      join(piNodeModules, "@earendil-works/pi-tui"),
      join(scoped, "pi-tui"),
      "dir",
    ),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

test("invalid single and parallel agentIds return structured errors without a makeDetails TDZ", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-subagent-tdz-"));
  try {
    await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
    await linkRuntimePackages(directory);
    const harness = join(directory, "harness.mts");
    await writeFile(
      harness,
      `import install from "./subagent/index.ts";

const tools = new Map();
install({
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  on() {},
});
const subagent = tools.get("subagent");
const options = [new AbortController().signal, undefined, { cwd: "/", hasUI: false }];
const single = await subagent.execute(
  "tdz-single",
  { agent: "general-purpose", task: "no-op", agentId: "Invalid ID" },
  ...options,
);
const parallel = await subagent.execute(
  "tdz-parallel",
  {
    tasks: [
      { agent: "general-purpose", task: "first" },
      { agent: "general-purpose", task: "second", agentId: "Invalid ID" },
    ],
  },
  ...options,
);
process.stdout.write(JSON.stringify({ single, parallel }));
`,
      "utf8",
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", harness],
      {
        cwd: directory,
        env: {
          ...process.env,
          PIPIUI_AGENT_DEPTH: "0",
          PIPIUI_AGENT_MAX_DEPTH: "2",
          PIPIUI_MAIN_CWD: "",
          PIPIUI_AGENTS_DIR: join(directory, "no-agents"),
          PIPIUI_BRIDGE_PORT: "",
          PIPIUI_SESSION_KEY: "",
        },
      },
    );
    const results = JSON.parse(stdout);

    for (const [mode, result] of Object.entries(results)) {
      assert.equal(result.isError, true, mode);
      assert.match(result.content[0]?.text ?? "", /^Invalid agentId "Invalid ID"/, mode);
      assert.deepEqual(result.details, {
        mode: mode === "single" ? "single" : "parallel",
        agentScope: "user",
        projectAgentsDir: null,
        results: [],
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
