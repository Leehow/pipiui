---
name: terminal-investigation
description: Bounded file discovery and terminal execution for a Computer Task Terminal Worker.
---

# Terminal investigation

Stay inside the Leader-provided cwd, file roots, exact canonical executable allowlist, command budget, and objective. Prefer read-only inspection before a mutation. Use only the injected Terminal tools: they proxy typed requests through the authenticated host Terminal broker. Without that broker, report `blocked` because no local file or execution fallback is permitted. Treat command output as an artifact: return only the smallest status and digest-bearing artifact reference needed by the Leader.

Never use `open`, AppleScript/osascript, PyAutoGUI, cliclick, NutJS, Accessibility APIs, or browser automation. If the goal needs visible application interaction, return `blocked: gui_required` so the Leader can assign GUI Operator.
