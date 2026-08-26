import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Mirrors @officecli/sdk@0.1.2 index.d.ts — do not invent extra methods. */
export interface BatchItem {
  command?: string;
  op?: string;
  path?: string;
  parent?: string;
  type?: string;
  index?: number | string;
  after?: string;
  before?: string;
  to?: string;
  selector?: string;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

export type SdkResult = Record<string, unknown> | unknown[] | string;

export interface OpenOptions {
  binary?: string;
  timeoutMs?: number;
  autoInstall?: boolean;
}

export interface BatchOptions {
  force?: boolean;
  stopOnError?: boolean;
  timeoutMs?: number;
}

export interface DocumentHandle {
  readonly path: string;
  send(item: BatchItem, asJson?: boolean, timeoutMs?: number): Promise<SdkResult>;
  batch(items: BatchItem[], options?: BatchOptions): Promise<SdkResult>;
  alive(timeoutMs?: number): Promise<boolean>;
  close(): Promise<SdkResult>;
}

export interface OfficeCliErrorLike extends Error {
  code: number;
}

export interface OfficeCliSdk {
  create(filePath: string, args?: string[], options?: OpenOptions): Promise<DocumentHandle>;
  open(filePath: string, options?: OpenOptions): Promise<DocumentHandle>;
  OfficeCliError: new (code: number, msg: string) => OfficeCliErrorLike;
  install?: () => void;
  Document?: unknown;
  pipePaths?: (filePath: string) => [string, string];
}

export const SDK_FORCED_OPEN_OPTIONS: Pick<OpenOptions, "autoInstall"> = { autoInstall: false };

export const OFFICECLI_SKIP_UPDATE_ENV = "OFFICECLI_SKIP_UPDATE";

/** Stable process-level invariant: OfficeCLI must not self-update or download. */
export function ensureOfficeCliUpdateDisabled(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env[OFFICECLI_SKIP_UPDATE_ENV] !== "1") env[OFFICECLI_SKIP_UPDATE_ENV] = "1";
  return env;
}

export function loadOfficeCliSdk(): OfficeCliSdk {
  ensureOfficeCliUpdateDisabled();
  const require = createRequire(import.meta.url);
  try {
    return require("@officecli/sdk") as OfficeCliSdk;
  } catch {
    const bundled = join(dirname(fileURLToPath(import.meta.url)), "officecli-sdk.cjs");
    if (!existsSync(bundled)) throw new Error("@officecli/sdk is not available");
    return require(bundled) as OfficeCliSdk;
  }
}

export function sdkOptions(binary: string, timeoutMs: number): OpenOptions {
  return { binary, timeoutMs, autoInstall: false };
}
