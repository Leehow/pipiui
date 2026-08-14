---
name: pipiui-upload
description: Upload the packaged PipiUI Electron app (build/PipiUI Electron.app) to the DMIT download host and return a public download link on pipi.aichattrpg.com. Use whenever the user asks to 上传 app / 发个下载链接 / 分发一下 / give me a link / upload the build to dmit / share the Electron app / 把打好的包传上去 — also handles uploading any build artifact (.zip/.dmg) to the same downloads host.
---

# PipiUI Upload

Publish the packaged Electron app to the PipiUI download host and hand back a
public link. The host is the DMIT VPS relay (`root@179.253.244.124`, reached
with the existing local RSA key — never create, rotate, print, or copy
credentials) which serves `GET /downloads/<name>` from
`/opt/pipiui-relay/downloads/` at `https://pipi.aichattrpg.com/downloads/<name>`.

## Use the script

From the repo root (`/Users/haoli/leehow/code/pipiui`):

```bash
.agents/skills/pipiui-upload/scripts/pipiui-upload            # zip the canonical app and publish
.agents/skills/pipiui-upload/scripts/pipiui-upload <file>     # publish an existing .zip/.dmg as-is
```

No-argument mode:

1. Refuses to run unless `build/PipiUI Electron.app/Contents/MacOS/PipiUI Electron`
   is newer than every file under `Electron/` (binding rule: never ship a stale
   build — repackage via the `pipiui-electron-build` skill first, or pass
   `--force` only when the user explicitly accepts shipping the current binary).
2. Zips with `ditto -c -k --sequesterRsrc --keepParent` (preserves symlinks and
   the code signature — plain `zip` without symlink handling breaks the bundle)
   to `PipiUI-Electron-YYYY-MM-DD.zip` (~230MB for the ~610MB app).
3. Uploads via `scp` (the VPS has **no rsync** — don't try it), verifies md5 on
   both ends, then verifies the public URL (`HEAD` 200 + `Content-Length`
   matches + a one-byte `Range` request returns 206) before printing the link.

Skips the transfer when the remote file already has the same md5. If the same
date-name already exists remotely with *different* content, it publishes as
`PipiUI-Electron-YYYY-MM-DD-2.zip` (then -3, …) so an already-shared link never
silently changes contents.

## Manual fallback

If the script cannot run, the flow is:

```bash
ditto -c -k --sequesterRsrc --keepParent "build/PipiUI Electron.app" /tmp/PipiUI-Electron-$(date +%F).zip
scp -i ~/.ssh/id_rsa -o IdentitiesOnly=yes -o BatchMode=yes /tmp/PipiUI-Electron-<date>.zip \
  root@179.253.244.124:/opt/pipiui-relay/downloads/
# then verify md5 on both ends, and curl -sSI the public link (200 + correct Content-Length)
```

## Constraints

- The relay listens on loopback only and is published through Cloudflare
  Tunnel; never open ports, and never touch the `sing-box` listener on 443.
  Relay/service changes go through the `dmit` skill's rules.
- Downloads are served with `Cache-Control: no-store`, so a replaced file is
  picked up immediately — no CDN invalidation needed.
- `/downloads/` accepts filenames matching `[A-Za-z0-9][A-Za-z0-9._-]*` only
  (no traversal, no dotfiles); keep artifact names in that grammar.
- The route lives in `Relay/src/tunnel-server.ts` (see `Relay/README.md`
  "App 分发下载"). If the public URL 404s while the file exists on disk, the
  server runs a stale dist — redeploy `Relay/dist/` and restart `pipiui-relay`
  per the dmit skill.
- Disk on the VPS is large (~34GB free) but not infinite; when uploads
  accumulate, ask the user before pruning old zips.

## Related skills

- `pipiui-electron-build` — package the app first (`fast-app`).
- `dmit` — VPS/relay operations, health checks, redeploy.
