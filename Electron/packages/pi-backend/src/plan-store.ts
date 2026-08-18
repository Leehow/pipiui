/**
 * Host-side mirror of the `pipiui-plan` extension's plan state.
 *
 * The extension is the writer: it persists `<cwd>/.pi/plans/<sessionId>.json`
 * and posts each mutation to the bridge. This store keeps the live per-session
 * view the Plan panel subscribes to, and rehydrates from that same file so a
 * resumed or reloaded session still shows the plan it was executing.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizePlanSnapshot,
  planEventKind,
  sortPlans,
  type PlanEvent,
  type PlanEventKind,
  type PlanSnapshot,
} from "@pipi/host-api";

export function planStoreDir(cwd: string): string {
  return join(cwd, ".pi", "plans");
}

/**
 * Must stay identical to `storeFileName` in
 * `resources/runtime/extensions/pipiui-plan.ts` — that extension writes these
 * files and this host reads them, and they cannot share a module (the extension
 * runs inside pi, outside this package). `plan-store-parity.test.ts` pins the
 * two implementations together.
 */
export function planStoreFileName(sessionId?: string): string {
  const safe = (sessionId ?? "").replace(/[^A-Za-z0-9._-]/g, "");
  return safe ? `${safe}.json` : "current.json";
}

export function planStorePath(cwd: string, sessionId?: string): string {
  return join(planStoreDir(cwd), planStoreFileName(sessionId));
}

/**
 * Parse one session's store. A missing, unreadable or malformed file is an
 * empty plan list — the panel then shows its empty state instead of an error,
 * which is right: no plan file simply means this session never published one.
 * Plans from a sibling session in the same work tree live in their own file and
 * are deliberately not read here.
 */
export async function readPlanStore(cwd: string, sessionId?: string): Promise<PlanSnapshot[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(planStorePath(cwd, sessionId), "utf8"));
  } catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null) return [];
  const store = raw as { activePlanId?: unknown; plans?: unknown };
  if (typeof store.plans !== "object" || store.plans === null) return [];
  const activeId = typeof store.activePlanId === "string" ? store.activePlanId : null;
  const plans: PlanSnapshot[] = [];
  for (const value of Object.values(store.plans as Record<string, unknown>)) {
    const plan = normalizePlanSnapshot(value);
    if (plan) plans.push({ ...plan, active: plan.id === activeId });
  }
  return plans;
}

/** Later wins on a tie so a just-emitted event is never overwritten by the file it wrote. */
function newer(left: PlanSnapshot, right: PlanSnapshot): PlanSnapshot {
  return right.updatedAt >= left.updatedAt ? right : left;
}

export class PlanStore {
  private readonly bySession = new Map<string, Map<string, PlanSnapshot>>();
  private readonly hydrated = new Set<string>();

  /**
   * Record one bridge `plan_event`. Returns the host event to publish, or null
   * when the payload is not a recognizable plan mutation (never throws: a bad
   * runtime message must not break the reporting call that carried it).
   */
  accept(event: Record<string, unknown>, sessionId: string): PlanEvent | null {
    const kind = planEventKind(event.event);
    const plan = normalizePlanSnapshot(event.plan);
    if (!kind || !plan) return null;
    const stored: PlanSnapshot = { ...plan, sessionId, active: kind !== "plan_cancel" };
    const plans = this.plansFor(sessionId);
    // `plan_publish` makes its plan the store's single active plan.
    if (kind === "plan_publish" || kind === "plan_cancel") {
      for (const [id, other] of plans) if (id !== stored.id && other.active) plans.set(id, { ...other, active: false });
    }
    plans.set(stored.id, stored);
    return { type: "plan", sessionId, kind, plan: stored };
  }

  /** Known plans for one session, newest activity first. */
  list(sessionId: string): PlanSnapshot[] {
    return sortPlans([...this.plansFor(sessionId).values()]);
  }

  /**
   * Fold plans read off disk into the session view. In-memory copies win only
   * when they are at least as new, so a store written by another window still
   * lands while a live event is never rolled back by a stale file.
   */
  merge(sessionId: string, plans: readonly PlanSnapshot[]): void {
    const known = this.plansFor(sessionId);
    for (const plan of plans) {
      const current = known.get(plan.id);
      const merged = current ? newer(current, { ...plan, sessionId }) : { ...plan, sessionId };
      known.set(plan.id, { ...merged, sessionId });
    }
  }

  /** True once this session has read its plan file, so a cold read happens once per session. */
  needsHydration(sessionId: string): boolean {
    return !this.hydrated.has(sessionId);
  }

  markHydrated(sessionId: string): void {
    this.hydrated.add(sessionId);
  }

  forget(sessionId: string): void {
    this.bySession.delete(sessionId);
    this.hydrated.delete(sessionId);
  }

  clear(): void {
    this.bySession.clear();
    this.hydrated.clear();
  }

  private plansFor(sessionId: string): Map<string, PlanSnapshot> {
    const existing = this.bySession.get(sessionId);
    if (existing) return existing;
    const created = new Map<string, PlanSnapshot>();
    this.bySession.set(sessionId, created);
    return created;
  }
}

export type { PlanEventKind, PlanSnapshot };
