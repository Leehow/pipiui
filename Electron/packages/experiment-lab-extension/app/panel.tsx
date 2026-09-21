import type * as ReactTypes from "react";
import type { ExtensionHostAPI } from "@pipiui/extension-api";
import type { CommandCase, CommandCaseInput, CommandSpec, ExperimentRecord, ExperimentRequest, ExperimentResponse, ExperimentSummary, InventoryKind, InventoryPage, TrialRecord, TrialRequest, TrialResponse, TrialState } from "../contracts.js";

const DATA = ".pi/agent/experiments";
// The host clips its fixed-height tool page; this root owns scrolling.
// Content-sized grid rows keep long cards from shrinking inside that viewport.
const panelStyle: ReactTypes.CSSProperties = { color: "var(--text)", padding: 16, display: "grid", gridAutoRows: "max-content", alignContent: "start", gap: 14, height: "100%", minHeight: 0, overflowY: "auto", boxSizing: "border-box", minWidth: 0, fontSize: 13 };
const fieldStyle: ReactTypes.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface-input)", color: "var(--text)", padding: "7px 9px", font: "inherit" };
const cardStyle: ReactTypes.CSSProperties = { border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "grid", gap: 8, minWidth: 0 };

const inventoryLabels: Record<InventoryKind, string> = { files: "源码", dirtyPaths: "修改", removedPaths: "删除", omittedUntracked: "未纳入的未跟踪文件", excluded: "排除", scopes: "项目范围", includeUntracked: "明确纳入的未跟踪文件" };
const inventoryKinds = Object.keys(inventoryLabels) as InventoryKind[];
type PanelRecord = ExperimentRecord & Partial<Pick<ExperimentSummary, "isSummary" | "inventory" | "previewTruncated" | "caseCatalog">>;
const inventoryPreview = (record: PanelRecord, kind: InventoryKind): unknown[] => kind === "scopes" || kind === "includeUntracked" ? record[kind] : record.baseline?.[kind] ?? [];
const inventoryCount = (record: PanelRecord, kind: InventoryKind) => record.isSummary ? record.inventory![kind].count : inventoryPreview(record, kind).length;
const itemText = (item: unknown) => typeof item === "string" ? item : JSON.stringify(item);

