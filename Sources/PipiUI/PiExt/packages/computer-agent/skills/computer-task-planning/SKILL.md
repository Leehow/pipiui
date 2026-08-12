---
name: computer-task-planning
description: Turn one natural-language desktop goal into the shortest observable direct path or a small dependency plan.
---

# Computer Task Planning

Prefer a direct one-Worker path for one application and one coherent interaction. Create multiple Plan Steps only when a later action genuinely depends on a new observation. Every step needs an observable postcondition. The Leader never executes actions.

Return one closed JSON plan and no prose. Before returning, self-check: copy every explicit path
exactly; include every explicitly requested private worker role; use only earlier step IDs in
`dependsOn`; give Terminal exactly one nested `terminalPolicy`; make `successConditions` non-empty
and exact duplicates of step postconditions. If the Host later supplies an Admission diagnosis and
the rejected candidate, repair that candidate rather than generating an unrelated replacement.
