import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
// @ts-ignore -- the bundled Pi runtime executes these TypeScript resources directly.
import type { DesktopCondition } from "./checkpoint.ts";
// @ts-ignore -- the bundled Pi runtime executes these TypeScript resources directly.
import type { ActionBlockRequest } from "./action-block.ts";

export type WorkflowState = "candidate" | "practiced" | "suspended";
export type WorkflowV2 = {
  schemaVersion: 2;
  id: string;
  lineageId: string;
  version: number;
  application: { bundleId: string; appName: string; versionRange?: string };
  taskFamily: string;
  intentExamples: string[];
  parameters: Array<{ name: string; required: boolean; description?: string }>;
  preconditions: DesktopCondition[];
  blocks: ActionBlockRequest[];
  postconditions: DesktopCondition[];
  recoveryLessons: string[];
  state: WorkflowState;
  evidence: {
    explorationReceipt: string;
    autonomousSuccessReceipts: string[];
    correctedSuccessReceipts: string[];
    consecutiveDrifts: number;
    consecutiveFailures: number;
    lastUsedAt?: string;
    lastSucceededAt?: string;
  };
};

export type RecoveryLessonV2 = {
  schemaVersion: 2;
  id: string;
  application: { bundleId: string; appName: string };
  taskFamily: string;
  condition: string;
  alternative: string;
  receiptRef: string;
  createdAt: string;
};

type CatalogWorkflow = {
  id: string;
  file: string;
  lineageId: string;
  version: number;
  application: { bundleId: string; appName: string };
  taskFamily: string;
  state: WorkflowState;
  successKeys: string[];
  updatedAt: string;
};

type CatalogLesson = {
  id: string;
  file: string;
  application: { bundleId: string; appName: string };
  taskFamily: string;
  createdAt: string;
};

type Catalog = { schemaVersion: 2; workflows: CatalogWorkflow[]; lessons: CatalogLesson[] };
const EMPTY_CATALOG = (): Catalog => ({ schemaVersion: 2, workflows: [], lessons: [] });

function safeFileId(id: string): string {
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(id)) throw new Error("workflow identity is invalid");
  return id.replaceAll(":", "-");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameApplication(left: { bundleId: string }, right: { bundleId: string }): boolean {
  return left.bundleId.toLowerCase() === right.bundleId.toLowerCase();
}

function validateApplication(application: { bundleId: string; appName: string }): void {
  if (!nonEmpty(application?.bundleId) || !nonEmpty(application?.appName)) throw new Error("workflow application identity is required");
}

function sanitizeIntentExample(value: string): string {
  return value.trim()
    .replace(/(?:^|\s)\/(?:[^\s/]+\/)*[^\s]+/g, " <path>")
    .replace(/["“”'‘’][^"“”'‘’]{2,}["“”'‘’]/g, "<value>")
    .replace(/\b\d{2,}\b/g, "<number>")
    .slice(0, 240);
}

function parameterizeWorkflowBlocks(
  blocks: ActionBlockRequest[],
  seed: WorkflowV2["parameters"] = [],
): { blocks: ActionBlockRequest[]; parameters: WorkflowV2["parameters"] } {
  let parameterIndex = 0;
  const parameters: WorkflowV2["parameters"] = structuredClone(seed);
  const names = new Set(parameters.map(({ name }) => name));
  const next = (description: string) => {
    let name: string;
    do { parameterIndex += 1; name = `input_${parameterIndex}`; } while (names.has(name));
    names.add(name);
    parameters.push({ name, required: true, description });
    return `{{${name}}}`;
  };
  const sanitized = structuredClone(blocks).map((block) => ({
    ...block,
    actions: block.actions.map((action) => {
      const output = { ...action } as Record<string, unknown>;
      if (typeof output.text === "string") output.text = next("task-specific text");
      const target = output.target;
      if (target && typeof target === "object" && !Array.isArray(target)) {
        if ((target as Record<string, unknown>).by === "coordinate") delete output.target;
        else if (typeof (target as Record<string, unknown>).value === "string") {
          output.target = { ...(target as Record<string, unknown>), value: next("task-specific target value") };
        }
      }
      return output as ActionBlockRequest["actions"][number];
    }),
    expectedEffects: block.expectedEffects?.map((condition) => {
      if (condition.kind === "visible_text") return { ...condition, contains: next("task-specific visible text") };
      if (condition.kind === "element_value") return { ...condition, value: next("task-specific element value") };
      return condition;
    }),
  }));
  return { blocks: sanitized, parameters };
}

