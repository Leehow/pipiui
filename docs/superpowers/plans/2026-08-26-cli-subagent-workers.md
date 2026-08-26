# CLI Subagent Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主会话可以把本机 Cursor Agent CLI（`agent acp`）派成一等 Subagent：出现在 SubagentPanel，走现有 abort / 续跑 / PipiUI worktree，找不到 launcher 时响失败且绝不回退成 Pi worker。

**Architecture:** bundled runtime 只加 `WorkerLauncher` 注册表和 spawn 分叉；Cursor ACP 适配器、路径门、session 映射、`cursor` AGENT.md 放在扩展 `pipiui-cli-subagents`。面板协议不新增。Claude / Codex 只留同一 launcher 接口。

**Tech Stack:** TypeScript · Node `node:test`（`pi-ext/subagent/test`）· Vitest（扩展包）· 现有 `pipiuiReport` / `writeFindingsArtifact` · Cursor ACP JSON-RPC stdio。

**Spec:** [`docs/superpowers/specs/2026-08-26-cli-subagent-workers-design.md`](../specs/2026-08-26-cli-subagent-workers-design.md)

## Global Constraints

- 只 spawn 用户本机官方 `agent` / `cursor-agent`。禁止 spawn 裸 `cursor`。禁止把 Cursor 打进 App。
- `agentId` 必须通过现有 `validateAgentId`。Cursor `sessionId` 只写 `{project}/.pi/agent/cli-subagents/<agentId>.json`，永不进入 `agentId`。
- 工作区必须是 PipiUI `.pi/worktrees` + `pipiui/<agentId>`。禁止传 Cursor `--worktree` 或 `--print`。
- `runtime === "external-cli"` 且 launcher 未注册：`end/failed`，子进程 argv 不得包含 `pi --mode json`。
- 仅主会话可派 `cursor`。不要改 `general-purpose` 的委派白名单。
- 不打真实 Cursor API。ACP 用 fixture 子进程。
- 不改 `SubagentPanel.tsx`。不申请 L2。不在 App 里做登录。
- npm 调用必须带 `--maxsockets 3`。
- 未要求打包前，只跑 Electron workspace / `node --test`。不要创建 `build/PipiUI Electron.app`。
- 每个任务结束提交一次（实现者执行时）。本计划落盘本身不提交，除非用户要求。

---

## File map

| File | Role |
|---|---|
| `Electron/resources/runtime/pi-ext/subagent/agents.ts` | `runtime` / `cli` 进入 `AgentConfig` |
| `Electron/resources/runtime/pi-ext/subagent/external-cli/launcher.ts` | 注册表 + `resolveWorkerBackend` |
| `Electron/resources/runtime/pi-ext/subagent/external-cli/prompt.ts` | 无人值守 prompt 拼装 |
| `Electron/resources/runtime/pi-ext/subagent/external-cli/dispatch.ts` | 等 launcher.done、写 findings、映到现有 result |
| `Electron/resources/runtime/pi-ext/subagent/index.ts` | start 报告之后、`getPiInvocation` 之前分叉 |
| `Electron/packages/pipiui-cli-subagents/**` | 扩展：ACP 适配器、路径门、session 映射、AGENT.md |
| `Electron/resources/runtime/extensions/pipiui-cli-subagents/**` | sync-bundled 产物，禁止手改 |
| `Electron/apps/electron/package.json` | extraResources 增加该扩展 |
| `Electron/package.json` | workspace `build` 加上该包 |

## Shared interfaces

```ts
// Electron/resources/runtime/pi-ext/subagent/external-cli/launcher.ts

export const EXTERNAL_LAUNCHER_REGISTRY_SYMBOL = Symbol.for("pipiui.externalWorkerLaunchers");

export type WorkerLauncherId = "cursor" | "claude" | "codex";
export type AgentRuntimeKind = "pi" | "external-cli";

export type AgentBridgeEventPayloadV1 = Record<string, unknown> & {
  kind: string;
  agentId: string;
  runId: string;
};

export interface ExternalWorkerStart {
  agentId: string;
  runId: string;
  worktreePath: string;
  prompt: string;
  resumeSessionId?: string;
  binaryPath?: string;
  report: (event: AgentBridgeEventPayloadV1) => void;
  signal: AbortSignal;
}

export interface ExternalWorkerResult {
  stopReason: "end_turn" | "cancelled" | "error";
  exitCode: number;
  finalText: string;
  errorMessage?: string;
  sessionId?: string;
}

export interface ExternalWorkerHandle {
  abort(): Promise<void>;
  done: Promise<ExternalWorkerResult>;
}

export interface WorkerLauncher {
  id: WorkerLauncherId;
  start(ctx: ExternalWorkerStart): Promise<ExternalWorkerHandle>;
}

export type WorkerBackend =
  | { kind: "pi" }
  | { kind: "external"; launcher: WorkerLauncher }
  | { kind: "missing-launcher"; cli: string; error: string };

export function registerExternalWorkerLauncher(launcher: WorkerLauncher): void;
export function getExternalWorkerLauncher(id: string): WorkerLauncher | undefined;
export function clearExternalWorkerLaunchersForTest(): void;
export function resolveWorkerBackend(agent: {
  runtime?: AgentRuntimeKind;
  cli?: WorkerLauncherId;
}): WorkerBackend;
```

实现细化（相对 spec §5.1）：`ExternalWorkerHandle` 增加 `done`。适配器只 `report` `log` / `log_delta` / `update`，**不**发 `kind: "end"`。`index.ts` 在 closeout 之后发 `end`，与 Pi 路径一致。

`MISSING_LAUNCHER_ERROR` 固定前缀：`external-cli launcher is not registered:`。

---

### Task 1: AGENT.md `runtime` / `cli` 解析

**Files:**
- Modify: `Electron/resources/runtime/pi-ext/subagent/agents.ts`
- Test: `Electron/resources/runtime/pi-ext/subagent/test/runtime-cli-fields.test.ts`

**Interfaces:**
- Consumes: 现有 `validateAgentDefinition`
- Produces: `AgentConfig.runtime: AgentRuntimeKind`（缺省 `"pi"`）、可选 `AgentConfig.cli?: WorkerLauncherId`

- [ ] **Step 1: Write the failing test**

