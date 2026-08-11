---
name: procedure-learning
description: Compile verified Computer Task exploration into safe parameterized Procedure candidates.
---

# Procedure learning

Only compile a candidate from a host-issued receipt for the sanitized executed trajectory after the task's declared Postconditions were independently verified. Never compile a planner-authored draft or Worker self-report. Parameterize user-specific paths and content. Retain only closed-schema semantic locators, action categories, Preconditions, consequential-step Postconditions, recovery rules, and artifact references. Apply the host-injected canonical sensitive-application predicate at compile, store, lookup, replay, repair, and promotion.

Reject screenshots, AX source, coordinates, element tokens or indexes, PID/window IDs, capability/session values, clipboard data, credentials, URLs, and real typed content. An exploration creates a candidate only. Promote only from two host-verified replay receipts bound to the same Procedure ID/version and fresh Postconditions. Drift creates a new versioned repair candidate and never overwrites a verified version. Repeated failures suspend replay monotonically and return to the agent path.
