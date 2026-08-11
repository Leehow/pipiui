import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import { ExternalAuthRuntime } from "../src/external-auth-runtime.js";

const fixture = `
const command = process.argv[2];
const secret = process.env.XAI_API_KEY;
if (command === "list-models") console.log(JSON.stringify({ok:true,models:[
  {provider:"openai-codex",id:"gpt-5.4",reasoning:true},
  ...(secret ? [{provider:"xai",id:"grok-4.5",reasoning:true}] : [])
]}));
else if (command === "list-providers") console.log(JSON.stringify({ok:true,providers:[{id:"xai",name:"xAI",auth:{apiKey:{}}}]}));
else if (command === "logout") console.log(JSON.stringify({ok:true}));
else if (command === "login-json") { console.log(JSON.stringify({event:"prompt",prompt:{type:"secret",message:"API key"}})); process.stdin.once("data", data => { const answer=JSON.parse(String(data)).answer; console.log(JSON.stringify({ok:true,result:{accepted:answer.length}})); }); }
else process.exit(2);
`;

describe("external Pi model runtime", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("uses the external helper and overlays .env under a Finder-like sparse environment without exposing values", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-auth-"));
    const agentDir = join(root, "agent");
    const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir);
    await writeFile(join(agentDir, ".env"), "XAI_API_KEY=do-not-expose\n");
    await writeFile(helperPath, fixture);
    const runtime = new ExternalAuthRuntime({ helperPath, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root, PATH: "/usr/bin:/bin" } });
    const models = await runtime.getAvailable();
    expect(models.map(model => `${model.provider}/${model.id}`)).toEqual(["openai-codex/gpt-5.4", "xai/grok-4.5"]);
    expect(JSON.stringify(models)).not.toContain("do-not-expose");
  });

  it("uses the embedded Pi command's Node for auth without an external Node lookup", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-backend-"));
    const agentDir = join(root, "agent");
    const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir);
    await writeFile(helperPath, fixture);
    const piCommand = { executable: process.execPath, prefixArgs: ["/bundle/pi/dist/cli.js"], piPath: "/bundle/pi/bin/pi", env: { PIPIUI_NODE_PATH: process.execPath, PIPIUI_PI_PATH: "/bundle/pi/bin/pi" } };
    const backend = createPiHostBackend({ agentDir, authHelperPath: helperPath, piCommand, env: { HOME: root, PATH: "/usr/bin:/bin" } });
    expect((await backend.handle("listModels", []) as any[]).map(model => `${model.provider}/${model.id}`)).toEqual(["openai-codex/gpt-5.4"]);
    await writeFile(helperPath, "throw new Error('node:sqlite unavailable')\n");
    const failed = createPiHostBackend({ agentDir, authHelperPath: helperPath, piCommand, env: { HOME: root } });
    await expect(failed.handle("listModels", [])).rejects.toThrow("Pi 模型目录不可用");
  });

  it("preserves interactive login while keeping the API key off argv and result events", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-login-"));
    const agentDir = join(root, "agent"); const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir); await writeFile(helperPath, fixture);
    const runtime = new ExternalAuthRuntime({ helperPath, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root } });
    const secret = "sk-never-serialize";
    const result = await runtime.login("xai", "api_key", { prompt: async () => secret, notify: () => undefined });
    expect(result).toEqual({ accepted: secret.length });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
