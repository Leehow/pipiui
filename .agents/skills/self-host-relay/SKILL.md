---
name: "self-host-relay"
description: "用户要用自己的服务器搭建 PipiUI 远程链接（Relay + browser-ui）时按此流程部署，不要指向我们的 deepwood。"
version: 1
created: "2026-08-18"
updated: "2026-08-18"
---
## When to Use
Use when the user wants to self-host PipiUI remote control / 远程链接 / Relay on their own VPS or domain, or when the remote-control teaching modal sent the canned setup prompt.

## Procedure
1. Ask only for what is missing: SSH login (host/user/key), a domain with DNS A record, and whether they already have nginx or Cloudflare Tunnel.
2. Do not use remote.deepwood.cn or pipi.aichattrpg.com as their server. Those are ours.
3. There is no installer tarball. Deploy unit is repo Relay/ plus Electron/packages/ui/dist/browser as browser-ui.
4. On their server: copy Relay/ to /opt/pipiui-relay, Node >=22, npm ci && npm run build (on the server, not this Mac if Clash proxy would hang).
5. Write /etc/pipiui-relay.env from Relay/deploy/pipiui-relay.env.example: PIPIUI_RELAY_HOST=127.0.0.1, PORT=8787, PIPIUI_PUBLIC_ORIGIN=https://their-domain, PIPIUI_TUNNEL_URL=wss://their-domain/tunnel/ws, PIPIUI_BROWSER_UI_DIR=/opt/pipiui-relay/browser-ui.
6. Install Relay/deploy/pipiui-relay.service, enable --now, check healthz.
7. Build browser-ui from this repo with Electron/packages/ui ../../node_modules/.bin/vite build --config vite.browser.config.ts (no npx/npm on this Mac). rsync dist/browser/ to /opt/pipiui-relay/browser-ui. Do not restart relay for static UI-only updates.
8. TLS: nginx+certbot on 443 with WebSocket upgrade, or Cloudflare Tunnel to 127.0.0.1:8787. Follow Relay/README.md.
9. When https://their-domain/healthz works, tell them to open 远程控制, put that origin in 服务器地址, then turn the switch on. Pair URL must keep #secret.
10. Never commit, never push, never write their secrets into the repo.

## Pitfalls
- pipiui-upload only publishes Electron zip to our existing DMIT host — it does not install Relay for a third party.
- This Mac's npm via Clash hangs; do not npm install locally. Build vite with the existing binary; run npm ci only on their VPS.
- Restarting pipiui-relay wipes in-memory pair rooms. Restart only when Relay JS changed.
- Packaged App has no env; origin must be set in the 远程控制 panel (start/reset relayOrigin), not PIPIUI_RELAY_ORIGIN.

## Verification
1. curl -sS https://their-domain/healthz returns {"ok":true}
2. Pair page at https://their-domain/pair/<id>#secret loads browser-ui, not the old white fallback
3. PipiUI 远程控制 using that origin reaches status 已连接 Relay and shows a pair URL on that host