const slug = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const activeStates = new Set<TrialState>(["queued", "preparing", "running", "verifying"]);
const stateLabels: Record<TrialState, string> = { queued: "排队中", preparing: "准备中", running: "运行中", verifying: "检查中", succeeded: "执行成功", failed: "执行失败", "timed-out": "超时", cancelled: "已取消", invalid: "无效", interrupted: "已中断" };
const qualityLabels = { pass: "通过", fail: "不通过", unknown: "未知" };
const sourceLabels = { runtime: "运行时测量", "workload-output": "工作负载输出", unavailable: "不可用" };
function validCommand(value: CommandSpec): boolean {
  return !!value && typeof value.executable === "string" && !!value.executable.trim() && Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string") && typeof value.shell === "boolean";
}
function validCase(value: CommandCase): boolean {
  return !!value && typeof value.id === "string" && slug.test(value.id) && typeof value.title === "string" && validCommand(value.command) && (value.prepare === undefined || validCommand(value.prepare)) && Number.isInteger(value.expectedExitCode) && Array.isArray(value.allowedDomains) && value.allowedDomains.every((domain) => typeof domain === "string") && Array.isArray(value.checks) && value.checks.every((check) => !!check && typeof check.path === "string" && (check.expectedText === undefined || typeof check.expectedText === "string") && (check.sha256 === undefined || typeof check.sha256 === "string")) && (value.metricsFile === undefined || typeof value.metricsFile === "string");
}
function parseCases(text: string): CommandCaseInput[] | undefined {
  if (!text.trim()) return undefined;
  const value = JSON.parse(text) as CommandCaseInput[];
  const strings = (items: unknown) => Array.isArray(items) && items.every((item) => typeof item === "string");
  const command = (input: CommandCaseInput["command"]) => !!input && typeof input.executable === "string" && (input.args === undefined || strings(input.args)) && (input.shell === undefined || typeof input.shell === "boolean");
  // Check input shapes only; the host owns semantic validation and all defaults.
  const validInput = (input: CommandCaseInput) => !!input && typeof input.id === "string"
    && command(input.command) && (input.prepare === undefined || command(input.prepare))
    && (input.title === undefined || typeof input.title === "string")
    && (input.expectedExitCode === undefined || typeof input.expectedExitCode === "number")
    && (input.allowedDomains === undefined || strings(input.allowedDomains))
    && (input.metricsFile === undefined || typeof input.metricsFile === "string")
    && (input.checks === undefined || Array.isArray(input.checks) && input.checks.every((check) => !!check && typeof check.path === "string" && (check.expectedText === undefined || typeof check.expectedText === "string") && (check.sha256 === undefined || typeof check.sha256 === "string")));
  if (!Array.isArray(value) || !value.every(validInput)) throw new Error("测例 JSON 必须是有效的命令测例数组。");
  return value;
}
function validTrial(value: TrialRecord, experimentId: string, filename: string): boolean {
  return !!value && value.version === 1 && typeof value.id === "string" && slug.test(value.id) && `${value.id}.json` === filename && value.experimentId === experimentId && Number.isInteger(value.revision) && typeof value.caseId === "string" && Object.hasOwn(stateLabels, value.state) && Object.hasOwn(qualityLabels, value.quality) && typeof value.createdAt === "string" && !!value.owner && (value.owner.sessionId === undefined || typeof value.owner.sessionId === "string") && (value.reason === undefined || typeof value.reason === "string") && Array.isArray(value.metrics) && value.metrics.every((metric) => !!metric && typeof metric.id === "string" && typeof metric.unit === "string" && (metric.value === null || typeof metric.value === "number" && Number.isFinite(metric.value)) && Object.hasOwn(sourceLabels, metric.source)) && Array.isArray(value.checks) && value.checks.every((check) => !!check && typeof check.path === "string" && typeof check.passed === "boolean" && (check.reason === undefined || typeof check.reason === "string")) && Array.isArray(value.artifacts) && value.artifacts.every((artifact) => !!artifact && ["prepare", "workload"].includes(artifact.phase) && ["stdout", "stderr"].includes(artifact.kind) && typeof artifact.path === "string" && Number.isFinite(artifact.bytes) && typeof artifact.truncated === "boolean");
}
const commandText = (command: CommandSpec) => `${command.shell ? "Shell" : "直接执行"}：${[command.executable, ...command.args].map((arg) => JSON.stringify(arg)).join(" ")}`;

