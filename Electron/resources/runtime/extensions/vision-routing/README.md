# 识图模型 (`vision-routing`)

内置扩展：主线模型不支持图片时，用指定识图模型识别图片后交给文字模型。

- 设置面板嵌在「扩展」tab，不可卸载，默认启用。
- 持久化仍写 `<agentDir>/pipiui-settings.json` 的 `visionModel` / `visionEnabled`，并维护 `vision.json` 镜像。不要改文件格式或位置。
- 项目禁用（`ext-enabled.json`）后识图回退链路失效，按原样发送图片。
