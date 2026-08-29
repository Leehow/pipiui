import { randomBytes } from "node:crypto";
import {
  HOST_CAPABILITY_PERMISSIONS,
  HOST_CAPABILITY_WIRE_VERSION,
  negotiateHostApiVersion,
  type HostCapabilityDenyCode,
  type HostCapabilityDenyV1,
  type HostCapabilityHandshakeV1,
  type HostCapabilityMintResponseV1,
  type HostCapabilityPermission,
  type HostCapabilityRequestV1,
  type HostCapabilityResponseV1,
} from "@pipi/host-api";
import { EXTENSION_HOST_API_VERSION, type ExtensionPermission } from "./extension-manifest.js";

/**
 * Versioned Host Capability API broker — the single narrow channel extensions
 * use to reach native host capabilities. The Electron main binds the drivers
 * (BrowserSessionHost / CuaDriverHost); this broker owns the four gates every
 * call passes before a driver runs:
 *
 * 1. wire envelope shape (closed schema version, closed permission/op sets),
 * 2. hostApi range renegotiation against the running host version,
 * 3. per-project permission check (manifest-declared AND project-granted),
 * 4. one-time capability token redemption (single use, TTL-bound, context-bound).
 *
 * Tokens are host-minted machine-internal one-time secrets (random, opaque by
 * design — CONSTITUTION §7 class C); extensions never name them across calls.
 */
export type HostCapabilityDrivers = {
  /** `browser.session` surface, backed by the Electron BrowserSessionHost. */
  browser?: {
    toolAction(sessionId: string, request: Record<string, unknown>): Promise<Record<string, unknown>>;
    watchAction?(
      sessionId: string,
      request: Record<string, unknown>,
    ): Promise<Record<string, unknown>> | Record<string, unknown>;
    disposeSession?(sessionId: string): Promise<void>;
  };
  /** `native.exec` surface, backed by the Electron CuaDriverHost. */
  native?: {
    handle(request: Record<string, unknown>): Promise<Record<string, unknown>>;
    usable?(): boolean;
  };
};

/** Authorization inputs; both may be async and must default to deny. */
export type HostCapabilityPolicy = {
  /** Permissions the extension's manifest declares (closed enum values). */
  declaredPermissions(extensionId: string): readonly string[] | Promise<readonly string[]>;
  /** Whether `projectRoot` granted `permission` to `extensionId` (ext-grants semantics). */
  projectAllows(extensionId: string, projectRoot: string, permission: string): boolean | Promise<boolean>;
  /**
   * Desktop-grant check for `native.exec`: does this bridge session own the
   * `computerCapability` presented in `params`? Absent or false denies —
   * the broker never treats a missing verifier as a grant.
   */
  verifyDesktopGrant?(input: { sessionId: string; computerCapability: string }): boolean | Promise<boolean>;
};

export type HostCapabilityBrokerOptions = {
  /** Defaults to the running host's `EXTENSION_HOST_API_VERSION`. */
  hostApiVersion?: string;
  drivers?: HostCapabilityDrivers;
  policy?: HostCapabilityPolicy;
  now?: () => number;
  /** Default one-time token lifetime (default 30s). */
  tokenTtlMs?: number;
};

type IssuedToken = {
  extensionId: string;
  projectRoot: string;
  permission: HostCapabilityPermission;
  expiresAt: number;
  consumedAt?: number;
};

