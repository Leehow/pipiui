import path from "node:path";

export type NormalizedComputerPostcondition =
  | { kind: "visible_text"; contains: string }
  | { kind: "element_exists"; name: string }
  | { kind: "file_exists"; path: string }
  | { kind: "visual_judgement"; description: string };

export type ComputerTaskRecoveryPolicy = "auto" | "fail_fast";

const RECOVERY_POLICY_CLAUSE_BOUNDARY = /[。.!?；;\n]+/u;
const CLOSED_NO_RECOVERY_CLAUSE = /^(?:(?:please\s+)?(?:do\s+not|don't|never)|(?:you\s+)?must\s+not)\s+(?:generate|create|make|produce|start|attempt)\s+(?:an?\s+)?(?:recovery|retry|repair)(?:\s+(?:plan|workflow|attempt))?\b|^(?:请)?(?:不要|不|禁止|不得|切勿)(?:再)?(?:生成|创建|制定|提出|启动|进行|尝试)?(?:任何)?(?:恢复|重试|修复|补救)(?:计划|方案|流程|尝试)?/iu;
const CLOSED_FAILURE_STOP_CLAUSE = /\b(?:if|when|after)\s+(?:the\s+)?(?:observe|observation|verification|worker|verifier|step|operation)?\s*(?:fails?|failed|failure|is\s+blocked)\b[^.!?;]{0,48}\b(?:stop|end|return|report)\b|(?:observe|观察|观测|验证|操作|步骤|worker|verifier)?\s*(?:失败|出错|受阻|无法完成)(?:后|时|则|就)?(?:立即|直接)?(?:如实)?(?:停止|结束|返回|报告)(?:任务|结果)?/iu;

/**
 * Project a closed, explicit no-recovery instruction into a typed policy.
 * Both halves are required so ordinary repair guidance cannot disable recovery.
 */
export function normalizeComputerTaskRecoveryPolicy(
  goal: string,
  requested?: ComputerTaskRecoveryPolicy,
): ComputerTaskRecoveryPolicy {
  if (requested !== undefined) return requested;
  const clauses = goal.split(RECOVERY_POLICY_CLAUSE_BOUNDARY).map((clause) => clause.trim()).filter(Boolean);
  return clauses.some((clause) => CLOSED_NO_RECOVERY_CLAUSE.test(clause))
    && clauses.some((clause) => CLOSED_FAILURE_STOP_CLAUSE.test(clause))
    ? "fail_fast"
    : "auto";
}

/**
 * A safe, stable explanation for a plan that the Host refused before any
 * worker received authority.  Keep the original parser error out of the
 * parent-model transcript: it is useful to Host tests, but it is neither an
 * actionable explanation for a user nor a safe retry instruction.
 */
export type ComputerPlanAdmissionDiagnostic = {
  code: "non_cua_worker_not_allowed" | "path_not_preserved" | "terminal_policy_invalid" | "terminal_objective_invalid" | "postconditions_invalid" | "success_conditions_invalid" | "required_role_missing" | "plan_schema_invalid" | "plan_repair_stalled";
  summary: string;
  leaderInstruction: string;
};

export function diagnoseComputerPlanAdmissionFailure(error: unknown): ComputerPlanAdmissionDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  if (/Computer Task accepts only Cua desktop actions/i.test(message)) {
    return {
      code: "non_cua_worker_not_allowed",
      summary: "该计划混入了终端、文件或启动准备工作，不属于 Computer Use，因此未开始执行。",
      leaderInstruction: "Return control to the Boss. The Boss must complete terminal, file, shell, dependency, and bootstrap work with ordinary tools, then submit a new pure-GUI Computer Task containing only Cua GUI Operator and optional Verifier steps.",
    };
  }
  if (/invented or altered an explicit user path/i.test(message)) {
    return {
      code: "path_not_preserved",
      summary: "计划把用户指定的文件路径改成了另一个路径，因此未开始执行。",
      leaderInstruction: "Copy every explicit user file path exactly into the matching file_exists condition and Terminal objective. Do not invent a second file path; terminalPolicy.writeRoots must be the target file's parent directory, not a replacement target.",
    };
  }
	if (/Terminal Worker (?:step requires a bounded terminalPolicy object|writeRoots must be a bounded list of absolute paths|cwd must be an absolute path|allowedExecutables must be a bounded string list|proposal contains no approved canonical executable path|maxCommands must be an integer)/i.test(message)
		|| /terminal (?:allowedExecutables|command budget)/i.test(message)) {
    return {
      code: "terminal_policy_invalid",
      summary: "终端步骤没有给出可安全执行的写入范围，因此未开始执行。",
      leaderInstruction: "Return exactly one nested terminalPolicy on the Terminal Worker step. Set cwd and writeRoots to absolute directories, make writeRoots a non-empty array, and use [] plus 0 only for a terminal_write_file-only step. Never flatten these fields onto the step.",
    };
  }
  if (/Terminal Worker .*?(?:only file_exists|must not use shell redirection|must preserve the exact explicit user path|must preserve exact user-supplied content)/i.test(message)) {
    return {
      code: "terminal_objective_invalid",
      summary: "终端步骤的目标或验证方式超出了受限文件操作契约，因此未开始执行。",
      leaderInstruction: "Use terminal_write_file for the exact requested file and content. Give Terminal Worker only file_exists postconditions; move visual checks to GUI Operator or Verifier.",
    };
  }
  if (/Postcondition|file Postcondition|unsupported kind/i.test(message)) {
    return {
      code: "postconditions_invalid",
      summary: "计划的可观察验收条件格式不完整或不受支持，因此未开始执行。",
      leaderInstruction: "Use only the documented closed Postcondition JSON shapes. Bind each condition to the worker that can observe it, without prose or extra fields.",
    };
  }
  if (/success condition/i.test(message)) {
    return {
      code: "success_conditions_invalid",
      summary: "计划没有把任务级验收条件准确绑定到下属步骤，因此未开始执行。",
      leaderInstruction: "Provide at least one task successCondition and make every one an exact duplicate of a step postcondition. Do not create task-only conditions.",
    };
  }
  if (/omitted explicitly requested|omitted the explicitly requested/i.test(message)) {
    return {
      code: "required_role_missing",
      summary: "计划漏掉了用户明确要求的一类下属，因此未开始执行。",
      leaderInstruction: "Include every explicitly requested worker role and preserve its dependency order before returning the corrected plan.",
    };
  }
  return {
    code: "plan_schema_invalid",
    summary: "Leader 返回的计划不符合 Computer Task 的受限计划格式，因此未开始执行。",
    leaderInstruction: "Re-read the Computer Use Leader plan contract and return one complete closed JSON plan only. Preserve the original goal and do not guess missing fields. Omit procedureContext for direct or ad hoc GUI work. Include it only for a qualified Procedure replay with an exact application bundleId and appName plus a closed string parameters map; never infer it from a PID, build path, or bridge port.",
  };
}

export function shouldRepairComputerPlanAdmission(diagnostic: ComputerPlanAdmissionDiagnostic): boolean {
  return diagnostic.code !== "non_cua_worker_not_allowed";
}

const CONDITION_VALUE_KEYS = {
  visible_text: "contains",
  element_exists: "name",
  file_exists: "path",
  visual_judgement: "description",
} as const;

export function normalizeComputerPostconditionProposals(raw: unknown, scope: string): NormalizedComputerPostcondition[] {
  if (!Array.isArray(raw)) throw new Error(`Computer Plan ${scope} requires a Postcondition array`);
  return raw.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Computer Plan ${scope} Postcondition ${index + 1} requires a closed Postcondition object`);
    }
    const value = candidate as Record<string, unknown>;
    if (value.kind !== undefined && value.type !== undefined && value.kind !== value.type) {
      throw new Error(`Computer Plan ${scope} Postcondition ${index + 1} has conflicting kind and type`);
    }
    const kind = value.kind ?? value.type;
    if (typeof kind !== "string" || !(kind in CONDITION_VALUE_KEYS)) {
      throw new Error(`Computer Plan ${scope} Postcondition ${index + 1} has an unsupported kind`);
    }
    const valueKey = CONDITION_VALUE_KEYS[kind as keyof typeof CONDITION_VALUE_KEYS];
    const allowedKeys = new Set([value.kind === undefined ? "type" : "kind", valueKey]);
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
      throw new Error(`Computer Plan ${scope} Postcondition ${index + 1} has unsupported fields`);
    }
    const observedValue = value[valueKey];
    if (typeof observedValue !== "string" || !observedValue.trim()) {
      throw new Error(`Computer Plan ${scope} Postcondition ${index + 1} requires ${valueKey}`);
    }
    const normalizedValue = observedValue.trim();
    if (kind === "file_exists" && (!path.isAbsolute(normalizedValue) || path.normalize(normalizedValue) !== normalizedValue)) {
      throw new Error(`Computer Plan ${scope} file Postcondition requires an absolute canonical path`);
    }
    return { kind, [valueKey]: normalizedValue } as NormalizedComputerPostcondition;
  });
}

export function normalizeTerminalWorkerObjective(
  objective: string,
  postconditions: NormalizedComputerPostcondition[],
): string {
  if (postconditions.some((condition) => condition.kind !== "file_exists")) {
    throw new Error("Terminal Worker step postconditions may contain only file_exists; visual observations belong to GUI Operator or Verifier");
  }
  if (/\/usr\/bin\/printf|\/bin\/(?:ba)?sh|\b(?:printf|echo)\b[^\n]*(?:>>|>)|(?:^|\s)(?:>>|>)(?:\s|$)/i.test(objective)) {
    throw new Error("Terminal Worker file mutation must not use shell redirection or terminal_execute argv shell syntax");
  }
  if (/(?:\bwrite\b|\bcreate\b|\boverwrite\b|写入|覆盖|创建)/i.test(objective) && !/\bterminal_write_file\b/.test(objective)) {
    return `${objective}\nUse terminal_write_file directly for the exact requested path and content.`;
  }
  return objective;
}

type GoalBoundPlan = {
  steps: Array<{ id: string; role: string; objective: string; dependsOn: string[]; postconditions: NormalizedComputerPostcondition[] }>;
  successConditions: NormalizedComputerPostcondition[];
  procedureContext?: { parameters: Record<string, string> };
};

const NON_CUA_OBJECTIVE = /\bterminal_?(?:read_?file|write_?file|execute)\b|\b(?:bash|zsh|shell|node_modules|bootstrap)\b|\bnpm\s+(?:install|run|start)\b|(?:open|launch|use|through|via|打开|启动|使用|通过)[^\n。.!?]{0,48}(?:Terminal|iTerm|终端)/i;
const NON_CUA_OBJECTIVE_CLAUSE_BOUNDARY = /[。.!?；;\n]+|\b(?:but|however|yet)\b|(?:但是|但|不过|然而)/giu;
const CLOSED_NON_CUA_PROHIBITION = /^(?:(?:please\s+)?(?:do\s+not|don't|never)|(?:you\s+)?must\s+not)\b|^(?:不要|禁止|不得|切勿)/iu;

function objectiveRequestsNonCuaAction(objective: string): boolean {
  return objective
    .split(NON_CUA_OBJECTIVE_CLAUSE_BOUNDARY)
    .map((clause) => clause.trim().replace(/^(?:[-*•]\s*)/, ""))
    .filter(Boolean)
    .some((clause) => NON_CUA_OBJECTIVE.test(clause) && !CLOSED_NON_CUA_PROHIBITION.test(clause));
}

export function validateComputerPlanCandidateCuaOnly(candidate: unknown): void {
  const record = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const containsNonCuaAction = steps.some((candidateStep) => {
    const step = candidateStep && typeof candidateStep === "object" && !Array.isArray(candidateStep) ? candidateStep as Record<string, unknown> : {};
    const postconditions = Array.isArray(step.postconditions) ? step.postconditions : [];
    return step.role === "terminal-worker"
      || postconditions.some((condition) => !!condition && typeof condition === "object" && !Array.isArray(condition) && ((condition as Record<string, unknown>).kind === "file_exists" || (condition as Record<string, unknown>).type === "file_exists"))
      || objectiveRequestsNonCuaAction(String(step.objective ?? ""));
  });
  if (containsNonCuaAction) throw new Error("Computer Task accepts only Cua desktop actions; terminal/file/shell/bootstrap work belongs to the Boss");
}

export function validateComputerPlanCuaOnly(plan: Pick<GoalBoundPlan, "steps">): void {
  validateComputerPlanCandidateCuaOnly(plan);
}

function computerPlanCandidateObject(candidate: string): Record<string, unknown> | undefined {
  const trimmed = candidate.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function computerPlanActionCategory(role: string, objective: string): string {
  if (role === "terminal-worker" || /\bterminal_|\b(?:bash|zsh|shell|npm|bootstrap)\b|(?:Terminal|iTerm|终端)/i.test(objective)) return "non-cua";
  if (role === "verifier" || /\b(?:verify|check|confirm)\b|验证|确认/i.test(objective)) return "verify";
  if (/\b(?:open|launch|navigate|visit|show)\b|打开|启动|进入|导航|显示/i.test(objective)) return "navigate";
  if (/\b(?:click|press|select|choose)\b|点击|按下|选择/i.test(objective)) return "activate";
  if (/\b(?:type|enter|input|fill)\b|输入|填写/i.test(objective)) return "input";
  return role;
}

function stableComputerPlanIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableComputerPlanIdentity);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stableComputerPlanIdentity((value as Record<string, unknown>)[key])]));
}

/** Stable strategy identity for admission repair; policy and prose-only edits do not create another attempt. */
export function computerPlanSemanticFingerprint(candidate: string): string {
  const plan = computerPlanCandidateObject(candidate);
  const steps = Array.isArray(plan?.steps) ? plan.steps.filter((step): step is Record<string, unknown> => !!step && typeof step === "object" && !Array.isArray(step)) : [];
  if (!plan || steps.length === 0) return candidate.trim();
  const indexById = new Map(steps.map((step, index) => [String(step.id ?? `step-${index + 1}`), index]));
  const conditions = (value: unknown) => (Array.isArray(value) ? value : []).map((condition) => {
    const record = condition && typeof condition === "object" && !Array.isArray(condition) ? condition as Record<string, unknown> : {};
    const kind = String(record.kind ?? record.type ?? "unknown");
    return `${kind}:${String(record.contains ?? record.name ?? record.path ?? record.description ?? "").trim()}`;
  }).sort();
  return JSON.stringify({
    mode: plan.mode === "planned" ? "planned" : "direct",
    target: stableComputerPlanIdentity(plan.procedureContext && typeof plan.procedureContext === "object" ? {
      application: (plan.procedureContext as Record<string, unknown>).application ?? null,
      qualification: (plan.procedureContext as Record<string, unknown>).qualification ?? null,
    } : null),
    successConditions: conditions(plan.successConditions),
    steps: steps.map((step) => ({
      role: String(step.role ?? "unknown"),
      action: computerPlanActionCategory(String(step.role ?? "unknown"), String(step.objective ?? "")),
      dependsOn: (Array.isArray(step.dependsOn) ? step.dependsOn : []).map((id) => indexById.get(String(id)) ?? -1).sort((a, b) => a - b),
      postconditions: conditions(step.postconditions),
    })),
  });
}

export function createComputerPlanRepairTracker() {
  const fingerprints = new Set<string>();
  return {
    admit(candidate: string): boolean {
      const fingerprint = computerPlanSemanticFingerprint(candidate);
      if (fingerprints.has(fingerprint)) return false;
      fingerprints.add(fingerprint);
      return true;
    },
    get size(): number { return fingerprints.size; },
  };
}

function explicitAbsolutePaths(goal: string): string[] {
  // Chinese prose commonly places punctuation immediately after a path.  Stop
  // before those delimiters instead of absorbing the following clause into a
  // syntactically-valid-but-nonexistent absolute path.
  return [...goal.matchAll(/\/(?:\\ |[^\s"'<>，。；：！？、（）【】「」『』《》])+/gu)]
    .map((match) => match[0].replace(/[),.;:!?，。；：！？]+$/u, ""))
    .filter((candidate) => /^(?:\/Users\/|\/tmp\/|\/var\/|\/private\/|\/Volumes\/)/.test(candidate) && path.isAbsolute(candidate) && path.normalize(candidate) === candidate);
}

export function validateComputerPlanGoalBindings(plan: GoalBoundPlan, goal: string): void {
  validateComputerPlanCuaOnly(plan);
  const paths = new Set(explicitAbsolutePaths(goal));
  if (paths.size > 0) {
    const proposedFilePaths = [...plan.successConditions, ...plan.steps.flatMap((step) => step.postconditions)]
      .filter((condition): condition is Extract<NormalizedComputerPostcondition, { kind: "file_exists" }> => condition.kind === "file_exists")
      .map((condition) => condition.path);
    const explicitlyNamesFileInDirectory = (candidate: string) => {
      const basename = path.basename(candidate);
      if (!goal.includes(basename)) return false;
      const parent = path.dirname(candidate);
      return [...paths].some((explicit) => {
        // A trailing slash is the user's unambiguous directory notation. Permit
        // only a basename also written verbatim in the goal to be joined under it.
        if (!explicit.endsWith(path.sep)) return false;
        return path.resolve(explicit) === parent;
      });
    };
    if (proposedFilePaths.some((candidate) => !paths.has(candidate) && !explicitlyNamesFileInDirectory(candidate))) throw new Error("Computer Use Leader invented or altered an explicit user path");
    for (const step of plan.steps.filter((candidate) => candidate.role === "terminal-worker")) {
      if (![...paths].some((candidate) => step.objective.includes(candidate))) throw new Error("Terminal Worker objective must preserve the exact explicit user path");
    }
  }
  const affirmativelyMentions = (pattern: RegExp) => [...goal.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))]
    .some((match) => {
      const clausePrefix = goal.slice(Math.max(0, match.index! - 64), match.index).split(/[。.!?;；\n]/).at(-1) ?? "";
      const negated = /(?:不要|不得|禁止|无需|不用|不使用|无须)(?:再)?(?:使用|安排|调用|派发)?[^。.!?;；\n]{0,48}$/i.test(clausePrefix)
        || /\b(?:without|no|do\s+not|don't|must\s+not)(?:\s+(?:use|using|spawn|dispatch))?[^.!?;\n]{0,48}$/i.test(clausePrefix);
      return !negated;
    });
  const requestedRoles = [
    { role: "terminal-worker", requested: affirmativelyMentions(/\bterminal worker\b|\bcomputer-terminal\b/i) },
    { role: "gui-operator", requested: affirmativelyMentions(/\bgui operator\b|\boperator\b|图形(?:化)?操作/i) },
    { role: "verifier", requested: affirmativelyMentions(/\bcomputer-verifier\b|\bverifier\b|独立验证/i) },
  ].filter((entry) => entry.requested);
  for (const { role } of requestedRoles) if (!plan.steps.some((step) => step.role === role)) throw new Error(`Computer Plan omitted explicitly requested ${role}`);
  if (/textedit/i.test(goal) && !plan.steps.some((step) => step.role === "gui-operator" && /textedit/i.test(step.objective))) throw new Error("Computer Plan omitted the explicitly requested TextEdit operation");
  const terminal = plan.steps.find((step) => step.role === "terminal-worker");
  const operator = plan.steps.find((step) => step.role === "gui-operator");
  const verifier = plan.steps.find((step) => step.role === "verifier");
  if (terminal && operator && !operator.dependsOn.includes(terminal.id)) throw new Error("GUI Operator must depend on the requested Terminal Worker step");
  if (operator && verifier) {
    const stepsById = new Map(plan.steps.map((step) => [step.id, step]));
    const pending = [...verifier.dependsOn];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const dependencyId = pending.pop()!;
      if (visited.has(dependencyId)) continue;
      visited.add(dependencyId);
      if (dependencyId === operator.id) break;
      pending.push(...(stepsById.get(dependencyId)?.dependsOn ?? []));
    }
    if (!visited.has(operator.id)) throw new Error("Verifier must depend on the requested GUI Operator step");
  }
  if (terminal && plan.procedureContext) {
    for (const [name, value] of Object.entries(plan.procedureContext.parameters)) {
      if (/(?:content|text|value)/i.test(name) && goal.includes(value) && !terminal.objective.includes(value)) {
        throw new Error("Terminal Worker objective must preserve exact user-supplied content");
      }
    }
  }
}
