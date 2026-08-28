import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_AGENT_AGING_CHECKPOINTS = "1,10,100,1000";

/** Parse the small public CLI surface without starting Vitest. */
export function parseAgentAgingArgs(argv) {
  let checkpoints;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--full") {
      checkpoints = DEFAULT_AGENT_AGING_CHECKPOINTS;
      continue;
    }
    if (arg === "--checkpoints" || arg === "--turns" || arg === "-c") {
      checkpoints = argv[++index];
      if (!checkpoints) throw new Error(`${arg} requires a comma-separated list`);
      continue;
    }
    if (arg.startsWith("--checkpoints=") || arg.startsWith("--turns=")) {
      checkpoints = arg.slice(arg.indexOf("=") + 1);
      if (!checkpoints) throw new Error(`${arg.slice(0, arg.indexOf("="))} requires a comma-separated list`);
      continue;
    }
    if (arg === "--help" || arg === "-h") return { checkpoints: DEFAULT_AGENT_AGING_CHECKPOINTS, help: true };
    throw new Error(`unknown Agent Aging option: ${arg}`);
  }
  return { checkpoints: checkpoints ?? DEFAULT_AGENT_AGING_CHECKPOINTS, help: false };
}

export function runAgentAging(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseAgentAgingArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (options.help) {
    console.log("Usage: npm run benchmark:agent-aging [-- --turns 1,10,100,1000|--full]");
    return 0;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const workspace = join(here, "..");
  const testFile = "packages/pi-backend/test/agent-aging.test.ts";
  const binName = process.platform === "win32" ? "vitest.cmd" : "vitest";
  const vitest = join(workspace, "node_modules", ".bin", binName);
  if (!existsSync(vitest)) {
    console.error(`vitest binary not found at ${vitest}; run the workspace setup first`);
    return 2;
  }

  const env = {
    ...process.env,
    AGENT_AGING_BENCHMARK: "1",
    AGENT_AGING_CHECKPOINTS: options.checkpoints,
  };
  const result = spawnSync(vitest, ["run", "--reporter", "verbose", "--config", "vitest.config.ts", testFile], {
    cwd: workspace,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    return 2;
  }
  return result.status ?? 1;
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint === fileURLToPath(import.meta.url)) process.exit(runAgentAging());