创建 `Electron/resources/runtime/pi-ext/subagent/test/runtime-cli-fields.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateAgentDefinition } from "../agents.ts";

function parse(name: string, frontmatter: string) {
	return validateAgentDefinition({
		filePath: `/tmp/${name}/AGENT.md`,
		content: `---\n${frontmatter}\n---\nYou are ${name}.\n`,
		source: "project",
		origin: "project",
		format: "package",
		directoryName: name,
	});
}

const BASE = [
	"schema: 1",
	"name: cursor-probe",
	"description: probe",
	"mode: worker",
	"capabilities:",
	"  filesystem: workspace-write",
	"  shell: true",
	"  web: true",
	"  mcp: false",
	"  desktop: none",
	"  delegation: false",
	"worktree: isolated",
	"deliverable: implementation",
].join("\n");

test("omitted runtime defaults to pi", () => {
	const result = parse("cursor-probe", BASE);
	assert.equal(result.diagnostics.some((d) => d.severity === "error"), false, JSON.stringify(result.diagnostics));
	assert.equal(result.agent?.runtime, "pi");
	assert.equal(result.agent?.cli, undefined);
});

test("runtime external-cli requires a known cli", () => {
	const result = parse("cursor-probe", `${BASE}\nruntime: external-cli\ncli: cursor\n`);
	assert.equal(result.agent?.runtime, "external-cli");
	assert.equal(result.agent?.cli, "cursor");
});

test("unknown runtime is rejected", () => {
	const result = parse("cursor-probe", `${BASE}\nruntime: banana\n`);
	assert.ok(result.diagnostics.some((d) => d.code === "invalid-runtime"));
	assert.equal(result.agent, undefined);
});

test("external-cli without cli is rejected", () => {
	const result = parse("cursor-probe", `${BASE}\nruntime: external-cli\n`);
	assert.ok(result.diagnostics.some((d) => d.code === "missing-field"));
	assert.equal(result.agent, undefined);
});

test("unknown cli slug is rejected", () => {
	const result = parse("cursor-probe", `${BASE}\nruntime: external-cli\ncli: windsurf\n`);
	assert.ok(result.diagnostics.some((d) => d.code === "invalid-cli"));
	assert.equal(result.agent, undefined);
});

test("cli on a pi runtime is rejected", () => {
	const result = parse("cursor-probe", `${BASE}\nruntime: pi\ncli: cursor\n`);
	assert.ok(result.diagnostics.some((d) => d.code === "conflicting-field"));
	assert.equal(result.agent, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test Electron/resources/runtime/pi-ext/subagent/test/runtime-cli-fields.test.ts
```

Expected: FAIL（`runtime` 不是合法 frontmatter，或 `agent.runtime` 为 undefined）。

- [ ] **Step 3: Write minimal implementation**

在 `agents.ts`：

1. `STANDARD_FIELDS` 加上 `"runtime"`、`"cli"`。
2. `AgentConfig` 增加：

```ts
runtime: "pi" | "external-cli";
cli?: "cursor" | "claude" | "codex";
```

3. 在 `parseAgentFile` 里、`hasErrors` 返回之前解析：

```ts
const ALLOWED_CLI = new Set(["cursor", "claude", "codex"]);

function parseRuntimeAndCli(
	frontmatter: Record<string, unknown>,
	filePath: string,
	diagnostics: AgentDiagnostic[],
): { runtime: "pi" | "external-cli"; cli?: "cursor" | "claude" | "codex" } {
	const rawRuntime = frontmatter.runtime;
	if (rawRuntime === undefined || rawRuntime === null) {
		if (hasOwn(frontmatter, "cli")) {
			diagnostic(diagnostics, "error", "conflicting-field", "`cli` requires `runtime: external-cli`.", filePath);
		}
		return { runtime: "pi" };
	}
	if (typeof rawRuntime !== "string" || (rawRuntime !== "pi" && rawRuntime !== "external-cli")) {
		diagnostic(diagnostics, "error", "invalid-runtime", "`runtime` must be `pi` or `external-cli`.", filePath);
		return { runtime: "pi" };
	}
	if (rawRuntime === "pi") {
		if (hasOwn(frontmatter, "cli")) {
			diagnostic(diagnostics, "error", "conflicting-field", "`cli` is only valid with `runtime: external-cli`.", filePath);
		}
		return { runtime: "pi" };
	}
	const rawCli = frontmatter.cli;
	if (typeof rawCli !== "string" || !rawCli.trim()) {
		diagnostic(diagnostics, "error", "missing-field", "`runtime: external-cli` requires `cli`.", filePath);
		return { runtime: "external-cli" };
	}
	const cli = rawCli.trim();
	if (!ALLOWED_CLI.has(cli)) {
		diagnostic(diagnostics, "error", "invalid-cli", `Unknown cli \`${cli}\`.`, filePath);
		return { runtime: "external-cli" };
	}
	return { runtime: "external-cli", cli: cli as "cursor" | "claude" | "codex" };
}
```

把结果写进返回的 `config`。现有 bundled AGENT.md 都不写这两字段，缺省 `pi`。

- [ ] **Step 4: Run tests**

```bash
node --experimental-strip-types --test Electron/resources/runtime/pi-ext/subagent/test/runtime-cli-fields.test.ts Electron/resources/runtime/pi-ext/subagent/test/retrieval-capability.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add Electron/resources/runtime/pi-ext/subagent/agents.ts Electron/resources/runtime/pi-ext/subagent/test/runtime-cli-fields.test.ts
git commit -m "$(cat <<'EOF'
feat(subagent): parse AGENT.md runtime and cli fields

External CLI workers need a declared runtime so dispatch can refuse unknown
launchers instead of silently spawning another pi process.
EOF
)"
```

---

### Task 2: WorkerLauncher 注册表与禁止回退

**Files:**
- Create: `Electron/resources/runtime/pi-ext/subagent/external-cli/launcher.ts`
- Test: `Electron/resources/runtime/pi-ext/subagent/test/external-cli-launcher.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `runtime` / `cli`
- Produces: Shared interfaces 里的全部 launcher 函数；`MISSING_LAUNCHER_ERROR`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
	MISSING_LAUNCHER_ERROR,
	clearExternalWorkerLaunchersForTest,
	getExternalWorkerLauncher,
	registerExternalWorkerLauncher,
	resolveWorkerBackend,
	type WorkerLauncher,
} from "../external-cli/launcher.ts";

function fakeLauncher(id: "cursor"): WorkerLauncher {
	return {
		id,
		async start() {
			return {
				async abort() {},
				done: Promise.resolve({ stopReason: "end_turn", exitCode: 0, finalText: "ok" }),
			};
		},
	};
}

