# pipiui-github-fetch

`pipiui-github-fetch` is PipiUI's local, official Pi package for the `github_fetch` tool.

- **Version:** `0.1.0`
- **License:** Apache-2.0 (see `LICENSE`)
- **Runtime dependencies:** none. Pi's bundled `@earendil-works/pi-coding-agent` and `typebox` are declared as peers, so users never run `npm install`.

PipiUI copies this checked-in package unchanged to:

```text
~/Library/Application Support/PipiUI/pi-ext/packages/github-fetch
```

`PiPlugin` passes that package directory to Pi with `-e`; Pi reads `package.json` and its `pi.extensions` manifest. The package is independently gated by PipiUI's **GitHub repo / code fetch** built-in feature and exported to nested workers through `PIPIUI_GITHUB_EXT`.

Use `github_fetch` for GitHub repository roots and `/blob/` or `/tree/` URLs. For GitHub issues, pull requests, discussions, wikis, releases, and other rendered pages, use PipiUI's generic `web_fetch` instead.

Repository/tree retrieval uses a fixed `https://github.com/...` anonymous shallow clone. Its Git child environment drops askpass/SSH overrides, injected Git config, every `GIT_HTTP_*` override, and `GH_TOKEN`/`GITHUB_TOKEN`; tokens are used only for optional `api.github.com` Contents API authorization.

The TypeScript under `extensions/` is the source of truth: it is not generated at runtime and has no runtime npm install step, so this directory can later be published as a normal Pi package. The full Apache-2.0 text is included in `LICENSE`.
