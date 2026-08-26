import { packageRoot, resolveOfficeCliBinary, type BinaryLocator } from "./binary.js";
import {
  CommandParseError,
  gateKind,
  parseOfficeCommand,
  type GateKind,
  type ParsedOfficeCommand,
} from "./command.js";
import { officeFormatPolicy, type OfficeFormatPolicy } from "./edit-policy.js";
import { PathValidationError, recheckValidatedPath, validateDocumentPath, type ValidatedPath } from "./paths.js";
import { OFFICECLI_WRITE_ATOMICITY } from "./provenance.js";
import {
  sdkOptions,
  loadOfficeCliSdk,
  type BatchItem,
  type DocumentHandle,
  type OfficeCliSdk,
  type SdkResult,
} from "./sdk.js";

export const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const DEFAULT_OUTPUT_LIMIT = 64 * 1024;
export const DEFAULT_DIAGNOSTIC_LIMIT = 8 * 1024;
const CLEANUP_MS = 80;

export type OfficeCommandInput = { command: string | string[] };

export type DirectOfficeErrorCode =
  | "ok"
  | "invalid_command"
  | "unknown_verb"
  | "control_chars"
  | "path_rejected"
  | "unsupported_extension"
  | "read_only_format"
  | "binary_missing"
  | "timeout"
  | "cancelled"
  | "crashed"
  | "sdk_error"
  | "command_failed"
  | "disposed";

export type GateMetadata = {
  kind: GateKind;
  targetPaths: string[];
  isCreate: boolean;
  isWrite: boolean;
  isQualifyingScreenshot: boolean;
  policies: Array<Pick<OfficeFormatPolicy, "extension" | "tier" | "editContract" | "macroContainer" | "shotGateCovered" | "writesAllowed">>;
};

export type WriteSemantics = {
  flush: typeof OFFICECLI_WRITE_ATOMICITY.flush;
  atomicRename: false;
  limitation: typeof OFFICECLI_WRITE_ATOMICITY.limitation;
  persisted?: boolean;
};

export type DirectOfficeResult = {
  ok: boolean;
  code: DirectOfficeErrorCode;
  message: string;
  argv: string[];
  stdout: string;
  stderr: string;
  truncated: { stdout: boolean; stderr: boolean; diagnostics: boolean };
  gate: GateMetadata;
  writeSemantics?: WriteSemantics;
  pathReason?: string;
  diagnostics: string;
};

export type DirectOfficeAdapterOptions = {
  projectRoot: string;
  extensionRoot?: string;
  packaged?: boolean;
  locateBinary?: BinaryLocator;
  sdk?: OfficeCliSdk;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  startupTimeoutMs?: number;
  commandTimeoutMs?: number;
  outputLimit?: number;
  diagnosticLimit?: number;
};

const emptyGate = (): GateMetadata => ({
  kind: "other",
  targetPaths: [],
  isCreate: false,
  isWrite: false,
  isQualifyingScreenshot: false,
  policies: [],
});

