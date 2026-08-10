import { realpathSync } from "node:fs";
import { resolve, normalize } from "node:path";
import type {
  MemoryActorContext,
  MemoryActorContextInput,
  MemoryDesktopGrant,
  MemoryRole,
  MemoryWorkerGrantInput,
} from "./types.ts";

export type MemoryContractErrorCode =
  | "invalid-request"
  | "worktree-root"
  | "broker-unavailable"
  | "unauthorized-worker"
  | "stale-run"
  | "computer-memory-grant-required"
  | "denied";

export class MemoryContractError extends Error {
  readonly code: MemoryContractErrorCode;

  constructor(code: MemoryContractErrorCode, message: string) {
    super(message);
    this.name = "MemoryContractError";
    this.code = code;
  }
}

export function validIdentifier(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && Buffer.byteLength(value, "utf8") <= 512;
}

/** Normalize a path and resolve a symlink when the host can observe it. */
export function canonicalProjectRoot(path: string): string {
  const lexical = normalize(resolve(path));
  try {
    return normalize(realpathSync.native(lexical));
  } catch {
    // Unit vectors and remote hosts may intentionally use a not-yet-created path.
    return lexical;
  }
}

export function isPipiUIWorktree(canonicalPath: string): boolean {
  return canonicalPath.includes("/.pi/worktrees/") || canonicalPath.endsWith("/.pi/worktrees");
}

/**
 * The main session root, not a worker cwd, is the only dedupe and scope root.
 * Existing paths resolve symlinks; not-yet-created roots retain lexical normalization.
 */
export function canonicalMainProjectRoot(path: unknown): string {
  if (typeof path !== "string" || !path.trim()) {
    throw new MemoryContractError("invalid-request", "Missing main project root.");
  }
  const canonical = canonicalProjectRoot(path.trim());
  if (isPipiUIWorktree(canonical)) {
    throw new MemoryContractError("worktree-root", "A worktree cwd cannot be used as projectRoot.");
  }
  return canonical;
}

function validDesktopGrant(value: unknown): value is MemoryDesktopGrant {
  return value === "user-requested" || value === "ui-verify";
}

function validRole(value: unknown): value is MemoryRole {
  return value === "main" || value === "worker" || value === "operator";
}

/**
 * Constructs host-owned identity. `hostIssuedDesktopGrant` is intentionally not
 * part of MemoryBrokerRequest and is only copied from an existing dispatch.
 */
export function createActorContext(input: MemoryActorContextInput): MemoryActorContext {
  if (!validRole(input.role)
    || !validIdentifier(input.chatSessionID)
    || !validIdentifier(input.bridgeRoutingKey)
    || !validIdentifier(input.agentID)
    || !validIdentifier(input.runID)) {
    throw new MemoryContractError("invalid-request", "Invalid memory actor identity.");
  }
  const projectRoot = canonicalMainProjectRoot(input.projectRoot);
  if (input.worktreeCWD !== undefined) {
    const canonicalWorktree = canonicalProjectRoot(input.worktreeCWD);
    if (canonicalWorktree === projectRoot || isPipiUIWorktree(canonicalWorktree)) {
      throw new MemoryContractError("worktree-root", "A worktree cwd cannot be used as projectRoot.");
    }
  }
  if (input.hostIssuedDesktopGrant !== undefined && !validDesktopGrant(input.hostIssuedDesktopGrant)) {
    throw new MemoryContractError("invalid-request", "Invalid host-issued desktop grant.");
  }
  return {
    projectRoot,
    chatSessionID: input.chatSessionID,
    bridgeRoutingKey: input.bridgeRoutingKey,
    agentID: input.agentID,
    runID: input.runID,
    role: input.role,
    ...(input.hostIssuedDesktopGrant ? { desktopGrant: input.hostIssuedDesktopGrant } : {}),
  };
}

export function hasComputerMemoryGrant(context: MemoryActorContext): boolean {
  return context.role === "operator" && context.desktopGrant !== undefined;
}

