import { existsSync, promises as fs, readFileSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

export const LEASE_PROTOCOL_VERSION = 1;
export const DEFAULT_HEARTBEAT_MS = 15_000;
export const DEFAULT_TTL_MS = 45_000;

export type LeaseRecord = {
  protocolVersion: typeof LEASE_PROTOCOL_VERSION;
  holder: string;
  pid: number;
  hostname: string;
  instanceId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
};
export type LeaseStatus = { sessionId: string; writable: boolean; holder?: LeaseRecord };
export type LeaseManagerOptions = {
  sessionId: string;
  sessionPath: string;
  holder?: string;
  pid?: number;
  hostname?: string;
  heartbeatMs?: number;
  ttlMs?: number;
  now?: () => number;
};

/** Coordinates a single JSONL writer shared by Electron and the future Swift host. */
export class LeaseManager {
  readonly sessionId: string;
  readonly leasePath: string;
  private readonly holder: string;
  private readonly pid: number;
  private readonly host: string;
  private readonly heartbeatMs: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly instanceId = crypto.randomUUID();
  private timer?: NodeJS.Timeout;
  private owned = false;

  constructor(options: LeaseManagerOptions) {
    this.sessionId = options.sessionId;
    this.leasePath = join(dirname(options.sessionPath), `${options.sessionId}.lease.json`);
    this.holder = options.holder ?? "pipiui-electron";
    this.pid = options.pid ?? process.pid;
    this.host = options.hostname ?? hostname();
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    process.once("exit", () => this.releaseSync());
  }

  private record(): LeaseRecord {
    const timestamp = new Date(this.now()).toISOString();
    return { protocolVersion: LEASE_PROTOCOL_VERSION, holder: this.holder, pid: this.pid, hostname: this.host, instanceId: this.instanceId, acquiredAt: timestamp, heartbeatAt: timestamp, expiresAt: new Date(this.now() + this.ttlMs).toISOString() };
  }
  private async read(): Promise<LeaseRecord | undefined> {
    try { return JSON.parse(await fs.readFile(this.leasePath, "utf8")) as LeaseRecord; } catch { return undefined; }
  }
  private expired(record: LeaseRecord): boolean { return !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= this.now(); }
  private same(record: LeaseRecord): boolean { return record.instanceId === this.instanceId; }
  private startHeartbeat(): void { if (!this.timer) this.timer = setInterval(() => { void this.heartbeat(); }, this.heartbeatMs); this.timer.unref?.(); }
  private stopHeartbeat(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async query(): Promise<LeaseStatus> {
    const holder = await this.read();
    // No lease means no competing writer. Returning `owned` here made every
    // freshly opened session read-only before Electron had acquired anything.
    if (!holder) return { sessionId: this.sessionId, writable: true };
    if (this.expired(holder)) {
      await fs.rm(this.leasePath, { force: true });
      return { sessionId: this.sessionId, writable: true };
    }
    if (this.same(holder)) return { sessionId: this.sessionId, writable: true, holder };
    return { sessionId: this.sessionId, writable: false, holder };
  }

  async acquire(): Promise<LeaseStatus> {
    if (this.owned) { await this.heartbeat(); return this.query(); }
    await fs.mkdir(dirname(this.leasePath), { recursive: true });
    const record = this.record();
    try {
      const file = await fs.open(this.leasePath, "wx");
      await file.writeFile(JSON.stringify(record));
      await file.close();
      this.owned = true;
      this.startHeartbeat();
      return { sessionId: this.sessionId, writable: true, holder: record };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const current = await this.read();
      if (current && this.expired(current)) {
        await fs.rm(this.leasePath, { force: true });
        return this.acquire();
      }
      return { sessionId: this.sessionId, writable: false, holder: current };
    }
  }

  async heartbeat(): Promise<LeaseStatus> {
    if (!this.owned) return this.query();
    const current = await this.read();
    if (!current || !this.same(current)) { this.owned = false; this.stopHeartbeat(); return this.query(); }
    const next: LeaseRecord = { ...current, heartbeatAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + this.ttlMs).toISOString() };
    const temporary = `${this.leasePath}.${this.instanceId}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next));
    await fs.rename(temporary, this.leasePath);
    return { sessionId: this.sessionId, writable: true, holder: next };
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    const current = await this.read();
    if (current && this.same(current)) await fs.rm(this.leasePath, { force: true });
    this.owned = false;
  }
  private releaseSync(): void {
    if (!this.owned || !existsSync(this.leasePath)) return;
    try { const current = JSON.parse(readFileSync(this.leasePath, "utf8")) as LeaseRecord; if (this.same(current)) unlinkSync(this.leasePath); } catch { /* best effort at exit */ }
  }

  async expire(): Promise<boolean> {
    const current = await this.read();
    if (!current || !this.expired(current)) return false;
    await fs.rm(this.leasePath, { force: true });
    return true;
  }

  async forceTakeover(): Promise<LeaseStatus> {
    this.stopHeartbeat();
    this.owned = false;
    await fs.rm(this.leasePath, { force: true });
    return this.acquire();
  }
}
