import { describe, expect, it } from "vitest";
import {
  ALL_CLAIMED_TOOL_NAMES,
  EXTENSION_TOOL_OWNERSHIP,
  PI_RUNTIME_TOOL_NAMES,
  owningExtension,
} from "../src/extension-tool-ownership.js";
import { CORE_CAPABILITY_TOOL_CONTRACT, FROZEN_CORE_CAPABILITY_TOOL_NAMES } from "../src/extension-registry.js";

/**
 * Boss（coding 包、默认全开）主会话的完整静态工具集：pi 运行时本体 7 个 +
 * 全部已认领工具 57 个。动态工具不在此列：`mcp_` 前缀的用户 MCP 工具与
 * 随提供商出现的 hosted search 变体（主会话与 web_search 去重，不新增名字）。
 */
const EXPECTED_BOSS_TOOLSET: readonly string[] = Object.freeze(
  [
    // pi 运行时本体（非扩展）
    "read",
    "bash",
    "edit",
    "write",
    "ls",
    "grep",
    "find",
    // web-access-extension（冻结契约）
    "web_search",
    "fetch_content",
    "source_check",
    "get_search_content",
    "arxiv_fetch",
    // webview-browser-extension（冻结契约）
    "browser_search",
    "browser_fetch",
    "browser",
    "browser_flow",
    // cua-extension（冻结契约）
    "computer",
    "open_application",
    // memory-extension（冻结契约）
    "memory_query",
    "memory_status",
    // agent-orchestration
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
    // pipiui-headroom（context-fold 引擎）
    "recall_folded",
    "unfold",
    // skill-loader-extension
    "skill_search",
    "skill_load",
    // plan-extension
    "plan_approve",
    "plan_cancel",
    "plan_check",
    "plan_publish",
    "plan_task_update",
    // goal-extension
    "goal_complete",
    "goal_blocked",
    "goal_wait",
    // code-retrieval
    "code_search",
    "code_nav",
    "read_spans",
    "repo_map",
    // 单工具扩展
    "git",
    "terminal",
    "reload_runtime",
    // document-workbench
    "list_open_documents",
    "pipiui_firecrawl_anydoc",
    // grok-build-oauth
    "image_gen",
    "image_edit",
    // pi-ext（宿主内核挂载）
    "secret_vault_put",
    "secret_vault_list",
    "secret_vault_mount",
    "secret_vault_unmount",
    "secret_vault_delete",
    "pipiui_runtime_info",
    // hello-pipiui（骨架示例；不在 coding 包内，包外仍可启用）
    "hello-pipiui",
  ].sort(),
);

describe("extension tool ownership", () => {
  it("keeps every claimed tool name unique across extensions", () => {
    const seen = new Map<string, string>();
    for (const [id, tools] of Object.entries(EXTENSION_TOOL_OWNERSHIP)) {
      expect(tools.length, `${id} claims nothing`).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(seen.has(tool), `tool '${tool}' claimed by both ${seen.get(tool)} and ${id}`).toBe(false);
        seen.set(tool, id);
      }
    }
    expect(seen.size).toBe(ALL_CLAIMED_TOOL_NAMES.length);
  });

  it("contains the frozen core-capability contract verbatim", () => {
    for (const [id, tools] of Object.entries(CORE_CAPABILITY_TOOL_CONTRACT)) {
      expect(EXTENSION_TOOL_OWNERSHIP[id]).toEqual([...tools].sort());
    }
    expect(ALL_CLAIMED_TOOL_NAMES).toEqual(expect.arrayContaining([...FROZEN_CORE_CAPABILITY_TOOL_NAMES]));
  });

  it("pins the Boss main-session toolset", () => {
    const boss = [...PI_RUNTIME_TOOL_NAMES, ...ALL_CLAIMED_TOOL_NAMES].sort();
    expect(boss).toEqual([...EXPECTED_BOSS_TOOLSET]);
  });

  it("resolves ownership lookups", () => {
    expect(owningExtension("browser_flow")).toBe("webview-browser-extension");
    expect(owningExtension("arxiv_fetch")).toBe("web-access-extension");
    expect(owningExtension("subagent_manage")).toBe("agent-orchestration");
    expect(owningExtension("secret_vault_put")).toBe("pi-ext");
    expect(owningExtension("image_gen")).toBe("grok-build-oauth");
    expect(owningExtension("read")).toBeUndefined();
    expect(owningExtension("mcp_context7_search")).toBeUndefined();
  });
});
