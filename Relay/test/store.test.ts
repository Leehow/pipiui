import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  DEFAULT_PENDING_DEVICE_TTL_MS,
  DeviceStore,
} from "../src/store.js";

function record(suffix: string) {
  return {
    deviceID: randomUUID(),
    publicKeyX963: `public-${suffix}`,
    fingerprint: suffix.padStart(64, "0"),
    displayName: `Device ${suffix}`,
  };
}

function createV1Fixture(
  databasePath: string,
  partial: "none" | "device-column" | "pair-column" | "both-columns",
) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    INSERT INTO schema_meta(key, value) VALUES ('schema_version', 1);
    CREATE TABLE devices (
      device_id TEXT PRIMARY KEY,
      public_key_x963 TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE pairs (
      pair_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      secret_hash TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'revoked')),
      claimed_subject TEXT,
      created_at INTEGER NOT NULL,
      claimed_at INTEGER
    );
    CREATE TABLE bindings (
      subject TEXT NOT NULL,
      device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      PRIMARY KEY(subject, device_id)
    );
  `);
  if (partial === "device-column" || partial === "both-columns") {
    db.exec("ALTER TABLE devices ADD COLUMN pending_expires_at INTEGER");
  }
  if (partial === "pair-column" || partial === "both-columns") {
    db.exec("ALTER TABLE pairs ADD COLUMN finalized_at INTEGER");
  }
  const activeDeviceID = randomUUID();
  const pendingDeviceID = randomUUID();
  const pairID = randomUUID();
  db.prepare(`
    INSERT INTO devices(
      device_id, public_key_x963, fingerprint, display_name, status,
      created_at, last_seen_at
    ) VALUES (?, ?, ?, 'Active', 'active', 700, 900)
  `).run(activeDeviceID, "active-public", "a".repeat(64));
  db.prepare(`
    INSERT INTO devices(
      device_id, public_key_x963, fingerprint, display_name, status,
      created_at, last_seen_at
    ) VALUES (?, ?, ?, 'Pending', 'pending', 800, 900)
  `).run(pendingDeviceID, "pending-public", "b".repeat(64));
  db.prepare(`
    INSERT INTO pairs(
      pair_id, device_id, secret_hash, fingerprint, expires_at, state,
      claimed_subject, created_at, claimed_at
    ) VALUES (?, ?, ?, ?, 100000, 'claimed', 'cf:fixture', 800, 900)
  `).run(pairID, activeDeviceID, "c".repeat(64), "a".repeat(64));
  db.prepare(`
    INSERT INTO bindings(subject, device_id, created_at, revoked_at)
    VALUES ('cf:fixture', ?, 900, NULL)
  `).run(activeDeviceID);
  db.close();
  return { activeDeviceID, pendingDeviceID, pairID };
}

test("pending-device cap survives restart and expired pending devices are reclaimed", () => {
  let now = 1_000;
  const databasePath = join(
    mkdtempSync(join(tmpdir(), "pipiui-store-pending-")),
    "relay.sqlite",
  );
  const limits = {
    pendingDeviceTTLMS: 100,
    maximumPendingDevices: 2,
  };
  const first = new DeviceStore(databasePath, () => now, limits);
  assert(first.registerOrVerifyDevice(record("1")));
  assert(first.registerOrVerifyDevice(record("2")));
  assert.equal(first.registerOrVerifyDevice(record("3")), null);
  first.close();

  const restarted = new DeviceStore(databasePath, () => now, limits);
  assert.equal(restarted.registerOrVerifyDevice(record("4")), null);
  assert.deepEqual(restarted.counts(), {
    devices: 2,
    pendingDevices: 2,
    pairs: 0,
  });
  now += 101;
  assert(restarted.registerOrVerifyDevice(record("5")));
  assert.deepEqual(restarted.counts(), {
    devices: 1,
    pendingDevices: 1,
    pairs: 0,
  });
  restarted.close();
});

test("pair caps survive restart and release only after durable records expire", () => {
  let now = 10_000;
  const databasePath = join(
    mkdtempSync(join(tmpdir(), "pipiui-store-pairs-")),
    "relay.sqlite",
  );
  const limits = {
    maximumPairRecords: 2,
    maximumPairRecordsPerDevice: 2,
    pairTombstoneRetentionMS: 100,
  };
  const device = record("a");
  const pair = (pairID: string) => ({
    pairID,
    deviceID: device.deviceID,
    fingerprint: device.fingerprint,
    secretHash: "1".repeat(64),
    expiresAt: now + 50,
  });
  const first = new DeviceStore(databasePath, () => now, limits);
  assert(first.registerOrVerifyDevice(device));
  assert(first.createPair(pair(randomUUID())));
  assert(first.createPair(pair(randomUUID())));
  assert.equal(first.createPair(pair(randomUUID())), null);
  first.close();

  const restarted = new DeviceStore(databasePath, () => now, limits);
  assert.equal(restarted.createPair(pair(randomUUID())), null);
  assert.equal(restarted.counts().pairs, 2);
  now += 151;
  restarted.collectGarbage();
  assert.equal(restarted.counts().pairs, 0);
  assert(restarted.createPair(pair(randomUUID())));
  restarted.close();
});

test("claimed pair tombstones reject replay until the retention boundary", () => {
  let now = 50_000;
  const store = new DeviceStore(":memory:", () => now, {
    pairTombstoneRetentionMS: 100,
  });
  const device = record("b");
  const pairID = randomUUID();
  const expiresAt = now + 50;
  assert(store.registerOrVerifyDevice(device));
  assert(store.createPair({
    pairID,
    deviceID: device.deviceID,
    fingerprint: device.fingerprint,
    secretHash: "2".repeat(64),
    expiresAt,
  }));
  assert(store.claimPair({
    pairID,
    pairSecretHash: "2".repeat(64),
    fingerprint: device.fingerprint,
    subject: "cf:subject",
  }));
  now = expiresAt + 99;
  assert.equal(store.pair(pairID, device.deviceID)?.state, "claimed");
  assert.equal(store.claimPair({
    pairID,
    pairSecretHash: "2".repeat(64),
    fingerprint: device.fingerprint,
    subject: "cf:attacker",
  }), null);
  now += 2;
  assert.equal(store.pair(pairID, device.deviceID), null);
  store.close();
});

test("device pending-pair revocation is selective and preserves finalized pairs", () => {
  const now = 60_000;
  const store = new DeviceStore(":memory:", () => now);
  const deviceA = record("c");
  const deviceB = record("d");
  assert(store.registerOrVerifyDevice(deviceA));
  assert(store.registerOrVerifyDevice(deviceB));
  const pendingA = randomUUID();
  const claimedA = randomUUID();
  const pendingB = randomUUID();
  for (const [pairID, device] of [
    [claimedA, deviceA],
    [pendingB, deviceB],
  ] as const) {
    assert(store.createPair({
      pairID,
      deviceID: device.deviceID,
      fingerprint: device.fingerprint,
      secretHash: pairID.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      expiresAt: now + 60_000,
    }));
  }
  assert(store.claimPair({
    pairID: claimedA,
    pairSecretHash: claimedA.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    fingerprint: deviceA.fingerprint,
    subject: "cf:subject",
  }));
  assert(store.createPair({
    pairID: pendingA,
    deviceID: deviceA.deviceID,
    fingerprint: deviceA.fingerprint,
    secretHash: pendingA.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    expiresAt: now + 60_000,
  }));

  assert.equal(store.revokePendingPairsForDevice(deviceA.deviceID, now), 1);
  assert.equal(store.pair(pendingA, deviceA.deviceID)?.state, "revoked");
  assert.equal(store.pair(claimedA, deviceA.deviceID)?.state, "claimed");
  assert.equal(store.pair(pendingB, deviceB.deviceID)?.state, "pending");
  store.close();
});

test("v1 migration is atomic, restart-idempotent, and repairs every partial state", () => {
  const now = 1_000;
  for (const partial of [
    "none",
    "device-column",
    "pair-column",
    "both-columns",
  ] as const) {
    const databasePath = join(
      mkdtempSync(join(tmpdir(), `pipiui-store-v1-${partial}-`)),
      "relay.sqlite",
    );
    const fixture = createV1Fixture(databasePath, partial);
    const migrated = new DeviceStore(databasePath, () => now);
    assert.equal(
      migrated.isBound("cf:fixture", fixture.activeDeviceID),
      true,
      partial,
    );
    assert.equal(
      migrated.pair(fixture.pairID, fixture.activeDeviceID)?.state,
      "claimed",
      partial,
    );
    assert.equal(migrated.device(fixture.pendingDeviceID)?.status, "pending");
    migrated.close();

    const raw = new DatabaseSync(databasePath);
    assert.equal(
      (raw.prepare(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'",
      ).get() as { value: number }).value,
      2,
      partial,
    );
    const deviceColumns = new Set(
      (raw.prepare("PRAGMA table_info(devices)").all() as Array<{
        name: string;
      }>).map((column) => column.name),
    );
    const pairColumns = new Set(
      (raw.prepare("PRAGMA table_info(pairs)").all() as Array<{
        name: string;
      }>).map((column) => column.name),
    );
    assert(deviceColumns.has("pending_expires_at"), partial);
    assert(pairColumns.has("finalized_at"), partial);
    assert.equal(
      (raw.prepare(
        "SELECT pending_expires_at AS value FROM devices WHERE device_id = ?",
      ).get(fixture.pendingDeviceID) as { value: number }).value,
      now + DEFAULT_PENDING_DEVICE_TTL_MS,
      partial,
    );
    assert.equal(
      (raw.prepare(
        "SELECT finalized_at AS value FROM pairs WHERE pair_id = ?",
      ).get(fixture.pairID) as { value: number }).value,
      900,
      partial,
    );
    raw.close();

    const restarted = new DeviceStore(databasePath, () => now);
    assert.equal(
      restarted.isBound("cf:fixture", fixture.activeDeviceID),
      true,
      partial,
    );
    assert.equal(
      restarted.pair(fixture.pairID, fixture.activeDeviceID)?.state,
      "claimed",
      partial,
    );
    restarted.close();
  }
});
