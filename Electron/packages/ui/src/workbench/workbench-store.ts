export type WorkbenchLocation = "primarySidebar" | "center" | "auxiliarySidebar" | "statusBar" | "overlay";

export type WorkbenchContainer = {
  id: string;
  location: WorkbenchLocation;
  title: string;
  icon?: string;
  order?: number;
};

export type WorkbenchView = {
  id: string;
  container: string;
};

export type WorkbenchLayout = {
  primarySidebar?: string;
  center?: string;
  auxiliarySidebar?: string;
  activity?: string[];
};

export type ResolvedWorkbenchPlan = {
  profileId: string;
  containers: WorkbenchContainer[];
  views: WorkbenchView[];
  layout: WorkbenchLayout;
};

export type WorkbenchStore = {
  apply(plan: ResolvedWorkbenchPlan): () => void;
  snapshot(): Readonly<ResolvedWorkbenchPlan>;
  subscribe(listener: () => void): () => void;
};

const EMPTY_PLAN: Readonly<ResolvedWorkbenchPlan> = Object.freeze({
  profileId: "empty",
  containers: Object.freeze([]) as unknown as WorkbenchContainer[],
  views: Object.freeze([]) as unknown as WorkbenchView[],
  layout: Object.freeze({}),
});

function semanticId(value: string): boolean {
  return /^[a-z][a-z0-9.-]*$/.test(value);
}

function validate(plan: ResolvedWorkbenchPlan): void {
  if (!semanticId(plan.profileId)) throw new Error("Workbench profileId must be a semantic slug");
  const containers = new Set<string>();
  for (const container of plan.containers) {
    if (!semanticId(container.id)) throw new Error("Workbench container id must be semantic");
    if (containers.has(container.id)) throw new Error(`duplicate Workbench container '${container.id}'`);
    if (!container.title.trim()) throw new Error(`Workbench container '${container.id}' needs a title`);
    containers.add(container.id);
  }
  const views = new Set<string>();
  for (const view of plan.views) {
    if (!semanticId(view.id)) throw new Error("Workbench view id must be semantic");
    if (views.has(view.id)) throw new Error(`duplicate Workbench view '${view.id}'`);
    if (!containers.has(view.container)) throw new Error(`Workbench view '${view.id}' has unknown container '${view.container}'`);
    views.add(view.id);
  }
  for (const id of [plan.layout.primarySidebar, plan.layout.center, plan.layout.auxiliarySidebar]) {
    if (id && !containers.has(id)) throw new Error(`Workbench layout references unknown container '${id}'`);
  }
  for (const id of plan.layout.activity ?? []) {
    if (!containers.has(id)) throw new Error(`Workbench activity references unknown container '${id}'`);
  }
}

function freezePlan(plan: ResolvedWorkbenchPlan): Readonly<ResolvedWorkbenchPlan> {
  return Object.freeze({
    profileId: plan.profileId,
    containers: Object.freeze(plan.containers.map(item => Object.freeze({ ...item }))) as unknown as WorkbenchContainer[],
    views: Object.freeze(plan.views.map(item => Object.freeze({ ...item }))) as unknown as WorkbenchView[],
    layout: Object.freeze({
      ...plan.layout,
      ...(plan.layout.activity ? { activity: Object.freeze([...plan.layout.activity]) as unknown as string[] } : {}),
    }),
  });
}

export function createWorkbenchStore(): WorkbenchStore {
  let current = EMPTY_PLAN;
  let generation = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  return {
    apply(plan) {
      validate(plan);
      const next = freezePlan(plan);
      const ownedGeneration = ++generation;
      current = next;
      emit();
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        if (ownedGeneration !== generation) return;
        generation += 1;
        current = EMPTY_PLAN;
        emit();
      };
    },
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
