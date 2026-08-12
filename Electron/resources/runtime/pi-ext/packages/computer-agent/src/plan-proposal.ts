import path from "node:path";

export type NormalizedComputerPostcondition =
  | { kind: "visible_text"; contains: string }
  | { kind: "element_exists"; name: string }
  | { kind: "file_exists"; path: string }
  | { kind: "visual_judgement"; description: string };

/**
 * A safe, stable explanation for a plan that the Host refused before any
 * worker received authority.  Keep the original parser error out of the
 * parent-model transcript: it is useful to Host tests, but it is neither an
 * actionable explanation for a user nor a safe retry instruction.
 */
export type ComputerPlanAdmissionDiagnostic = {
  code: "path_not_preserved" | "terminal_policy_invalid" | "terminal_objective_invalid" | "postconditions_invalid" | "success_conditions_invalid" | "required_role_missing" | "plan_schema_invalid";
  summary: string;
  leaderInstruction: string;
};

export function diagnoseComputerPlanAdmissionFailure(error: unknown): ComputerPlanAdmissionDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
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
    leaderInstruction: "Re-read the Computer Use Leader plan contract and return one complete closed JSON plan only. Preserve the original goal and do not guess missing fields.",
  };
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

function explicitAbsolutePaths(goal: string): string[] {
  // Chinese prose commonly places punctuation immediately after a path.  Stop
  // before those delimiters instead of absorbing the following clause into a
  // syntactically-valid-but-nonexistent absolute path.
  return [...goal.matchAll(/\/(?:\\ |[^\s"'<>，。；：！？、（）【】「」『』《》])+/gu)]
    .map((match) => match[0].replace(/[),.;:!?，。；：！？]+$/u, ""))
    .filter((candidate) => /^(?:\/Users\/|\/tmp\/|\/var\/|\/private\/|\/Volumes\/)/.test(candidate) && path.isAbsolute(candidate) && path.normalize(candidate) === candidate);
}

export function validateComputerPlanGoalBindings(plan: GoalBoundPlan, goal: string): void {
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
  if (operator && verifier && !verifier.dependsOn.includes(operator.id)) throw new Error("Verifier must depend on the requested GUI Operator step");
  if (terminal && plan.procedureContext) {
    for (const [name, value] of Object.entries(plan.procedureContext.parameters)) {
      if (/(?:content|text|value)/i.test(name) && goal.includes(value) && !terminal.objective.includes(value)) {
        throw new Error("Terminal Worker objective must preserve exact user-supplied content");
      }
    }
  }
}
