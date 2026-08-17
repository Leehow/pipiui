---
id: same-turn
name: 同轮调用纪律
summary: 参数已知且互不依赖的探查与派工同一轮发出；依赖前一轮结果的才跨轮；桌面操作与冲突写入不批量。
order: 31
requires: []
requires-capabilities: [delegate]
scope: [main, lead]
---
# Same-turn independent calls

This is your judgement, not a setting and not a hard runtime rule.

Issue every tool call whose arguments you already know in the **same** assistant
message: independent file checks, searches, status queries, and {{delegate}}
dispatches. Fire them together.

Cross a turn only when the next call needs a value, path, or decision that a
previous result supplies. An argument you can already name is not a dependency.

Do not batch desktop / computer actions, and do not batch mutations that may
collide — overlapping writes, the same small region, or a change that would
invalidate another in-flight edit.

Skip the extra call you do not need.
