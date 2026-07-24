# Agents — read this first

## Constitution (binding)

**Read and follow [`CONSTITUTION.md`](./CONSTITUTION.md).**

Hard rule: **successful compile meant for the runnable app ⇒ refresh `build/PipiUI.app`.**

```bash
./make-app.sh              # required ship path (release .app)
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
| Package App | `./make-app.sh` |
| Test + package | `./scripts/build-app.sh` |
| Dev loop only | `swift run` |

macOS 14+ · SwiftPM · product binary `PipiUI` → `build/PipiUI.app/Contents/MacOS/PipiUI`.
