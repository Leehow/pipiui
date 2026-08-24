// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { validateDesktopActions } from "./desktop-actions.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import {
  observationFingerprint,
  type ComputerWorkerBrokerRequest,
} from "./worker-broker.ts";

export const BOSS_DESKTOP_GRANT_VALUES = ["user-requested", "ui-verify"] as const;
export type BossDesktopGrant = (typeof BOSS_DESKTOP_GRANT_VALUES)[number];
export const BOSS_DIRECT_DRIVE_ACTIONS = ["session", "observe", "open_application", "act", "close"] as const;
export type BossDirectDriveAction = (typeof BOSS_DIRECT_DRIVE_ACTIONS)[number];

export const DIRECT_DRIVE_ERROR = {
  grantRequired: "desktop_grant_required",
  grantUnavailable: "desktop_grant_unavailable",
  grantInvalid: "desktop_grant_invalid",
  sessionRequired: "desktop_session_required",
  sessionUnknown: "desktop_session_unknown",
  unsupportedAction: "unsupported_direct_drive_action",
} as const;

export type DirectDriveBroker = {
  issue(input: {
    taskId: string;
    stepId: string;
    runId: string;
    role: "boss-direct";
    goal?: string;
  }): { token: string };
  execute(token: string, request: ComputerWorkerBrokerRequest, signal?: AbortSignal): Promise<Record<string, unknown>>;
  revokeTask(taskId: string): void;
};

export type DirectDriveParams = {
  goal?: unknown;
  desktop?: unknown;
  sessionId?: unknown;
  action?: unknown;
  actions?: unknown;
  expectedEffect?: unknown;
  fresh?: unknown;
  bundle_identifier?: unknown;
  application_name?: unknown;
};

export type DirectDriveActionRecord = Record<string, unknown>;

export type DirectDriveResult = {
  action: DirectDriveActionRecord;
  observation: Record<string, unknown> | null;
  screenChanged: boolean | null;
  error: string | null;
  sessionId: string;
  expectedEffect?: unknown;
  code?: string;
  spawnedLeader: false;
};

type SessionRecord = {
  sessionId: string;
  taskId: string;
  stepId: string;
  runId: string;
  token: string;
  desktop: BossDesktopGrant;
  goal?: string;
  lastObservation?: Record<string, unknown>;
};

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function isComputerTaskDirectDrive(params: DirectDriveParams | Record<string, unknown> | null | undefined): boolean {
  if (!params || typeof params !== "object") return false;
  return params.action != null || params.sessionId != null || params.desktop != null;
}

export function isBossDesktopGrant(value: unknown): value is BossDesktopGrant {
  return typeof value === "string" && (BOSS_DESKTOP_GRANT_VALUES as readonly string[]).includes(value);
}

export function resolveBossDesktopGrant(input: {
  desktop: unknown;
  hostAvailable: boolean;
}): { granted: false; code: string; error: string } | { granted: true; desktop: BossDesktopGrant } {
  if (input.desktop == null || input.desktop === "") {
    return {
      granted: false,
      code: DIRECT_DRIVE_ERROR.grantRequired,
      error: 'desktop_grant_required: open a Boss-driven desktop session with desktop:"user-requested" or desktop:"ui-verify".',
    };
  }
  if (!isBossDesktopGrant(input.desktop)) {
    return {
      granted: false,
      code: DIRECT_DRIVE_ERROR.grantInvalid,
      error: `desktop_grant_invalid: desktop must be "user-requested" or "ui-verify", got ${JSON.stringify(input.desktop)}.`,
    };
  }
  if (!input.hostAvailable) {
    return {
      granted: false,
      code: DIRECT_DRIVE_ERROR.grantUnavailable,
      error: `desktop_grant_unavailable: Cannot authorize desktop:"${input.desktop}": Computer Use capability is not available in this host (global Computer Use toggle is off, or the strategy extension is not mounted).`,
    };
  }
  return { granted: true, desktop: input.desktop };
}

