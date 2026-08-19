---
name: computer-task-planning
description: Turn one natural-language desktop goal into the shortest observable direct path or a small dependency plan.
---

# Computer Task Planning

Prefer a direct one-Worker path for one application and one coherent interaction. Create multiple Plan Steps only when a later action genuinely depends on a new observation. Every step needs an observable postcondition. The Leader never executes actions. Plan Operator and/or Verifier: observation-only goals may be Verifier-only; a Verifier depends on an Operator only when it verifies a prior GUI mutation. Opening, saving, or choosing a file through Finder, TextEdit, or a file picker is Computer Use. Direct terminal, shell, or filesystem work is not.

`procedureContext` is only for a qualified Procedure replay; omit it for direct, ad hoc GUI work. If it is genuinely available, its application must contain the exact `bundleId` and `appName`, and its `parameters` must be a closed string map. Never infer this context from a PID, build path, or bridge port.

Return one closed JSON plan and no prose. Before returning, self-check: plan `gui-operator` and/or
`verifier` steps; include every explicitly requested CUA worker role; use only earlier step IDs in
`dependsOn`; give every step an observable GUI Postcondition (`visible_text`, `element_exists`, or
`visual_judgement`); never add `terminal-worker`, `file_exists`, or `terminalPolicy`; make
`successConditions` non-empty and exact duplicates of step postconditions. If the Host later supplies
an Admission diagnosis and the rejected candidate, repair that candidate rather than generating an
unrelated replacement. If the diagnosis is that the work needs a terminal or direct filesystem worker,
return control to the Boss. Do not bounce visible GUI file open/save/picker work to the Boss.
