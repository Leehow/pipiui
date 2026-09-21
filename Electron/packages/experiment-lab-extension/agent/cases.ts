import type { CommandCase, CommandSpec, FileAssertion } from "../contracts.js";
import { ExperimentError, relativePath, semanticId } from "./paths.js";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function commandSpec(value: unknown): CommandSpec {
  if (!object(value) || typeof value.executable !== "string" || !value.executable.trim() || value.executable.length > 8192 || value.executable.includes("\0")) throw new ExperimentError("invalid-command", "命令需要明确 executable，且不能含 NUL。");
  const args = value.args ?? [];
  if (!Array.isArray(args) || args.length > 64 || args.some((arg) => typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"))) throw new ExperimentError("invalid-command", "args 必须是至多64个有界字符串。");
  if (value.shell !== undefined && typeof value.shell !== "boolean") throw new ExperimentError("invalid-command", "shell 必须为布尔值。");
  if (value.shell === true && args.length) throw new ExperimentError("invalid-command", "shell 模式将完整脚本放在 executable，不能混用 args。");
  return { executable: value.executable, args: args as string[], shell: value.shell === true };
}

export function commandCases(value: unknown): CommandCase[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new ExperimentError("invalid-case", "首版每个实验最多20个测例。");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!object(item)) throw new ExperimentError("invalid-case", "测例必须是对象。");
    const id = semanticId(item.id);
    if (ids.has(id)) throw new ExperimentError("invalid-case", "测例身份不能重复。");
    ids.add(id);
    const title = item.title ?? id;
    if (typeof title !== "string" || !title.trim() || title.length > 240) throw new ExperimentError("invalid-case", "测例名称应为1至240字符。");
    const expectedExitCode = item.expectedExitCode ?? 0;
    if (!Number.isInteger(expectedExitCode) || Number(expectedExitCode) < 0 || Number(expectedExitCode) > 255) throw new ExperimentError("invalid-case", "期望退出码须为0至255的整数。");
    const rawChecks = item.checks ?? [];
    if (!Array.isArray(rawChecks) || rawChecks.length > 16) throw new ExperimentError("invalid-check", "文件检查最多16项。");
    const checks: FileAssertion[] = rawChecks.map((check) => {
      if (!object(check)) throw new ExperimentError("invalid-check", "检查必须是对象。");
      const path = relativePath(check.path);
      if (check.expectedText !== undefined && (typeof check.expectedText !== "string" || Buffer.byteLength(check.expectedText) > 4096)) throw new ExperimentError("invalid-check", "大文件请使用 SHA-256，不内联超过4KiB的期望文本。");
      if (check.sha256 !== undefined && (typeof check.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(check.sha256))) throw new ExperimentError("invalid-check", "sha256 必须为64位小写十六进制。");
      return { path, ...(check.expectedText !== undefined ? { expectedText: check.expectedText as string } : {}), ...(check.sha256 !== undefined ? { sha256: check.sha256 as string } : {}) };
    });
    const domains = item.allowedDomains ?? [];
    if (!Array.isArray(domains) || domains.length > 16 || domains.some((domain) => typeof domain !== "string" || domain.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/.test(domain) || (domain.includes(":") && Number(domain.split(":")[1]) > 65535))) throw new ExperimentError("invalid-domain", "仅支持明确的主机名/IP和可选端口，不支持URL、通配符或用户信息。");
    const result: CommandCase = {
      id, title: title.trim(), command: commandSpec(item.command),
      ...(item.prepare !== undefined ? { prepare: commandSpec(item.prepare) } : {}),
      expectedExitCode: Number(expectedExitCode), checks,
      ...(item.metricsFile !== undefined ? { metricsFile: relativePath(item.metricsFile) } : {}),
      allowedDomains: [...new Set(domains)] as string[],
    };
    if (Buffer.byteLength(JSON.stringify(result)) > 12 * 1024) throw new ExperimentError("case-limit", "单个测例定义最多12KiB；请使用冻结源码中的脚本或哈希检查。");
    return result;
  });
}
