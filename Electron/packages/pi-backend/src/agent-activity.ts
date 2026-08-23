/** Explicit live-tool projection. Never stores prompt, args, or stdout. */

export type AgentActivityFields = {
  listSubtitle?: string;
  activityActive?: boolean;
  activityEndedAt?: number;
  activityToolCallId?: string;
};

export function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function finiteTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function activityText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Diagnostics and activity-only updates must not look like business progress. */
export function isActivityOnlyAgentEvent(raw: Record<string, unknown>): boolean {
  if (raw.kind === "diagnostics" || raw.kind === "activity") return true;
  if (raw.kind !== "update") return false;
  const progressKeys = ["output", "cost", "turns", "usage", "deadlineAt", "stalled", "ok", "aborted"] as const;
  return !progressKeys.some((key) => hasOwn(raw, key) && raw[key] !== undefined);
}

export function mergeAgentActivity(
  raw: Record<string, unknown>,
  current: AgentActivityFields | undefined,
  opts: { sameRun: boolean; terminal: boolean; now: number },
): AgentActivityFields {
  const explicitInactive = hasOwn(raw, "activityActive") && raw.activityActive === false;
  const explicitActive = hasOwn(raw, "activityActive") && raw.activityActive === true;
  const activityProvided = hasOwn(raw, "activity");
  const activityNull = activityProvided && (raw.activity === null || raw.activity === "");
  const nextText = activityText(raw.activity);
  const nextToolCallId = activityText(raw.activityToolCallId);
  const stallLike = raw.kind === "stalled";

  if (opts.terminal || explicitInactive || activityNull || stallLike) {
    return {
      listSubtitle: undefined,
      activityActive: false,
      activityEndedAt: finiteTime(raw.activityEndedAt) ?? opts.now,
      activityToolCallId: undefined,
    };
  }

  if (nextText !== undefined || explicitActive) {
    return {
      listSubtitle: nextText ?? (opts.sameRun ? current?.listSubtitle : undefined),
      activityActive: true,
      activityEndedAt: undefined,
      activityToolCallId: nextToolCallId,
    };
  }

  return {
    listSubtitle: opts.sameRun ? current?.listSubtitle : undefined,
    activityActive: opts.sameRun ? current?.activityActive : undefined,
    activityEndedAt: opts.sameRun ? current?.activityEndedAt : undefined,
    activityToolCallId: opts.sameRun ? current?.activityToolCallId : undefined,
  };
}
