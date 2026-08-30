# 自动扫描外部会话 (`external-session-scan`)

内置扩展：自动扫描 Codex / Claude / Cursor 等外部 coding agent 的聊天记录并显示在侧栏。

- 设置面板嵌在「扩展」tab，不可卸载，默认启用。
- 持久化仍写 `<agentDir>/pipiui-settings.json` 的 `scanExternalSessions`（默认开）。不要改文件格式或位置。
- 项目禁用（`ext-enabled.json`）后后端列表不再产出外部会话，侧栏不显示；重新启用后行为与今天完全一致。
