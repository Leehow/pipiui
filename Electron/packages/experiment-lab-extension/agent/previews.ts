import { randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { atomicJson, ExperimentError, readRegular, relativePath, safeDirectory, semanticId } from "./paths.js";
import { DATA_DIRECTORY } from "./service.js";
import { sha256 } from "./snapshot.js";
import { VariantStore } from "./variants.js";

export type PreviewStart = { experimentId: string; variantId: string; revision?: number; previewId: string; entry?: string; fixturePaths?: string[] };
export type PreviewRecord = {
  version: 1; projectRoot: string; experimentId: string; variantId: string; revision: number; previewId: string;
  fingerprint: string; baselineFingerprint: string; workspace: string; entry: string; fixturePaths: string[];
  state: "starting" | "running" | "stopped" | "interrupted" | "unconfirmed" | "failed"; url?: string; createdAt: string; stoppedAt?: string;
  evidenceCount: number; verification: "unverified"; responsive: "unverified"; limitations: string[];
  coverage?: { interaction: boolean; observedBoth: boolean; screenshotsBoth: boolean };
};
/** Structural subset of the installed Pi ToolResultEvent. Never expose this as tool input. */
export type BrowserToolResultEvent = {
  type: "tool_result"; toolName: string; toolCallId: string; input: Record<string, unknown>;
  content: unknown[]; details?: unknown; isError: boolean;
};
export type BrowserEvidence = {
  toolCallId: string; receivedAt: string; action: string; target: string;
  experimentId: string; previewId: string; variantId: string; revision: number; fingerprint: string;
  pages: Array<{ target: string; url: string; viewport: { width: number; height: number }; observation: Record<string, unknown>; image?: { path: string; sha256: string; mimeType: string; tabId: string | number } }>;
  observationFingerprint: string; contentFingerprint: string;
  kind: "observation" | "interaction-observation" | "screenshot"; verdict: "unverified";
};
export type EvidenceReceipt = { accepted: true; experimentId: string; previewId: string; toolCallId: string } | { accepted: false; reason: string };
type Saved = { record: PreviewRecord; evidence: BrowserEvidence[] };
const MAX_FILE = 16 * 1024 * 1024;
const MAX_RECORD = 8 * 1024 * 1024;
const MAX_EVIDENCE = 100;
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; worker-src 'none'; frame-ancestors 'none'; sandbox allow-scripts allow-same-origin";
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const interactions = new Set(["click", "input", "type", "select", "fill_form", "scroll"]);
const observations = new Set(["navigate", "observe", "wait", "reload", "back", "forward"]);

/** Static snapshots only, not an OS sandbox or an SSR/dev-server runner. Owns no external process. */
export class PreviewCoordinator {
  private root: string;
  private readonly variants: Pick<VariantStore, "read" | "materialize">;
  private readonly active = new Map<string, { server: Server; saved: Saved }>();
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(projectRoot: string, options: { variants?: Pick<VariantStore, "read" | "materialize"> } = {}) {
    this.root = resolve(projectRoot);
    this.variants = options.variants ?? new VariantStore(projectRoot);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => undefined); return result;
  }
  private key(experimentId: string, previewId: string): string { return `${semanticId(experimentId)}/${semanticId(previewId)}`; }
  private directory(experimentId: string, previewId: string): string { this.key(experimentId, previewId); return join(this.root, DATA_DIRECTORY, experimentId, "previews", previewId); }
  private async save(saved: Saved): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(saved)) > MAX_RECORD) throw new ExperimentError("record-limit", "预览证据超过保存预算。");
    await atomicJson(this.root, join(this.directory(saved.record.experimentId, saved.record.previewId), "record.json"), saved);
  }
  private async load(experimentId: string, previewId: string): Promise<Saved> {
    this.root = await realpath(this.root);
    const directory = this.directory(experimentId, previewId);
    const saved = JSON.parse((await readRegular(this.root, join(directory, "record.json"), MAX_RECORD)).toString()) as Saved;
    const r = saved.record;
    if (!r || r.version !== 1 || r.projectRoot !== this.root || r.experimentId !== experimentId || r.previewId !== previewId || r.workspace !== join(directory, "workspace") || !Array.isArray(saved.evidence) || saved.evidence.length > MAX_EVIDENCE) throw new ExperimentError("invalid-record", "预览记录归属无效。");
    return saved;
  }
  private view(saved: Saved): PreviewRecord {
    const record = structuredClone(saved.record);
    if (["starting", "running"].includes(record.state) && !this.active.has(this.key(record.experimentId, record.previewId))) {
      record.state = "unconfirmed";
      record.limitations = [...record.limitations, "本会话不持有预览实例，不能确认其是否仍由另一会话运行，也不会按端口或记录强制停止它。"];
    }
    return record;
  }
  async get(experimentId: string, previewId: string): Promise<PreviewRecord> { return this.view(await this.load(experimentId, previewId)); }
  async list(experimentId: string): Promise<PreviewRecord[]> {
    this.root = await realpath(this.root);
    const directory = join(this.root, DATA_DIRECTORY, semanticId(experimentId), "previews");
    try { await safeDirectory(this.root, directory, false); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const entries = await readdir(directory);
    if (entries.length > 200) throw new ExperimentError("record-limit", "预览列表超过200项。");
    return Promise.all(entries.sort().map((id) => this.get(experimentId, id)));
  }
  start(input: PreviewStart): Promise<PreviewRecord> {
    return this.serial(async () => {
      if (this.closed) throw new ExperimentError("preview-closed", "本会话预览已关闭。");
      this.root = await realpath(this.root);
      const key = this.key(input.experimentId, input.previewId);
      const entry = relativePath(input.entry ?? "index.html");
      if (extname(entry).toLowerCase() !== ".html") throw new ExperimentError("unsupported-preview", "静态预览入口必须为 HTML；不启动自定义 SSR/dev-server。");
      if (!Array.isArray(input.fixturePaths ?? []) || (input.fixturePaths?.length ?? 0) > 100) throw new ExperimentError("invalid-path", "声明夹具最多100项。");
      const fixturePaths = [...new Set((input.fixturePaths ?? []).map((path) => relativePath(path)))].sort();
      const frozen = await this.variants.read(input.experimentId, semanticId(input.variantId), input.revision);
      const files = new Map(frozen.files.map((file) => [file.path, file]));
      for (const path of [entry, ...fixturePaths]) if (!files.has(path)) throw new ExperimentError("input-not-found", `入口或夹具不在冻结快照：${path}`);
      const live = this.active.get(key);
      if (live) {
        if (live.saved.record.fingerprint !== frozen.fingerprint || live.saved.record.variantId !== frozen.id || live.saved.record.revision !== frozen.revision || live.saved.record.entry !== entry || JSON.stringify(live.saved.record.fixturePaths) !== JSON.stringify(fixturePaths)) throw new ExperimentError("preview-conflict", "此预览身份已经绑定不同输入。");
        return this.view(live.saved);
      }
      const directory = this.directory(input.experimentId, input.previewId);
      await safeDirectory(this.root, join(directory, ".."));
      try { await mkdir(directory, { mode: 0o700 }); } // Never overwrite or resume another owner's instance.
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ExperimentError("preview-id-exists", "该预览身份已有记录，请使用新的 previewId；不会覆盖或复活旧实例。");
        throw error;
      }
      const workspace = join(directory, "workspace");
      const saved: Saved = { record: {
        version: 1, projectRoot: this.root, experimentId: frozen.experimentId, variantId: frozen.id, revision: frozen.revision, previewId: input.previewId,
        fingerprint: frozen.fingerprint, baselineFingerprint: frozen.baselineFingerprint, workspace, entry, fixturePaths,
        state: "starting", createdAt: new Date().toISOString(), evidenceCount: 0, verification: "unverified", responsive: "unverified",
        limitations: ["仅静态 HTML/CSS/JS/本地资源与声明夹具；不支持 SSR/dev-server。", "CSP 限制外部资源、连接和表单；不是 OS 安全沙盒。", "浏览器证据不自动判定功能或视觉通过；截图必须携带实际页面来源，旧版缺少来源时仍明确未验证。"],
      }, evidence: [] };
      let server: Server | undefined;
      try {
        await this.save(saved);
        await this.variants.materialize(frozen, workspace);
        // A per-instance URL marker prevents accepting old browser results if a port is reused.
        const marker = randomUUID();
        let authority = "";
        server = createServer((req, res) => {
          res.setHeader("Content-Security-Policy", CSP);
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Referrer-Policy", "no-referrer");
          void (async () => {
            if (req.headers.host !== authority) { res.writeHead(403).end(); return; }
            if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
            const raw = (req.url ?? "").split("?")[0];
            if (!raw.startsWith("/") || raw.startsWith("//")) throw new Error("path");
            const path = relativePath(decodeURIComponent(raw.slice(1) || entry));
            const file = files.get(path);
            if (!file) { res.writeHead(404).end(); return; }
            const data = await readRegular(this.root, join(workspace, path), MAX_FILE);
            if (data.length !== file.bytes || sha256(data) !== file.sha256) throw new Error("snapshot changed");
            res.setHeader("Content-Type", MIME[extname(path).toLowerCase()] ?? "application/octet-stream");
            res.setHeader("Content-Length", data.length);
            res.writeHead(200).end(req.method === "HEAD" ? undefined : data);
          })().catch(() => { if (!res.headersSent) res.writeHead(403); res.end(); });
        });
        server.requestTimeout = 5000; server.headersTimeout = 5000;
        await new Promise<void>((done, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", () => { server!.removeListener("error", reject); done(); }); });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("preview-listen-failed");
        authority = `127.0.0.1:${address.port}`;
        saved.record.url = `http://${authority}/${entry.split("/").map(encodeURIComponent).join("/")}?preview=${marker}`;
        saved.record.state = "running";
        await this.save(saved);
        this.active.set(key, { server, saved });
        return this.view(saved);
      } catch (error) {
        if (server?.listening) await this.close(server);
        saved.record.state = "failed"; await this.save(saved); throw error;
      }
    });
  }
  private async close(server: Server): Promise<void> {
    await new Promise<void>((done, reject) => { server.close((error) => error ? reject(error) : done()); server.closeAllConnections(); });
  }
  private async stopOwned(experimentId: string, previewId: string): Promise<PreviewRecord> {
    const key = this.key(experimentId, previewId);
    const live = this.active.get(key);
    if (!live) return this.get(experimentId, previewId); // No PID, port or disk record authorizes a stop.
    await this.close(live.server);
    this.active.delete(key);
    live.saved.record.state = "stopped"; live.saved.record.stoppedAt = new Date().toISOString();
    await this.save(live.saved);
    return this.view(live.saved);
  }
  stop(experimentId: string, previewId: string): Promise<PreviewRecord> { return this.serial(() => this.stopOwned(experimentId, previewId)); }
  shutdown(): Promise<void> {
    this.closed = true;
    return this.serial(async () => { for (const { saved } of [...this.active.values()]) await this.stopOwned(saved.record.experimentId, saved.record.previewId); });
  }
  async evidence(experimentId: string, previewId: string, options: { cursor?: number; limit?: number } = {}): Promise<{ items: BrowserEvidence[]; nextCursor: number; total: number }> {
    const cursor = options.cursor ?? 0, limit = options.limit ?? 10;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new ExperimentError("invalid-page", "证据查询 cursor 非负，limit 为1至20。");
    const saved = await this.load(experimentId, previewId);
    const items = saved.evidence.slice(cursor, cursor + limit);
    return { items, nextCursor: Math.min(cursor + items.length, saved.evidence.length), total: saved.evidence.length };
  }
  private matchingPreview(pages: BrowserEvidence["pages"]) {
    return [...this.active.values()].find(({ saved }) => pages.length > 0 && pages.every((page) => {
      try {
        const actual = new URL(page.url), expected = new URL(saved.record.url!);
        return actual.origin === expected.origin && actual.searchParams.get("preview") === expected.searchParams.get("preview");
      } catch { return false; }
    }));
  }
  private async saveEvidence(live: { server: Server; saved: Saved }, evidence: BrowserEvidence): Promise<EvidenceReceipt> {
    const existing = live.saved.evidence.find((item) => item.toolCallId === evidence.toolCallId);
    if (existing) {
      if (existing.contentFingerprint !== evidence.contentFingerprint || existing.observationFingerprint !== evidence.observationFingerprint || existing.action !== evidence.action) return { accepted: false, reason: "tool-call-conflict" };
    } else {
      if (live.saved.evidence.length >= MAX_EVIDENCE) return { accepted: false, reason: "evidence-limit" };
      const all = [...live.saved.evidence, evidence];
      const both = (item: BrowserEvidence) => item.pages.some((page) => page.target === "desktop") && item.pages.some((page) => page.target === "mobile");
      const saved: Saved = { record: { ...live.saved.record, evidenceCount: all.length, coverage: {
        interaction: all.some((item) => item.kind === "interaction-observation"),
        observedBoth: all.some((item) => item.action === "observe" && both(item)),
        screenshotsBoth: all.some((item) => item.kind === "screenshot" && both(item)),
      } }, evidence: all };
      await this.save(saved); live.saved = saved;
    }
    return { accepted: true, experimentId: evidence.experimentId, previewId: evidence.previewId, toolCallId: evidence.toolCallId };
  }
  private async recordScreenshots(event: BrowserToolResultEvent): Promise<EvidenceReceipt> {
    const reject = (reason: string): EvidenceReceipt => ({ accepted: false, reason: `evidence-unavailable: ${reason}` });
    const details = object(event.details);
    const sources = Array.isArray(details?.images) ? details.images.map(object) : [object(details?.image)];
    const images = event.content.map(object).filter((item) => item?.type === "image");
    if (!sources.length || sources.length > 2 || sources.length !== images.length) return reject("截图缺少对应的实际页面来源。");
    const pages: BrowserEvidence["pages"] = [];
    const bytes: Buffer[] = [];
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index], image = images[index];
      if (!source || !image || typeof source.url !== "string" || !["desktop", "mobile"].includes(String(source.viewport)) || !["string", "number"].includes(typeof source.tabId) || typeof source.width !== "number" || typeof source.height !== "number" || !Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0 || typeof image.data !== "string" || image.data.length > MAX_FILE * 4 / 3 + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) || image.data.length % 4 !== 0 || !["image/png", "image/jpeg", "image/webp"].includes(String(image.mimeType))) return reject("截图来源、尺寸或图片内容无效。");
      if ((image.viewport !== undefined && image.viewport !== source.viewport) || (source.base64 !== undefined && source.base64 !== image.data) || source.mimeType !== image.mimeType || pages.some((page) => page.target === source.viewport)) return reject("截图与视口来源不一致。");
      const data = Buffer.from(image.data, "base64");
      if (!data.length || data.length > MAX_FILE) return reject("截图超过读取预算。");
      bytes.push(data);
      pages.push({ target: String(source.viewport), url: source.url, viewport: { width: source.width, height: source.height }, observation: {}, image: { path: "", sha256: sha256(data), mimeType: String(image.mimeType), tabId: source.tabId as string | number } });
    }
    if (event.input?.target === "both" && (pages.length !== 2 || !pages.some((page) => page.target === "desktop") || !pages.some((page) => page.target === "mobile"))) return reject("双视口截图不完整。");
    const live = this.matchingPreview(pages);
    if (!live) return reject("没有匹配的本会话预览。");
    if (live.saved.evidence.length >= MAX_EVIDENCE && !live.saved.evidence.some((item) => item.toolCallId === event.toolCallId)) return reject("证据已达上限。");
    const directory = join(this.directory(live.saved.record.experimentId, live.saved.record.previewId), "images");
    await safeDirectory(this.root, directory);
    for (let index = 0; index < pages.length; index++) {
      const image = pages[index].image!;
      image.path = join(directory, `${image.sha256}.${image.mimeType === "image/png" ? "png" : image.mimeType === "image/jpeg" ? "jpg" : "webp"}`);
      try { await writeFile(image.path, bytes[index], { flag: "wx", mode: 0o400 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await readRegular(this.root, image.path, MAX_FILE)).equals(bytes[index])) throw error; }
    }
    const r = live.saved.record;
    return this.saveEvidence(live, { toolCallId: event.toolCallId, receivedAt: new Date().toISOString(), action: "screenshot", target: String(event.input?.target ?? "active"), experimentId: r.experimentId, previewId: r.previewId, variantId: r.variantId, revision: r.revision, fingerprint: r.fingerprint, pages, observationFingerprint: sha256(JSON.stringify(pages)), contentFingerprint: sha256(JSON.stringify(pages.map((page) => page.image!.sha256))), kind: "screenshot", verdict: "unverified" });
  }
  /** TRUST BOUNDARY: call only from pi.on('tool_result'); never pass model-supplied JSON.
   * Pi's middleware supplies input/content/details/isError, not a signed attestation.
   * No URL guessing from inputs, latest navigation, screenshot text, or eval results.
   */
  recordBrowserToolResult(event: BrowserToolResultEvent): Promise<EvidenceReceipt> {
    return this.serial(async () => {
      const reject = (reason: string): EvidenceReceipt => ({ accepted: false, reason });
      if (event.type !== "tool_result" || event.toolName !== "browser" || event.isError !== false || typeof event.toolCallId !== "string" || !event.toolCallId || event.toolCallId.length > 512) return reject("not-successful-browser-tool-result");
      const action = event.input?.action;
      if (action === "screenshot") return this.recordScreenshots(event);
      if (typeof action !== "string" || (!observations.has(action) && !interactions.has(action))) return reject("unsupported-browser-action");
      const details = object(event.details);
      if (!details || details.ok !== true || details.error || details.deferObservation === true) return reject("missing-successful-observation");
      const target = typeof event.input.target === "string" ? event.input.target : "active";
      const sources = target === "both" && action === "observe" && details.target === "both"
        ? [["desktop", object(details.desktop)], ["mobile", object(details.mobile)]] as const
        : [[target, details]] as const;
      const pages: BrowserEvidence["pages"] = [];
      for (const [label, source] of sources) {
        const viewport = object(source?.viewport);
        if (!source || source.error || source.deferObservation === true || typeof source.url !== "string" || typeof source.snapshotID !== "string" || !source.snapshotID || !viewport || typeof viewport.width !== "number" || typeof viewport.height !== "number" || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) return reject("missing-page-url-or-viewport-observation");
        pages.push({ target: label, url: source.url, viewport: { width: viewport.width, height: viewport.height }, observation: source });
      }
      const live = this.matchingPreview(pages);
      if (!live) return reject("no-matching-live-preview");
      const observationText = JSON.stringify(pages), contentText = JSON.stringify(event.content);
      if (observationText.length > 48 * 1024 || !contentText || contentText.length > 64 * 1024) return reject("evidence-limit");
      const contentFingerprint = sha256(contentText), observationFingerprint = sha256(observationText);
      const r = live.saved.record;
      return this.saveEvidence(live, { toolCallId: event.toolCallId, receivedAt: new Date().toISOString(), action, target, experimentId: r.experimentId, previewId: r.previewId, variantId: r.variantId, revision: r.revision, fingerprint: r.fingerprint, pages, contentFingerprint, observationFingerprint, kind: interactions.has(action) ? "interaction-observation" : "observation", verdict: "unverified" });
    });
  }
}