function parameterizeConditions(
  conditions: DesktopCondition[],
  parameters: WorkflowV2["parameters"],
): DesktopCondition[] {
  let parameterIndex = 0;
  const names = new Set(parameters.map(({ name }) => name));
  const next = (description: string) => {
    let name: string;
    do { parameterIndex += 1; name = `input_${parameterIndex}`; } while (names.has(name));
    names.add(name);
    parameters.push({ name, required: true, description });
    return `{{${name}}}`;
  };
  return structuredClone(conditions).map((condition) => {
    if (condition.kind === "visible_text") return { ...condition, contains: next("task-specific visible text") };
    if (condition.kind === "element_value") return { ...condition, value: next("task-specific element value") };
    return condition;
  });
}

export function taskFamilyForGoal(goal: string): string {
  const normalized = sanitizeIntentExample(goal)
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join("-");
  return normalized || "computer-task";
}

function workflowIsValid(value: unknown): value is WorkflowV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WorkflowV2;
  return item.schemaVersion === 2
    && nonEmpty(item.id)
    && nonEmpty(item.lineageId)
    && Number.isInteger(item.version)
    && item.version > 0
    && nonEmpty(item.application?.bundleId)
    && nonEmpty(item.application?.appName)
    && nonEmpty(item.taskFamily)
    && Array.isArray(item.intentExamples)
    && Array.isArray(item.parameters)
    && Array.isArray(item.preconditions)
    && Array.isArray(item.blocks)
    && Array.isArray(item.postconditions)
    && Array.isArray(item.recoveryLessons)
    && ["candidate", "practiced", "suspended"].includes(item.state)
    && nonEmpty(item.evidence?.explorationReceipt)
    && Array.isArray(item.evidence?.autonomousSuccessReceipts)
    && Array.isArray(item.evidence?.correctedSuccessReceipts)
    && Number.isInteger(item.evidence?.consecutiveDrifts)
    && Number.isInteger(item.evidence?.consecutiveFailures);
}

function lessonIsValid(value: unknown): value is RecoveryLessonV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as RecoveryLessonV2;
  return item.schemaVersion === 2 && nonEmpty(item.id) && nonEmpty(item.application?.bundleId)
    && nonEmpty(item.application?.appName) && nonEmpty(item.taskFamily) && nonEmpty(item.condition)
    && nonEmpty(item.alternative) && nonEmpty(item.receiptRef) && Number.isFinite(Date.parse(item.createdAt));
}

function catalogIsValid(value: unknown): value is Catalog {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && (value as Catalog).schemaVersion === 2
    && Array.isArray((value as Catalog).workflows)
    && Array.isArray((value as Catalog).lessons);
}

export function canonicalSensitiveApplicationPolicy(application: { bundleId: string; appName: string }): boolean {
  return /(?:1password|bitwarden|lastpass|keychain|password|authentication|authenticator|systempreferences|systemsettings)/i
    .test(`${application.bundleId} ${application.appName}`);
}

export class WorkflowMemoryStore {
  readonly #root: string;
  readonly #workflowsDir: string;
  readonly #lessonsDir: string;
  readonly #catalogPath: string;
  readonly #isSensitive: (application: { bundleId: string; appName: string }) => boolean;
  readonly #now: () => string;
  #queue: Promise<void> = Promise.resolve();

