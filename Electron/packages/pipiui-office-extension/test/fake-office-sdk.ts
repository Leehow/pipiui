import type { BatchItem, DocumentHandle, OfficeCliSdk, OpenOptions, SdkResult } from "../agent/sdk.js";

export type FakeSendHook = (item: BatchItem, doc: FakeDocument) => Promise<SdkResult> | SdkResult;

export type FakeOfficeSdk = OfficeCliSdk & {
  opens: number;
  creates: number;
  sends: BatchItem[];
  closed: string[];
  processStarts: number;
  autoInstallSeen: boolean[];
  binaries: string[];
  crash(): void;
  hangNext: boolean;
  hangClose: boolean;
  sendDelayMs: number;
  inflight: number;
  maxInflight: number;
  inflightByPath: Map<string, number>;
  maxInflightByPath: Map<string, number>;
  sendHook?: FakeSendHook;
  _dead: boolean;
};

export class FakeDocument implements DocumentHandle {
  closed = false;
  constructor(
    readonly path: string,
    private readonly sdk: FakeOfficeSdk,
  ) {}

  async send(item: BatchItem, _asJson?: boolean, _timeoutMs?: number): Promise<SdkResult> {
    this.sdk.sends.push(item);
    this.sdk.inflight += 1;
    this.sdk.maxInflight = Math.max(this.sdk.maxInflight, this.sdk.inflight);
    const current = (this.sdk.inflightByPath.get(this.path) ?? 0) + 1;
    this.sdk.inflightByPath.set(this.path, current);
    this.sdk.maxInflightByPath.set(this.path, Math.max(this.sdk.maxInflightByPath.get(this.path) ?? 0, current));
    try {
      if (this.sdk.hangNext) {
        return await new Promise<SdkResult>(() => undefined);
      }
      if (this.sdk.sendDelayMs) await new Promise((resolve) => setTimeout(resolve, this.sdk.sendDelayMs));
      if (this.sdk.sendHook) return await this.sdk.sendHook(item, this);
      if (this.closed) throw Object.assign(new Error("closed"), { code: -1 });
      return { success: true, command: item.command, path: this.path };
    } finally {
      this.sdk.inflight -= 1;
      this.sdk.inflightByPath.set(this.path, (this.sdk.inflightByPath.get(this.path) ?? 1) - 1);
    }
  }

  async batch(items: BatchItem[]): Promise<SdkResult> {
    return this.send({ command: "batch", items });
  }

  async alive(): Promise<boolean> {
    return !this.closed && this.sdk.processStarts > 0 && !this.sdk._dead;
  }

  async close(): Promise<SdkResult> {
    this.closed = true;
    this.sdk.closed.push(this.path);
    if (this.sdk.hangClose) return await new Promise<SdkResult>(() => undefined);
    return { success: true };
  }
}

class OfficeCliError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.name = "OfficeCliError";
    this.code = code;
  }
}

export function createFakeOfficeSdk(): FakeOfficeSdk {
  const docs = new Map<string, FakeDocument>();
  const sdk: FakeOfficeSdk = {
    opens: 0,
    creates: 0,
    sends: [],
    closed: [],
    processStarts: 0,
    autoInstallSeen: [],
    binaries: [],
    hangNext: false,
    hangClose: false,
    sendDelayMs: 0,
    inflight: 0,
    maxInflight: 0,
    inflightByPath: new Map(),
    maxInflightByPath: new Map(),
    _dead: false,
    OfficeCliError,
    crash() {
      sdk._dead = true;
      docs.clear();
    },
    async create(filePath: string, _args?: string[], options?: OpenOptions) {
      note(options);
      start();
      sdk.creates += 1;
      const doc = new FakeDocument(filePath, sdk);
      docs.set(filePath, doc);
      return doc;
    },
    async open(filePath: string, options?: OpenOptions) {
      note(options);
      start();
      sdk.opens += 1;
      const existing = docs.get(filePath);
      if (existing && !existing.closed && !sdk._dead) return existing;
      const doc = new FakeDocument(filePath, sdk);
      docs.set(filePath, doc);
      return doc;
    },
  } as FakeOfficeSdk;

  function note(options?: OpenOptions) {
    sdk.autoInstallSeen.push(options?.autoInstall === true);
    if (options?.binary) sdk.binaries.push(options.binary);
  }

  function start() {
    if (sdk._dead) {
      sdk._dead = false;
      sdk.processStarts += 1;
      return;
    }
    if (sdk.processStarts === 0) sdk.processStarts += 1;
  }

  return sdk;
}
