import { timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const PAIR_MAX_TTL_MS = 60 * 60 * 1_000;
const SCHEMA_VERSION = 2;
export const DEFAULT_PENDING_DEVICE_TTL_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_PAIR_TOMBSTONE_RETENTION_MS = 5 * 60 * 1_000;

export interface DeviceStoreLimits {
  pendingDeviceTTLMS: number;
  maximumPendingDevices: number;
  maximumPairRecords: number;
  maximumPairRecordsPerDevice: number;
  pairTombstoneRetentionMS: number;
}

const DEFAULT_LIMITS: DeviceStoreLimits = {
  pendingDeviceTTLMS: DEFAULT_PENDING_DEVICE_TTL_MS,
  maximumPendingDevices: 10_000,
  maximumPairRecords: 50_000,
  maximumPairRecordsPerDevice: 32,
  pairTombstoneRetentionMS: DEFAULT_PAIR_TOMBSTONE_RETENTION_MS,
};

export interface DeviceRecord {
  deviceID: string;
  publicKeyX963: string;
  fingerprint: string;
  displayName: string;
  status: "pending" | "active" | "revoked";
}

export interface PairRecord {
  pairID: string;
  deviceID: string;
  fingerprint: string;
  expiresAt: number;
  state: "pending" | "claimed" | "revoked";
  claimedSubject?: string;
}

export class DeviceStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly limits: DeviceStoreLimits;

  constructor(
    path = ":memory:",
    now: () => number = Date.now,
    limits: Partial<DeviceStoreLimits> = {},
  ) {
    this.db = new DatabaseSync(path);
    this.now = now;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    if (Object.values(this.limits).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )) throw new Error("invalid device store limits");
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
    this.expirePairs();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        public_key_x963 TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        pending_expires_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS pairs (
        pair_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        secret_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'revoked')),
        claimed_subject TEXT,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER,
        finalized_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS bindings (
        subject TEXT NOT NULL,
        device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER,
        PRIMARY KEY(subject, device_id)
      );
      CREATE INDEX IF NOT EXISTS pairs_device_state
        ON pairs(device_id, state, expires_at);
      CREATE INDEX IF NOT EXISTS bindings_subject_active
        ON bindings(subject, revoked_at);
    `);
    const current = this.db.prepare(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
    ).get() as { value: number } | undefined;
    if (current && current.value !== 1 && current.value !== SCHEMA_VERSION) {
      throw new Error("unsupported database schema");
    }
    if (current?.value === SCHEMA_VERSION) {
      const deviceColumns = this.columnNames("devices");
      const pairColumns = this.columnNames("pairs");
      if (!deviceColumns.has("pending_expires_at")
        || !pairColumns.has("finalized_at")) {
        throw new Error("invalid database schema");
      }
      return;
    }

    // SQLite ALTER TABLE is transactional. Introspection makes startup recover
    // legacy databases left in any partially applied v1->v2 state by the
    // previous non-atomic migrator. The schema version is written last.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.columnNames("devices").has("pending_expires_at")) {
        this.db.exec(
          "ALTER TABLE devices ADD COLUMN pending_expires_at INTEGER",
        );
      }
      if (!this.columnNames("pairs").has("finalized_at")) {
        this.db.exec(
          "ALTER TABLE pairs ADD COLUMN finalized_at INTEGER",
        );
      }
      const now = this.now();
      this.db.prepare(`
        UPDATE devices SET pending_expires_at = ?
        WHERE status = 'pending' AND pending_expires_at IS NULL
      `).run(now + this.limits.pendingDeviceTTLMS);
      this.db.prepare(`
        UPDATE pairs SET finalized_at = COALESCE(claimed_at, created_at)
        WHERE state != 'pending' AND finalized_at IS NULL
      `).run();
      if (current) {
        this.db.prepare(
          "UPDATE schema_meta SET value = ? WHERE key = 'schema_version'",
        ).run(SCHEMA_VERSION);
      } else {
        this.db.prepare(
          "INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?)",
        ).run(SCHEMA_VERSION);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private columnNames(table: "devices" | "pairs"): Set<string> {
    return new Set(
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>).map((column) => column.name),
    );
  }

  expirePairs(now = this.now()): number {
    return this.collectGarbage(now).pairs;
  }

  collectGarbage(now = this.now()): { devices: number; pairs: number } {
    const expiredPendingPairs = this.db.prepare(
      "DELETE FROM pairs WHERE state = 'pending' AND expires_at <= ?",
    ).run(now).changes;
    const oldTombstones = this.db.prepare(`
      DELETE FROM pairs
      WHERE state IN ('claimed', 'revoked')
        AND expires_at + ? <= ?
    `).run(this.limits.pairTombstoneRetentionMS, now).changes;
    const expiredDevices = this.db.prepare(`
      DELETE FROM devices
      WHERE status = 'pending'
        AND pending_expires_at IS NOT NULL
        AND pending_expires_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM pairs
          WHERE pairs.device_id = devices.device_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM bindings
          WHERE bindings.device_id = devices.device_id
            AND bindings.revoked_at IS NULL
        )
    `).run(now).changes;
    return {
      devices: Number(expiredDevices),
      pairs: Number(expiredPendingPairs) + Number(oldTombstones),
    };
  }

  registerOrVerifyDevice(record: Omit<DeviceRecord, "status">): DeviceRecord | null {
    this.collectGarbage();
    const existing = this.device(record.deviceID);
    if (existing) {
      if (existing.status === "revoked"
        || existing.publicKeyX963 !== record.publicKeyX963
        || existing.fingerprint !== record.fingerprint) return null;
      this.db.prepare(
        "UPDATE devices SET display_name = ?, last_seen_at = ? WHERE device_id = ?",
      ).run(record.displayName, this.now(), record.deviceID);
      return { ...existing, displayName: record.displayName };
    }
    const now = this.now();
    const pendingCount = this.db.prepare(
      "SELECT COUNT(*) AS count FROM devices WHERE status = 'pending'",
    ).get() as { count: number };
    if (pendingCount.count >= this.limits.maximumPendingDevices) return null;
    try {
      this.db.prepare(`
        INSERT INTO devices(
          device_id, public_key_x963, fingerprint, display_name, status,
          created_at, last_seen_at, pending_expires_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        record.deviceID,
        record.publicKeyX963,
        record.fingerprint,
        record.displayName,
        now,
        now,
        now + this.limits.pendingDeviceTTLMS,
      );
    } catch {
      return null;
    }
    return { ...record, status: "pending" };
  }

  device(deviceID: string): DeviceRecord | null {
    const row = this.db.prepare(`
      SELECT device_id, public_key_x963, fingerprint, display_name, status
      FROM devices WHERE device_id = ?
    `).get(deviceID) as {
      device_id: string;
      public_key_x963: string;
      fingerprint: string;
      display_name: string;
      status: DeviceRecord["status"];
    } | undefined;
    return row ? {
      deviceID: row.device_id,
      publicKeyX963: row.public_key_x963,
      fingerprint: row.fingerprint,
      displayName: row.display_name,
      status: row.status,
    } : null;
  }

  createPair(input: {
    pairID: string;
    deviceID: string;
    fingerprint: string;
    secretHash: string;
    expiresAt: number;
  }): PairRecord | null {
    const now = this.now();
    if (input.expiresAt <= now || input.expiresAt > now + PAIR_MAX_TTL_MS) return null;
    const device = this.device(input.deviceID);
    if (!device || device.status === "revoked" || device.fingerprint !== input.fingerprint) {
      return null;
    }
    this.expirePairs(now);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const total = this.db.prepare(
        "SELECT COUNT(*) AS count FROM pairs",
      ).get() as { count: number };
      const perDevice = this.db.prepare(
        "SELECT COUNT(*) AS count FROM pairs WHERE device_id = ?",
      ).get(input.deviceID) as { count: number };
      if (total.count >= this.limits.maximumPairRecords
        || perDevice.count >= this.limits.maximumPairRecordsPerDevice) {
        this.db.exec("ROLLBACK");
        return null;
      }
      this.db.prepare(`
        UPDATE pairs SET state = 'revoked', finalized_at = ?
        WHERE device_id = ? AND state = 'pending'
      `).run(now, input.deviceID);
      this.db.prepare(`
        INSERT INTO pairs(
          pair_id, device_id, secret_hash, fingerprint, expires_at, state, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        input.pairID,
        input.deviceID,
        input.secretHash,
        input.fingerprint,
        input.expiresAt,
        now,
      );
      this.db.exec("COMMIT");
      return {
        pairID: input.pairID,
        deviceID: input.deviceID,
        fingerprint: input.fingerprint,
        expiresAt: input.expiresAt,
        state: "pending",
      };
    } catch {
      this.db.exec("ROLLBACK");
      return null;
    }
  }

  claimPair(input: {
    pairID: string;
    pairSecretHash: string;
    fingerprint: string;
    subject: string;
  }): PairRecord | null {
    const now = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(`
        SELECT pair_id, device_id, secret_hash, fingerprint, expires_at, state
        FROM pairs WHERE pair_id = ?
      `).get(input.pairID) as {
        pair_id: string;
        device_id: string;
        secret_hash: string;
        fingerprint: string;
        expires_at: number;
        state: PairRecord["state"];
      } | undefined;
      const expected = row ? Buffer.from(row.secret_hash, "hex") : Buffer.alloc(32);
      const actual = Buffer.from(input.pairSecretHash, "hex");
      const secretMatches = actual.length === expected.length
        && timingSafeEqual(actual, expected);
      if (!row
        || row.state !== "pending"
        || row.expires_at <= now
        || row.fingerprint !== input.fingerprint
        || !secretMatches) {
        this.db.exec("ROLLBACK");
        return null;
      }
      // Pairing links are reusable: a claim does not consume the pair. Each
      // successful claim slides the expiry forward to now + TTL, so the link
      // survives until a full hour passes without any browser pairing.
      const renewedExpiresAt = now + PAIR_MAX_TTL_MS;
      const renewed = this.db.prepare(`
        UPDATE pairs
        SET expires_at = ?
        WHERE pair_id = ? AND state = 'pending' AND expires_at > ?
      `).run(renewedExpiresAt, input.pairID, now);
      if (renewed.changes !== 1) {
        this.db.exec("ROLLBACK");
        return null;
      }
      this.db.prepare(`
        INSERT INTO bindings(subject, device_id, created_at, revoked_at)
        VALUES (?, ?, ?, NULL)
        ON CONFLICT(subject, device_id)
        DO UPDATE SET created_at = excluded.created_at, revoked_at = NULL
      `).run(input.subject, row.device_id, now);
      this.db.prepare(
        `UPDATE devices
         SET status = 'active', last_seen_at = ?, pending_expires_at = NULL
         WHERE device_id = ?`,
      ).run(now, row.device_id);
      this.db.exec("COMMIT");
      return {
        pairID: input.pairID,
        deviceID: row.device_id,
        fingerprint: row.fingerprint,
        expiresAt: renewedExpiresAt,
        state: "pending",
      };
    } catch {
      this.db.exec("ROLLBACK");
      return null;
    }
  }

  pair(pairID: string, deviceID: string): PairRecord | null {
    this.expirePairs();
    const row = this.db.prepare(`
      SELECT pair_id, device_id, fingerprint, expires_at, state, claimed_subject
      FROM pairs WHERE pair_id = ? AND device_id = ?
    `).get(pairID, deviceID) as {
      pair_id: string;
      device_id: string;
      fingerprint: string;
      expires_at: number;
      state: PairRecord["state"];
      claimed_subject: string | null;
    } | undefined;
    return row ? {
      pairID: row.pair_id,
      deviceID: row.device_id,
      fingerprint: row.fingerprint,
      expiresAt: row.expires_at,
      state: row.state,
      ...(row.claimed_subject ? { claimedSubject: row.claimed_subject } : {}),
    } : null;
  }

  revokePair(pairID: string, deviceID: string): boolean {
    return this.db.prepare(`
      UPDATE pairs SET state = 'revoked', finalized_at = ?
      WHERE pair_id = ? AND device_id = ? AND state = 'pending'
    `).run(this.now(), pairID, deviceID).changes === 1;
  }

  revokePendingPairsForDevice(deviceID: string, at: number = this.now()): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`
        UPDATE pairs SET state = 'revoked', finalized_at = ?
        WHERE device_id = ? AND state = 'pending'
      `).run(at, deviceID);
      this.db.exec("COMMIT");
      return Number(result.changes);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  pendingPairDevice(pairID: string, fingerprint: string): string | null {
    this.expirePairs();
    const row = this.db.prepare(`
      SELECT device_id FROM pairs
      WHERE pair_id = ? AND fingerprint = ? AND state = 'pending'
        AND expires_at > ?
    `).get(pairID, fingerprint, this.now()) as { device_id: string } | undefined;
    return row?.device_id ?? null;
  }

  revokeBinding(subject: string, deviceID: string): boolean {
    return this.db.prepare(`
      UPDATE bindings SET revoked_at = ?
      WHERE subject = ? AND device_id = ? AND revoked_at IS NULL
    `).run(this.now(), subject, deviceID).changes === 1;
  }

  isBound(subject: string, deviceID: string): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM bindings
      WHERE subject = ? AND device_id = ? AND revoked_at IS NULL
    `).get(subject, deviceID));
  }

  boundDeviceIDs(subject: string): string[] {
    return (this.db.prepare(`
      SELECT device_id FROM bindings
      WHERE subject = ? AND revoked_at IS NULL
      ORDER BY created_at, device_id
    `).all(subject) as Array<{ device_id: string }>).map((row) => row.device_id);
  }

  counts(): { devices: number; pendingDevices: number; pairs: number } {
    const devices = this.db.prepare(
      "SELECT COUNT(*) AS count FROM devices",
    ).get() as { count: number };
    const pending = this.db.prepare(
      "SELECT COUNT(*) AS count FROM devices WHERE status = 'pending'",
    ).get() as { count: number };
    const pairs = this.db.prepare(
      "SELECT COUNT(*) AS count FROM pairs",
    ).get() as { count: number };
    return {
      devices: devices.count,
      pendingDevices: pending.count,
      pairs: pairs.count,
    };
  }
}