type RegisteredWorkerGrant = Required<Pick<MemoryWorkerGrantInput, "capability" | "agentID" | "runID">> & {
  role: "worker" | "operator";
  desktopGrant?: MemoryDesktopGrant;
};

/**
 * Host-side one-run capability fence. It accepts a pre-existing desktop grant
 * from dispatch state but exposes no operation that can mint one from memory.
 */
export class MemoryWorkerGrantRegistry {
  private readonly grantsByAgentID = new Map<string, RegisteredWorkerGrant>();
  private readonly agentIDByCapability = new Map<string, string>();
  private readonly host: Omit<MemoryActorContextInput, "agentID" | "runID" | "role" | "hostIssuedDesktopGrant" | "worktreeCWD">;
  private readonly active: boolean;

  constructor(
    host: Omit<MemoryActorContextInput, "agentID" | "runID" | "role" | "hostIssuedDesktopGrant" | "worktreeCWD">,
    active = true,
  ) {
    this.host = host;
    this.active = active;
    canonicalMainProjectRoot(host.projectRoot);
    if (!validIdentifier(host.chatSessionID) || !validIdentifier(host.bridgeRoutingKey)) {
      throw new MemoryContractError("invalid-request", "Invalid memory host identity.");
    }
  }

  registerHostDispatch(input: MemoryWorkerGrantInput): void {
    if (!this.active
      || typeof input.capability !== "string"
      || Buffer.byteLength(input.capability, "utf8") < 32
      || Buffer.byteLength(input.capability, "utf8") > 512
      || !validIdentifier(input.agentID)
      || !validIdentifier(input.runID)
      || (input.hostIssuedDesktopGrant !== undefined && !validDesktopGrant(input.hostIssuedDesktopGrant))) {
      return;
    }
    const old = this.grantsByAgentID.get(input.agentID);
    if (old) this.agentIDByCapability.delete(old.capability);

    // The current Swift host downgrades an ungranted operator registration to a
    // normal worker rather than treating a memory RPC as desktop authorization.
    const role = input.role === "operator" && input.hostIssuedDesktopGrant ? "operator" : "worker";
    const grant: RegisteredWorkerGrant = {
      capability: input.capability,
      agentID: input.agentID,
      runID: input.runID,
      role,
      ...(role === "operator" ? { desktopGrant: input.hostIssuedDesktopGrant } : {}),
    };
    this.grantsByAgentID.set(grant.agentID, grant);
    this.agentIDByCapability.set(grant.capability, grant.agentID);
  }

  retireHostDispatch(agentID: string, runID: string): void {
    const grant = this.grantsByAgentID.get(agentID);
    if (!grant || grant.runID !== runID) return;
    this.grantsByAgentID.delete(agentID);
    this.agentIDByCapability.delete(grant.capability);
  }

  validate(capability: unknown, agentID: unknown, runID: unknown): MemoryActorContext {
    if (!this.active) {
      throw new MemoryContractError("broker-unavailable", "Memory broker is unavailable for this session.");
    }
    if (typeof capability !== "string" || typeof agentID !== "string" || typeof runID !== "string"
      || this.agentIDByCapability.get(capability) !== agentID) {
      throw new MemoryContractError("unauthorized-worker", "Memory broker capability is unauthorized.");
    }
    const grant = this.grantsByAgentID.get(agentID);
    if (!grant || grant.capability !== capability) {
      throw new MemoryContractError("unauthorized-worker", "Memory broker capability is unauthorized.");
    }
    if (grant.runID !== runID) {
      throw new MemoryContractError("stale-run", "Memory broker request belongs to a stale worker run.");
    }
    return createActorContext({
      ...this.host,
      agentID: grant.agentID,
      runID: grant.runID,
      role: grant.role,
      ...(grant.desktopGrant ? { hostIssuedDesktopGrant: grant.desktopGrant } : {}),
    });
  }
}