const BROWSER_OPS = new Set<string>(["browser.action", "browser.watch", "browser.disposeSession"]);
const NATIVE_OPS = new Set<string>(["native.cua"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class HostCapabilityBroker {
  private readonly hostApiVersion: string;
  private readonly drivers: HostCapabilityDrivers;
  private readonly policy?: HostCapabilityPolicy;
  private readonly now: () => number;
  private readonly tokenTtlMs: number;
  private readonly tokens = new Map<string, IssuedToken>();

  constructor(options: HostCapabilityBrokerOptions = {}) {
    this.hostApiVersion = options.hostApiVersion ?? EXTENSION_HOST_API_VERSION;
    this.drivers = options.drivers ?? {};
    this.policy = options.policy;
    this.now = options.now ?? Date.now;
    this.tokenTtlMs = options.tokenTtlMs ?? 30_000;
  }

  /** Host API version this broker negotiates for (pinned wire field). */
  get version(): string {
    return this.hostApiVersion;
  }

  /** Handshake only: range negotiation without any permission or token gate. */
  handshake(request: { extensionId?: unknown; hostApi?: unknown }): HostCapabilityHandshakeV1 {
    const range = typeof request.hostApi === "string" ? request.hostApi : "";
    return negotiateHostApiVersion({ hostVersion: this.hostApiVersion, requestedRange: range });
  }

  /** Mint a one-time capability token. The host calls this after its own authorization flow. */
  issueToken(input: {
    extensionId: string;
    projectRoot: string;
    permission: HostCapabilityPermission;
    ttlMs?: number;
  }): { token: string; expiresAt: number } {
    if (!(HOST_CAPABILITY_PERMISSIONS as readonly string[]).includes(input.permission)) {
      throw new TypeError(`unknown host capability permission '${String(input.permission)}'`);
    }
    if (typeof input.extensionId !== "string" || !input.extensionId.trim()) {
      throw new TypeError("extensionId is required");
    }
    if (typeof input.projectRoot !== "string" || !input.projectRoot.trim()) {
      throw new TypeError("projectRoot is required");
    }
    const ttl = input.ttlMs ?? this.tokenTtlMs;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + Math.max(0, ttl);
    this.tokens.set(token, {
      extensionId: input.extensionId,
      projectRoot: input.projectRoot,
      permission: input.permission,
      expiresAt,
    });
    return { token, expiresAt };
  }

  /**
   * Redeem a token once. Replay of a consumed token answers `token_consumed`
   * (until the record is pruned) so a caller can tell replay from garbage;
   * any context mismatch answers the same opaque `token_invalid` so a wrong
   * caller learns nothing about which tokens exist.
   */
  redeem(
    token: string,
    ctx: { extensionId: string; projectRoot: string; permission: HostCapabilityPermission },
  ): { ok: true } | { ok: false; code: HostCapabilityDenyCode; error: string } {
    const entry = this.tokens.get(token);
    if (!entry) return { ok: false, code: "token_invalid", error: "unknown capability token" };
    if (entry.consumedAt !== undefined) return { ok: false, code: "token_consumed", error: "capability token was already used" };
    if (
      entry.extensionId !== ctx.extensionId ||
      entry.projectRoot !== ctx.projectRoot ||
      entry.permission !== ctx.permission
    ) {
      return { ok: false, code: "token_invalid", error: "capability token does not match this caller" };
    }
    if (this.now() > entry.expiresAt) {
      this.tokens.delete(token);
      return { ok: false, code: "token_expired", error: "capability token expired" };
    }
    entry.consumedAt = this.now();
    return { ok: true };
  }

  private deny(code: HostCapabilityDenyCode, error: string): HostCapabilityDenyV1 {
    return { schemaVersion: HOST_CAPABILITY_WIRE_VERSION, ok: false, code, error, hostApiVersion: this.hostApiVersion };
  }

  /** Shared manifest-declared + project-granted gate. Returns the deny, or null when authorized. */
  private async authorizePermission(
    extensionId: string,
    permission: HostCapabilityPermission,
    projectRoot: string,
  ): Promise<HostCapabilityDenyV1 | null> {
    const declared = this.policy ? await this.policy.declaredPermissions(extensionId) : [];
    if (!declared.includes(permission)) {
      return this.deny("permission_denied", `extension '${extensionId}' does not declare permission '${permission}'`);
    }
    const projectAllowed = this.policy ? await this.policy.projectAllows(extensionId, projectRoot, permission) : false;
    if (!projectAllowed) {
      return this.deny("permission_denied", `project has not granted '${permission}' to extension '${extensionId}'`);
    }
    return null;
  }

  /** Structural pre-parse. Returns the typed request or a wire-shape deny. */
  private parseRequest(request: unknown): { ok: true; request: HostCapabilityRequestV1 } | { ok: false; deny: HostCapabilityDenyV1 } {
    if (!isRecord(request)) return { ok: false, deny: this.deny("unsupported_wire", "request must be an object") };
    if (request.schemaVersion !== HOST_CAPABILITY_WIRE_VERSION) {
      return { ok: false, deny: this.deny("unsupported_wire", `schemaVersion must be ${HOST_CAPABILITY_WIRE_VERSION}`) };
    }
    const bad = (error: string) => ({ ok: false as const, deny: this.deny("unsupported_wire", error) });
    if (typeof request.extensionId !== "string" || !request.extensionId.trim()) return bad("extensionId is required");
    if (typeof request.hostApi !== "string" || !request.hostApi.trim()) return bad("hostApi range is required");
    if (typeof request.projectRoot !== "string" || !request.projectRoot.trim()) return bad("projectRoot is required");
    if (typeof request.token !== "string") return bad("token must be a string");
    if (!request.token) return { ok: false, deny: this.deny("token_required", "a one-time capability token is required") };
    if (!isRecord(request.params)) return bad("params must be an object");
    const permission = request.permission;
    if (typeof permission !== "string" || !(HOST_CAPABILITY_PERMISSIONS as readonly string[]).includes(permission)) {
      return { ok: false, deny: this.deny("unknown_capability", `unknown permission '${String(permission)}'`) };
    }
    const op = request.op;
    if (permission === "browser.session") {
      if (typeof op !== "string" || !BROWSER_OPS.has(op)) {
        return { ok: false, deny: this.deny("unknown_capability", `op '${String(op)}' is not a browser.session operation`) };
      }
    } else if (permission === "native.exec") {
      if (typeof op !== "string" || !NATIVE_OPS.has(op)) {
        return { ok: false, deny: this.deny("unknown_capability", `op '${String(op)}' is not a native.exec operation`) };
      }
    } else {
      return { ok: false, deny: this.deny("unknown_capability", `permission '${permission}' has no driver in this host wave`) };
    }
    return {
      ok: true,
      request: request as unknown as HostCapabilityRequestV1,
    };
  }

  /** The narrow channel entry: every gate in order, then exactly one driver call. */
  async dispatch(request: unknown, sessionId: string): Promise<HostCapabilityResponseV1> {
    const parsed = this.parseRequest(request);
    if (!parsed.ok) return parsed.deny;
    const req = parsed.request;

    const handshake = this.handshake({ hostApi: req.hostApi });
    if (!handshake.ok) return this.deny("host_api_mismatch", `extension hostApi range '${req.hostApi}' does not load against host ${this.hostApiVersion}`);

    const permission = req.permission as ExtensionPermission;
    const authorizeDeny = await this.authorizePermission(req.extensionId, permission, req.projectRoot);
    if (authorizeDeny) return authorizeDeny;

    // Desktop grant: `native.exec` must additionally present the session's own
    // computerCapability (the legacy desktop-grant field, byte-identical).
    // Checked before token redemption so a grant mismatch never burns a token.
    if (permission === "native.exec") {
      const grant = req.params.computerCapability;
      if (typeof grant !== "string" || !grant) {
        return this.deny("permission_denied", "desktop grant computerCapability is required for native.exec");
      }
      const granted = this.policy?.verifyDesktopGrant
        ? await this.policy.verifyDesktopGrant({ sessionId, computerCapability: grant })
        : false;
      if (!granted) {
        return this.deny("permission_denied", "desktop grant does not authorize this session for native.exec");
      }
    }

    const redeemed = this.redeem(req.token, {
      extensionId: req.extensionId,
      projectRoot: req.projectRoot,
      permission,
    });
    if (!redeemed.ok) return this.deny(redeemed.code, redeemed.error);

    try {
      if (permission === "browser.session") {
        const driver = this.drivers.browser;
        if (!driver) return this.deny("host_unavailable", "no browser session driver is bound");
        if (req.op === "browser.action") {
          const result = await driver.toolAction(sessionId, req.params);
          return { schemaVersion: HOST_CAPABILITY_WIRE_VERSION, ok: true, result, hostApiVersion: this.hostApiVersion };
        }
        if (req.op === "browser.watch") {
          if (!driver.watchAction) return this.deny("host_unavailable", "no browser watch driver is bound");
          const result = await driver.watchAction(sessionId, req.params);
          return { schemaVersion: HOST_CAPABILITY_WIRE_VERSION, ok: true, result, hostApiVersion: this.hostApiVersion };
        }
        if (!driver.disposeSession) return this.deny("host_unavailable", "no browser session disposal is bound");
        await driver.disposeSession(sessionId);
        return {
          schemaVersion: HOST_CAPABILITY_WIRE_VERSION,
          ok: true,
          result: { disposed: true, sessionId },
          hostApiVersion: this.hostApiVersion,
        };
      }
      const driver = this.drivers.native;
      if (!driver || (driver.usable && !driver.usable())) {
        return this.deny("host_unavailable", "no usable native driver is bound");
      }
      const result = await driver.handle(req.params);
      return { schemaVersion: HOST_CAPABILITY_WIRE_VERSION, ok: true, result, hostApiVersion: this.hostApiVersion };
    } catch (error) {
      return this.deny("driver_error", error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Mint one one-time capability token (loopback `host_capability_token`).
   * Fail closed: without a policy — or when the manifest/project permission
   * gates refuse — no token is issued. The response envelope mirrors the
   * dispatch denies so callers read one shape.
   */
  async mint(request: unknown): Promise<HostCapabilityMintResponseV1> {
    if (!isRecord(request)) return this.deny("unsupported_wire", "mint request must be an object");
    if (typeof request.extensionId !== "string" || !request.extensionId.trim()) {
      return this.deny("unsupported_wire", "extensionId is required");
    }
    const permission = request.permission;
    if (typeof permission !== "string" || !(HOST_CAPABILITY_PERMISSIONS as readonly string[]).includes(permission)) {
      return this.deny("unknown_capability", `unknown permission '${String(permission)}'`);
    }
    if (typeof request.projectRoot !== "string" || !request.projectRoot.trim()) {
      return this.deny("unsupported_wire", "projectRoot is required");
    }
    const authorizeDeny = await this.authorizePermission(
      request.extensionId,
      permission as HostCapabilityPermission,
      request.projectRoot,
    );
    if (authorizeDeny) return authorizeDeny;
    const { token, expiresAt } = this.issueToken({
      extensionId: request.extensionId,
      projectRoot: request.projectRoot,
      permission: permission as HostCapabilityPermission,
    });
    return { schemaVersion: HOST_CAPABILITY_WIRE_VERSION, ok: true, token, expiresAt, hostApiVersion: this.hostApiVersion };
  }
}
