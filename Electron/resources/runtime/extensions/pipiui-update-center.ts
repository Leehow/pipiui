import type { ExtensionAPI, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";

// Deliberately duplicated from @pipi/host-api: the embedded runtime cannot assume that
// workspace package is resolvable. The interoperability test locks these values together.
const INTENT_PREFIX = "[[PIPIUI_UPDATE_EVALUATION_INTENT]]";
const INTENT_VERSION = 1;
const MAX_ENVELOPE_LENGTH = 1024;
const MAX_FIELD_LENGTH = 160;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SAFE_ID = /^[A-Za-z0-9@._/-]+$/;
const SAFE_NAME = /^[\p{L}\p{N} @._+/-]+$/u;

type Intent = {
  version: 1;
  id: string;
  name: string;
  packageName?: string;
  currentVersion: string;
  latestVersion: string;
};

type ParsedSemver = { core: [number, number, number]; prerelease: Array<number | string> };

function parseSemver(value: string): ParsedSemver | undefined {
  const match = SEMVER.exec(value);
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".").map(part => /^\d+$/.test(part) ? Number(part) : part) ?? [],
  };
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index];
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a.localeCompare(b);
  }
  return 0;
}

function safeField(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD_LENGTH && pattern.test(value);
}

function parseIntent(text: string): Intent | undefined {
  if (text.length > MAX_ENVELOPE_LENGTH) return undefined;
  let value: unknown;
  try { value = JSON.parse(text.slice(INTENT_PREFIX.length)); } catch { return undefined; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowed = new Set(["version", "id", "name", "packageName", "currentVersion", "latestVersion"]);
  if (Object.keys(record).some(key => !allowed.has(key))) return undefined;
  if (record.version !== INTENT_VERSION) return undefined;
  if (!safeField(record.id, SAFE_ID) || !safeField(record.name, SAFE_NAME)) return undefined;
  if (record.packageName !== undefined && !safeField(record.packageName, SAFE_ID)) return undefined;
  if (typeof record.currentVersion !== "string" || typeof record.latestVersion !== "string") return undefined;
  const current = parseSemver(record.currentVersion);
  const latest = parseSemver(record.latestVersion);
  if (!current || !latest || compareSemver(latest, current) <= 0) return undefined;
  return record as Intent;
}

function componentChecks(intent: Intent): string {
  const hermes = intent.id === "pi-hermes-memory" || intent.packageName === "pi-hermes-memory";
  const pi = intent.name === "Pi" || intent.packageName === "@earendil-works/pi-coding-agent";
  const cua = intent.name === "Cua Driver" || intent.id === "cua-driver" || intent.id === "cua";
  const electron = intent.id === "electron" || intent.packageName === "electron";
  const node = intent.id === "node";
  const toolchain = intent.id === "vite" || intent.id === "electron-vite" || intent.packageName === "vite" || intent.packageName === "electron-vite";
  if (hermes) return `Hermes 专属检查：
- 保留现有 memory-broker、自动召回、角色化记忆策略和 Hermes 复核模型设置；核对 recall 行为、role 策略、数据库格式/迁移、Hermes adapter 内部 API 与配置兼容性。
- 版本 pin、lockfile、运行时 manifest 与 Hermes adapter 必须作为一个兼容面评估，并保持精确版本和 fail-soft；不兼容时建议保留旧 pin，不做猜测性适配。
- 禁止使用真实用户数据库做迁移试验，只能规划临时副本或 fixture；验收必须覆盖 memory-broker 测试/typecheck、角色策略回归、包版本/签名、主 Agent 自动召回、显式 memory_query、subagent 召回，以及仅由主 checkout 产出的 canonical Electron App。`;
  if (pi) return `Pi 专属检查：
- 核对 RPC、CLI、extension API、session format 的兼容性，以及 PipiUI 的 embedded fixed runtime、精确版本 pin 和运行时 manifest。
- 验收方案必须覆盖 clean machine 安装、离线首次运行、内置扩展加载、会话读写/恢复和 canonical Electron App。`;
  if (cua) return `Cua Driver 专属检查：
- 核对 driver protocol、tool schema、各架构 driver slices、坐标与输入语义，以及 PipiUI Computer Use 调用约定。
- 验收方案必须覆盖目标架构、TCC 权限连续性、真实屏幕/输入操作和 canonical Electron App 中的真实 Computer Use。`;
  if (electron) return `Electron 平台专属检查：
- 核对 Electron 绑定的 Chromium/Node 版本、原生模块 ABI、preload/contextIsolation、窗口与 IPC API、macOS 签名和 TCC 权限连续性。
- 必须把 node-pty 等原生依赖重建、主进程/renderer 回归、canonical Electron App 打包，以及真实窗口和 Computer Use 验收纳入方案。`;
  if (node) return `内置 Node.js 专属检查：
- 这是 PipiUI 固定打包给 Pi 的独立 Node 运行时，不得与 Electron 自带 Node 混为一谈；核对 Pi 支持范围、原生模块 ABI、launcher、双架构 embedded runtime、manifest 与离线首次运行。
- 最新大版本只代表上游最新版，不代表建议跨大版本升级；必须先给出 LTS/支持周期和依赖兼容结论，再决定目标版本。`;
  if (toolchain) return `Electron 构建工具专属检查：
- 核对 Vite 与 electron-vite 的相互兼容范围、Node 要求、插件 API、配置格式、main/preload/renderer 构建产物和开发服务器行为。
- 这是构建链更新，不是运行时扩展更新；验收必须覆盖 workspace build/test、preload 校验、canonical Electron App 打包和启动冒烟，跨大版本不得只改版本号。`;
  return `Pi 扩展专属检查：
- 核对 Pi extension API、hooks、tools、配置格式、精确版本 pins、运行时 manifest 和离线可用性。
- 验收方案必须覆盖扩展加载、工具注册与调用、配置兼容、clean machine/离线运行和 canonical Electron App。`;
}

function evaluationPrompt(intent: Intent): string {
  const target = intent.name === "Pi" ? "Pi" : intent.name;
  return `请评估 PipiUI 内置 ${target} 从 ${intent.currentVersion} 升级到 ${intent.latestVersion}，现在只做第一阶段调查，不要实施更新。

两阶段协议：
第一阶段（本次请求）：
1. 查阅官方 release notes、changelog，并在必要时检查相关源码差异；给出可核查的来源和版本范围。
2. 解释新版具体更新内容，分别列出 breaking changes、安全修复、bug fixes 和新功能；没有证据的类别明确写“未发现”，不要猜测。
3. 对照 PipiUI 当前实现、内置运行时和本地未提交修改判断兼容性与冲突，明确建议“现在更新 / 有条件更新 / 暂缓”及理由。
4. 说明升级收益，并分析新版特性可为 PipiUI 这个开源项目做哪些针对性优化；严格区分“本次升级必需兼容改动”“可选低风险优化”“应另立任务的功能或重构”。
5. 在不改文件的前提下给出准确涉及文件、实施步骤、主要风险、回退方法，以及测试、Electron 打包和真实 App 验收方案。

第二阶段（仅在用户看完评估并明确确认后）：
- 才能按获批范围实施更新、兼容改动和验收；不得把可选优化或另立任务事项顺带实现。可选优化不因本 intent 获得实施授权。

${componentChecks(intent)}

硬门槛：在用户明确确认进入第二阶段前，不得修改任何文件、安装或更新依赖、更新 lockfile、打包、commit、push 或 deploy；本次只提交调查结论和建议。`;
}

function handleInput(event: InputEvent): InputEventResult {
  if (!event.text.startsWith(INTENT_PREFIX)) return { action: "continue" };
  const intent = parseIntent(event.text);
  if (!intent) {
    return {
      action: "transform",
      text: "更新评估 intent 无效，已拒绝处理。不要执行更新、修改文件、安装依赖或任何发布操作。",
      images: event.images,
    };
  }
  return { action: "transform", text: evaluationPrompt(intent), images: event.images };
}

export default function (pi: ExtensionAPI) {
  pi.on("input", event => handleInput(event));
}
