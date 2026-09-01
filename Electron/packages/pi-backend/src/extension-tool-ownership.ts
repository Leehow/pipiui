/**
 * 全量工具归属注册表：每个会话内可见的 agent 工具都必须有一个归属方。
 *
 * 三类归属：
 * 1. 冻结核心能力契约（`CORE_CAPABILITY_TOOL_CONTRACT`）——直接并入本表；
 * 2. 描述符扩展的事实归属——工具由扩展的 agent 入口注册（或经 legacy fallback
 *    裸挂载，且注册扩展后即由扩展接管），这里把归属显式化；
 * 3. pi 运行时本体工具（`PI_RUNTIME_TOOL_NAMES`）——按设计不属于任何扩展。
 *
 * 动态工具（不在本表）：`pi-mcp-extension` 按 `{projectRoot}/.pi/mcp.json` 挂载的
 * `mcp_` 前缀工具，以及随提供商出现的 hosted search 变体（主会话经
 * hosted-search-exclusion 与 web_search 去重，不新增名字）。
 */
import { CORE_CAPABILITY_TOOL_CONTRACT } from "./extension-registry.js";

/** pi（pi-coding-agent）运行时本体工具；coding-runtime 会以同名增强版替换 grep/ls。 */
export const PI_RUNTIME_TOOL_NAMES: readonly string[] = Object.freeze([
  "read",
  "bash",
  "edit",
  "write",
  "ls",
  "grep",
  "find",
]);

/** 描述符扩展的事实归属（冻结契约之外的部分）。 */
const EXTENSION_TOOL_CLAIMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // subagent / Boss 编排域（pi-ext/subagent 经 agent-orchestration 的 agent 入口注册）。
  "agent-orchestration": Object.freeze([
    "subagent",
    "subagent_manage",
    "subagent_status",
    "subagent_progress",
    "subagent_resolve",
    "subagent_watch",
    "subagent_chain",
    "subagent_abort",
    "subagent_alarm_ack",
    "ledger_note",
    "context_doc",
    "context_manage",
    "session_recall",
    "secretary_commit",
  ]),
  // context-fold 折叠引擎的取回工具；feature 归 pipiui-headroom（主优化器，context-fold 为回退）。
  "pipiui-headroom": Object.freeze(["recall_folded", "unfold"]),
  "skill-loader-extension": Object.freeze(["skill_search", "skill_load"]),
  "plan-extension": Object.freeze([
    "plan_approve",
    "plan_cancel",
    "plan_check",
    "plan_publish",
    "plan_task_update",
  ]),
  "goal-extension": Object.freeze(["goal_complete", "goal_blocked", "goal_wait"]),
  "code-retrieval": Object.freeze(["code_search", "code_nav", "read_spans", "repo_map"]),
  "git-capability": Object.freeze(["git"]),
  "terminal-extension": Object.freeze(["terminal"]),
  "document-workbench": Object.freeze(["list_open_documents", "pipiui_firecrawl_anydoc"]),
  "coding-runtime": Object.freeze(["reload_runtime"]),
  // Grok 图像传输（pipiui-media.ts 只是其 compat/off 回退，grok 挂载时让位）。
  "grok-build-oauth": Object.freeze(["image_gen", "image_edit"]),
  // 宿主内核级挂载（KERNEL_PATHS，任何 profile 都在），归属宿主编排层 Pi Ext。
  "pi-ext": Object.freeze([
    "secret_vault_put",
    "secret_vault_list",
    "secret_vault_mount",
    "secret_vault_unmount",
    "secret_vault_delete",
    "pipiui_runtime_info",
  ]),
  "hello-pipiui": Object.freeze(["hello-pipiui"]),
});

/** 冻结契约 + 事实归属合成出的全量归属表。 */
export const EXTENSION_TOOL_OWNERSHIP: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries({ ...EXTENSION_TOOL_CLAIMS, ...CORE_CAPABILITY_TOOL_CONTRACT }).map(([id, tools]) => [
      id,
      Object.freeze([...tools].sort()),
    ]),
  ),
);

/** 所有已认领工具名（去重排序）。 */
export const ALL_CLAIMED_TOOL_NAMES: readonly string[] = Object.freeze(
  [...new Set(Object.values(EXTENSION_TOOL_OWNERSHIP).flat())].sort(),
);

/** 返回工具的归属扩展 id；未认领时 undefined。 */
export function owningExtension(tool: string): string | undefined {
  for (const [id, tools] of Object.entries(EXTENSION_TOOL_OWNERSHIP)) {
    if (tools.includes(tool)) return id;
  }
  return undefined;
}