  constructor(activeProjectPiHome: string, options: {
    isSensitiveApplication?: (application: { bundleId: string; appName: string }) => boolean;
    now?: () => string;
  } = {}) {
    if (!isAbsolute(activeProjectPiHome)) throw new Error("Workflow Memory requires the backend-resolved absolute active project Pi home");
    this.#root = join(activeProjectPiHome, "computer-use");
    this.#workflowsDir = join(this.#root, "workflows");
    this.#lessonsDir = join(this.#root, "lessons");
    this.#catalogPath = join(this.#root, "catalog.json");
    this.#isSensitive = options.isSensitiveApplication ?? canonicalSensitiveApplicationPolicy;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async #atomicWrite(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }

  async #readCatalog(): Promise<{ catalog: Catalog; isolated: string[] }> {
    try {
      const value = JSON.parse(await readFile(this.#catalogPath, "utf8"));
      if (!catalogIsValid(value)) throw new Error("unknown catalog schema");
      return { catalog: value, isolated: [] };
    } catch (error: any) {
      if (error?.code === "ENOENT") return { catalog: EMPTY_CATALOG(), isolated: [] };
      return { catalog: EMPTY_CATALOG(), isolated: ["catalog.json"] };
    }
  }

  async #mutate<T>(operation: (catalog: Catalog) => Promise<T>): Promise<T> {
    let output!: T;
    const next = this.#queue.then(async () => {
      const { catalog } = await this.#readCatalog();
      output = await operation(catalog);
      await this.#atomicWrite(this.#catalogPath, catalog);
    });
    this.#queue = next.then(() => undefined, () => undefined);
    await next;
    return output;
  }

  async #readWorkflow(file: string): Promise<WorkflowV2 | undefined> {
    try {
      const value = JSON.parse(await readFile(join(this.#workflowsDir, file), "utf8"));
      return workflowIsValid(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async #readLesson(file: string): Promise<RecoveryLessonV2 | undefined> {
    try {
      const value = JSON.parse(await readFile(join(this.#lessonsDir, file), "utf8"));
      return lessonIsValid(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async recordAutonomousSuccess(input: {
    taskId: string;
    runId: string;
    application: { bundleId: string; appName: string; versionRange?: string };
    taskFamily: string;
    intent: string;
    receiptRef: string;
    blocks: ActionBlockRequest[];
    postconditions: DesktopCondition[];
    humanCorrected: boolean;
    parameters?: WorkflowV2["parameters"];
    preconditions?: DesktopCondition[];
  }): Promise<WorkflowV2 | undefined> {
    validateApplication(input.application);
    if (this.#isSensitive(input.application) || input.humanCorrected) return undefined;
    if (input.blocks.some((block) => block.actions.some((action) => action.target?.by === "coordinate" || action.target?.by === "visual"))) return undefined;
    if (![input.taskId, input.runId, input.taskFamily, input.intent, input.receiptRef].every(nonEmpty)) throw new Error("workflow success evidence is incomplete");
    const successKey = `${input.taskId}\u0000${input.runId}`;
    const parameterized = parameterizeWorkflowBlocks(input.blocks, input.parameters);
    const postconditions = parameterizeConditions(input.postconditions, parameterized.parameters);
    return this.#mutate(async (catalog) => {
      const matching = catalog.workflows
        .filter((item) => sameApplication(item.application, input.application) && item.taskFamily === input.taskFamily && item.state !== "suspended")
        .sort((left, right) => right.version - left.version);
      const entry = matching[0];
      if (!entry) {
        const id = `workflow:${randomUUID()}`;
        const now = this.#now();
        const workflow: WorkflowV2 = {
          schemaVersion: 2,
          id,
          lineageId: id,
          version: 1,
          application: structuredClone(input.application),
          taskFamily: input.taskFamily,
          intentExamples: [sanitizeIntentExample(input.intent)],
          parameters: structuredClone(parameterized.parameters),
          preconditions: structuredClone(input.preconditions ?? []),
          blocks: structuredClone(parameterized.blocks),
          postconditions: structuredClone(postconditions),
          recoveryLessons: [],
          state: "candidate",
          evidence: {
            explorationReceipt: input.receiptRef,
            autonomousSuccessReceipts: [input.receiptRef],
            correctedSuccessReceipts: [],
            consecutiveDrifts: 0,
            consecutiveFailures: 0,
            lastUsedAt: now,
            lastSucceededAt: now,
          },
        };
        const file = `${safeFileId(id)}.json`;
        await this.#atomicWrite(join(this.#workflowsDir, file), workflow);
        catalog.workflows.push({
          id, file, lineageId: id, version: 1,
          application: { bundleId: input.application.bundleId, appName: input.application.appName },
          taskFamily: input.taskFamily, state: "candidate", successKeys: [successKey], updatedAt: now,
        });
        return structuredClone(workflow);
      }
      const workflow = await this.#readWorkflow(entry.file);
      if (!workflow) throw new Error(`workflow record ${entry.id} is corrupt`);
      if (entry.successKeys.includes(successKey)) return structuredClone(workflow);
      entry.successKeys.push(successKey);
      workflow.evidence.autonomousSuccessReceipts.push(input.receiptRef);
      workflow.evidence.consecutiveDrifts = 0;
      workflow.evidence.consecutiveFailures = 0;
      workflow.evidence.lastUsedAt = this.#now();
      workflow.evidence.lastSucceededAt = workflow.evidence.lastUsedAt;
      const example = sanitizeIntentExample(input.intent);
      if (example && !workflow.intentExamples.includes(example)) workflow.intentExamples = [...workflow.intentExamples, example].slice(-8);
      if (entry.successKeys.length >= 2) workflow.state = "practiced";
      entry.state = workflow.state;
      entry.updatedAt = workflow.evidence.lastUsedAt;
      await this.#atomicWrite(join(this.#workflowsDir, entry.file), workflow);
      return structuredClone(workflow);
    });
  }

  async recordRecoveryLesson(input: {
    application: { bundleId: string; appName: string };
    taskFamily: string;
    condition: string;
    alternative: string;
    receiptRef: string;
  }): Promise<RecoveryLessonV2 | undefined> {
    validateApplication(input.application);
    if (this.#isSensitive(input.application)) return undefined;
    if (![input.taskFamily, input.condition, input.alternative, input.receiptRef].every(nonEmpty)) throw new Error("Recovery Lesson is incomplete");
    return this.#mutate(async (catalog) => {
      for (const duplicate of catalog.lessons.filter((item) => sameApplication(item.application, input.application) && item.taskFamily === input.taskFamily)) {
        const lesson = await this.#readLesson(duplicate.file);
        if (lesson?.condition === sanitizeIntentExample(input.condition) && lesson.alternative === sanitizeIntentExample(input.alternative)) return lesson;
      }
      const id = `lesson:${randomUUID()}`;
      const lesson: RecoveryLessonV2 = {
        schemaVersion: 2,
        id,
        ...structuredClone(input),
        condition: sanitizeIntentExample(input.condition),
        alternative: sanitizeIntentExample(input.alternative),
        createdAt: this.#now(),
      };
      const file = `${safeFileId(id)}.json`;
      await this.#atomicWrite(join(this.#lessonsDir, file), lesson);
      catalog.lessons.push({ id, file, application: structuredClone(input.application), taskFamily: input.taskFamily, createdAt: lesson.createdAt });
      return structuredClone(lesson);
    });
  }

  async recall(input: {
    application: { bundleId: string; appName: string };
    taskFamily: string;
    intent: string;
  }): Promise<{
    entries: Array<{ kind: "workflow"; workflow: WorkflowV2 } | { kind: "lesson"; lesson: RecoveryLessonV2 }>;
    isolatedRecords: string[];
  }> {
    validateApplication(input.application);
    if (this.#isSensitive(input.application)) return { entries: [], isolatedRecords: [] };
    await this.#queue;
    const { catalog, isolated } = await this.#readCatalog();
    const isolatedRecords = [...isolated];
    try {
      const files = await readdir(this.#workflowsDir);
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        if (!await this.#readWorkflow(file)) isolatedRecords.push(file);
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") isolatedRecords.push("workflows/");
    }
    const workflowCandidates: WorkflowV2[] = [];
    for (const entry of catalog.workflows
      .filter((item) => sameApplication(item.application, input.application) && item.taskFamily === input.taskFamily && item.state !== "suspended")
      .sort((left, right) => (right.state === "practiced" ? 1 : 0) - (left.state === "practiced" ? 1 : 0) || right.updatedAt.localeCompare(left.updatedAt))) {
      const workflow = await this.#readWorkflow(entry.file);
      if (!workflow) { isolatedRecords.push(entry.file); continue; }
      workflowCandidates.push(workflow);
    }
    const lessons: RecoveryLessonV2[] = [];
    for (const entry of catalog.lessons
      .filter((item) => sameApplication(item.application, input.application) && item.taskFamily === input.taskFamily)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
      const lesson = await this.#readLesson(entry.file);
      if (!lesson) { isolatedRecords.push(entry.file); continue; }
      lessons.push(lesson);
    }
    const entries: Array<{ kind: "workflow"; workflow: WorkflowV2 } | { kind: "lesson"; lesson: RecoveryLessonV2 }> = [];
    if (workflowCandidates[0]) entries.push({ kind: "workflow", workflow: workflowCandidates[0] });
    entries.push(...lessons.slice(0, 2).map((lesson) => ({ kind: "lesson" as const, lesson })));
    return { entries: entries.slice(0, 3), isolatedRecords: [...new Set(isolatedRecords)] };
  }

  async recordFailure(id: string, failure: { kind: "drift" | "failure" | "outcome_unknown" }): Promise<WorkflowV2> {
    return this.#mutate(async (catalog) => {
      const entry = catalog.workflows.find((item) => item.id === id);
      if (!entry) throw new Error(`Workflow ${id} not found`);
      const workflow = await this.#readWorkflow(entry.file);
      if (!workflow) throw new Error(`workflow record ${id} is corrupt`);
      if (workflow.state === "suspended") return workflow;
      if (failure.kind === "drift") workflow.evidence.consecutiveDrifts += 1;
      else workflow.evidence.consecutiveFailures += 1;
      if (failure.kind === "outcome_unknown" || workflow.evidence.consecutiveDrifts >= 2 || workflow.evidence.consecutiveFailures >= 2) {
        workflow.state = "suspended";
      }
      entry.state = workflow.state;
      entry.updatedAt = this.#now();
      await this.#atomicWrite(join(this.#workflowsDir, entry.file), workflow);
      return structuredClone(workflow);
    });
  }

  async createRepairCandidate(id: string, input: {
    taskId: string;
    runId: string;
    receiptRef: string;
    blocks: ActionBlockRequest[];
  }): Promise<WorkflowV2> {
    return this.#mutate(async (catalog) => {
      const previousEntry = catalog.workflows.find((item) => item.id === id);
      if (!previousEntry) throw new Error(`Workflow ${id} not found`);
      const previous = await this.#readWorkflow(previousEntry.file);
      if (!previous || previous.state !== "suspended") throw new Error("only a suspended Workflow can produce a repair candidate");
      const parameterized = parameterizeWorkflowBlocks(input.blocks, previous.parameters);
      const version = Math.max(...catalog.workflows.filter((item) => item.lineageId === previous.lineageId).map((item) => item.version)) + 1;
      const repairId = `workflow:${randomUUID()}`;
      const now = this.#now();
      const repair: WorkflowV2 = {
        ...structuredClone(previous),
        id: repairId,
        version,
        parameters: structuredClone(parameterized.parameters),
        blocks: structuredClone(parameterized.blocks),
        state: "candidate",
        evidence: {
          explorationReceipt: input.receiptRef,
          autonomousSuccessReceipts: [input.receiptRef],
          correctedSuccessReceipts: [],
          consecutiveDrifts: 0,
          consecutiveFailures: 0,
          lastUsedAt: now,
          lastSucceededAt: now,
        },
      };
      const file = `${safeFileId(repairId)}.json`;
      await this.#atomicWrite(join(this.#workflowsDir, file), repair);
      catalog.workflows.push({
        id: repairId, file, lineageId: repair.lineageId, version,
        application: structuredClone(repair.application), taskFamily: repair.taskFamily,
        state: "candidate", successKeys: [`${input.taskId}\u0000${input.runId}`], updatedAt: now,
      });
      return structuredClone(repair);
    });
  }
}
