// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionHostAPI } from "@pipiui/extension-api";
import type { ExperimentRequest, ExperimentSummary, InventoryKind, InventoryPage } from "../contracts.js";
import { createComponent } from "../app/panel.js";
import { ExperimentService } from "../agent/service.js";

const Panel = createComponent(React);
const roots: string[] = [];
const DATA = ".pi/agent/experiments";
// Match the public host channel: default 128 KiB tail, hard cap 512 KiB,
// discard the first partial line, and never conceal truncation from the panel.
function hostRead(content: string, options?: { tailBytes?: number }) {
  const bytes = Buffer.from(content);
  const cap = Math.min(Math.max(1024, Math.floor(options?.tailBytes ?? 128 * 1024)), 512 * 1024);
  if (bytes.length <= cap) return { content, bytes: bytes.length, truncated: false };
  const tail = bytes.subarray(bytes.length - cap).toString("utf8");
  const newline = tail.indexOf("\n");
  return { content: newline < 0 ? tail : tail.slice(newline + 1), bytes: bytes.length, truncated: true };
}
function fakeAPI(files: Record<string, string>) {
  const read = vi.fn<NonNullable<ExtensionHostAPI["data"]>["read"]>(async (path, options) => {
    if (!(path in files)) throw new Error("data file is unavailable");
    return hostRead(files[path], options);
  });
  const api: ExtensionHostAPI = {
    subscribeExt: () => () => {},
    data: {
      list: async (directory) => Object.keys(files).filter((path) => path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes("/")).map((path) => ({ name: path.slice(directory.length + 1), bytes: Buffer.byteLength(files[path]), mtime: 0 })),
      read,
    },
  };
  return { api, read };
}
function summary(): ExperimentSummary {
  return {
    version: 1, id: "inventory-check", projectRoot: "/projects/真实项目", revision: 1, sequence: 2,
    question: "核验完整实验清单", kind: "command", state: "frozen", scopes: ["src"], includeUntracked: ["src/fixture.ts"],
    metrics: [{ id: "latency", unit: "ms", direction: "lower" }, { id: "accuracy", unit: "%", direction: "higher" }, { id: "size", unit: "bytes", direction: "neutral" }],
    variants: [{ id: "wide-recall", hypothesis: "宽召回提高定位准确度" }],
    budget: { repetitions: 3, concurrency: 2, maxTrials: 12, trialTimeoutMs: 60000, totalTimeoutMs: 600000 },
    baseline: { head: "abc123456789", indexFingerprint: "index", fingerprint: "fingerprint1234", frozenAt: "2026-01-01", files: [], dirtyPaths: [], removedPaths: [], omittedUntracked: [], excluded: [] },
    createdAt: "2026-01-01", updatedAt: "2026-01-01", isSummary: true, recordDigest: "digest", previewTruncated: true,
    inventory: { files: { count: 0, pages: 0 }, dirtyPaths: { count: 0, pages: 0 }, removedPaths: { count: 0, pages: 0 }, omittedUntracked: { count: 0, pages: 0 }, excluded: { count: 0, pages: 0 }, scopes: { count: 1, pages: 1 }, includeUntracked: { count: 1, pages: 1 } },
  };
}
afterEach(async () => { cleanup(); await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))); });

it("同一服务驱动面板创建、冻结、重开读取和新修订", async () => {
  const root = await mkdtemp(join(tmpdir(), "experiment-panel-"));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  await writeFile(join(root, "logic.ts"), "export const value = 1;\n");
  await writeFile(join(root, ".gitignore"), ".pi/\n");
  git("add", "."); git("commit", "-m", "fixture");
  const service = new ExperimentService(root);
  const api: ExtensionHostAPI = {
    subscribeExt: () => () => {},
    invoke: async (_method, params) => {
      try { return { ok: true, data: await service.execute(params as ExperimentRequest) }; }
      catch (cause) { return { ok: false, error: { code: "agent_error", message: String(cause) } }; }
    },
    data: {
      list: async (path) => {
        let names: string[];
        try { names = await readdir(join(root, path)); } catch { return []; }
        const result = [];
        for (const name of names) {
          const info = await stat(join(root, path, name));
          if (info.isFile()) result.push({ name, bytes: info.size, mtime: info.mtimeMs });
        }
        return result;
      },
      read: async (path, options) => hostRead(await readFile(join(root, path), "utf8"), options),
    },
  };
  const mounted = render(<Panel api={api} />);
  fireEvent.change(screen.getByRole("textbox", { name: "要验证的问题" }), { target: { value: "比较检索方案" } });
  fireEvent.click(screen.getByRole("button", { name: "创建实验草稿" }));
  await screen.findByRole("article", { name: "比较检索方案" });
  fireEvent.click(screen.getByRole("button", { name: "冻结当前基线" }));
  await screen.findByText(/已冻结/);
  expect((await service.get("design-contrast")).baseline?.files).toHaveLength(2);
  mounted.unmount();
  render(<Panel api={api} />);
  await screen.findByText(/已冻结/);
  fireEvent.click(screen.getByRole("button", { name: "创建新修订" }));
  await screen.findByText(/草稿 · r2/);
  expect((await service.get("design-contrast", 1)).state).toBe("frozen");
});

