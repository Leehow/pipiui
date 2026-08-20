# 密钥库（内存）

密钥只存在于 Electron 主进程 RAM。秘密目录在进程内共享，挂载按会话。退出 App 后全部丢失。

不使用钥匙串、Keychain、Secret Service、`safeStorage`、`PIPIUI_VAULT_DEK`，也不再读写 `secret-vault.json` / `secret-vault-dek.sealed`。磁盘上已有的旧文件不会被删除，只是不再读取。

主 Pi 通过 `secret_vault_*` 工具与 host IPC 读写同一块主进程内存；没有设置页或手动增删挂载入口。Worker / subagent 只能通过当前会话挂载拿到环境变量，不会拿到 DEK，工具结果里也只有元数据。
