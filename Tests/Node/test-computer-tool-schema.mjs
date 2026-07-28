import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const piNodeModules = join(
  homedir(),
  ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent/node_modules",
);

function assertFixedCoordinateArray(schema, label) {
  assert.equal(schema.type, "array", `${label} must remain an array`);
  assert.equal(schema.minItems, 2, `${label} must require two numbers`);
  assert.equal(schema.maxItems, 2, `${label} must allow only two numbers`);
  assert.equal(Array.isArray(schema.items), false, `${label}.items cannot be a tuple array`);
  assert.equal(schema.items?.type, "number", `${label}.items must be one number schema`);
}

function containsTupleItems(value) {
  if (Array.isArray(value)) return value.some(containsTupleItems);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value.items)) return true;
  return Object.values(value).some(containsTupleItems);
}

test("resource-backed computer coordinate schema is xAI-compatible in the custom provider shape", async () => {
  const source = await readFile(
    join(repositoryRoot, "Sources/PipiUI/PiExt/computer-use-strategy.ts"),
    "utf8",
  );
  assert.ok(source, "bundled Computer Use strategy resource was not found");

  const directory = await mkdtemp(join(tmpdir(), "pipiui-computer-schema-"));
  try {
    await mkdir(join(directory, "node_modules"));
    await symlink(
      join(piNodeModules, "typebox"),
      join(directory, "node_modules/typebox"),
      "dir",
    );
    await writeFile(join(directory, "extension.ts"), source, "utf8");
    await writeFile(
      join(directory, "harness.ts"),
      `
import install, {
  compactAccessibility,
  compactToolDetails,
  lifecycleShellBlockReason,
  screenshotToolResult,
} from "./extension.ts";

const tools = new Map<string, any>();
const handlers = new Map<string, any>();
install({
  registerTool(tool: any) { tools.set(tool.name, tool); },
  on(name: string, handler: any) { handlers.set(name, handler); },
} as any);

const computer = tools.get("computer");
if (!computer) throw new Error("computer tool was not registered");
const payload = {
  tools: [{
    type: "function",
    function: {
      name: computer.name,
      description: computer.description,
      parameters: computer.parameters,
    },
  }],
};
const providerResult = handlers.get("before_provider_request")?.(
  { payload },
  { model: { provider: "xai", api: "openai-completions", id: "grok-4" } },
);
const compactAX = compactAccessibility({
  tree_markdown: "[element_index 0] duplicated markdown",
  screenshot_width: 1440,
  elements: [{
    element_index: 0,
    element_token: "required-token",
    role: "AXButton",
  }],
  truncated: true,
});
const compactDetails = compactToolDetails({
  batchOK: true,
  outcomes: [{ index: 0, ok: true }],
  foregroundApp: { bundleID: "com.google.Chrome" },
  accessibility: compactAX,
});
const modelResult = screenshotToolResult(
  {
    base64: "png-base64",
    mimeType: "image/png",
    screenshotId: "bridge-aligned-id",
  },
  {
    batchOK: true,
    outcomes: [{ index: 0, ok: true }],
    accessibility: compactAX,
  },
);
let modelResultFallbackError = null;
try {
  screenshotToolResult(
    { base64: "png-base64-2", mimeType: "image/png" },
    { batchOK: true },
  );
} catch (error) {
  modelResultFallbackError = String(error?.message || error);
}
process.stdout.write(JSON.stringify({
  schema: computer.parameters,
  openApplicationSchema: tools.get("open_application")?.parameters,
  computerDescription: computer.description,
  openApplicationDescription: tools.get("open_application")?.description,
  blockedShellOpenShapes: [
    "/usr/bin/open /Users/me/Downloads",
    "exec /usr/bin/open /Users/me/Downloads",
    "env /usr/bin/open /Users/me/Downloads",
    "\\"/usr/bin/open\\" /Users/me/Downloads",
    "command open /Users/me/Downloads",
    "sh -c '/usr/bin/open /Users/me/Downloads'",
    "/bin/zsh -c 'exec open /Users/me/Downloads'",
    "/usr/bin/env /usr/bin/open /Users/me/Downloads",
    "env -u FOO /usr/bin/open /Users/me/Downloads",
    "command -p /usr/bin/open /Users/me/Downloads",
    "exec -- /usr/bin/open /Users/me/Downloads",
    "bash -lc '/usr/bin/open /Users/me/Downloads'",
    "VAR=x /usr/bin/open /Users/me/Downloads",
  ].map((command) =>
    lifecycleShellBlockReason("bash", { command })
  ),
  allowedLifecycleShellShapes: [
    "pgrep -x Finder",
    "osascript -e 'tell application \\"Finder\\" to quit'",
    "swift test",
    "echo /usr/bin/open is blocked only in command position",
    "tool --open file",
  ].map((command) =>
    lifecycleShellBlockReason("bash", { command })
  ),
  compactAX,
  compactDetails,
  modelResult,
  modelResultFallbackError,
  payload,
  providerPassedThrough: providerResult === undefined,
}));
`,
      "utf8",
    );

    const { stdout } = await execFileAsync(
      join(piNodeModules, ".bin/jiti"),
      [join(directory, "harness.ts")],
      {
        env: {
          ...process.env,
          PIPIUI_BRIDGE_PORT: "9000",
          PIPIUI_SESSION_KEY: "node-schema-test",
          PIPIUI_COMPUTER_CAPABILITY: "node-schema-capability",
          PIPIUI_COMPUTER_DISPLAY_ID: "1",
          PIPIUI_COMPUTER_WIDTH: "1440",
          PIPIUI_COMPUTER_HEIGHT: "900",
        },
      },
    );
    const result = JSON.parse(stdout);
    const schema = result.schema;

    assertFixedCoordinateArray(
      schema.properties.coordinate,
      "computer.coordinate",
    );
    assertFixedCoordinateArray(
      schema.properties.start_coordinate,
      "computer.start_coordinate",
    );
    assertFixedCoordinateArray(
      schema.properties.actions.items.properties.coordinate,
      "computer.actions[].coordinate",
    );
    assertFixedCoordinateArray(
      schema.properties.actions.items.properties.start_coordinate,
      "computer.actions[].start_coordinate",
    );
    assert.equal(
      containsTupleItems(schema),
      false,
      "custom computer schema must not contain tuple-style items arrays",
    );
    assert.equal(
      result.providerPassedThrough,
      true,
      "xAI must keep using the custom provider tool request",
    );
    assert.deepEqual(
      result.payload.tools[0].function.parameters,
      schema,
      "the existing OpenAI-compatible provider shape must carry the fixed schema unchanged",
    );
    assert.match(
      result.openApplicationDescription,
      /deterministic lifecycle tool instead of pixel clicks/,
    );
    assert.match(
      result.openApplicationDescription,
      /Cmd-Shift-G/,
    );
    assert.equal(
      "path" in result.openApplicationSchema.properties,
      false,
    );
    assert.equal(
      "url" in result.openApplicationSchema.properties,
      false,
    );
    assert.equal(
      result.blockedShellOpenShapes.every(
        (reason) => /Do not use shell open/.test(reason),
      ),
      true,
    );
    assert.deepEqual(
      result.allowedLifecycleShellShapes,
      [null, null, null, null, null],
    );
    assert.match(
      result.computerDescription,
      /Routing priority: deterministic app lifecycle first/,
    );
    assert.match(
      result.computerDescription,
      /running-state checks and graceful quit/,
    );
    assert.match(
      result.computerDescription,
      /do not default to force quit or kill -9/,
    );
    assert.match(
      result.computerDescription,
      /Prefer the browser tool for ordinary web tasks/,
    );
    assert.match(
      result.computerDescription,
      /one complete percent-encoded URL/,
    );
    assert.match(
      result.computerDescription,
      /printf '%s' '<URL>' \| pbcopy/,
    );
    assert.match(
      result.computerDescription,
      /one computer batch: CMD\+L, CMD\+V, RETURN, wait/,
    );
    assert.match(
      result.computerDescription,
      /Do not use AppleScript\/osascript or shell open for external-browser navigation/,
    );
    assert.match(
      result.computerDescription,
      /Prefer element_index\/element_token AX actions over screenshot coordinates/,
    );
    assert.match(
      result.computerDescription,
      /Use screenshot coordinates only as a fallback/,
    );
    assert.equal(
      "tree_markdown" in result.compactAX,
      false,
      "model-facing accessibility must not duplicate structured elements as markdown",
    );
    assert.equal(result.compactAX.elements.length, 1);
    assert.equal(
      result.compactAX.elements[0].element_token,
      "required-token",
      "interactive AX tokens must remain available to the model",
    );
    assert.deepEqual(result.compactDetails.accessibility, {
      elementCount: 1,
      truncated: true,
    });
    assert.equal(
      "elements" in result.compactDetails.accessibility,
      false,
      "tool details must summarize rather than duplicate the AX elements",
    );
    assert.equal(
      "outcomes" in result.compactDetails,
      false,
      "tool details must not duplicate the full model-facing result",
    );
    assert.match(result.modelResult.content[0].text, /required-token/);
    assert.doesNotMatch(
      result.modelResult.content[0].text,
      /duplicated markdown/,
    );
    assert.deepEqual(result.modelResult.details.accessibility, {
      elementCount: 1,
      truncated: true,
    });
    assert.equal(
      "outcomes" in result.modelResult.details,
      false,
      "assembled tool result details must remain compact",
    );
    assert.equal(result.modelResult.content.length, 1);
    assert.equal(result.modelResult.content[0].type, "text");
    assert.match(
      result.modelResult.content[0].text,
      /\[PIPIUI_COMPUTER_SCREENSHOT:bridge-aligned-id\]/,
      "marker must reuse bridge screenshotId",
    );
    assert.doesNotMatch(
      result.modelResult.content[0].text,
      /png-base64/,
      "toolResult text must stay marker-only without raw base64",
    );
    assert.match(
      result.modelResultFallbackError || "",
      /missing stable screenshotId/,
      "missing bridge screenshotId must fail the marker contract",
    );
    assert.doesNotMatch(
      result.modelResultFallbackError || "",
      /png-base64-2/,
      "contract failure must not embed raw base64",
    );
    assert.doesNotMatch(
      result.modelResultFallbackError || "",
      /PIPIUI_COMPUTER_SCREENSHOT/,
      "contract failure must not emit an unhydratable marker",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