it("根容器在父级高度内滚动且长卡片不收缩，保留底部清单与修订入口", async () => {
  const record = summary();
  record.variants = Array.from({ length: 80 }, (_, index) => ({ id: `variant-${index}`, hypothesis: `长卡片方案假设 ${index}` }));
  const { api } = fakeAPI({ [`${DATA}/${record.id}.json`]: JSON.stringify(record) });
  render(<Panel api={api} />);
  const card = await screen.findByRole("article", { name: record.question });
  const root = screen.getByRole("region", { name: "实验台" });
  // jsdom verifies the layout contract, not browser geometry or actual scrolling.
  expect(root.style.height).toBe("100%");
  expect(root.style.minHeight).toBe("0px");
  expect(root.style.overflowY).toBe("auto");
  expect(root.style.boxSizing).toBe("border-box");
  expect(root.style.display).toBe("grid");
  expect(root.style.gridAutoRows).toBe("max-content");
  expect(root.style.alignContent).toBe("start");
  expect(card.parentElement).toBe(root);
  expect(within(card).getByText("variant-79 — 长卡片方案假设 79")).toBeTruthy();
  expect(within(card).getByRole("button", { name: "创建新修订" })).toBeTruthy();
  fireEvent.click(within(card).getByRole("button", { name: "查看完整清单" }));
  const reader = within(card).getByRole("region", { name: "完整清单" });
  expect(within(reader).getByRole("combobox", { name: "清单种类" })).toBeTruthy();
  expect(within(reader).getByRole("button", { name: "下一页" })).toBeTruthy();
});

it("宿主 fake 保留128KiB默认读取和512KiB硬限制", async () => {
  const { api } = fakeAPI({ large: "x".repeat(600 * 1024) });
  const defaultRead = await api.data!.read("large");
  expect(defaultRead.truncated).toBe(true);
  expect(Buffer.byteLength(defaultRead.content)).toBe(128 * 1024);
  const capped = await api.data!.read("large", { tailBytes: 1024 * 1024 });
  expect(capped.truncated).toBe(true);
  expect(Buffer.byteLength(capped.content)).toBe(512 * 1024);
});

