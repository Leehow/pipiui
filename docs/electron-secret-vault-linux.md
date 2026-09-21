# 通用工具密钥库（内存）

本页描述 `secret_vault_*` 的通用工具密钥库，不代表所有扩展自己的凭据存储。

通用工具密钥只存在于 Electron 主进程 RAM。秘密目录在进程内共享，挂载按会话。退出 App 后全部丢失。

这条通用工具通道不使用钥匙串、Keychain、Secret Service、`safeStorage`、`PIPIUI_VAULT_DEK`，也不再读写 `secret-vault.json` / `secret-vault-dek.sealed`。磁盘上已有的旧文件不会被删除，只是不再读取。

主 Pi 通过 `secret_vault_*` 工具与 host IPC 读写同一块主进程内存；没有设置页或手动增删挂载入口。Worker / subagent 只能通过当前会话挂载拿到环境变量，不会拿到 DEK，工具结果里也只有元数据。

## Jev 扩展凭据的独立持久化

Jev 扩展设置中的 key 走项目作用域的扩展凭据通道，不通过通用工具的 session mount。它使用 Electron `safeStorage` 加密后写入项目 `.pi/agent/jev-optimizer/credential.enc`，重启恢复；检索、浏览器 Score / Choice 共用这一份。无可用 OS 加密或 Linux 选中了 `basic_text` / `unknown` 时拒绝保存，不降级成明文或内存成功。

该例外不恢复通用 vault 的磁盘存储，不读取上述旧 vault 文件。详见 [Jev Choice 与凭据合同](jev-browser-choice-v1.md)。
