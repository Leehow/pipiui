# PipiUI Relay（自托管）

PipiUI 远程能力隧道的中继服务：提供配对页与 `/tunnel/ws` WebSocket。  
浏览器与 Mac 通过同一（或分离的）HTTPS/WSS 域名接入；**无需账号、OTP、设备注册或长期 token**。

另有独立的 Host API v2 远控 broker：Electron host 出站连接 `/relay/host`，浏览器经 `/pair/<roomID>#<32-byte-secret>` 配对后使用同源 `/ws`。Relay 只做有界透明转发，不创建 PiHostBackend、不改业务 JSON。旧 `/tunnel/ws` 与 `/downloads` 行为不变。

## 服务器要求

- Ubuntu（或同类 systemd Linux）
- Node.js ≥ 22
- 公网可达的 80/443（用于 certbot 与业务流量）
- 一条 DNS **A 记录**指向该服务器

## 快速部署

### 1. 拷贝并构建

```bash
# 将仓库中的 Relay/ 目录拷到服务器，例如：
sudo mkdir -p /opt/pipiui-relay
sudo rsync -a ./Relay/ /opt/pipiui-relay/
cd /opt/pipiui-relay
npm ci
npm run build
```

产物入口：`dist/tunnel-server.js`。

### App 分发下载

`GET /downloads/<相对路径>` 从 `<relay>/downloads/`（默认 `/opt/pipiui-relay/downloads/`）流式分发
App 构建包与安装器静态文件（`.zip`/`.dmg`/`.json` 等），支持 `Range` 断点续传。
路径最多 4 段、总长受段规则约束；每一段必须以 `[A-Za-z0-9]` 开头，段内仅
`[A-Za-z0-9._-]`，不允许空段、点文件或 `..`。解析后必须仍落在 downloads 根目录内。
例如 `/downloads/slab/seed/index.json`。上传新构建：

```bash
rsync -a --partial PipiUI-Electron-<date>.zip root@<server>:/opt/pipiui-relay/downloads/
# 公网链接即 https://<public-origin>/downloads/PipiUI-Electron-<date>.zip
```

### 2. 环境变量

参考 `deploy/pipiui-relay.env.example`，写入 `/etc/pipiui-relay.env`：

| 变量 | 说明 | 示例 |
|------|------|------|
| `PIPIUI_RELAY_HOST` | 监听地址 | `127.0.0.1` |
| `PIPIUI_RELAY_PORT` | 本地端口 | `8787` |
| `PIPIUI_PUBLIC_ORIGIN` | 浏览器页面源（https） | `https://remote.example.com` |
| `PIPIUI_TUNNEL_URL` | 隧道 WSS（可与页面同主机） | `wss://remote.example.com/tunnel/ws` |
| `PIPIUI_BROWSER_UI_DIR` | 共享 browser UI 静态目录（可选） | `/opt/pipiui-relay/browser-ui` |

单域名自托管时，`PIPIUI_PUBLIC_ORIGIN` 与 `PIPIUI_TUNNEL_URL` 使用**同一主机**即可。

Host API v2 部署时把 `Electron/packages/ui/dist/browser` 拷到 `PIPIUI_BROWSER_UI_DIR`（缺省也会探测仓库内该路径）。未部署时配对仍可用，页面回退到占位 HTML。

### Host API v2 端点

| 路径 | 作用 |
|------|------|
| `WS /relay/host` | Host 出站控制+数据。首帧 `{v:2,type:"hello",roomID,hostToken,pairSecretHash}` |
| `GET /pair/<roomID>` | 仅当该 ID 是 v2 房间时返回 claim 页；否则仍是旧 tunnel 配对页 |
| `POST /pair/<roomID>/claim` | `{secret}` 恒时比对 hash，签发 `pipiui_pair` Secure+HttpOnly+SameSite=Strict |
| `WS /ws` | 浏览器同源 Host API v2；升级时校验 cookie。只转发 `request` |
| `GET /` | 已配对则托管 browser UI；未配对仍是旧提示页 |

外层控制帧用 `{v:2,type}`（`hello`/`ready`/`paired`/`replaced`/`end`/`expired`/`error`/`ping`/`pong`）。业务帧用 `{protocolVersion:2,type:request\|response\|event}`，Relay 原样转发、不改 JSON。browser→host 只允许 request，host→browser 只允许 response/event。

### 3. systemd

使用仓库自带单元 `deploy/pipiui-relay.service`：

```bash
sudo useradd --system --home /opt/pipiui-relay --shell /usr/sbin/nologin pipiui-relay || true
sudo chown -R pipiui-relay:pipiui-relay /opt/pipiui-relay
sudo cp deploy/pipiui-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pipiui-relay
sudo systemctl status pipiui-relay
```

单元默认执行：`node /opt/pipiui-relay/dist/tunnel-server.js`，并从 `/etc/pipiui-relay.env` 读环境变量。

### 4. nginx 反代（含 WebSocket）

将 443 反代到 `127.0.0.1:8787`，并开启 WebSocket upgrade：

```nginx
server {
    listen 443 ssl http2;
    server_name remote.example.com;

    # ssl_certificate / ssl_certificate_key 由 certbot 管理

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### 5. TLS 证书

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d remote.example.com
```

### 6. DNS

为上述域名添加一条 **A 记录** 指向服务器公网 IP。生效后，在 PipiUI「远程连接」面板填入：

```text
https://remote.example.com
```

应用会自动推导 WSS：`wss://remote.example.com/tunnel/ws`。

## 安全说明

- **无公钥/私钥配置、无账号体系**。配对密钥由 Mac 端随机生成，只写在配对链接的 **URL fragment** 中（默认约 24 小时有效），不会进入普通访问日志的 path/query。
- 服务器只转发**有界命令帧**，不保存账号、设备或会话内容，也不提供可降级的公网 HTTP 命令 API。
- TLS 由 Let's Encrypt / certbot 自动签发与续期即可。

## 相关文件

- `deploy/pipiui-relay.service` — systemd 单元
- `deploy/pipiui-relay.env.example` — 环境变量样例
- `package.json` — `npm ci && npm run build` / `npm start`
