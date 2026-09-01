# pipiui-theme-pack

内置配色主题包。纯清单贡献（`app.ui.themes`），无运行时代码：渲染层的主题加载器
（`packages/ui/src/theme-contribution-loader.ts`）在本扩展启用时把清单里的主题合并进
主题注册表，禁用/卸载时自动移除；当前选中的主题失效会回退到跟随系统。

包含主题：护眼绿（forest，深色）、赛博紫（neon，深色）、暖米白（paper，浅色）。

`npm run build` 把本包同步进 `resources/runtime/extensions/pipiui-theme-pack/`（单一来源规则：
不要手改运行时副本）；`npm test` 校验同步后的清单形状。
