import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PreviewCoordinator, type BrowserToolResultEvent } from "../agent/previews.js";
import { ExperimentService } from "../agent/service.js";
import { VariantStore } from "../agent/variants.js";

const roots: string[] = [], coordinators: PreviewCoordinator[] = [];
const experimentId = "page-comparison";
const exec = promisify(execFile);
function coordinator(root: string) { const value = new PreviewCoordinator(root); coordinators.push(value); return value; }
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "experiment-previews-"))); roots.push(root);
  await exec("git", ["init", "-b", "main", root]);
  const git = (...args: string[]) => exec("git", ["-C", root, ...args]);
  await git("config", "user.name", "Fixture"); await git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(root, ".gitignore"), ".pi/\n");
  await mkdir(join(root, "assets")); await mkdir(join(root, "fixtures"));
  await writeFile(join(root, "index.html"), '<!doctype html><link rel="stylesheet" href="assets/style.css"><button onclick="this.textContent=\'Clicked\'">Click</button><script src="assets/main.js"></script>');
  await writeFile(join(root, "assets/style.css"), "button { color: blue; }");
  await writeFile(join(root, "assets/main.js"), "fetch('./fixtures/data.json').then(r => r.json());");
  await writeFile(join(root, "fixtures/data.json"), '{"name":"declared fixture"}');
  await writeFile(join(root, "assets/icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await git("add", "."); await git("commit", "-m", "static fixture");
  const store = new ExperimentService(root);
  await store.create({ experimentId, question: "页面原型", variants: [{ id: "baseline", hypothesis: "静态页面" }] });
  await store.freeze(experimentId);
  const previews = coordinator(root);
  return { root, previews, input: { experimentId, variantId: "baseline", previewId: "page-one", fixturePaths: ["fixtures/data.json"] } };
}
function raw(url: string, path: string, headers?: Record<string, string>): Promise<{ status: number; text: string }> {
  return new Promise((done, reject) => {
    const req = request(new URL(url).origin, { path, headers }, (res) => { const chunks: Buffer[] = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => done({ status: res.statusCode!, text: Buffer.concat(chunks).toString() })); });
    req.on("error", reject); req.end();
  });
}
function event(url: string, action = "observe", id = "call-one"): BrowserToolResultEvent {
  return { type: "tool_result", toolName: "browser", toolCallId: id, input: { action, target: "desktop" }, isError: false,
    content: [{ type: "text", text: "browser observation" }], details: { ok: true, url, title: "Fixture", snapshotID: "snapshot-one", viewport: { width: 1280, height: 800 }, elements: [{ index: 0, role: "button", text: "Clicked" }] } };
}
afterEach(async () => {
  await Promise.all(coordinators.splice(0).map((value) => value.shutdown()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("真实静态预览与可信 browser tool_result 接缝", () => {
  it("materialize 冻结输入，实际监听127.0.0.1:0并返回页面/资源/声明夹具与CSP", async () => {
    const { root, previews, input } = await setup();
    const started = await previews.start(input);
    const frozen = await new VariantStore(root).read(experimentId, "baseline");
    expect(started).toMatchObject({ state: "running", fingerprint: frozen.fingerprint, verification: "unverified", responsive: "unverified", fixturePaths: ["fixtures/data.json"] });
    expect(started.workspace).toBe(join(root, ".pi/agent/experiments", experimentId, "previews/page-one/workspace"));
    expect(new URL(started.url!).hostname).toBe("127.0.0.1"); expect(Number(new URL(started.url!).port)).toBeGreaterThan(0);
    const response = await fetch(started.url!);
    expect(response.status).toBe(200); expect(await response.text()).toContain("<button");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'; form-action 'none'");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts allow-same-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await (await fetch(new URL("assets/style.css", started.url))).text()).toBe("button { color: blue; }");
    expect((await fetch(new URL("assets/main.js", started.url))).headers.get("content-type")).toContain("javascript");
    expect((await fetch(new URL("assets/icon.svg", started.url))).headers.get("content-type")).toBe("image/svg+xml");
    expect(await (await fetch(new URL("fixtures/data.json", started.url))).json()).toEqual({ name: "declared fixture" });
    expect((await fetch(started.url!, { method: "POST", body: "production write" })).status).toBe(405);
    expect(await previews.start(input)).toEqual(started);
    await expect(previews.start({ ...input, fixturePaths: [] })).rejects.toMatchObject({ code: "preview-conflict" });
    await writeFile(join(root, "index.html"), "later source edits");
    expect(await (await fetch(started.url!)).text()).toContain("<button");
  });

  it("拒绝穿越、符号链接、非快照文件、篡改内容、大文件和错误Host", async () => {
    const { root, previews, input } = await setup(); const started = await previews.start(input);
    for (const path of ["/../index.html", "/%2e%2e/index.html", "/assets/%2e%2e/index.html", "/assets%5cmain.js", "/%00", "//index.html"]) expect((await raw(started.url!, path)).status).toBe(403);
    expect((await raw(started.url!, "/index.html", { Host: "attacker.invalid" })).status).toBe(403);
    await writeFile(join(started.workspace, "extra.txt"), "not frozen");
    expect((await raw(started.url!, "/extra.txt")).status).toBe(404);
    await rm(join(started.workspace, "assets/main.js")); await symlink(join(root, "index.html"), join(started.workspace, "assets/main.js"));
    expect((await raw(started.url!, "/assets/main.js")).status).toBe(403);
    await rm(join(started.workspace, "assets"), { recursive: true }); await symlink(join(root, "assets"), join(started.workspace, "assets"));
    expect((await raw(started.url!, "/assets/style.css")).status).toBe(403);
    await writeFile(join(started.workspace, "index.html"), "changed"); expect((await fetch(started.url!)).status).toBe(403);
    await writeFile(join(started.workspace, "index.html"), Buffer.alloc(16 * 1024 * 1024 + 1)); expect((await fetch(started.url!)).status).toBe(403);
  });

  it("两个预览互不影响，重开只读待核实记录，停止/关闭仅本实例且保留源和证据", async () => {
    const { root, previews, input } = await setup();
    const [first, second] = await Promise.all([previews.start(input), previews.start({ ...input, previewId: "page-two" })]);
    expect(first.url).not.toBe(second.url); expect(await previews.list(experimentId)).toHaveLength(2);
    const reopened = coordinator(root);
    expect((await reopened.get(experimentId, input.previewId)).state).toBe("unconfirmed");
    expect((await reopened.stop(experimentId, input.previewId)).state).toBe("unconfirmed");
    await reopened.shutdown(); expect((await fetch(first.url!)).status).toBe(200);
    await expect(coordinator(root).start(input)).rejects.toMatchObject({ code: "preview-id-exists" });
    expect((await previews.stop(experimentId, input.previewId)).state).toBe("stopped");
    await expect(fetch(first.url!)).rejects.toThrow(); expect((await fetch(second.url!)).status).toBe(200);
    expect(await readFile(join(first.workspace, "index.html"), "utf8")).toContain("<button");
    await previews.shutdown(); await expect(fetch(second.url!)).rejects.toThrow();
    await expect(previews.start({ ...input, previewId: "page-three" })).rejects.toMatchObject({ code: "preview-closed" });
    expect((await coordinator(root).get(experimentId, "page-two")).state).toBe("stopped");
  });

  it("入口/夹具/身份必须有效；预览存储符号链接不能跨项目写", async () => {
    const { root, previews, input } = await setup();
    await expect(previews.start({ ...input, entry: "assets/main.js" })).rejects.toMatchObject({ code: "unsupported-preview" });
    await expect(previews.start({ ...input, entry: "../index.html" })).rejects.toMatchObject({ code: "invalid-path" });
    await expect(previews.start({ ...input, fixturePaths: ["missing.json"] })).rejects.toMatchObject({ code: "input-not-found" });
    await expect(previews.start({ ...input, previewId: "../other" })).rejects.toMatchObject({ code: "invalid-id" });
    await symlink(root, join(root, ".pi/agent/experiments", experimentId, "previews"));
    await expect(previews.start(input)).rejects.toMatchObject({ code: "unsafe-path" });
  });

  it("可信事件fixture关联结构观察和真实动作形状，但不把其视为功能或视觉PASS", async () => {
    const { root, previews, input } = await setup(); const started = await previews.start(input);
    expect(await previews.evidence(experimentId, input.previewId)).toEqual({ items: [], total: 0, nextCursor: 0 });
    const observation = event(started.url!);
    expect(await previews.recordBrowserToolResult(observation)).toMatchObject({ accepted: true, previewId: input.previewId });
    expect(await previews.recordBrowserToolResult(observation)).toMatchObject({ accepted: true });
    const click = event(started.url!, "click", "call-click");
    expect(await previews.recordBrowserToolResult(click)).toMatchObject({ accepted: true });
    const page = await previews.evidence(experimentId, input.previewId, { limit: 1 });
    expect(page).toMatchObject({ total: 2, nextCursor: 1 });
    expect(page.items[0]).toMatchObject({ toolCallId: "call-one", verdict: "unverified", fingerprint: started.fingerprint, pages: [{ url: started.url, viewport: { width: 1280, height: 800 } }] });
    expect(page.items[0].contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await previews.evidence(experimentId, input.previewId, { cursor: 1 })).items[0].kind).toBe("interaction-observation");
    expect(await previews.get(experimentId, input.previewId)).toMatchObject({ evidenceCount: 2, verification: "unverified", responsive: "unverified" });
    expect((await coordinator(root).evidence(experimentId, input.previewId)).total).toBe(2);
    await expect(previews.evidence(experimentId, input.previewId, { limit: 21 })).rejects.toMatchObject({ code: "invalid-page" });
  });

  it("拒绝模型PASS文本、输入URL冒充输出、eval、错误、无快照、其他预览及重复冲突", async () => {
    const { previews, input } = await setup(); const started = await previews.start(input);
    for (const invalid of [
      { ...event(started.url!), toolName: "bash" }, { ...event(started.url!), isError: true },
      { ...event(started.url!), details: {}, content: [{ type: "text", text: "PASS" }] },
      { ...event(started.url!), input: { action: "observe", url: started.url }, details: { ok: true } },
      event(started.url!, "eval"), event("https://production.invalid/"), event(started.url!.replace(/preview=[^&]+/, "preview=old-instance")),
      { ...event(started.url!), details: { ...(event(started.url!).details as object), snapshotID: undefined } },
      { ...event(started.url!), details: { ...(event(started.url!).details as object), deferObservation: true } },
    ]) expect(await previews.recordBrowserToolResult(invalid)).toMatchObject({ accepted: false });
    await previews.recordBrowserToolResult(event(started.url!));
    expect(await previews.recordBrowserToolResult({ ...event(started.url!), content: ["different"] })).toMatchObject({ accepted: false, reason: "tool-call-conflict" });
    await previews.stop(experimentId, input.previewId);
    expect(await previews.recordBrowserToolResult(event(started.url!, "click", "late-result"))).toMatchObject({ accepted: false, reason: "no-matching-live-preview" });
  });

  it("真实来源截图可保存单图/双图产物；来源错配不接受，覆盖记录不冒充PASS", async () => {
    const { previews, input } = await setup(); const started = await previews.start(input);
    const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8wAAAABJRU5ErkJggg==";
    const desktop = { url: started.url!, tabId: "tab-one", viewport: "desktop", width: 1280, height: 800, mimeType: "image/png" };
    const mobile = { ...desktop, viewport: "mobile", width: 390, height: 844 };
    const single: BrowserToolResultEvent = { type: "tool_result", toolName: "browser", toolCallId: "single-image", input: { action: "screenshot" }, isError: false,
      content: [{ type: "image", data, mimeType: "image/png", viewport: "desktop" }], details: { viewport: "desktop", image: desktop } };
    expect(await previews.recordBrowserToolResult(single)).toMatchObject({ accepted: true });
    const image = (await previews.evidence(experimentId, input.previewId)).items[0].pages[0].image!;
    expect(await readFile(image.path)).toEqual(Buffer.from(data, "base64"));
    const both: BrowserToolResultEvent = { ...single, toolCallId: "both-images", input: { action: "screenshot", target: "both" },
      content: ["desktop", "mobile"].map((viewport) => ({ type: "image", data, mimeType: "image/png", viewport })),
      details: { target: "both", images: [desktop, mobile].map((source) => ({ ...source, base64: data })) } };
    expect(await previews.recordBrowserToolResult(both)).toMatchObject({ accepted: true });
    expect(await previews.recordBrowserToolResult(both)).toMatchObject({ accepted: true });
    expect(await previews.get(experimentId, input.previewId)).toMatchObject({ evidenceCount: 2, coverage: { interaction: false, observedBoth: false, screenshotsBoth: true }, verification: "unverified", responsive: "unverified" });
    const wrongPage = structuredClone(both); wrongPage.toolCallId = "wrong-page";
    (wrongPage.details as any).images[1].url = "http://127.0.0.1:1/another";
    expect(await previews.recordBrowserToolResult(wrongPage)).toMatchObject({ accepted: false });
    const wrongViewport = structuredClone(single); wrongViewport.toolCallId = "wrong-viewport";
    (wrongViewport.content[0] as any).viewport = "mobile";
    expect(await previews.recordBrowserToolResult(wrongViewport)).toMatchObject({ accepted: false });
  });

  it("真实both观察形状可存；旧版截图无URL合同明确不可用，绝不推测双视口验收", async () => {
    const { previews, input } = await setup(); const started = await previews.start(input);
    const both = event(started.url!, "observe", "both-observe"); both.input.target = "both";
    both.details = { ok: true, target: "both", desktop: event(started.url!).details, mobile: { ...(event(started.url!).details as object), viewport: { width: 390, height: 844 } } };
    expect(await previews.recordBrowserToolResult(both)).toMatchObject({ accepted: true });
    const screenshot: BrowserToolResultEvent = { type: "tool_result", toolName: "browser", toolCallId: "both-screen", input: { action: "screenshot", target: "both" }, isError: false,
      content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png", viewport: "desktop" }, { type: "image", data: "aW1hZ2U=", mimeType: "image/png", viewport: "mobile" }],
      details: { target: "both", images: [{ viewport: "desktop", width: 1280, height: 800, base64: "aW1hZ2U=" }, { viewport: "mobile", width: 390, height: 844, base64: "aW1hZ2U=" }] } };
    expect(await previews.recordBrowserToolResult(screenshot)).toMatchObject({ accepted: false, reason: expect.stringContaining("evidence-unavailable") });
    expect((await previews.evidence(experimentId, input.previewId)).items[0].pages).toHaveLength(2);
    expect((await previews.get(experimentId, input.previewId)).responsive).toBe("unverified");
    const mismatched = structuredClone(both); mismatched.toolCallId = "mixed-page";
    (mismatched.details as any).mobile.url = "http://127.0.0.1:1/other";
    expect(await previews.recordBrowserToolResult(mismatched)).toMatchObject({ accepted: false });
  });
});
