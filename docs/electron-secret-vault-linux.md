# Linux 密钥库（Ubuntu 22.04 / 24.04 x64）

Electron 密钥库沿用系统密钥服务（Secret Service / `safeStorage`），**不会降级成明文**。
普通聊天不依赖密钥库；只有打开设置 → **密钥库** 或把密钥写入库时才需要桌面会话。

## 需要什么

- 已登录的图形桌面会话（不要在纯 SSH、容器或无桌面环境里用密钥库）
- 已启动并解锁的系统密钥服务
- Ubuntu 优先安装：`gnome-keyring`、`libsecret-1-0`、`libsecret-tools`

正式支持：Ubuntu 22.04 / 24.04 x64，安装包是 `.deb` 与 AppImage。Linux ARM、无桌面和容器环境暂不承诺。

## Ubuntu 安装示例

在桌面会话里执行：

```bash
sudo apt install gnome-keyring libsecret-1-0 libsecret-tools
```

然后解锁登录密钥环（桌面一般会提示），回到 PipiUI 设置 → 密钥库点 **重试检测**。

不需要额外账号、邮箱验证或二次登录。PipiUI 不会自动 `sudo` / `apt` 安装依赖。

## 不可用时

密钥库页面会显示可关闭的中文说明，并给出可复制的安装命令。关闭提示或关掉设置后，普通聊天仍可继续。

常见原因：

- 缺包：未安装 gnome-keyring / libsecret
- 没有桌面会话总线：纯 SSH、容器、无 `DBUS_SESSION_BUS_ADDRESS`
- 密钥服务不可达：gnome-keyring 未启动
- 密钥环锁定：登录密钥环尚未解锁
- 无图形会话：没有 `DISPLAY` / `WAYLAND_DISPLAY`

## 存放位置

Linux 的 App-profile 在 `~/.config/@pipiui/electron/`。加密后的密钥库在该 profile 的 `pi-agent/` 下，DEK 由系统密钥服务密封，旁边不会出现明文 `secret-vault.key`。