/** Use the host's React instance; compiled extension modules have no bare imports. */
export function createComponent(react: typeof ReactTypes) {
  const { createElement: h, useEffect, useRef, useState } = react;
  function InventoryReader({ api, record }: { api?: ExtensionHostAPI; record: PanelRecord }) {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<InventoryKind>("files");
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<unknown[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const count = inventoryCount(record, kind);
    const pages = record.isSummary ? record.inventory![kind].pages : (count ? 1 : 0);
    useEffect(() => {
      if (!open) return;
      let current = true;
      setItems([]);
      setError("");
      setLoading(true);
      async function load() {
        try {
          if (!record.isSummary || !pages) {
            if (current) setItems(inventoryPreview(record, kind));
            return;
          }
          if (!api?.data) throw new Error("当前没有可用的清单读取通道。");
          const data = await api.data.read(`${DATA}/${record.id}/inventory/${record.sequence}/${kind}-${page}.json`);
          if (data.truncated) throw new Error("清单分页超过读取上限，无法完整显示。");
          const value = JSON.parse(data.content) as InventoryPage;
          if (value.kind !== kind || value.page !== page || value.pages !== pages || value.count !== count || !Array.isArray(value.items)) throw new Error("清单分页身份或计数不匹配。");
          if (current) setItems(value.items);
        } catch (cause) {
          if (current) setError(cause instanceof Error ? cause.message : "读取清单失败。");
        } finally {
          if (current) setLoading(false);
        }
      }
      void load();
      return () => { current = false; };
    }, [api, record, open, kind, page, pages, count, retry]);
    return <div style={{ display: "grid", gap: 8 }}>
      <button type="button" onClick={() => setOpen(!open)}>{open ? "收起完整清单" : "查看完整清单"}</button>
      {open && <div role="region" aria-label="完整清单" style={{ display: "grid", gap: 8 }}>
        <label>清单种类<select style={fieldStyle} value={kind} onChange={(event) => { setKind(event.currentTarget.value as InventoryKind); setPage(1); }}>{inventoryKinds.map((value) => <option key={value} value={value}>{inventoryLabels[value]}（{inventoryCount(record, value)}）</option>)}</select></label>
        <span>{inventoryLabels[kind]}：共 {count} 项 · 第 {pages ? page : 0} / {pages} 页</span>
        {loading && <span role="status">正在读取清单…</span>}
        {error && <div role="alert"><span>{error}</span><button type="button" aria-label="关闭清单错误" onClick={() => setError("")}>×</button><button type="button" onClick={() => setRetry(retry + 1)}>重试读取</button></div>}
        {!loading && !error && !count && <span>此类清单为空。</span>}
        <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 280, overflow: "auto", overflowWrap: "anywhere" }}>{items.map((item, index) => <li key={index}>{itemText(item)}</li>)}</ul>
        <div style={{ display: "flex", gap: 8 }}><button type="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>上一页</button><button type="button" disabled={loading || page >= pages} onClick={() => setPage(page + 1)}>下一页</button></div>
      </div>}
    </div>;
  }
  function TrialLogs({ api, trial }: { api?: ExtensionHostAPI; trial: TrialRecord }) {
    const [path, setPath] = useState("");
    const [log, setLog] = useState<{ content: string; truncated: boolean; bytes: number }>();
    const [error, setError] = useState("");
    const artifact = trial.artifacts.find((entry) => entry.path === path);
    useEffect(() => {
      setLog(undefined);
      setError("");
      if (!artifact) return;
      let current = true;
      async function load() {
        try {
          const expected = `${DATA}/${trial.experimentId}/runs/${trial.id}/artifacts/${artifact!.phase}.${artifact!.kind}.txt`;
          if (path !== expected) throw new Error("日志路径不属于本次运行，已拒绝读取。");
          if (!api?.data) throw new Error("当前没有可用的日志读取通道。");
          const data = await api.data.read(path, { tailBytes: 64 * 1024 });
          if (current) setLog({ ...data, truncated: data.truncated || artifact!.truncated });
        } catch (cause) {
          if (current) setError(cause instanceof Error ? cause.message : "读取日志失败。");
        }
      }
      void load();
      return () => { current = false; };
    }, [api, artifact, path, trial.experimentId, trial.id]);
    return <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{trial.artifacts.map((entry) => <button key={entry.path} type="button" onClick={() => setPath(entry.path)}>查看 {entry.phase}/{entry.kind} 日志</button>)}</div>
      {path && <div role="region" aria-label="运行日志"><button type="button" onClick={() => setPath("")}>关闭日志</button>
        {error && <div role="alert">{error}<button type="button" aria-label="关闭日志错误" onClick={() => setError("")}>×</button></div>}
        {log && <div><small>日志文件 {log.bytes} 字节。{log.truncated ? "日志已截断，仅显示保留内容的末尾（最多 64 KiB）。" : "日志未截断。"}</small><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 240, overflow: "auto" }}>{log.content}</pre></div>}
      </div>}
    </div>;
  }
  function CommandTrials({ api, record }: { api?: ExtensionHostAPI; record: PanelRecord }) {
    const [caseId, setCaseId] = useState("");
    const [definition, setDefinition] = useState<CommandCase>();
    const [runs, setRuns] = useState<TrialRecord[]>([]);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const pending = useRef<{ requestId: string; action: TrialRequest["action"] } | undefined>(undefined);
    const requestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const mounted = useRef(true);
    const catalog = record.caseCatalog ?? [];
    const hasActive = runs.some((trial) => activeStates.has(trial.state));
    useEffect(() => {
      let current = true;
      setDefinition(undefined);
      if (!caseId || !api?.data || record.state !== "frozen") return;
      async function load() {
        try {
          const data = await api!.data!.read(`${DATA}/${record.id}/cases/${record.sequence}/${caseId}.json`);
          if (data.truncated) throw new Error("测例定义读取不完整，不能运行。");
          const value = JSON.parse(data.content) as CommandCase;
          if (!validCase(value) || value.id !== caseId) throw new Error("测例定义无效或身份不匹配，不能运行。");
          if (current) setDefinition(value);
        } catch (cause) {
          if (current) setError(cause instanceof Error ? cause.message : "读取测例失败。");
        }
      }
      void load();
      return () => { current = false; };
    }, [api, record.id, record.sequence, record.state, caseId]);
    useEffect(() => {
      if (!api?.data) return;
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let polls = 0;
      async function load() {
        try {
          const entries = (await api!.data!.list(`${DATA}/${record.id}/runs`)).filter((entry) => /^[a-z][a-z0-9-]*\.json$/.test(entry.name)).sort((a, b) => b.mtime - a.mtime);
          const next: TrialRecord[] = [];
          const errors: string[] = [];
          for (const entry of entries.slice(0, 100)) {
            if (disposed) return;
            try {
              const data = await api!.data!.read(`${DATA}/${record.id}/runs/${entry.name}`);
              if (data.truncated) throw new Error("运行记录超过读取上限。");
              const trial = JSON.parse(data.content) as TrialRecord;
              if (!validTrial(trial, record.id, entry.name)) throw new Error("运行记录身份或字段不匹配。");
              next.push(trial);
            } catch (cause) { errors.push(`${entry.name}：${cause instanceof Error ? cause.message : "读取失败。"}`); }
          }
          if (disposed) return;
          setRuns(next.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
          if (errors.length) setError(errors.join("\n"));
          if (entries.length > 100) setNotice("仅显示最近修改的 100 条运行；其他运行可用 experiment status 查看。");
          if (next.some((trial) => activeStates.has(trial.state))) {
            if (polls++ < 300) timer = setTimeout(() => void load(), 2000);
            else setNotice("自动刷新已暂停，请点击刷新运行继续查看状态。");
          }
        } catch (cause) {
          if (!disposed && !/ENOENT|not found|不存在/.test(String(cause))) setError(cause instanceof Error ? cause.message : "读取运行失败。");
        }
      }
      void load();
      return () => { disposed = true; if (timer) clearTimeout(timer); };
    }, [api, record.id, refreshKey]);
    function accept(value: (TrialResponse & { error?: { message: string } })) {
      const request = pending.current;
      if (!request || value.requestId !== request.requestId) return;
      if (requestTimer.current) clearTimeout(requestTimer.current);
      pending.current = undefined;
      setBusy(false);
      if (value.error) setError(value.error.message);
      else {
        setNotice(request.action === "run" ? "运行已受理；以下状态来自本项目持久记录，不代表已经完成。" : "操作已受理，正在重新读取持久状态。");
        setRefreshKey((key) => key + 1);
      }
    }
    useEffect(() => {
      mounted.current = true;
      const dispose = api?.subscribeExt((event) => {
        // Events can originate elsewhere: they only invalidate this api's project data.
        if (event.type === "trial" || event.type === "changed") setRefreshKey((key) => key + 1);
        if (event.type === "result" && event.payload) accept(event.payload as TrialResponse);
      });
      return () => { mounted.current = false; pending.current = undefined; if (requestTimer.current) clearTimeout(requestTimer.current); dispose?.(); };
    }, [api]);
    async function send(action: TrialRequest["action"], trial?: TrialRecord) {
      if (pending.current) return;
      if (!api?.invoke) { setError("当前没有可用的实验控制通道，请打开项目会话。"); return; }
      if (action === "run" && (record.state !== "frozen" || !definition || definition.id !== caseId || hasActive)) return;
      const requestId = globalThis.crypto.randomUUID();
      const request: TrialRequest = { version: 1, action, experimentId: record.id, revision: trial?.revision ?? record.revision, requestId, ...(trial ? { trialId: trial.id } : { caseId }) };
      pending.current = { requestId, action };
      setBusy(true);
      setError("");
      setNotice("等待操作受理…");
      requestTimer.current = setTimeout(() => {
        pending.current = undefined;
        if (mounted.current) { setBusy(false); setNotice(""); setError("等待受理超时；请先刷新运行记录，勿重复启动同一操作。"); }
      }, 30000);
      try {
        const result = await api.invoke(action, request, action === "cancel" && trial?.owner.sessionId ? { sessionId: trial.owner.sessionId } : undefined);
        if (!mounted.current || pending.current?.requestId !== requestId) return;
        if (!result.ok) throw new Error(result.error.message);
        const direct = result.data as TrialResponse | undefined;
        if (direct?.version === 1 && direct.action === action) accept({ ...direct, requestId });
        // Transport ack alone is not an accepted run; wait for the correlated result event.
      } catch (cause) {
        if (!mounted.current || pending.current?.requestId !== requestId) return;
        if (requestTimer.current) clearTimeout(requestTimer.current);
        pending.current = undefined;
        setBusy(false);
        setNotice("");
        setError(cause instanceof Error ? cause.message : "运行操作失败。");
      }
    }
    return <section aria-label="单次受限运行" style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <strong>单次受限运行</strong>
      {error && <div role="alert" style={{ overflowWrap: "anywhere" }}>{error}<button type="button" aria-label="关闭运行错误" onClick={() => setError("")}>×</button></div>}
      {notice && <small role="status">{notice}</small>}
      {record.state === "frozen" ? <div style={{ display: "grid", gap: 8 }}>
        <label>测例<select style={fieldStyle} value={caseId} onChange={(event) => { setDefinition(undefined); setError(""); setCaseId(event.currentTarget.value); }}><option value="">请选择测例并读取完整定义</option>{catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} — {entry.title}{entry.titleTruncated ? "（标题截断）" : ""}</option>)}</select></label>
        {!catalog.length && <small>本修订没有命令测例；请创建新修订后通过工具设置测例。</small>}
        {definition && <div style={{ display: "grid", gap: 5, overflowWrap: "anywhere" }}>
          <strong>{definition.title}</strong><code>{commandText(definition.command)}</code>
          {definition.prepare && <code>准备命令：{commandText(definition.prepare)}</code>}
          <span>预期退出码：{definition.expectedExitCode}</span>
          <span>联网域：{definition.allowedDomains.join("、") || "无（默认禁止联网）"}</span>
          <span>检查：{definition.checks.length ? "" : "未设置文件检查"}</span>
          {definition.checks.map((check, index) => <code key={index}>{check.path}{check.expectedText !== undefined ? ` · 预期文本 ${JSON.stringify(check.expectedText)}` : ""}{check.sha256 ? ` · SHA256 ${check.sha256}` : ""}</code>)}
          <span>工作负载指标文件：{definition.metricsFile ?? "未设置"}</span>
        </div>}
        <button type="button" disabled={busy || hasActive || !definition || definition.id !== caseId} onClick={() => void send("run")}>单次运行</button>
      </div> : <small>请先保存测例并冻结基线，再运行。创建与冻结不会执行命令。</small>}
      <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>刷新运行</button>
      {!runs.length && <small>暂无持久运行记录。</small>}
      {runs.map((trial) => <section key={trial.id} aria-label={`运行 ${trial.id}`} style={{ ...cardStyle, overflowWrap: "anywhere" }}>
        <strong>{trial.id} · r{trial.revision} · {trial.caseId}</strong>
        <span>执行状态：{stateLabels[trial.state]}（{trial.state}）</span>
        <span>质量：{qualityLabels[trial.quality]}（{trial.quality}）</span>
        {trial.reason && <span>原因：{trial.reason}</span>}
        <ul style={{ margin: 0, paddingLeft: 18 }}>{trial.metrics.map((metric, index) => <li key={index}>{metric.id}：{metric.value === null ? "未测" : metric.value} {metric.unit} · 来源：{sourceLabels[metric.source]}</li>)}</ul>
        {!trial.metrics.length && <small>指标：尚无测量结果。</small>}
        {trial.checks.map((check, index) => <span key={index}>{check.path}：{check.passed ? "通过" : "不通过"}{check.reason ? ` — ${check.reason}` : ""}</span>)}
        {activeStates.has(trial.state) ? <button type="button" disabled={busy || trial.cancelRequested === true} onClick={() => void send("cancel", trial)}>{trial.cancelRequested ? "取消已请求" : "取消运行"}</button> : <button type="button" disabled={busy || trial.workspaceCleaned === true} onClick={() => void send("cleanup", trial)}>{trial.workspaceCleaned ? "工作副本已清理" : "清理工作副本"}</button>}
        <TrialLogs api={api} trial={trial} />
      </section>)}
    </section>;
  }
  return function ExperimentPanel({ api }: { api?: ExtensionHostAPI }) {
    const [records, setRecords] = useState<PanelRecord[]>([]);
    const [id, setId] = useState("design-contrast");
    const [question, setQuestion] = useState("");
    const [scope, setScope] = useState(".");
    const [extra, setExtra] = useState("");
    const [casesText, setCasesText] = useState("");
    const [kind, setKind] = useState<"command" | "pi" | "browser">("command");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const pending = useRef<string | undefined>(undefined);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const alive = useRef(true);

    async function refresh() {
      if (!api?.data) return;
      try {
        const entries = (await api.data.list(DATA)).filter((entry) => /^[a-z][a-z0-9-]*\.json$/.test(entry.name));
        const next: PanelRecord[] = [];
        const errors: string[] = [];
        for (const file of entries.slice(0, 40)) {
          try {
            const data = await api.data.read(`${DATA}/${file.name}`);
            if (data.truncated) throw new Error("实验摘要超过面板读取上限。");
            const record = JSON.parse(data.content) as PanelRecord;
            if (!record || record.version !== 1 || `${record.id}.json` !== file.name || typeof record.updatedAt !== "string" || typeof record.projectRoot !== "string" || typeof record.question !== "string" || !record.budget || !Array.isArray(record.scopes) || !Array.isArray(record.includeUntracked) || !Array.isArray(record.metrics) || !Array.isArray(record.variants)) throw new Error("实验记录身份、版本或字段不匹配。");
            if (!["draft", "frozen"].includes(record.state) || !Number.isInteger(record.revision) || record.revision < 1 || !Number.isInteger(record.sequence) || record.sequence < 1 || record.scopes.some((path) => typeof path !== "string") || record.includeUntracked.some((path) => typeof path !== "string") || ![record.budget.repetitions, record.budget.concurrency, record.budget.maxTrials, record.budget.trialTimeoutMs, record.budget.totalTimeoutMs].every(Number.isFinite)) throw new Error("实验状态、范围或预算字段不完整。");
            if (record.isSummary && inventoryKinds.some((kind) => !Number.isInteger(record.inventory?.[kind]?.count) || !Number.isInteger(record.inventory?.[kind]?.pages) || record.inventory![kind].count < 0 || record.inventory![kind].pages < 0)) throw new Error("实验摘要清单计数不完整。");
            if (record.baseline && (!inventoryKinds.slice(0, 5).every((kind) => Array.isArray(record.baseline?.[kind as keyof typeof record.baseline])) || typeof record.baseline.head !== "string" || typeof record.baseline.fingerprint !== "string")) throw new Error("实验基线字段不完整。");
            if (record.metrics.some((metric) => !metric || typeof metric.id !== "string" || typeof metric.unit !== "string" || !["lower", "higher", "neutral"].includes(metric.direction)) || record.variants.some((variant) => !variant || typeof variant.id !== "string" || typeof variant.hypothesis !== "string")) throw new Error("实验指标或方案字段不完整。");
            if (record.caseCatalog !== undefined && (!Array.isArray(record.caseCatalog) || record.caseCatalog.some((entry) => !entry || typeof entry.id !== "string" || !slug.test(entry.id) || typeof entry.title !== "string"))) throw new Error("实验测例目录字段不完整。");
            next.push(record);
          } catch (cause) {
            errors.push(`${file.name}：${cause instanceof Error ? cause.message : "读取实验失败。"}`);
          }
        }
        if (entries.length > 40) errors.push("当前仅显示前40个实验，请使用 experiment 工具查找其他实验。");
        if (alive.current) {
          setRecords(next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
          if (errors.length) setError(errors.join("\n"));
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "读取实验失败。";
        if (alive.current && !/ENOENT|not found|不存在/.test(message)) setError(message);
      }
    }
    function settled() {
      pending.current = undefined;
      if (timer.current) clearTimeout(timer.current);
      if (alive.current) setBusy(false);
    }
    useEffect(() => {
      alive.current = true;
      void refresh();
      const dispose = api?.subscribeExt((event) => {
        if (event.type === "changed") void refresh();
        if (event.type !== "result") return;
        const value = event.payload as ExperimentResponse & { error?: { message: string } };
        if (!value || value.requestId !== pending.current) return;
        settled();
        if (value.error) setError(value.error.message);
        else void refresh();
      });
      return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); dispose?.(); };
    }, [api]);

    async function invoke(request: ExperimentRequest) {
      if (!api?.invoke) { setError("当前没有可用的实验控制通道，请启用扩展并打开项目会话。"); return; }
      setError("");
      setBusy(true);
      const requestId = globalThis.crypto.randomUUID();
      pending.current = requestId;
      timer.current = setTimeout(() => {
        settled();
        if (alive.current) setError("等待实验结果超时；请刷新查看持久记录，勿重复启动同一操作。");
      }, 30000);
      try {
        const result = await api.invoke(request.action, { ...request, version: 1, requestId });
        if (!result.ok) throw new Error(result.error.message);
        const direct = result.data as ExperimentResponse | undefined;
        if (direct?.version === 1 && direct.action) { settled(); await refresh(); }
      } catch (cause) {
        settled();
        if (alive.current) setError(cause instanceof Error ? cause.message : "实验操作失败。");
      }
    }
    const parsePaths = (value: string) => value.split(/\n/).map((part) => part.trim()).filter(Boolean);

    return <section aria-label="实验台" style={panelStyle}>
      <header><h2 style={{ margin: "0 0 6px", fontSize: 17 }}>实验台</h2><p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>先验证问题，再决定采用。实验是可选流程，不会自动合并原型。</p></header>
      {error && <div role="alert" style={{ ...cardStyle, borderColor: "var(--danger)" }}><div style={{ display: "flex", gap: 8, alignItems: "start" }}><span style={{ flex: 1, overflowWrap: "anywhere" }}>{error}</span><button type="button" aria-label="关闭错误" onClick={() => setError("")}>×</button></div></div>}
      <form aria-label="新建实验" style={cardStyle} onSubmit={(event) => {
        event.preventDefault();
        try {
          const cases = parseCases(casesText);
          void invoke({ action: "create", experimentId: id, question, kind, scopes: parsePaths(scope), includeUntracked: parsePaths(extra), ...(cases ? { cases } : {}) });
        } catch (cause) { setError(cause instanceof Error ? cause.message : "测例 JSON 无效。"); }
      }}>
        <label>要验证的问题<textarea style={{ ...fieldStyle, minHeight: 64, marginTop: 5 }} value={question} required maxLength={2000} placeholder="例如：宽召回是否提高定位成功率，代价是多少？" onChange={(event) => setQuestion(event.currentTarget.value)} /></label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <label style={{ flex: "1 1 150px" }}>实验标识<input style={{ ...fieldStyle, marginTop: 5 }} value={id} required maxLength={64} pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" onChange={(event) => setId(event.currentTarget.value)} /></label>
          <label style={{ flex: "1 1 120px" }}>实验类型<select style={{ ...fieldStyle, marginTop: 5 }} value={kind} onChange={(event) => setKind(event.currentTarget.value as typeof kind)}><option value="command">命令／逻辑</option><option value="pi">Pi 行为</option><option value="browser">界面原型</option></select></label>
        </div>
        <details><summary>基线范围与未跟踪文件</summary><div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
          <label>项目相对范围（每行一个，. 表示整个项目）<textarea style={fieldStyle} value={scope} onChange={(event) => setScope(event.currentTarget.value)} /></label>
          <label>明确纳入的未跟踪源码（每行一个）<textarea style={fieldStyle} value={extra} onChange={(event) => setExtra(event.currentTarget.value)} /></label>
          <small style={{ color: "var(--muted)" }}>默认包含已跟踪修改；排除凭据、项目元数据、依赖缓存和构建输出。不修改 Git index。</small>
        </div></details>
        <details><summary>高级：命令测例（可选 JSON）</summary><label>命令测例 JSON<textarea style={{ ...fieldStyle, minHeight: 110 }} value={casesText} placeholder={'[{"id":"smoke","title":"冒烟检查","command":{"executable":"node","args":["test.js"],"shell":false},"expectedExitCode":0,"checks":[],"allowedDomains":[]}]'} onChange={(event) => setCasesText(event.currentTarget.value)} /></label><small>这里只保存定义，不执行命令；也可通过自然语言请实验工具设置草稿测例。</small></details>
        <button type="submit" disabled={busy}>{busy ? "处理中…" : "创建实验草稿"}</button>
      </form>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong>本项目实验</strong><button type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>
      {records.length === 0 && <p style={{ color: "var(--muted)", margin: 0 }}>暂无实验。也可以直接对 PipiUI 说：“比较两个方案，先冻结实验基线。”</p>}
      {records.map((record) => <article key={record.id} style={cardStyle} aria-label={record.question}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 6 }}><strong style={{ overflowWrap: "anywhere" }}>{record.question}</strong><span style={{ color: "var(--muted)" }}>{record.state === "frozen" ? "已冻结" : "草稿"} · r{record.revision}</span></div>
        <code style={{ fontSize: 11, overflowWrap: "anywhere" }}>{record.id}</code>
        <div style={{ overflowWrap: "anywhere" }}>有效项目：<code>{record.projectRoot}</code></div>
        <div style={{ overflowWrap: "anywhere" }}>项目范围：{record.scopes.join("、") || "无"}</div>
        <div style={{ overflowWrap: "anywhere" }}>明确纳入的未跟踪文件：{record.includeUntracked.join("、") || "无"}</div>
        <div>指标：{record.metrics.length ? <ul style={{ margin: "4px 0", paddingLeft: 18, overflowWrap: "anywhere" }}>{record.metrics.map((metric) => <li key={metric.id}>{metric.id} · 单位：{metric.unit || "无"} · {metric.direction === "lower" ? "越低越好" : metric.direction === "higher" ? "越高越好" : "中性观察"}</li>)}</ul> : "未设置"}</div>
        <div>方案草稿：{record.variants.length ? <ul style={{ margin: "4px 0", paddingLeft: 18, overflowWrap: "anywhere" }}>{record.variants.map((variant) => <li key={variant.id}>{variant.id} — {variant.hypothesis}</li>)}</ul> : "未设置"}</div>
        <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>预算：每测例 {record.budget.repetitions} 轮，并发 {record.budget.concurrency}，最多 {record.budget.maxTrials} 次，单次 {record.budget.trialTimeoutMs / 60000} 分钟，总计 {record.budget.totalTimeoutMs / 60000} 分钟。创建与冻结不会自动运行测试。</div>
        {record.previewTruncated && <strong>摘要预览已截断；完整路径与数量请查看完整清单。</strong>}
        {record.baseline && <div style={{ display: "grid", gap: 5 }}>
          <span>源码 {inventoryCount(record, "files")} 个 · 修改 {inventoryCount(record, "dirtyPaths")} 个 · 删除 {inventoryCount(record, "removedPaths")} 个 · 未纳入的未跟踪文件 {inventoryCount(record, "omittedUntracked")} 个 · 排除 {inventoryCount(record, "excluded")} 个</span>
          <code style={{ color: "var(--muted)", fontSize: 11, overflowWrap: "anywhere" }}>基线 {record.baseline.head.slice(0, 10)} · 内容 {record.baseline.fingerprint.slice(0, 12)}</code>
          <details><summary>纳入／排除路径预览（每类最多 5 项，完整内容请查看清单）</summary>{inventoryKinds.slice(0, 5).map((kind) => <div key={kind}><strong>{inventoryLabels[kind]}（{inventoryCount(record, kind)}）</strong><ul style={{ paddingLeft: 18, overflowWrap: "anywhere" }}>{inventoryPreview(record, kind).slice(0, 5).map((item, index) => <li key={index}>{itemText(item)}</li>)}</ul>{inventoryCount(record, kind) > Math.min(5, inventoryPreview(record, kind).length) && <small>此类预览已截断。</small>}</div>)}</details>
        </div>}
        <InventoryReader key={`${record.id}-${record.sequence}`} api={api} record={record} />
        {record.kind === "command" ? <CommandTrials key={`trials-${record.id}-${record.sequence}`} api={api} record={record} /> : <small>{record.kind === "pi" ? "Pi 行为评测" : "浏览器原型验收"}适配将在后续阶段提供；当前未执行此类实验。</small>}
        <button type="button" disabled={busy} onClick={() => void invoke({ action: record.state === "draft" ? "freeze" : "revise", experimentId: record.id })}>{record.state === "draft" ? "冻结当前基线" : "创建新修订"}</button>
      </article>)}
    </section>;
  };
}
