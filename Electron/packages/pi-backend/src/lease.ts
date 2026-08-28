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
/** Non-enumerable metadata attached to acquire() results for host transaction guards. */
export const LEASE_ACQUISITION_METADATA = Symbol("pipiui.leaseAcquisitionMetadata");
export type LeaseAcquisitionMetadata = Readonly<{
  acquired: boolean;
  ownershipGeneration: number;
}>;
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

/** One process hook tracks only currently owned leases, never every constructed manager. */
const exitTrackedLeases = new Set<LeaseManager>();
let exitHookInstalled = false;

function releaseTrackedLeasesSync(): void {
  exitHookInstalled = false;
  const leases = [...exitTrackedLeases];
  exitTrackedLeases.clear();
  for (const lease of leases) lease.releaseSync();
}

function trackLeaseForExit(lease: LeaseManager): void {
  exitTrackedLeases.add(lease);
  if (exitHookInstalled) return;
  process.once("exit", releaseTrackedLeasesSync);
  exitHookInstalled = true;
}

function untrackLeaseForExit(lease: LeaseManager): void {
  exitTrackedLeases.delete(lease);
  if (exitTrackedLeases.size !== 0 || !exitHookInstalled) return;
  process.removeListener("exit", releaseTrackedLeasesSync);
  exitHookInstalled = false;
}

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
  private acquisitionGeneration = 0;
  private acquireChain: Promise<void> = Promise.resolve();

  constructor(options: LeaseManagerOptions) {
    this.sessionId = options.sessionId;
    this.leasePath = join(dirname(options.sessionPath), `${options.sessionId}.lease.json`);
    this.holder = options.holder ?? "pipiui-electron";
    this.pid = options.pid ?? process.pid;
    this.host = options.hostname ?? hostname();
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get isOwned(): boolean { return this.owned; }
  /** Release-ownership token: advances on every successful claim or reuse. */
  get ownershipGeneration(): number { return this.acquisitionGeneration; }

  private record(): LeaseRecord {
    const timestamp = new Date(this.now()).toISOString();
    return { protocolVersion: LEASE_PROTOCOL_VERSION, holder: this.holder, pid: this.pid, hostname: this.host, instanceId: this.instanceId, acquiredAt: timestamp, heartbeatAt: timestamp, expiresAt: new Date(this.now() + this.ttlMs).toISOString() };
  }
  private async read(): Promise<LeaseRecord | undefined> {
    try { return JSON.parse(await fs.readFile(this.leasePath, "utf8")) as LeaseRecord; } catch { return undefined; }
  }
  private expired(record: LeaseRecord): boolean { return !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= this.now(); }
  private same(record: LeaseRecord): boolean { return record.instanceId === this.instanceId; }
  /** Same-host PID is gone (ESRCH). A live peer in this process keeps its own instanceId. */
  private holderGone(record: LeaseRecord): boolean {
    if (record.hostname !== this.host) return false;
    if (!Number.isInteger(record.pid) || record.pid <= 0) return true;
    if (record.pid === this.pid) return false;
    try {
      process.kill(record.pid, 0);
      return false;
    } catch (error: any) {
      return error?.code === "ESRCH";
    }
  }
  private reclaimable(record: LeaseRecord | undefined): boolean {
    return Boolean(record && (this.expired(record) || this.holderGone(record)));
  }
  private claim(record: LeaseRecord): LeaseStatus {
    this.owned = true;
    this.acquisitionGeneration += 1;
    this.startHeartbeat();
    trackLeaseForExit(this);
    return { sessionId: this.sessionId, writable: true, holder: record };
  }
  private startHeartbeat(): void { if (!this.timer) this.timer = setInterval(() => { void this.heartbeat(); }, this.heartbeatMs); this.timer.unref?.(); }
  private stopHeartbeat(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async query(): Promise<LeaseStatus> {
    const holder = await this.read();
    // No lease means no competing writer. Returning `owned` here made every
    // freshly opened session read-only before Electron had acquired anything.
    if (!holder) return { sessionId: this.sessionId, writable: true };
    if (this.reclaimable(holder)) {
      await fs.rm(this.leasePath, { force: true });
      return { sessionId: this.sessionId, writable: true };
    }
    if (this.same(holder)) return { sessionId: this.sessionId, writable: true, holder };
    return { sessionId: this.sessionId, writable: false, holder };
  }

  async acquire(): Promise<LeaseStatus> {
    const run = async (): Promise<LeaseStatus> => {
      const beforeGeneration = this.acquisitionGeneration;
      const status = await this.acquireUnlocked();
      // A claim changes the generation in claim(). A successful acquire that
      // reuses an already-owned manager must advance it too, so an earlier
      // installer cannot release a lease later relied on by this caller.
      const acquired = this.owned && this.acquisitionGeneration !== beforeGeneration;
      if (status.writable && this.owned && !acquired) this.acquisitionGeneration += 1;
      // The metadata is deliberately non-enumerable: host-facing lease status
      // remains the existing protocol shape while host transactions can tell
      // this invocation's claim from a reused valid lease. The generation is
      // sampled inside the serialized acquire operation, so concurrent callers
      // do not mistake a prior caller's claim for their own.
      Object.defineProperty(status, LEASE_ACQUISITION_METADATA, {
        value: {
          acquired,
          ownershipGeneration: this.acquisitionGeneration,
        } satisfies LeaseAcquisitionMetadata,
        enumerable: false,
        configurable: true,
      });
      return status;
    };
    const next = this.acquireChain.then(run, run);
    this.acquireChain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async acquireUnlocked(): Promise<LeaseStatus> {
    if (this.owned) {
      const status = await this.heartbeat();
      if (this.owned) return status;
    }
    await fs.mkdir(dirname(this.leasePath), { recursive: true });
    const record = this.record();
    try {
      const file = await fs.open(this.leasePath, "wx");
      await file.writeFile(JSON.stringify(record));
      await file.close();
      return this.claim(record);
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const current = await this.read();
      if (current && this.same(current)) return this.claim(current);
      if (this.reclaimable(current)) {
        await fs.rm(this.leasePath, { force: true });
        return this.acquireUnlocked();
      }
      return { sessionId: this.sessionId, writable: false, holder: current };
    }
  }

  async heartbeat(): Promise<LeaseStatus> {
    if (!this.owned) return this.query();
    const current = await this.read();
    if (!current || !this.same(current)) { this.owned = false; this.stopHeartbeat(); untrackLeaseForExit(this); return this.query(); }
    const next: LeaseRecord = { ...current, heartbeatAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + this.ttlMs).toISOString() };
    const temporary = `${this.leasePath}.${this.instanceId}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next));
    await fs.rename(temporary, this.leasePath);
    return { sessionId: this.sessionId, writable: true, holder: next };
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    try {
      const current = await this.read();
      if (current && this.same(current)) await fs.rm(this.leasePath, { force: true });
    } finally {
      this.owned = false;
      untrackLeaseForExit(this);
    }
  }
  /** Process-exit cleanup for the shared tracker; synchronous by Node's exit contract. */
  releaseSync(): void {
    this.stopHeartbeat();
    try {
      if (!this.owned || !existsSync(this.leasePath)) return;
      const current = JSON.parse(readFileSync(this.leasePath, "utf8")) as LeaseRecord;
      if (this.same(current)) unlinkSync(this.leasePath);
    } catch {
      /* best effort at exit */
    } finally {
      this.owned = false;
      untrackLeaseForExit(this);
    }
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
    untrackLeaseForExit(this);
    await fs.rm(this.leasePath, { force: true });
    return this.acquire();
  }
}
