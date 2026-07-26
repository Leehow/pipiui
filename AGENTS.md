# Agents — read this first

## Constitution (binding)

**Read and follow [`CONSTITUTION.md`](./CONSTITUTION.md).**

Hard rule: **only the primary checkout `/Users/haoli/leehow/code/pipiui` may create a runnable App.** All other linked/temporary worktrees must verify with `swift build` / `swift test` only and must never create `build/PipiUI.app`.

```bash
cd /Users/haoli/leehow/code/pipiui
./make-app.sh              # the sole release .app location
./scripts/build-app.sh     # test (optional skip) then make-app.sh
```

Do **not** report "done / open the app" if only `.build/*` is fresh and `build/PipiUI.app` is older than sources.

Verify after package:

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  <changed-source-files>
```

## Quick map

| Need | Where |
|------|--------|
| Project rules | `CONSTITUTION.md` |
| Build / run docs | `README.md` → 构建运行 |
| Package App (primary checkout only) | `./make-app.sh` → `build/PipiUI.app` |
| Test + package (primary checkout only) | `./scripts/build-app.sh` |
| Worker/dev verification | `swift run` / `swift build` / `swift test` |

macOS 14+ · SwiftPM · the only product bundle is `/Users/haoli/leehow/code/pipiui/build/PipiUI.app`.