test("pi runtime never looks up a launcher", () => {
	clearExternalWorkerLaunchersForTest();
	registerExternalWorkerLauncher(fakeLauncher("cursor"));
	assert.deepEqual(resolveWorkerBackend({ runtime: "pi" }), { kind: "pi" });
});

test("external-cli with a registered launcher resolves it", () => {
	clearExternalWorkerLaunchersForTest();
	const launcher = fakeLauncher("cursor");
	registerExternalWorkerLauncher(launcher);
	const backend = resolveWorkerBackend({ runtime: "external-cli", cli: "cursor" });
	assert.equal(backend.kind, "external");
	if (backend.kind === "external") assert.equal(backend.launcher, launcher);
});

test("external-cli without a launcher is a loud miss, not pi", () => {
	clearExternalWorkerLaunchersForTest();
	const backend = resolveWorkerBackend({ runtime: "external-cli", cli: "cursor" });
	assert.equal(backend.kind, "missing-launcher");
	if (backend.kind === "missing-launcher") {
		assert.equal(backend.cli, "cursor");
		assert.match(backend.error, new RegExp(MISSING_LAUNCHER_ERROR));
		assert.match(backend.error, /cursor/);
	}
	assert.equal(getExternalWorkerLauncher("cursor"), undefined);
});

test("duplicate module copies share the registry via Symbol.for", () => {
	clearExternalWorkerLaunchersForTest();
	const key = Symbol.for("pipiui.externalWorkerLaunchers");
	const map = (globalThis as Record<PropertyKey, unknown>)[key] as Map<string, WorkerLauncher>;
	assert.ok(map instanceof Map);
	registerExternalWorkerLauncher(fakeLauncher("cursor"));
	assert.equal(map.get("cursor")?.id, "cursor");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test Electron/resources/runtime/pi-ext/subagent/test/external-cli-launcher.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: Write minimal implementation**

`launcher.ts` 用 `Symbol.for("pipiui.externalWorkerLaunchers")` 取 `Map`，这样扩展包编译出的副本和 runtime 副本共享同一张表。

```ts
export const MISSING_LAUNCHER_ERROR = "external-cli launcher is not registered:";

function registry(): Map<string, WorkerLauncher> {
	const key = EXTERNAL_LAUNCHER_REGISTRY_SYMBOL;
	const bag = globalThis as Record<PropertyKey, unknown>;
	if (!(bag[key] instanceof Map)) bag[key] = new Map<string, WorkerLauncher>();
	return bag[key] as Map<string, WorkerLauncher>;
}

export function registerExternalWorkerLauncher(launcher: WorkerLauncher): void {
	registry().set(launcher.id, launcher);
}

export function getExternalWorkerLauncher(id: string): WorkerLauncher | undefined {
	return registry().get(id);
}

export function clearExternalWorkerLaunchersForTest(): void {
	registry().clear();
}

export function resolveWorkerBackend(agent: {
	runtime?: AgentRuntimeKind;
	cli?: WorkerLauncherId;
}): WorkerBackend {
	if (agent.runtime !== "external-cli") return { kind: "pi" };
	const cli = agent.cli ?? "";
	const launcher = cli ? getExternalWorkerLauncher(cli) : undefined;
	if (!launcher) {
		return {
			kind: "missing-launcher",
			cli: cli || "unknown",
			error: `${MISSING_LAUNCHER_ERROR} ${cli || "unknown"}`,
		};
	}
	return { kind: "external", launcher };
}
```

补齐 Shared interfaces 的 type export。

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-strip-types --test Electron/resources/runtime/pi-ext/subagent/test/external-cli-launcher.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add Electron/resources/runtime/pi-ext/subagent/external-cli/launcher.ts Electron/resources/runtime/pi-ext/subagent/test/external-cli-launcher.test.ts
git commit -m "$(cat <<'EOF'
feat(subagent): add external WorkerLauncher registry

Dispatch can now resolve a registered CLI backend or fail closed
without falling back to another pi worker.
EOF
)"
```

---

### Task 3: 路径门

**Files:**
- Create: `Electron/packages/pipiui-cli-subagents/agent/path-gate.ts`
- Test: `Electron/packages/pipiui-cli-subagents/test/path-gate.test.ts`

**Interfaces:**
- Consumes: worktree 绝对路径
- Produces: `decidePermission(input: PermissionGateInput): "allow-once" | "reject-once"`

先建扩展包的最小 `package.json` / `vitest.config.ts` / `tsconfig`，只为跑这个纯函数测试。完整 manifest 在 Task 7。

- [ ] **Step 1: Write the failing test**

`Electron/packages/pipiui-cli-subagents/test/path-gate.test.ts`：

```ts
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decidePermission } from "../agent/path-gate.js";

describe("decidePermission", () => {
  it("allows a path inside the worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "gate-in-"));
    const file = join(root, "src", "a.ts");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(file, "x");
    expect(decidePermission({ worktreePath: root, path: file })).toBe("allow-once");
    expect(decidePermission({ worktreePath: root, path: "src/a.ts" })).toBe("allow-once");
  });

  it("rejects an absolute path outside the worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "gate-out-"));
    expect(decidePermission({ worktreePath: root, path: "/etc/passwd" })).toBe("reject-once");
  });

  it("rejects a symlink that escapes the worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "gate-link-"));
    const outside = mkdtempSync(join(tmpdir(), "gate-escape-"));
    writeFileSync(join(outside, "secret"), "no");
    symlinkSync(join(outside, "secret"), join(root, "leak"));
    expect(decidePermission({ worktreePath: root, path: join(root, "leak") })).toBe("reject-once");
  });

  it("rejects a request with no path", () => {
    const root = mkdtempSync(join(tmpdir(), "gate-none-"));
    expect(decidePermission({ worktreePath: root })).toBe("reject-once");
    expect(decidePermission({ worktreePath: root, path: "   " })).toBe("reject-once");
  });
});
```

`package.json`（最小）：

```json
{
  "name": "@pipiui/pipiui-cli-subagents",
  "version": "0.1.0",
  "private": true,
  "license": "Apache-2.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p agent/tsconfig.json",
    "postbuild": "node ../../scripts/sync-bundled-extension.mjs pipiui-cli-subagents",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "typescript": "^5.6.3",
    "vitest": "^4.1.10"
  }
}
```

`vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

`agent/tsconfig.json` 抄 `pipiui-headroom-extension/agent/tsconfig.json`。

- [ ] **Step 2: Run test to verify it fails**

