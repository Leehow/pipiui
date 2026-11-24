import { describe, expect, it, vi } from "vitest";
import type { FrozenVariant } from "../agent/batch-contract.js";
import type { VariantStore } from "../agent/variants.js";
import { executeVariantRequest, summarizeVariant } from "../agent/variant-control.js";

const frozen: FrozenVariant = {
  version: 1, experimentId: "search-contrast", revision: 2, id: "candidate", hypothesis: "减少重复读取。",
  fingerprint: "candidate-fingerprint", baselineFingerprint: "baseline-fingerprint", frozenAt: "2026-01-01T00:00:00Z", snapshotPath: "/private/immutable/source",
  files: Array.from({ length: 30 }, (_, index) => ({ path: `source-${index}.ts`, sha256: "a".repeat(64), bytes: 10, executable: false, origin: "tracked" as const })),
};
function harness() {
  const prepare = vi.fn().mockResolvedValue({ experimentId: "search-contrast", variantId: "candidate", workspace: { agentId: "search-candidate", path: "/project/.pi/worktrees/search-candidate", branch: "pipiui/search-candidate", mergePolicy: "never" } });
  const freeze = vi.fn().mockResolvedValue(frozen);
  const read = vi.fn().mockResolvedValue(frozen);
  const list = vi.fn().mockResolvedValue([frozen]);
  return { prepare, freeze, read, list, store: { prepare, freeze, read, list } as unknown as VariantStore };
}

describe("候选控制入口", () => {
  it("传递语义身份、冻结修订和明确验证器输入，不替用户猜路径", async () => {
    const h = harness();
    const response = await executeVariantRequest(h.store, { action: "variant_prepare", requestId: "panel-request", experimentId: "search-contrast", variantId: "candidate", agentId: "search-candidate", revision: 2, validationPaths: ["benchmark.js"] });
    expect(h.prepare).toHaveBeenCalledWith({ experimentId: "search-contrast", variantId: "candidate", agentId: "search-candidate", revision: 2, validationPaths: ["benchmark.js"] });
    expect(response).toMatchObject({ version: 1, requestId: "panel-request", action: "variant_prepare", preparation: { workspace: { mergePolicy: "never" } } });
  });
  it("分别路由冻结、回读与列表，并保留显式未跟踪文件选择", async () => {
    const h = harness();
    const request = { experimentId: "search-contrast", variantId: "candidate", revision: 2 };
    expect((await executeVariantRequest(h.store, { ...request, action: "variant_freeze", includeUntracked: ["new.ts"] })).variant).toEqual(frozen);
    expect(h.freeze).toHaveBeenCalledWith("search-contrast", "candidate", 2, ["new.ts"]);
    await executeVariantRequest(h.store, { ...request, action: "variant_read" });
    expect(h.read).toHaveBeenCalledWith("search-contrast", "candidate", 2);
    expect((await executeVariantRequest(h.store, { ...request, action: "variant_list" })).variants).toEqual([frozen]);
    expect(h.list).toHaveBeenCalledWith("search-contrast", 2);
  });
  it("在任何工作区操作前拒绝取消、无效版本和身份", async () => {
    const h = harness();
    const request = { action: "variant_prepare" as const, experimentId: "search-contrast", variantId: "candidate", agentId: "search-candidate" };
    await expect(executeVariantRequest(h.store, request, AbortSignal.abort())).rejects.toThrow();
    await expect(executeVariantRequest(h.store, { ...request, version: 2 as never })).rejects.toThrow("invalid-version");
    await expect(executeVariantRequest(h.store, { ...request, agentId: "../escape" })).rejects.toThrow("invalid-id");
    expect(h.prepare).not.toHaveBeenCalled();
  });
  it("模型摘要不展开文件清单或泄露内部快照入口", () => {
    const summary = summarizeVariant(frozen);
    expect(summary.files).toEqual({ count: 30, preview: frozen.files.slice(0, 10).map((file) => file.path), truncated: true });
    expect(summary).not.toHaveProperty("snapshotPath");
    expect(summary.fingerprint).toBe(frozen.fingerprint);
    expect(frozen.files).toHaveLength(30);
  });
});
