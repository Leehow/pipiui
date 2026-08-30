# Web 搜索密钥 (`web-search-keys`)

内置扩展：按项目配置 Pi 联网搜索服务的 API Key。

- 设置面板嵌在「扩展」tab，不可卸载，默认启用。
- 持久化仍写 `<projectRoot>/.pi/agent/web-search.json`，格式不变。密钥永不回传 UI，只回 presence 布尔。
- 项目禁用后路由按「无密钥 / 不重排」组合；已写入的密钥留在文件里，重新启用后继续生效。
