import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PIPIUI_OFFICECLI_BINARY_ENV = "PIPIUI_OFFICECLI_BINARY";
export const OFFICECLI_RECEIPT_NAME = "receipt.json";

export type OfficeCliReceipt = {
  version: string;
  asset: string;
  sha256: string;
  target: string;
  bytes: number;
  generatedAt?: string;
};

export type BinaryLocator = () => string | null | undefined;

export type ResolveBinaryOptions = {
  extensionRoot?: string;
  packaged?: boolean;
  locateBinary?: BinaryLocator;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
};

export function packageRoot(from = import.meta.url): string {
  return dirname(dirname(fileURLToPath(from)));
}

export function bundledOfficeCliCandidate(options: {
  extensionRoot: string;
  platform?: NodeJS.Platform;
  arch?: string;
}): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const name = platform === "win32" ? "officecli.exe" : "officecli";
  return join(options.extensionRoot, "bin", `${platform}-${arch}`, name);
}

function isUsableBinary(path: string): boolean {
  if (!path || !isAbsolute(path)) return false;
  if (basename(path) === OFFICECLI_RECEIPT_NAME) return false;
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    return true;
  } catch {
    return false;
  }
}

/** Machine-readable receipt beside the binary. Never treat it as the executable. */
export function readOfficeCliReceipt(binaryPath: string): OfficeCliReceipt | null {
  if (!binaryPath || basename(binaryPath) === OFFICECLI_RECEIPT_NAME) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(dirname(binaryPath), OFFICECLI_RECEIPT_NAME), "utf8")) as Partial<OfficeCliReceipt>;
    if (
      typeof parsed.version !== "string" ||
      typeof parsed.asset !== "string" ||
      typeof parsed.sha256 !== "string" ||
      typeof parsed.target !== "string" ||
      typeof parsed.bytes !== "number"
    ) {
      return null;
    }
    return parsed as OfficeCliReceipt;
  } catch {
    return null;
  }
}

/**
 * Resolve the OfficeCLI native binary.
 * Order: injected locator → bundled bin/<platform>-<arch>/officecli →
 * dev-only PIPIUI_OFFICECLI_BINARY when not packaged.
 * Never PATH, never ~/.local/bin, never network, never MCP config.
 */
export function resolveOfficeCliBinary(options: ResolveBinaryOptions = {}): string | null {
  if (options.locateBinary) {
    const injected = options.locateBinary();
    if (typeof injected === "string") return isUsableBinary(injected) ? injected : null;
    if (injected === null) return null;
  }

  const extensionRoot = options.extensionRoot ?? packageRoot();
  const bundled = bundledOfficeCliCandidate({
    extensionRoot,
    platform: options.platform,
    arch: options.arch,
  });
  if (existsSync(bundled) && isUsableBinary(bundled)) return bundled;

  const packaged = options.packaged ?? false;
  if (!packaged) {
    const env = options.env ?? process.env;
    const override = env[PIPIUI_OFFICECLI_BINARY_ENV]?.trim();
    if (override && isUsableBinary(override)) return override;
  }
  return null;
}