function screenshotFrom(observation: Record<string, unknown> | null): { data: string; mimeType: string } | undefined {
  if (!observation) return undefined;
  const data = [observation.screenshotBase64, observation.screenshot_png_b64, observation.base64]
    .find((value): value is string => typeof value === "string" && value.length > 0);
  if (!data) return undefined;
  const mimeType = String(observation.mimeType ?? observation.screenshotMimeType ?? observation.screenshot_mime_type ?? "image/png");
  return { data, mimeType };
}

export function sanitizeDirectDriveObservation(observation: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!observation) return null;
  const safe = { ...observation };
  delete safe.screenshotBase64;
  delete safe.screenshot_png_b64;
  delete safe.base64;
  return safe;
}

function screenChangedBetween(before: Record<string, unknown> | undefined, after: Record<string, unknown> | null): boolean | null {
  if (!before || !after) return null;
  const previous = observationFingerprint(before);
  const next = observationFingerprint(after);
  if (!previous || !next) return null;
  return previous !== next;
}

function resultEnvelope(input: {
  action: DirectDriveActionRecord;
  observation?: Record<string, unknown> | null;
  screenChanged?: boolean | null;
  error?: string | null;
  sessionId?: string;
  expectedEffect?: unknown;
  code?: string;
}): DirectDriveResult {
  const result: DirectDriveResult = {
    action: input.action,
    observation: input.observation ?? null,
    screenChanged: input.screenChanged ?? null,
    error: input.error ?? null,
    sessionId: input.sessionId ?? "",
    spawnedLeader: false,
  };
  if (input.expectedEffect !== undefined) result.expectedEffect = input.expectedEffect;
  if (input.code) result.code = input.code;
  return result;
}

export function formatDirectDriveToolResult(result: DirectDriveResult): {
  content: Array<Record<string, unknown>>;
  details: DirectDriveResult;
} {
  const screenshot = screenshotFrom(result.observation);
  const details = { ...result, observation: sanitizeDirectDriveObservation(result.observation) };
  const content: Array<Record<string, unknown>> = [{ type: "text", text: JSON.stringify(details) }];
  if (screenshot) content.push({ type: "image", data: screenshot.data, mimeType: screenshot.mimeType });
  return { content, details };
}

function parseActionName(value: unknown, fallback: BossDirectDriveAction): BossDirectDriveAction | undefined {
  if (value == null || value === "") return fallback;
  if (typeof value === "string" && (BOSS_DIRECT_DRIVE_ACTIONS as readonly string[]).includes(value)) {
    return value as BossDirectDriveAction;
  }
  return undefined;
}