```bash
cd Electron && npx --maxsockets 3 --no-install vitest run packages/pipiui-cli-subagents/test/path-gate.test.ts
```

Expected: FAIL（`path-gate` 不存在）。若 workspace 还没认这个包，先 `npm install --maxsockets 3 -w @pipiui/pipiui-cli-subagents --offline` 失败时用 `npx vitest` 从 `packages/pipiui-cli-subagents` 目录跑。

- [ ] **Step 3: Write minimal implementation**

```ts
import { realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

export type PermissionDecision = "allow-once" | "reject-once";

export interface PermissionGateInput {
  worktreePath: string;
  path?: string;
  extraRoots?: string[];
}

function resolveExisting(pathValue: string): string {
  try {
    return realpathSync(pathValue);
  } catch {
    return resolve(pathValue);
  }
}

function isInside(root: string, candidate: string): boolean {
  const a = resolveExisting(root);
  const b = resolveExisting(candidate);
  return b === a || b.startsWith(a.endsWith(sep) ? a : a + sep);
}

export function decidePermission(input: PermissionGateInput): PermissionDecision {
  const raw = input.path?.trim();
  if (!raw) return "reject-once";
  const candidate = isAbsolute(raw) ? raw : join(input.worktreePath, raw);
  const roots = [input.worktreePath, ...(input.extraRoots ?? [])];
  return roots.some((root) => isInside(root, candidate)) ? "allow-once" : "reject-once";
}
```

v1 `extraRoots` 默认空；主 checkout 不自动加入。

- [ ] **Step 4: Run test to verify it passes**

```bash
cd Electron/packages/pipiui-cli-subagents && npx --maxsockets 3 --no-install vitest run test/path-gate.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add Electron/packages/pipiui-cli-subagents
git commit -m "$(cat <<'EOF'
feat(cli-subagents): add worktree path gate

Auto-allow only resolves inside the PipiUI worktree so unattended ACP
permission callbacks cannot write the main checkout.
EOF
)"
```

---

### Task 4: Session 映射（slug ↔ Cursor session id）

**Files:**
- Create: `Electron/packages/pipiui-cli-subagents/agent/session-map.ts`
- Test: `Electron/packages/pipiui-cli-subagents/test/session-map.test.ts`

**Interfaces:**
- Consumes: `projectAgentHome`（`{project}/.pi/agent`）、`agentId`
- Produces: `readCursorSessionMap` / `writeCursorSessionMap`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCursorSessionMap, writeCursorSessionMap } from "../agent/session-map.js";

