import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Matches the deployed Relay tunnel's one-link pairing material:
 * `/pair/<uuid>#<32-byte-hex-secret>`.  The secret remains in the fragment,
 * so it is never sent in the ordinary HTTP request URL or proxy access logs.
 */
export const RELAY_PAIR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const RELAY_PAIR_SECRET = /^[0-9a-f]{64}$/;
export const PAIRING_COOKIE = "pipiui_pair";
export const DEFAULT_PAIRING_TTL_MS = 24 * 60 * 60 * 1_000;

type PairRecord = {
  id: string;
  secretHash: Buffer;
  expiresAt: number;
  grantHash?: Buffer;
};

export type PairingLink = {
  id: string;
  secret: string;
  expiresAt: number;
  url: string;
};

export type PairingGrant = {
  pairID: string;
  token: string;
  expiresAt: number;
  replaced: boolean;
};

export type PairingIdentity = {
  pairID: string;
  expiresAt: number;
};

export type RelayCompatiblePairingOptions = {
  ttlMs?: number;
  now?: () => number;
};

function hash(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function equal(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return undefined;
}

function origin(value: string): string {
  const parsed = new URL(value);
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username || parsed.password || parsed.pathname !== "/"
    || parsed.search || parsed.hash) {
    throw new Error("pairing public origin must be an HTTP(S) origin");
  }
  return parsed.origin;
}

/**
 * Direct-server adapter for the Relay pairing contract.  Relay remains an
 * independent service for hosts that need a tunnel; a public Node host can
 * terminate the same fragment-based pairing locally and then serve its native
 * Host API WebSocket without an extra request/response translation hop.
 */
export class RelayCompatiblePairing {
  private readonly records = new Map<string, PairRecord>();
  private readonly grants = new Map<string, PairRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: RelayCompatiblePairingOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_PAIRING_TTL_MS;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error("pairing TTL must be a positive integer");
    }
  }

  create(publicOrigin: string): PairingLink {
    this.prune();
    const id = randomUUID().toLowerCase();
    const secret = randomBytes(32).toString("hex");
    const expiresAt = this.now() + this.ttlMs;
    this.records.set(id, { id, secretHash: hash(secret), expiresAt });
    return { id, secret, expiresAt, url: `${origin(publicOrigin)}/pair/${id}#${secret}` };
  }

  claim(pairID: string, secret: string): PairingGrant | undefined {
    this.prune();
    if (!RELAY_PAIR_ID.test(pairID) || !RELAY_PAIR_SECRET.test(secret)) return undefined;
    const record = this.records.get(pairID.toLowerCase());
    if (!record || !equal(hash(secret), record.secretHash)) return undefined;

    const replaced = Boolean(record.grantHash);
    if (record.grantHash) this.grants.delete(record.grantHash.toString("hex"));
    const token = randomBytes(32).toString("base64url");
    record.grantHash = hash(token);
    this.grants.set(record.grantHash.toString("hex"), record);
    return { pairID: record.id, token, expiresAt: record.expiresAt, replaced };
  }

  authorize(cookieHeader: string | undefined): PairingIdentity | undefined {
    this.prune();
    const token = cookieValue(cookieHeader, PAIRING_COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const digest = hash(token);
    const record = this.grants.get(digest.toString("hex"));
    if (!record || !record.grantHash || !equal(digest, record.grantHash)) return undefined;
    return { pairID: record.id, expiresAt: record.expiresAt };
  }

  cookie(grant: PairingGrant, secure: boolean): string {
    const seconds = Math.max(1, Math.floor((grant.expiresAt - this.now()) / 1_000));
    return `${PAIRING_COOKIE}=${grant.token}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Strict; Path=/; Max-Age=${seconds}`;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, record] of this.records) {
      if (record.expiresAt > now) continue;
      this.records.delete(id);
      if (record.grantHash) this.grants.delete(record.grantHash.toString("hex"));
    }
  }
}