it("大摘要、损坏JSON及不完整字段均不阻断另一条记录，错误可关闭", async () => {
  const record = summary();
  const { api } = fakeAPI({
    [`${DATA}/large.json`]: JSON.stringify({ padding: "x".repeat(600 * 1024) }),
    [`${DATA}/broken.json`]: "{",
    [`${DATA}/invalid.json`]: JSON.stringify({ version: 1, id: "invalid" }),
    [`${DATA}/bad-budget.json`]: JSON.stringify({ ...record, id: "bad-budget", budget: { ...record.budget, repetitions: {} } }),
    [`${DATA}/${record.id}.json`]: JSON.stringify(record),
  });
  render(<Panel api={api} />);
  await screen.findByRole("article", { name: record.question });
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("large.json");
  expect(alert.textContent).toContain("broken.json");
  expect(alert.textContent).toContain("invalid.json");
  expect(alert.textContent).toContain("bad-budget.json");
  fireEvent.click(screen.getByRole("button", { name: "关闭错误" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("article", { name: record.question })).toBeTruthy();
});

it("摘要显示真实字段与权威计数，超512KiB完整清单只经公开data分页读取", async () => {
  const record = summary();
  const files: Record<string, string> = {};
  const sourceItems = Array.from({ length: 4000 }, (_, index) => ({ path: `src/source-${index}.ts`, sha256: "a".repeat(64), bytes: 40, executable: false, origin: "tracked" }));
  expect(Buffer.byteLength(JSON.stringify(sourceItems))).toBeGreaterThan(512 * 1024);
  const inventories: Record<InventoryKind, unknown[]> = {
    files: sourceItems, dirtyPaths: ["src/changed.ts"], removedPaths: ["src/deleted.ts"], omittedUntracked: ["src/not-selected.ts"], excluded: [{ path: ".env", reason: "凭据" }], scopes: record.scopes, includeUntracked: record.includeUntracked,
  };
  for (const [kind, items] of Object.entries(inventories) as [InventoryKind, unknown[]][]) {
    const pages = Math.ceil(items.length / 100);
    record.inventory[kind] = { count: items.length, pages };
    for (let page = 1; page <= pages; page++) {
      const value: InventoryPage = { kind, page, pages, count: items.length, items: items.slice((page - 1) * 100, page * 100) };
      const content = JSON.stringify(value);
      expect(Buffer.byteLength(content)).toBeLessThan(25 * 1024);
      files[`${DATA}/${record.id}/inventory/${record.sequence}/${kind}-${page}.json`] = content;
    }
  }
  files[`${DATA}/${record.id}.json`] = JSON.stringify(record);
  const { api, read } = fakeAPI(files);
  render(<Panel api={api} />);
  const card = await screen.findByRole("article", { name: record.question });
  expect(card.textContent).toContain("/projects/真实项目");
  expect(card.textContent).toContain("项目范围：src");
  expect(card.textContent).toContain("明确纳入的未跟踪文件：src/fixture.ts");
  expect(card.textContent).toContain("latency · 单位：ms · 越低越好");
  expect(card.textContent).toContain("accuracy · 单位：% · 越高越好");
  expect(card.textContent).toContain("size · 单位：bytes · 中性观察");
  expect(card.textContent).toContain("wide-recall — 宽召回提高定位准确度");
  expect(card.textContent).toContain("每测例 3 轮，并发 2，最多 12 次，单次 1 分钟，总计 10 分钟");
  expect(card.textContent).toContain("源码 4000 个 · 修改 1 个 · 删除 1 个 · 未纳入的未跟踪文件 1 个 · 排除 1 个");
  expect(card.textContent).toContain("摘要预览已截断");
  fireEvent.click(within(card).getByRole("button", { name: "查看完整清单" }));
  const reader = within(screen.getByRole("region", { name: "完整清单" }));
  // Traverse every page, not merely the preview or the first two pages.
  for (let page = 1; page <= 40; page++) {
    await reader.findByText(new RegExp(`source-${(page - 1) * 100}\\.ts`));
    expect(reader.getByText(`源码：共 4000 项 · 第 ${page} / 40 页`)).toBeTruthy();
    if (page < 40) fireEvent.click(reader.getByRole("button", { name: "下一页" }));
  }
  expect(reader.getByRole("button", { name: "下一页" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(reader.getByRole("button", { name: "上一页" }));
  await reader.findByText(/source-3800\.ts/);
  for (const [kind, expected] of [["dirtyPaths", "src/changed.ts"], ["removedPaths", "src/deleted.ts"], ["omittedUntracked", "src/not-selected.ts"], ["excluded", '"reason":"凭据"'], ["scopes", "src"], ["includeUntracked", "src/fixture.ts"]]) {
    fireEvent.change(reader.getByRole("combobox", { name: "清单种类" }), { target: { value: kind } });
    await waitFor(() => expect(reader.getAllByRole("listitem").some((item) => item.textContent?.includes(expected))).toBe(true));
  }
  expect(read.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  expect(read.mock.calls.some(([path]) => path.includes("/events/"))).toBe(false);
});

it("分页读取错误可关闭并重试，不隐藏实验卡", async () => {
  const record = summary();
  record.inventory.files = { count: 1, pages: 1 };
  const files = { [`${DATA}/${record.id}.json`]: JSON.stringify(record) };
  const { api } = fakeAPI(files);
  render(<Panel api={api} />);
  await screen.findByRole("article", { name: record.question });
  fireEvent.click(screen.getByRole("button", { name: "查看完整清单" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "关闭清单错误" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("article", { name: record.question })).toBeTruthy();
  // Close/reopen retries through the same public read channel.
  files[`${DATA}/${record.id}/inventory/${record.sequence}/files-1.json`] = JSON.stringify({ kind: "files", page: 1, pages: 1, count: 1, items: ["src/recovered.ts"] });
  fireEvent.click(screen.getByRole("button", { name: "收起完整清单" }));
  fireEvent.click(screen.getByRole("button", { name: "查看完整清单" }));
  await screen.findByText("src/recovered.ts");
});

it.each([
  [JSON.stringify({ padding: "x".repeat(130 * 1024) }), "清单分页超过读取上限"],
  [JSON.stringify({ kind: "files", page: 2, pages: 1, count: 1, items: ["wrong-page"] }), "清单分页身份或计数不匹配"],
])("不把损坏分页误报成完整清单 %#", async (content, message) => {
  const record = summary();
  record.inventory.files = { count: 1, pages: 1 };
  const { api } = fakeAPI({ [`${DATA}/${record.id}.json`]: JSON.stringify(record), [`${DATA}/${record.id}/inventory/${record.sequence}/files-1.json`]: content });
  render(<Panel api={api} />);
  await screen.findByRole("article", { name: record.question });
  fireEvent.click(screen.getByRole("button", { name: "查看完整清单" }));
  expect((await screen.findByRole("alert")).textContent).toContain(message);
  expect(screen.queryByText("wrong-page")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭清单错误" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("没有活动会话时保留可关闭错误，不假装创建成功", async () => {
  const api: ExtensionHostAPI = {
    subscribeExt: () => () => {},
    invoke: async () => ({ ok: false, error: { code: "no_session", message: "请打开项目会话" } }),
    data: { list: async () => [], read: async () => ({ content: "", bytes: 0, truncated: false }) },
  };
  render(<Panel api={api} />);
  fireEvent.change(screen.getByRole("textbox", { name: "要验证的问题" }), { target: { value: "需要检查的设计" } });
  fireEvent.click(screen.getByRole("button", { name: "创建实验草稿" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭错误" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByRole("button", { name: "创建实验草稿" }).hasAttribute("disabled")).toBe(false);
});