function cap(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

function stringifySdk(value: SdkResult | unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isFailureEnvelope(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (value as { success?: unknown }).success === false;
}

function failureMessage(value: Record<string, unknown>): string {
  for (const key of ["error", "message", "stderr", "reason"]) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item;
  }
  return "officecli command failed";
}

function coded(code: DirectOfficeErrorCode, message: string): Error & { code: DirectOfficeErrorCode } {
  const err = new Error(message) as Error & { code: DirectOfficeErrorCode };
  err.code = code;
  return err;
}

function toBatchItem(parsed: ParsedOfficeCommand, validated: ValidatedPath[]): BatchItem {
  const item: BatchItem = { command: parsed.verb };
  if (parsed.verb === "merge") {
    item.template = validated[0]?.absolute;
    item.output = validated[1]?.absolute;
    const data = parsed.flags.get("data");
    if (data !== undefined) item.data = data;
    if (parsed.flags.get("force") === true) item.force = true;
    return item;
  }
  if (parsed.verb === "import") {
    item.path = validated[0]?.absolute;
    if (parsed.positionals[2]) item.parent = parsed.positionals[2];
    if (validated[1]) item.source = validated[1].absolute;
    for (const key of ["format", "header", "stdin", "start-cell"] as const) {
      const value = parsed.flags.get(key);
      if (value !== undefined) item[key] = value;
    }
    return item;
  }
  if (parsed.verb === "view" && parsed.positionals[2]) item.mode = parsed.positionals[2];
  // `add`/`add-part` take a PARENT target: the resident defaults a missing
  // `parent` to /body (verified against officecli 1.0.144 — "Invalid parent
  // '/body' for --type slide"), so mapping the positional to `path` silently
  // retargets every add to the docx body. T6 parity evidence:
  // docs/office/direct-mcp-parity-v1.json.
  else if ((parsed.verb === "add" || parsed.verb === "add-part") && parsed.positionals[2]) item.parent = parsed.positionals[2];
  else if (parsed.positionals[2]) item.path = parsed.positionals[2];
  if (parsed.positionals[3] && parsed.verb !== "view") item.type = parsed.positionals[3];
  const props: Record<string, unknown> = {};
  for (const [key, value] of parsed.flags) {
    if (key === "prop" && typeof value === "string") {
      const eq = value.indexOf("=");
      if (eq === -1) props[value] = true;
      else props[value.slice(0, eq)] = value.slice(eq + 1);
    } else if (key === "json" && parsed.verb === "batch") {
      item.batchJson = value;
    } else {
      item[key] = value === true ? true : value;
    }
  }
  if (Object.keys(props).length) item.props = props;
  return item;
}

async function withDeadline<T>(promise: Promise<T>, ms: number, signal: AbortSignal | undefined, onTimeout: () => void): Promise<T> {
  if (signal?.aborted) throw coded("cancelled", "cancelled");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(coded("timeout", "timeout"));
    }, ms);
  });
  const abort = signal
    ? new Promise<never>((_, reject) => {
        const onAbort = () => reject(coded("cancelled", "cancelled"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      })
    : undefined;
  try {
    const racers: Promise<T>[] = [promise, timeout as Promise<T>];
    if (abort) racers.push(abort as Promise<T>);
    return await Promise.race(racers);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class DirectOfficeAdapter {
  private readonly projectRoot: string;
  private readonly options: DirectOfficeAdapterOptions;
  private readonly sdk: OfficeCliSdk;
  private readonly outputLimit: number;
  private readonly diagnosticLimit: number;
  private readonly startupTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly docs = new Map<string, DocumentHandle>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private crashed = false;
  private disposed = false;
  private disposing: Promise<void> | null = null;
  private processGeneration = 0;

  constructor(options: DirectOfficeAdapterOptions) {
    this.options = options;
    this.projectRoot = options.projectRoot;
    this.sdk = options.sdk ?? loadOfficeCliSdk();
    this.outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
    this.diagnosticLimit = options.diagnosticLimit ?? DEFAULT_DIAGNOSTIC_LIMIT;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  }

  get residentGenerations(): number {
    return this.processGeneration;
  }

  async execute(input: OfficeCommandInput, signal?: AbortSignal): Promise<DirectOfficeResult> {
    if (this.disposed) return this.fail("disposed", "adapter is disposed", [], emptyGate());
    let parsed: ParsedOfficeCommand;
    try {
      parsed = parseOfficeCommand(input.command);
    } catch (error) {
      if (error instanceof CommandParseError) return this.fail(error.code, error.message, [], emptyGate());
      throw error;
    }

    const gateBase = {
      kind: gateKind(parsed),
      isCreate: parsed.isCreate,
      isWrite: parsed.isWrite,
      isQualifyingScreenshot: parsed.isQualifyingScreenshot,
    };

    let validated: ValidatedPath[] = [];
    try {
      validated = await Promise.all(
        parsed.pathSpecs.map((spec) =>
          validateDocumentPath(spec.raw, this.projectRoot, {
            mustExist: spec.mustExist,
            requireOfficeExtension: spec.requireOfficeExtension,
          }),
        ),
      );
    } catch (error) {
      if (error instanceof PathValidationError) {
        const code = error.reason === "unsupported_extension" ? "unsupported_extension" : "path_rejected";
        return this.fail(code, error.message, parsed.argv, { ...gateBase, targetPaths: [], policies: [] }, error.reason);
      }
      throw error;
    }

    const policies = validated
      .filter((_, index) => parsed.pathSpecs[index]?.requireOfficeExtension)
      .map((item) => officeFormatPolicy(item.extension))
      .filter((row): row is OfficeFormatPolicy => Boolean(row));
    const gate: GateMetadata = {
      ...gateBase,
      targetPaths: validated.map((item) => item.absolute),
      policies: policies.map((row) => ({
        extension: row.extension,
        tier: row.tier,
        editContract: row.editContract,
        macroContainer: row.macroContainer,
        shotGateCovered: row.shotGateCovered,
        writesAllowed: row.writesAllowed,
      })),
    };

    if (parsed.isWrite) {
      for (const [index, spec] of parsed.pathSpecs.entries()) {
        if (!spec.requireOfficeExtension) continue;
        if (parsed.verb === "merge" && index === 0) continue;
        const policy = officeFormatPolicy(validated[index]!.extension);
        if (policy && !policy.writesAllowed) {
          return this.fail(
            "read_only_format",
            `writes are not allowed for ${policy.extension} (${policy.tier}; macros never execute)`,
            parsed.argv,
            gate,
          );
        }
      }
    }

    const binary = resolveOfficeCliBinary({
      extensionRoot: this.options.extensionRoot ?? packageRoot(),
      packaged: this.options.packaged,
      locateBinary: this.options.locateBinary,
      env: this.options.env,
      platform: this.options.platform,
      arch: this.options.arch,
    });
    if (!binary) {
      return this.fail("binary_missing", "OfficeCLI binary is not available (no locator, bundled candidate, or dev override)", parsed.argv, gate);
    }

    const keys = gate.targetPaths.length ? [...new Set(gate.targetPaths)].sort() : ["__session__"];
    try {
      const outcome = await this.enqueue(keys, () => this.runSdk(binary, parsed, validated, signal));
      if (isFailureEnvelope(outcome.payload)) {
        return this.fail("command_failed", failureMessage(outcome.payload), parsed.argv, gate);
      }
      const stdout = cap(stringifySdk(outcome.payload), this.outputLimit);
      return {
        ok: true,
        code: "ok",
        message: "ok",
        argv: parsed.argv,
        stdout: stdout.text,
        stderr: "",
        truncated: { stdout: stdout.truncated, stderr: false, diagnostics: false },
        gate,
        writeSemantics: parsed.isWrite
          ? { ...OFFICECLI_WRITE_ATOMICITY, persisted: outcome.persisted }
          : undefined,
        diagnostics: "",
      };
    } catch (error) {
      if (error instanceof PathValidationError) {
        const code = error.reason === "unsupported_extension" ? "unsupported_extension" : "path_rejected";
        return this.fail(code, error.message, parsed.argv, gate, error.reason);
      }
      const code = (error as { code?: DirectOfficeErrorCode }).code;
      if (code === "timeout" || code === "cancelled" || code === "crashed" || code === "disposed" || code === "command_failed") {
        return this.fail(code, (error as Error).message, parsed.argv, gate);
      }
      return this.fail("sdk_error", error instanceof Error ? error.message : String(error), parsed.argv, gate);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.disposing = (async () => {
      const handles = [...this.docs.values()];
      this.docs.clear();
      await Promise.race([
        Promise.all(handles.map((doc) => Promise.resolve(doc.close()).catch(() => undefined))),
        new Promise<void>((resolve) => setTimeout(resolve, this.commandTimeoutMs)),
      ]);
    })();
    await this.disposing;
  }

  private fail(
    code: DirectOfficeErrorCode,
    message: string,
    argv: string[],
    gate: GateMetadata,
    pathReason?: string,
  ): DirectOfficeResult {
    const diagnostics = cap(message, this.diagnosticLimit);
    return {
      ok: false,
      code,
      message: diagnostics.text,
      argv,
      stdout: "",
      stderr: diagnostics.text,
      truncated: { stdout: false, stderr: diagnostics.truncated, diagnostics: diagnostics.truncated },
      gate,
      pathReason,
      diagnostics: diagnostics.text,
    };
  }

  private enqueue<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const run = async (remaining: string[]): Promise<T> => {
      if (remaining.length === 0) return fn();
      const [head, ...tail] = remaining;
      const prev = this.queues.get(head!) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.queues.set(head!, prev.then(() => gate, () => gate));
      await prev.catch(() => undefined);
      try {
        return await run(tail);
      } finally {
        release();
      }
    };
    return run(keys);
  }

  /** Never await an unbounded SDK close on the response path. */
  private discardHandle(key: string | undefined, handle?: DocumentHandle): void {
    if (key) this.docs.delete(key);
    this.crashed = true;
    if (!handle) return;
    void Promise.race([
      Promise.resolve(handle.close()).catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_MS)),
    ]);
  }

  private async runSdk(
    binary: string,
    parsed: ParsedOfficeCommand,
    validated: ValidatedPath[],
    signal: AbortSignal | undefined,
  ): Promise<{ payload: SdkResult; persisted?: boolean }> {
    if (this.disposed) throw coded("disposed", "disposed");
    if (parsed.verb === "help") return { payload: { success: true, verb: "help" } };

    const primary = validated[0];
    if (!primary) return { payload: { success: true } };

    let handle: DocumentHandle | undefined;
    try {
      handle = await withDeadline(
        this.ensureDocument(binary, primary, parsed),
        this.startupTimeoutMs,
        signal,
        () => this.discardHandle(primary.absolute),
      );
    } catch (error) {
      this.discardHandle(primary.absolute, handle);
      throw error;
    }

    if (parsed.verb === "close" || parsed.verb === "save") {
      try {
        const closed = await withDeadline(handle.close(), this.commandTimeoutMs, signal, () => this.discardHandle(primary.absolute, handle));
        this.docs.delete(primary.absolute);
        return { payload: closed, persisted: true };
      } catch (error) {
        this.discardHandle(primary.absolute, handle);
        throw error;
      }
    }

    if (parsed.verb === "create" && validated.length === 1) {
      await this.recheckWrites(validated, parsed);
      return { payload: { success: true, path: handle.path }, persisted: true };
    }

    const item = toBatchItem(parsed, validated);
    // `view … screenshot` must go as JSON: the resident returns the rendered
    // PNG path only in the JSON envelope for some formats (pptx returns an
    // empty Stdout in text mode — verified against officecli 1.0.144), while
    // the CLI one-shot path always prints it. T6 parity evidence:
    // docs/office/direct-mcp-parity-v1.json.
    const screenshotMode = parsed.verb === "view" && (parsed.positionals[2] ?? "").toLowerCase() === "screenshot";
    try {
      const result = await withDeadline(
        handle.send(item, parsed.asJson || screenshotMode, this.commandTimeoutMs),
        this.commandTimeoutMs,
        signal,
        () => this.discardHandle(primary.absolute, handle),
      );
      if (isFailureEnvelope(result)) return { payload: result, persisted: false };
      let persisted = !parsed.isWrite;
      if (parsed.isWrite && parsed.verb !== "save") {
        try {
          const saved = await withDeadline(
            handle.send({ command: "save" }, true, this.commandTimeoutMs),
            this.commandTimeoutMs,
            signal,
            () => this.discardHandle(primary.absolute, handle),
          );
          persisted = !isFailureEnvelope(saved);
        } catch {
          persisted = false;
        }
      }
      if (parsed.isWrite) await this.recheckWrites(validated, parsed);
      return { payload: result, persisted };
    } catch (error) {
      const code = (error as { code?: DirectOfficeErrorCode }).code;
      if (code === "timeout" || code === "cancelled") this.discardHandle(primary.absolute, handle);
      throw error;
    }
  }

  private async recheckWrites(validated: ValidatedPath[], parsed: ParsedOfficeCommand): Promise<void> {
    for (const [index, spec] of parsed.pathSpecs.entries()) {
      if (!parsed.isWrite) continue;
      if (parsed.verb === "merge" && index === 0) continue;
      const target = validated[index];
      if (!target || !spec.requireOfficeExtension) continue;
      await recheckValidatedPath({ ...target, mustExist: parsed.verb !== "create" || index > 0 ? target.mustExist : false }, this.projectRoot);
    }
  }

  private async ensureDocument(binary: string, target: ValidatedPath, parsed: ParsedOfficeCommand): Promise<DocumentHandle> {
    if (this.crashed) {
      this.docs.clear();
      this.crashed = false;
    }
    const checked = await recheckValidatedPath(target, this.projectRoot);
    const existing = this.docs.get(checked.absolute);
    if (existing) {
      try {
        if (await existing.alive()) return existing;
      } catch {
        /* restart */
      }
      this.docs.delete(checked.absolute);
      this.crashed = false;
    }

    const opts = sdkOptions(binary, this.startupTimeoutMs);
    this.processGeneration += 1;
    const doc =
      parsed.verb === "create"
        ? await this.sdk.create(checked.absolute, createArgs(parsed), opts)
        : await this.sdk.open(checked.absolute, opts);
    this.docs.set(checked.absolute, doc);
    return doc;
  }
}

function createArgs(parsed: ParsedOfficeCommand): string[] {
  const args: string[] = [];
  for (const [key, value] of parsed.flags) {
    if (value === true) args.push(`--${key}`);
    else args.push(`--${key}`, String(value));
  }
  return args;
}

export function createDirectOfficeAdapter(options: DirectOfficeAdapterOptions): DirectOfficeAdapter {
  return new DirectOfficeAdapter(options);
}
