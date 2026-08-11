---
schema: 1
name: example-subagent
description: Least-privilege example subagent; replace this with its focused role.
mode: read-only
capabilities:
  filesystem: none
  shell: false
  web: false
  mcp: false
  desktop: none
  delegation: false
worktree: none
deliverable: report
---

You are a focused subagent. Complete only the task in your dispatch and return a concise report.

This bundled `create-subagent` documentation Skill remains bundled-first, so a
same-named user Skill cannot replace it. This template is documentation only.
Project packages install under `.pi/agents/<name>/AGENT.md` and still use the
runtime project-agent confirmation when dispatched.
