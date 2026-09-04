import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpCatalogItem, McpCatalogTool, UserMcpServer } from "@pipi/host-api";

const ORIGIN_ORDER = { builtin: 0, extension: 1, project: 2 } as const;

const HOST_ITEM: McpCatalogItem = {
  name: "pi-mcp-extension",
  description: "内置 MCP 宿主。读取当前项目 `.pi/mcp.json`，把第三方 MCP 的工具挂进会话，名称形如 mcp_<连接名>_<工具名>。",
  origin: "builtin",
  sourceId: "pi-mcp-extension",
  sourceName: "MCP 宿主",
  available: true,
  tools: [],
};

const GLM_SEARCH_TOOLS: readonly McpCatalogTool[] = [
  {
    name: "mcp_zhipu_search_*",
    description: "GLM 主会话启动时按智谱 web_search_prime MCP 的 tools/list 动态注册，工具名带 mcp_zhipu_search_ 前缀。",
  },
];

const GLM_VISION_TOOLS: readonly McpCatalogTool[] = [
  {
    name: "image_analysis",
    description: "分析会话附图中的图像。GLM 会话优先走智谱官方视觉 MCP；失败时回退到默认识图路径。",
  },
];

export function bundledMcpItems(runtimeRoot: string): McpCatalogItem[] {
  const glmSearchAvailable = existsSync(join(runtimeRoot, "extensions", "pipiui-glm-search-mcp.ts"));
  return [
    {
      name: "zhipu_search",
      description: "GLM 主会话自动连接智谱 web_search_prime MCP（streamable-http）。非 GLM 模型或没有 API key 时不会挂载。",
      origin: "extension",
      sourceId: "glm-search-mcp",
      sourceName: "GLM Search MCP",
      available: glmSearchAvailable,
      transport: "streamable-http",
      summary: "open.bigmodel.cn/api/mcp/web_search_prime/mcp",
      tools: [...GLM_SEARCH_TOOLS],
    },
    {
      name: "glm-vision",
      description: "GLM 主会话把附图识图交给智谱官方视觉 MCP（@z_ai/mcp-server，stdio）。",
      origin: "extension",
      sourceId: "glm-vision-mcp",
      sourceName: "GLM Vision MCP",
      available: true,
      transport: "stdio",
      summary: "@z_ai/mcp-server",
      tools: [...GLM_VISION_TOOLS],
    },
  ];
}

export function projectMcpItems(servers: readonly UserMcpServer[]): McpCatalogItem[] {
  return servers.map((server) => ({
    name: server.name,
    description: `当前项目 MCP 连接（${server.transport}）：${server.summary}`,
    origin: "project" as const,
    sourceId: "project",
    sourceName: "项目连接",
    available: true,
    transport: server.transport,
    summary: server.summary,
    tools: [],
  }));
}

export function collectMcpCatalog(input: {
  runtimeRoot: string;
  projectServers: readonly UserMcpServer[];
}): McpCatalogItem[] {
  const items = [HOST_ITEM, ...bundledMcpItems(input.runtimeRoot), ...projectMcpItems(input.projectServers)];
  return items.sort((left, right) => {
    const origin = ORIGIN_ORDER[left.origin] - ORIGIN_ORDER[right.origin];
    if (origin !== 0) return origin;
    const source = left.sourceName.localeCompare(right.sourceName) || left.sourceId.localeCompare(right.sourceId);
    if (source !== 0) return source;
    return left.name.localeCompare(right.name);
  });
}
