const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const profile = {
  type: "object", additionalProperties: false, required: ["id", "provider", "model", "thinking", "tools"], properties: {
    id: text(64), provider: text(300), model: text(300),
    thinking: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
    tools: { type: "array", maxItems: 64, items: text(160) },
    extensions: { type: "array", maxItems: 32, items: text(8192) },
    skills: { type: "array", maxItems: 32, items: text(8192) },
    systemPrompt: { type: "string", maxLength: 100000 },
  },
};
export const batchParameterProperties = {
  batchId: { ...text(64), description: "调用方选择的语义批次身份；同身份同定义幂等，不重复启动。新复跑使用新身份并受已声明预算约束。" },
  profiles: { type: "array", minItems: 1, maxItems: 4, description: "batch_run的冻结候选与真实Pi配置；id必须是该修订已冻结的variantId。", items: {
    type: "object", additionalProperties: false, required: ["id", "profile"], properties: { id: text(64), profile, environmentKeys: { type: "array", maxItems: 32, items: { ...text(128), pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }, description: "仅引用已授权挂载环境变量的名字；不传或保存密钥值。" } },
  } },
  piCases: { type: "array", minItems: 1, maxItems: 20, description: "Pi批次共同任务和确定性检查，随批次定义固定；不同于旧command cases。", items: {
    type: "object", additionalProperties: false, required: ["id", "title", "prompt", "checks"], properties: {
      id: text(64), title: text(240), prompt: text(100000), expectedAnswer: { type: "string", maxLength: 100000 }, metricsFile: text(1024),
      checks: { type: "array", maxItems: 16, items: { type: "object", additionalProperties: false, required: ["path"], properties: { path: text(1024), expectedText: { type: "string", maxLength: 4096 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } } } },
    },
  } },
  mode: { type: "string", enum: ["comparison", "throughput"] },
  logLimit: { type: "integer", minimum: 4, maximum: 65536, description: "batch_logs的最大读取字节数，默认16384；与状态分页limit分开。" },
  inputRequestId: { ...text(512), description: "该轮真实waiting-input事件给出的请求身份，不自行生成。" },
  response: { type: "object", additionalProperties: false, properties: { value: { type: "string", maxLength: 100000 }, confirmed: { type: "boolean" }, cancelled: { type: "boolean" } } },
};