describe("cursor session map", () => {
  it("writes under the project agent home and never uses the slug as sessionId", () => {
    const home = mkdtempSync(join(tmpdir(), "cli-map-"));
    writeCursorSessionMap({
      projectAgentHome: home,
      agentId: "fix-login",
      cursorSessionId: "sess_abc-uuid",
      worktreePath: "/tmp/wt/fix-login",
      updatedAt: 1770000000000,
    });
    const raw = JSON.parse(readFileSync(join(home, "cli-subagents", "fix-login.json"), "utf8"));
    expect(raw.agentId).toBe("fix-login");
    expect(raw.cursorSessionId).toBe("sess_abc-uuid");
    expect(raw.cli).toBe("cursor");
    expect(readCursorSessionMap(home, "fix-login")?.cursorSessionId).toBe("sess_abc-uuid");
  });

  it("rejects an agentId that is not a semantic slug", () => {
    const home = mkdtempSync(join(tmpdir(), "cli-map-bad-"));
    expect(() => writeCursorSessionMap({
      projectAgentHome: home,
      agentId: "sess_abc-uuid",
      cursorSessionId: "sess_abc-uuid",
      worktreePath: "/tmp/wt",
      updatedAt: 1,
    })).toThrow(/agentId/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd Electron/packages/pipiui-cli-subagents && npx --maxsockets 3 --no-install vitest run test/session-map.test.ts
```

Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

`session-map.ts`：

- 路径：`join(projectAgentHome, "cli-subagents", `${agentId}.json`)`
- `agentId` 必须匹配 `^[a-z0-9][a-z0-9_-]{1,23}$`，且不含 `..`
- 禁止 `projectAgentHome` 解析后落到 `/.pi` 以外的「用户全局家」检查不必做（调用方传入的已是项目家）；但路径必须 `resolve` 后仍以 `projectAgentHome` 为前缀
- `read` 缺文件返回 `undefined`；JSON 坏了返回 `undefined`

- [ ] **Step 4: Run test to verify it passes**

同上命令，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add Electron/packages/pipiui-cli-subagents/agent/session-map.ts Electron/packages/pipiui-cli-subagents/test/session-map.test.ts
git commit -m "$(cat <<'EOF'
feat(cli-subagents): persist cursor session ids under the project agent home

Resume stays keyed by the caller-chosen slug; the UUID never becomes agentId.
EOF
)"
```

---

### Task 5: ACP 事件与阻塞 RPC 纯映射

**Files:**
- Create: `Electron/packages/pipiui-cli-subagents/agent/acp-map.ts`
- Test: `Electron/packages/pipiui-cli-subagents/test/acp-map.test.ts`

**Interfaces:**
- Consumes: Task 3 `decidePermission`
- Produces:
  - `mapSessionUpdate(update, ids) => AgentBridgeEventPayloadV1 | undefined`
  - `decideAcpPermission(req, worktreePath) => { outcome: { outcome: "selected"; optionId: "allow-once" | "reject-once" } }`
  - `askQuestionResponse() => { outcome: { outcome: "skipped"; reason: "unattended-subagent" } }`
  - `createPlanResponse() => { outcome: { outcome: "accepted" } }`（若 Cursor 实际字段不同，以官方 ACP 页为准，但测试钉住本函数返回值）
  - `mapStopReason(reason: string): ExternalWorkerResult["stopReason"]`

适配器 **不**把 `session/load` 回放转成 report：`mapSessionUpdate` 接受 `{ replay: boolean }`，`replay: true` 时返回 `undefined`。

- [ ] **Step 1: Write the failing test**

覆盖至少：

- `agent_message_chunk` → `{ kind: "log_delta", itemType: "text", agentId, runId, text }`
- `agent_thought_chunk` 或 `sessionUpdate` 含 `thought` → `{ kind: "log_delta", itemType: "thinking" }`
- 未知 update → `undefined`（不编造 thinking）
- `tool_call` + status `completed` → `{ kind: "log", itemType: "toolResult", toolCallId }`
- `replay: true` → `undefined`
- `cursor/task` → `{ kind: "log", itemType: "text" }`，文案含 task 摘要
- `mapStopReason("end_turn") === "end_turn"`
- `mapStopReason("cancelled") === "cancelled"`
- `mapStopReason("max_tokens") === "error"`
- 入界路径 → `allow-once`；无路径 → `reject-once`
- `askQuestionResponse().outcome.reason === "unattended-subagent"`

从 `session/request_permission` 抽路径：优先 `params.options` 里的 file path，其次任意字符串字段名匹配 `/path$/i`。测两个夹具对象即可，不必穷尽 Cursor schema。

- [ ] **Step 2: Run test to verify it fails**

```bash
cd Electron/packages/pipiui-cli-subagents && npx --maxsockets 3 --no-install vitest run test/acp-map.test.ts
```

- [ ] **Step 3: Write minimal implementation**

按测试钉死的对象形状实现。`mapStopReason`：

```ts
export function mapStopReason(reason: string): "end_turn" | "cancelled" | "error" {
  if (reason === "end_turn") return "end_turn";
  if (reason === "cancelled" || reason === "canceled") return "cancelled";
  return "error";
}
```

thinking：仅当 `sessionUpdate` 为 `agent_thought_chunk`，或 `content.type === "thought"`。没有这些键就不当 thinking。

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add Electron/packages/pipiui-cli-subagents/agent/acp-map.ts Electron/packages/pipiui-cli-subagents/test/acp-map.test.ts
git commit -m "$(cat <<'EOF'
feat(cli-subagents): map ACP updates onto pipiuiReport events

Keep the SubagentPanel protocol unchanged and drop session-load replay
so a resume does not rewrite the current run.
EOF
)"
```

---

### Task 6: Cursor ACP 客户端 + fixture

**Files:**
- Create: `Electron/packages/pipiui-cli-subagents/agent/cursor-acp.ts`
- Create: `Electron/packages/pipiui-cli-subagents/agent/binary.ts`
- Create: `Electron/packages/pipiui-cli-subagents/test/fake-acp-server.mjs`
- Test: `Electron/packages/pipiui-cli-subagents/test/cursor-acp.test.ts`
- Test: `Electron/packages/pipiui-cli-subagents/test/binary.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5、`ExternalWorkerStart`
- Produces: `createCursorWorkerLauncher(): WorkerLauncher`（`id: "cursor"`）、`resolveCursorAgentBinary`

- [ ] **Step 1: Write failing tests**

`binary.test.ts`：

- override 指向存在的文件 → 用 override
- override 指向不存在 → error 含「设置里填」
- PATH 上有 `agent` → 用它
- PATH 只有 `cursor` 没有 `agent`/`cursor-agent` → error（禁止 IDE 启动器）
- 都没有 → error 含「安装 Cursor Agent CLI」

`cursor-acp.test.ts`（spawn fixture）：

`fake-acp-server.mjs` 读 stdin JSON-RPC 行，按 method 回答：

1. `initialize` → `{ protocolVersion: 1, agentCapabilities: { loadSession: true } }`
2. `authenticate` → `{}`
3. `session/new` → `{ sessionId: "sess_new_1" }`
4. `session/load` → 先发一条 `session/update`（旧消息），再 `{ }`
5. `session/prompt` → 发 `agent_message_chunk`「hello」、`tool_call` started/completed，然后 result `{ stopReason: "end_turn" }`
6. `session/request_permission` 由客户端先回；fixture 可在 prompt 期间发一个 worktree 内路径和一个无路径请求
7. `session/cancel` → 随后 prompt result `{ stopReason: "cancelled" }`
8. `cursor/ask_question` / `cursor/create_plan`：记录客户端的 response，不挂起超过 1s

测试：

1. `start` 后 `done` 为 `end_turn`，`report` 收到 text delta，**没有** `kind: "end"`。
2. `resumeSessionId` 触发 `session/load`；回放那条 update **没有**进入 `report`。
3. `abort()` → `done.stopReason === "cancelled"`。
4. 无路径 permission → report 里有一条 tool 错误；客户端回 `reject-once`。
5. spawn 参数：`[binary, "--trust", "acp"]`，`cwd === worktreePath`，argv 不含 `--print`、`--worktree`。

fixture 用 `process.argv[1]` 自己当 binary。`createCursorWorkerLauncher` 的 `start` 必须用 `ctx.binaryPath`。

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Electron/packages/pipiui-cli-subagents && npx --maxsockets 3 --no-install vitest run test/binary.test.ts test/cursor-acp.test.ts
```

- [ ] **Step 3: Write minimal implementation**

`binary.ts`：按顺序 `override` → `PATH/agent` → `PATH/cursor-agent`。用传入的 `exists` / `pathEnv` 以便测。永不返回名为 `cursor` 且不是 `cursor-agent` 的路径。

`cursor-acp.ts`：

- `spawn(binaryPath, ["--trust", "acp"], { cwd: worktreePath, stdio: ["pipe","pipe","pipe"] })`
- NDJSON JSON-RPC；`stderr` 累积，handshake 失败时放进 `errorMessage`
- 顺序：`initialize` → `authenticate({ methodId: "cursor_login" })` → `session/load` 或 `session/new({ cwd: worktreePath, mcpServers: [] })` → `session/prompt`
- `session/load` 期间设 `replaying = true`，直到 load 的 response 回来
- 阻塞 method 立刻按 Task 5 回答
- `abort`：写 `session/cancel`，2000ms 后 `SIGTERM`，再 2000ms `SIGKILL`（对 `proc.pid`，`detached: false`）
- `done` 在 prompt 返回或进程退出时 settle，只 settle 一次
- `sessionId` 从 new/load 结果取出，不写入映射（映射在 Task 7 的 index 里，或在 launcher.start 成功后由调用方写——**本任务 start 返回 `result.sessionId`，调用方写盘**）

未登录：`authenticate` 抛错 / 非 0 退出 → `done` `{ stopReason: "error", errorMessage: "终端运行 agent login" }`。

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add Electron/packages/pipiui-cli-subagents/agent/binary.ts Electron/packages/pipiui-cli-subagents/agent/cursor-acp.ts Electron/packages/pipiui-cli-subagents/test
git commit -m "$(cat <<'EOF'
feat(cli-subagents): speak Cursor ACP over a fixture child

The adapter streams panel events and answers blocking RPCs so an
unattended worker cannot hang on permissions or questions.
EOF
)"
```

---

### Task 7: 扩展包、AGENT.md、注册 launcher

**Files:**
- Create: `Electron/packages/pipiui-cli-subagents/pipiui-extension.json`
- Create: `Electron/packages/pipiui-cli-subagents/agents/cursor/AGENT.md`
- Create: `Electron/packages/pipiui-cli-subagents/agent/index.ts`
- Create: `Electron/packages/pipiui-cli-subagents/LICENSE`（Apache-2.0，抄 headroom 的 LICENSE 文本）
- Create: `Electron/packages/pipiui-cli-subagents/NOTICE`（`PipiUI CLI Subagents` + 一句：不包含 Cursor 二进制）
- Create: `Electron/packages/pipiui-cli-subagents/README.md`（只 spawn 本机 `agent`；先 `agent login`）
- Test: `Electron/packages/pipiui-cli-subagents/test/manifest.test.ts`
- Test: `Electron/resources/runtime/pi-ext/subagent/test/cursor-agent-contribution.test.ts`

**Interfaces:**
- Consumes: `createCursorWorkerLauncher`、`registerExternalWorkerLauncher`
- Produces: 目录角色 `cursor`；Boss 会话加载时注册 `id: "cursor"`

- [ ] **Step 1: Write failing tests**

`manifest.test.ts`：`validateExtensionManifest` 通过；`id === "pipiui-cli-subagents"`；`capabilities` 为 `["settings.read","settings.write"]`；`agent.agents === ["agents/cursor/AGENT.md"]`；`settings.scope === "app"`；有键 `ext.pipiui-cli-subagents.cursor.binary`；`ui.panels` 为空。

`cursor-agent-contribution.test.ts`：用 `validateAgentDefinition` 读扩展里的 `agents/cursor/AGENT.md`，断言 `runtime === "external-cli"`、`cli === "cursor"`、`traits.delegates === false`、`worktree === "isolated"`、`capabilities.delegation === false`、正文匹配 `/unattended|无人值守/` 与 `/do not spawn|不要再派/`。

再测 `agent/index.ts` 的可注入注册：

```ts
export function registerPipiuiCliSubagents(
  pi: { on: Function },
  hooks?: { registerLauncher?: typeof registerExternalWorkerLauncher; launcher?: WorkerLauncher },
): void
```

`session_start` 时调用 `hooks.registerLauncher(hooks.launcher ?? createCursorWorkerLauncher())`。测试传入 fake register，断言被叫到一次且 `id === "cursor"`。

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Write files**

`pipiui-extension.json`：

```json
{
  "id": "pipiui-cli-subagents",
  "name": "CLI Subagents",
  "version": "0.1.0",
  "description": "Run the local Cursor Agent CLI as a PipiUI subagent via ACP.",
  "capabilities": ["settings.read", "settings.write"],
  "agent": {
    "extension": "agent/dist/index.js",
    "agents": ["agents/cursor/AGENT.md"]
  },
  "app": {
    "settings": {
      "scope": "app",
      "schema": {
        "type": "object",
        "properties": {
          "ext.pipiui-cli-subagents.cursor.binary": {
            "type": "string",
            "default": "",
            "title": "Cursor Agent 二进制（空则 PATH 上的 agent / cursor-agent）"
          }
        }
      }
    },
    "ui": {
      "panels": [],
      "settingsSections": [{ "id": "pipiui-cli-subagents", "title": "CLI Subagents" }],
      "slashCommands": [],
      "themes": [],
      "statusBar": []
    }
  },
  "settingsVersion": 1,
  "migrations": [],
  "lifecycle": { "onDisable": "dispose-app-immediate; unmount-agent-on-next-session" }
}
```

`AGENT.md` frontmatter 必须与 spec §5.3 逐字段一致。正文用英文（与其它 bundled AGENT.md 一致），写明 unattended、do not ask the user、do not spawn nested agents、edit only the current cwd。

`agent/index.ts`：`export default function (pi: ExtensionAPI) { registerPipiuiCliSubagents(pi); }`。从 `PIPIUI_EXT_SETTINGS_PIPIUI_CLI_SUBAGENTS` 读 binary 覆盖，传给 launcher 的闭包（`createCursorWorkerLauncher({ resolveBinary: () => resolveCursorAgentBinary({ override }) })`）。

注册必须经过 `registerExternalWorkerLauncher`（从 `../../../resources/runtime/pi-ext/subagent/external-cli/launcher.ts` 或 `Symbol.for` 那份模块 import）。相对路径从 `packages/pipiui-cli-subagents/agent/` 到 runtime 是 `../../../resources/runtime/pi-ext/subagent/external-cli/launcher.ts`。bundled 副本在 `resources/runtime/extensions/pipiui-cli-subagents/agent/dist/`，**不要**依赖编译后的相对 import 指回 pi-ext。因此 **只通过 `Symbol.for` 注册**：扩展里写一个 `registerViaSymbol(launcher)`，往 `Symbol.for("pipiui.externalWorkerLaunchers")` 的 Map `set`。不要 `import` runtime 源文件进扩展 dist。Task 2 的 Map 协议就是为这个。

- [ ] **Step 4: Run tests**

Expected: PASS。另跑：

```bash
node --experimental-strip-types --test Electron/resources/runtime/pi-ext/subagent/test/nested-delegation.test.ts
```

确认 general-purpose 仍只允许 explore / general-purpose。

- [ ] **Step 5: Commit**

```bash
git add Electron/packages/pipiui-cli-subagents Electron/resources/runtime/pi-ext/subagent/test/cursor-agent-contribution.test.ts
git commit -m "$(cat <<'EOF'
feat(cli-subagents): contribute the cursor AGENT.md and register its launcher

Disabling the extension drops the catalog role and the launcher on the
next session without touching the pi worker path.
EOF
)"
```

---

### Task 8: Prompt 拼装与 dispatch 分叉

**Files:**
- Create: `Electron/resources/runtime/pi-ext/subagent/external-cli/prompt.ts`
- Create: `Electron/resources/runtime/pi-ext/subagent/external-cli/dispatch.ts`
- Modify: `Electron/resources/runtime/pi-ext/subagent/index.ts`（仅分叉，不改 Pi spawn 语义）
- Test: `Electron/resources/runtime/pi-ext/subagent/test/external-cli-dispatch.test.ts`

**Interfaces:**
- Consumes: `resolveWorkerBackend`、`WorkerLauncher`、`writeFindingsArtifact`
- Produces: `composeExternalCliPrompt`、`runExternalCliDispatch`、`externalCliFallbackInvoked` 测试探针

- [ ] **Step 1: Write the failing test**

`external-cli-dispatch.test.ts`：

1. `composeExternalCliPrompt({ agentSystemPrompt: "You are cursor.", brief: "fix login" })` 含三部分，且含 `unattended`、`do not spawn`、`current cwd`。
2. `runExternalCliDispatch` 在 `missing-launcher` 时：
   - 返回 `{ ok: false, error }` 含 `MISSING_LAUNCHER_ERROR`
   - 回调 `spawnPi` **一次都不要被调用**（把 `spawnPi` 做成注入依赖，默认才是真 spawn；测试注入 `() => { throw new Error("pi fallback") }`）。
3. 注册 fake launcher：`start` 被叫到时 `ctx.worktreePath` / `ctx.prompt` / `ctx.agentId` 正确；`report` 只见 log；`done` 为 end_turn；`runExternalCliDispatch` 返回 `{ ok: true, finalText, sessionId }`。
4. `signal.abort()` → launcher.abort 被调用。
5. fake launcher 返回的 `sessionId` 不会被当成 `agentId` 写进 report 事件。

`index.ts` 的分叉用一个导出函数包一层，避免测整份 index：

```ts
export function shouldUsePiInvocation(backend: WorkerBackend): boolean {
  return backend.kind === "pi";
}
```

再加源码探针测试（与 `nested-delegation.test.ts` 读文件的风格相同）：

```ts
const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
test("external-cli missing launcher does not call getPiInvocation", () => {
  assert.match(source, /resolveWorkerBackend/);
  assert.match(source, /MISSING_LAUNCHER_ERROR|missing-launcher/);
  assert.match(source, /shouldUsePiInvocation|runtime === "external-cli"|kind === "pi"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test Electron/resources/runtime/pi-ext/subagent/test/external-cli-dispatch.test.ts
```

- [ ] **Step 3: Write implementation**

`prompt.ts`：

```ts
export const EXTERNAL_CLI_UNATTENDED = [
  "You are an unattended PipiUI subagent.",
  "Do not ask the user questions. Skip or auto-accept any human gate.",
  "Do not spawn nested agents or subagents.",
  "Edit only the current working directory (the PipiUI worktree).",
].join(" ");

export function composeExternalCliPrompt(input: { agentSystemPrompt: string; brief: string }): string {
  return [input.agentSystemPrompt.trim(), EXTERNAL_CLI_UNATTENDED, input.brief.trim()].filter(Boolean).join("\n\n");
}
```

`dispatch.ts`：`runExternalCliDispatch` 接收 `{ agent, agentId, runId, worktreePath, brief, report, signal, writeFindings, projectAgentHome, spawnPi }`。

- `resolveWorkerBackend(agent)`
- `kind === "pi"` → 调用 `spawnPi()` 并返回其结果（index 里 Pi 路径仍走原函数，这个分支给测试）
- `kind === "missing-launcher"` → **不**调用 `spawnPi`，返回失败
- `kind === "external"` → `composeExternalCliPrompt`，`launcher.start`，等 `Promise.race([handle.done, abort])`，`writeFindingsArtifact({ mainCwd: projectRoot, agentId, agentName: agent.name, text: finalText, task: brief, runId })`

`index.ts` 在 `jobUpsertRunning` / `runningAgents.set` 之后、`getPiInvocation` 之前：

```ts
const backend = resolveWorkerBackend(agent);
if (backend.kind === "missing-launcher") {
  currentResult.exitCode = 1;
  currentResult.stopReason = "error";
  currentResult.errorMessage = backend.error;
  // 跳到现有 closeout / pipiuiReport end，不要 spawn
} else if (backend.kind === "external") {
  const outcome = await runExternalCliDispatch({ ... });
  // 填 currentResult；dispatchAbort.abort 时 outcome.handle.abort()
  // 跳过 getPiInvocation / spawn(pi)
} else {
  // 现有 Pi 路径一字不改
}
```

`worktreePath` 必须存在；`runtime: external-cli` 且 placement 失败：沿用现有 isolation 失败路径（已在 spawn 前处理）。

从 settings / env 取 binary：`process.env.PIPIUI_EXT_SETTINGS_PIPIUI_CLI_SUBAGENTS` JSON 的 `ext.pipiui-cli-subagents.cursor.binary`。

- [ ] **Step 4: Run tests**

```bash
node --experimental-strip-types --test \
  Electron/resources/runtime/pi-ext/subagent/test/external-cli-dispatch.test.ts \
  Electron/resources/runtime/pi-ext/subagent/test/external-cli-launcher.test.ts \
  Electron/resources/runtime/pi-ext/subagent/test/dispatch-id-contract.test.ts \
  Electron/resources/runtime/pi-ext/subagent/test/nested-delegation.test.ts
```

Expected: PASS。Pi 身份与嵌套委派测试不得红。

- [ ] **Step 5: Commit**

```bash
git add Electron/resources/runtime/pi-ext/subagent/external-cli Electron/resources/runtime/pi-ext/subagent/index.ts Electron/resources/runtime/pi-ext/subagent/test/external-cli-dispatch.test.ts
git commit -m "$(cat <<'EOF'
feat(subagent): dispatch external-cli workers without a pi fallback

A missing Cursor launcher now fails the run in place and leaves the
existing pi invocation path untouched.
EOF
)"
```

---

### Task 9: Bundled 同步、workspace、打包清单

**Files:**
- Modify: `Electron/package.json`（`build` 脚本加上 `-w @pipiui/pipiui-cli-subagents`）
- Modify: `Electron/apps/electron/package.json`（`extraResources` 增加 `pipiui-cli-subagents`，filter 与 headroom 相同，**不要**加任何 agent 二进制）
- Modify: `Electron/apps/electron/packaging-contract.test.ts`（断言该 extraResources 条目存在，且 filter 不含 cursor/agent 二进制 from）
- Create: sync 产物（经脚本，不手改）
- Test: `Electron/packages/pipiui-cli-subagents/test/manifest.test.ts` 补「bundled 树与包 manifest 字节相等」（headroom 同款），在 build 之后才绿

**Interfaces:**
- Consumes: Task 7 包布局
- Produces: `resources/runtime/extensions/pipiui-cli-subagents/` + 打包拷贝

- [ ] **Step 1: Write the failing packaging assertion**

在 `packaging-contract.test.ts` 的 extraResources 列表测试末尾加：

```ts
expect(packageJSON.build.extraResources).toContainEqual(expect.objectContaining({
  from: '../../resources/runtime/extensions/pipiui-cli-subagents',
  to: 'pipiui-runtime/extensions/pipiui-cli-subagents',
  filter: ['**/*', '!**/node_modules/**', '!**/.git/**', '!**/*.tsbuildinfo'],
}))
expect(JSON.stringify(packageJSON.build.extraResources)).not.toMatch(/cursor-agent|\/agent\"/)
```

第二条不要误伤无关字段：改为断言 **该条目的 from** 不是一个 agent 二进制路径。

- [ ] **Step 2: Run test to verify it fails**

```bash
cd Electron && npx --maxsockets 3 --no-install vitest run apps/electron/packaging-contract.test.ts
```

- [ ] **Step 3: Wire build + sync**

1. `Electron/package.json` `build` 在 headroom 之后插入 `npm run build -w @pipiui/pipiui-cli-subagents`。
2. `apps/electron/package.json` extraResources 按测试插入。
3. 若 `package-lock` 需要认 workspace：在 `Electron/` 跑 `npm install --maxsockets 3 --ignore-scripts --no-audit --no-fund`（只为写入 lock；不要改用户代理）。
4. `cd Electron && npm run build -w @pipiui/pipiui-cli-subagents`（postbuild 同步 runtime 树）。
5. 确认 runtime 树有 `pipiui-extension.json`、`agents/cursor/AGENT.md`、`agent/dist/index.js`、`LICENSE`、`NOTICE`。没有 `agent` 二进制。

- [ ] **Step 4: Run tests**

```bash
cd Electron && npx --maxsockets 3 --no-install vitest run \
  apps/electron/packaging-contract.test.ts \
  packages/pipiui-cli-subagents/test/manifest.test.ts \
  packages/pi-backend/test/extension-manifest.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add Electron/package.json Electron/package-lock.json Electron/apps/electron/package.json Electron/apps/electron/packaging-contract.test.ts Electron/packages/pipiui-cli-subagents Electron/resources/runtime/extensions/pipiui-cli-subagents
git commit -m "$(cat <<'EOF'
chore(electron): bundle the CLI subagents extension without a Cursor binary

The App only ships the adapter. Users keep their own authenticated agent CLI.
EOF
)"
```

---

### Task 10: 回归与验收钉

**Files:**
- Test: `Electron/resources/runtime/pi-ext/subagent/test/external-cli-no-fallback.test.ts`（若 Task 8 已覆盖可只补缺口）
- Modify: 无功能代码，除非上列测试暴露漏洞

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 规格 §10 / §12 的自动化证据

- [ ] **Step 1: Write any missing failing test**

必须同时为真（已有则 skip 该条）：

1. launcher 缺失 → `shouldUsePiInvocation === false` 且注入的 `spawnPi` 未被调用。
2. `cursor` AGENT.md 在贡献快照里可被 `applyExtensionAgentContributions` 看见（仿 `extension-agent-contributions.test.ts` 的 `writePackage`，改成读真实文件）。
3. `general-purpose` 正文仍匹配 `ONLY \`subagent_type\` explore and general-purpose`，且不匹配 `subagent_type\` cursor`。
4. 映射文件路径含 `.pi/agent/cli-subagents/`，不含 `/.pi/cli` 全局家。

- [ ] **Step 2: Run the focused suite**

```bash
node --experimental-strip-types --test \
  Electron/resources/runtime/pi-ext/subagent/test/runtime-cli-fields.test.ts \
  Electron/resources/runtime/pi-ext/subagent/test/external-cli-launcher.test.ts \
  Electron/resources/runtime/pi-ext/subagent/test/external-cli-dispatch.test.ts \
  Electron/resources/runtime/pi-ext/subagent/test/cursor-agent-contribution.test.ts \
  Electron/resources/runtime/pi-ext/subagent/test/nested-delegation.test.ts \
  Electron/resources/runtime/pi-ext/subagent/test/dispatch-id-contract.test.ts

cd Electron/packages/pipiui-cli-subagents && npx --maxsockets 3 --no-install vitest run
```

Expected: PASS。

- [ ] **Step 3: Manual live check（仅当用户本机已 `agent login` 且要求真实验收）**

不要在实现任务里擅自打包。若用户明确要求打开 App：

1. 经 `pipiui-electron-build` skill `fast-app --overwrite-running`
2. 主会话派 `subagent_type: cursor` + slug `agentId`
3. 确认 worktree 在 `.pi/worktrees`，Abort 能停，扩展关掉后新会话派 `cursor` 响失败

- [ ] **Step 4: Commit only if Step 1 added files**

```bash
git add Electron/resources/runtime/pi-ext/subagent/test
git commit -m "$(cat <<'EOF'
test(subagent): pin external-cli no-fallback and catalog isolation

Keep Cursor dispatch off nested general-purpose workers and off the
pi invocation path when the launcher is missing.
EOF
)"
```

---

## Self-review

**Spec coverage**

| Spec | Task |
|---|---|
| §5.1 launcher 缝 / Symbol 注册 | 2, 7 |
| §5.2 扩展包 / 设置 / 不 L2 | 7, 9 |
| §5.3 runtime/cli / cursor AGENT.md | 1, 7 |
| §5.4 slug 映射文件 | 4 |
| §6 序列 ACP / 不 print / --trust | 6, 8 |
| §6.1 load 丢回放 | 5, 6 |
| §6.2 事件映射 / 不编造 thinking | 5 |
| §6.3 三个阻塞 RPC | 5, 6 |
| §6.4 abort | 6, 8 |
| §6.5 findings / 现有 closeout | 8 |
| §7 路径门 / 无路径拒绝 | 3, 5 |
| §8 失败文案 | 6, 8 |
| §9 不预装二进制 | 6 binary、9 packaging |
| §10 测试清单 | 1–10 |
| §3 仅主会话可派 | 7/10 不改 general-purpose 白名单 |
| 面板零新增 | 全程不改 SubagentPanel |

**Interface note:** spec 的 `ExternalWorkerHandle` 只有 `abort`。本计划补 `done` 与「适配器不发 end」，避免和现有 closeout 双发 `end`。产品行为不变。

**Placeholders:** 无 TBD。`createPlan` 的 Cursor 字段名以 Task 5 测试钉住的返回值为准；若 fixture 对不上官方方法名，只改适配器 method 字符串，不改面板协议。