export function createBossDesktopDirectDrive(input: {
  acquireBroker: () => Promise<DirectDriveBroker>;
  randomId?: () => string;
}): {
  execute(params: DirectDriveParams, options: { hostAvailable: boolean; signal?: AbortSignal }): Promise<DirectDriveResult>;
  closeAll(): void;
} {
  const sessions = new Map<string, SessionRecord>();
  const randomId = input.randomId ?? (() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  let broker: DirectDriveBroker | undefined;

  const brokerOrThrow = async () => {
    broker ??= await input.acquireBroker();
    return broker;
  };

  const fail = (action: DirectDriveActionRecord, code: string, error: string, sessionId = ""): DirectDriveResult =>
    resultEnvelope({ action, code, error, sessionId });

  return {
    closeAll() {
      for (const session of sessions.values()) {
        try { broker?.revokeTask(session.taskId); } catch { /* best-effort */ }
      }
      sessions.clear();
    },
    async execute(params, options) {
      const expectedEffect = params.expectedEffect;
      const requestedAction = parseActionName(params.action, nonempty(params.sessionId) ? "observe" : "session");
      if (!requestedAction) {
        return fail(
          { type: String(params.action ?? "") },
          DIRECT_DRIVE_ERROR.unsupportedAction,
          `unsupported_direct_drive_action: action must be one of ${BOSS_DIRECT_DRIVE_ACTIONS.join(", ")}.`,
        );
      }

      if (requestedAction === "session") {
        const grant = resolveBossDesktopGrant({ desktop: params.desktop, hostAvailable: options.hostAvailable });
        if (!grant.granted) return fail({ type: "session" }, grant.code, grant.error);
        const handle = await brokerOrThrow();
        const sessionId = nonempty(params.sessionId) ? params.sessionId.trim() : `desktop-${randomId()}`;
        const existing = sessions.get(sessionId);
        if (existing) {
          return resultEnvelope({
            action: { type: "session", desktop: existing.desktop, resumed: true },
            sessionId,
            observation: existing.lastObservation ?? null,
            expectedEffect,
          });
        }
        const taskId = `boss-direct-${sessionId}`;
        const stepId = "direct";
        const runId = randomId();
        const goal = nonempty(params.goal) ? params.goal.trim() : undefined;
        const issued = handle.issue({ taskId, stepId, runId, role: "boss-direct", goal });
        sessions.set(sessionId, {
          sessionId,
          taskId,
          stepId,
          runId,
          token: issued.token,
          desktop: grant.desktop,
          goal,
        });
        return resultEnvelope({
          action: { type: "session", desktop: grant.desktop },
          sessionId,
          expectedEffect,
        });
      }

      if (!nonempty(params.sessionId)) {
        return fail({ type: requestedAction }, DIRECT_DRIVE_ERROR.sessionRequired, "desktop_session_required: pass sessionId from a prior computer_task desktop session.");
      }
      const session = sessions.get(params.sessionId.trim());
      if (!session) {
        return fail({ type: requestedAction }, DIRECT_DRIVE_ERROR.sessionUnknown, "desktop_session_unknown: no Boss-driven desktop session matches this sessionId.", params.sessionId.trim());
      }

      if (requestedAction === "close") {
        const handle = await brokerOrThrow();
        handle.revokeTask(session.taskId);
        sessions.delete(session.sessionId);
        return resultEnvelope({ action: { type: "close" }, sessionId: session.sessionId, expectedEffect });
      }

      const handle = await brokerOrThrow();
      let request: ComputerWorkerBrokerRequest;
      let actionRecord: DirectDriveActionRecord;
      try {
        if (requestedAction === "observe") {
          request = { operation: "observe", payload: { fresh: params.fresh !== false } };
          actionRecord = { type: "observe", fresh: params.fresh !== false };
        } else if (requestedAction === "open_application") {
          request = {
            operation: "openApplication",
            payload: {
              ...(nonempty(params.bundle_identifier) ? { bundle_identifier: params.bundle_identifier.trim() } : {}),
              ...(nonempty(params.application_name) ? { application_name: params.application_name.trim() } : {}),
            },
          };
          actionRecord = { type: "open_application", ...request.payload };
        } else {
          validateDesktopActions(params.actions);
          request = { operation: "mutate", payload: { actions: params.actions } };
          actionRecord = { type: "act", actions: params.actions };
        }
      } catch (error) {
        return fail( { type: requestedAction }, "invalid_direct_drive_payload", error instanceof Error ? error.message : String(error), session.sessionId);
      }

      try {
        const raw = await handle.execute(session.token, request, options.signal);
        const observation = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
        const changed = screenChangedBetween(session.lastObservation, observation);
        if (observation) session.lastObservation = observation;
        return resultEnvelope({
          action: actionRecord,
          observation,
          screenChanged: changed,
          sessionId: session.sessionId,
          expectedEffect,
        });
      } catch (error) {
        return resultEnvelope({
          action: actionRecord,
          error: error instanceof Error ? error.message : String(error),
          sessionId: session.sessionId,
          expectedEffect,
        });
      }
    },
  };
}
