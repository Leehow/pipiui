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

const harnessSource = "\nimport install, {\n  MAX_ACCESSIBILITY_ELEMENTS_IN_CONTEXT,\n  compactAccessibility,\n  compactToolDetails,\n  injectInMemoryScreenshots,\n  lifecycleShellBlockReason,\n  retainScreenshot,\n  screenshotToolResult,\n} from \"./extension.ts\";\n\nconst tools = new Map<string, any>();\nconst handlers = new Map<string, any>();\ninstall({\n  registerTool(tool: any) { tools.set(tool.name, tool); },\n  on(name: string, handler: any) { handlers.set(name, handler); },\n} as any);\n\nconst computer = tools.get(\"computer\");\nif (!computer) throw new Error(\"computer tool was not registered\");\nconst payload = {\n  tools: [{\n    type: \"function\",\n    function: {\n      name: computer.name,\n      description: computer.description,\n      parameters: computer.parameters,\n    },\n  }],\n};\nconst providerResult = handlers.get(\"before_provider_request\")?.(\n  { payload },\n  { model: { provider: \"xai\", api: \"openai-completions\", id: \"grok-4\" } },\n);\nconst compactAX = compactAccessibility({\n  tree_markdown: \"[element_index 0] duplicated markdown\",\n  screenshot_width: 1440,\n  elements: [{\n    element_index: 0,\n    element_token: \"required-token\",\n    role: \"AXButton\",\n  }],\n  truncated: true,\n});\nconst compactDetails = compactToolDetails({\n  batchOK: true,\n  outcomes: [{ index: 0, ok: true }],\n  foregroundApp: { bundleID: \"com.google.Chrome\" },\n  accessibility: compactAX,\n});\nconst modelResult = screenshotToolResult(\n  {\n    base64: \"png-base64\",\n    mimeType: \"image/png\",\n    screenshotId: \"bridge-aligned-id\",\n  },\n  {\n    batchOK: true,\n    outcomes: [{ index: 0, ok: true }],\n    accessibility: compactAX,\n  },\n);\nlet modelResultFallbackError = null;\ntry {\n  screenshotToolResult(\n    { base64: \"png-base64-2\", mimeType: \"image/png\" },\n    { batchOK: true },\n  );\n} catch (error) {\n  modelResultFallbackError = String(error?.message || error);\n}\n\n// P0: interactive-first + hard cap; elementCount is pre-trim total.\nconst overK = MAX_ACCESSIBILITY_ELEMENTS_IN_CONTEXT + 12;\nconst oversizedElements = [];\nfor (let i = 0; i < overK; i += 1) {\n  const interactive = i % 3 !== 2;\n  oversizedElements.push({\n    element_index: i,\n    element_token: interactive ? `tok-${i}` : `static-tok-${i}`,\n    role: interactive ? (i % 2 === 0 ? \"AXButton\" : \"AXTextField\") : \"AXStaticText\",\n    label: interactive ? `Control ${i}` : `Static ${i}`,\n  });\n}\nconst layoutPad = [\n  { element_index: 900, element_token: \"group-a\", role: \"AXGroup\", label: \"wrap\" },\n  { element_index: 901, element_token: \"scroll-a\", role: \"AXScrollArea\", label: \"scroller\" },\n];\nconst rawOversized = [...layoutPad, ...oversizedElements];\nconst compactOversized = compactAccessibility({\n  elements: rawOversized,\n  truncated: false,\n});\nconst oversizedModelResult = screenshotToolResult(\n  {\n    base64: \"png-over\",\n    mimeType: \"image/png\",\n    screenshotId: \"bridge-over-id\",\n  },\n  {\n    batchOK: true,\n    accessibility: compactOversized,\n  },\n);\nconst oversizedText = oversizedModelResult.content[0].text as string;\nconst oversizedJsonText = oversizedText.split(\"\\n[PIPIUI_COMPUTER_SCREENSHOT:\")[0];\nconst oversizedContent = JSON.parse(oversizedJsonText);\nconst contentElementCount = Array.isArray(oversizedContent?.accessibility?.elements)\n  ? oversizedContent.accessibility.elements.length\n  : -1;\nconst contentStaticRoles = (oversizedContent?.accessibility?.elements || [])\n  .filter((el: any) => /statictext/i.test(String(el?.role || \"\")))\n  .length;\n\n// P1: retain 4 \u2192 oldest marker misses inject; newest 3 still inject.\nconst shotIds = [\"aaaaaaaa-aaaa-4aaa-8aaa-000000000001\", \"bbbbbbbb-bbbb-4bbb-8bbb-000000000002\", \"cccccccc-cccc-4ccc-8ccc-000000000003\", \"dddddddd-dddd-4ddd-8ddd-000000000004\"].map((id, index) =>\n  retainScreenshot(`png-${index}`, \"image/png\", id),\n);\nconst injected = injectInMemoryScreenshots(\n  shotIds.map((id) => ({\n    role: \"toolResult\",\n    content: [{\n      type: \"text\",\n      text: `meta\\n[PIPIUI_COMPUTER_SCREENSHOT:${id}]`,\n    }],\n  })),\n);\nconst injectedImageCounts = injected.map((message: any) =>\n  (message.content || []).filter((block: any) => block.type === \"image\").length,\n);\nconst markerStillPresent = injected.every((message: any, index: number) =>\n  typeof message.content?.[0]?.text === \"string\"\n  && message.content[0].text.includes(`[PIPIUI_COMPUTER_SCREENSHOT:${shotIds[index]}]`),\n);\n\nprocess.stdout.write(JSON.stringify({\n  schema: computer.parameters,\n  openApplicationSchema: tools.get(\"open_application\")?.parameters,\n  computerDescription: computer.description,\n  openApplicationDescription: tools.get(\"open_application\")?.description,\n  blockedShellOpenShapes: [\n    \"/usr/bin/open /Users/me/Downloads\",\n    \"exec /usr/bin/open /Users/me/Downloads\",\n    \"env /usr/bin/open /Users/me/Downloads\",\n    \"\\\"/usr/bin/open\\\" /Users/me/Downloads\",\n    \"command open /Users/me/Downloads\",\n    \"sh -c '/usr/bin/open /Users/me/Downloads'\",\n    \"/bin/zsh -c 'exec open /Users/me/Downloads'\",\n    \"/usr/bin/env /usr/bin/open /Users/me/Downloads\",\n    \"env -u FOO /usr/bin/open /Users/me/Downloads\",\n    \"command -p /usr/bin/open /Users/me/Downloads\",\n    \"exec -- /usr/bin/open /Users/me/Downloads\",\n    \"bash -lc '/usr/bin/open /Users/me/Downloads'\",\n    \"VAR=x /usr/bin/open /Users/me/Downloads\",\n  ].map((command) =>\n    lifecycleShellBlockReason(\"bash\", { command })\n  ),\n  allowedLifecycleShellShapes: [\n    \"pgrep -x Finder\",\n    \"osascript -e 'tell application \\\"Finder\\\" to quit'\",\n    \"swift test\",\n    \"echo /usr/bin/open is blocked only in command position\",\n    \"tool --open file\",\n  ].map((command) =>\n    lifecycleShellBlockReason(\"bash\", { command })\n  ),\n  compactAX,\n  compactDetails,\n  modelResult,\n  modelResultFallbackError,\n  payload,\n  providerPassedThrough: providerResult === undefined,\n  maxAccessibilityElementsInContext: MAX_ACCESSIBILITY_ELEMENTS_IN_CONTEXT,\n  compactOversized,\n  oversizedRawCount: rawOversized.length,\n  oversizedContentElementCount: contentElementCount,\n  oversizedContentElementCountField: oversizedContent?.accessibility?.elementCount,\n  oversizedContentTruncated: oversizedContent?.accessibility?.truncated,\n  oversizedContentStaticRoles: contentStaticRoles,\n  oversizedDetails: oversizedModelResult.details?.accessibility,\n  oversizedMarker: oversizedModelResult.content[0].text,\n  fifoShotIds: shotIds,\n  fifoInjectedImageCounts: injectedImageCounts,\n  fifoMarkerStillPresent: markerStillPresent,\n}));\n";

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
    await writeFile(join(directory, "harness.ts"), harnessSource, "utf8");

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
    assert.match(
      result.computerDescription,
      /re-observe/i,
      "computer description must require re-observe after permanent failures",
    );
    assert.match(
      result.computerDescription,
      /do not retry/i,
      "computer description must forbid retrying the same coordinate/token",
    );
    assert.equal(
      "tree_markdown" in result.compactAX,
      false,
      "model-facing accessibility must not duplicate structured elements as markdown",
    );
    assert.equal(result.compactAX.elements.length, 1);
    assert.equal(
      result.compactAX.elementCount,
      1,
      "elementCount must equal pre-trim total",
    );
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

    // P0 — AX text budget
    assert.equal(result.maxAccessibilityElementsInContext, 48);
    assert.ok(
      result.oversizedRawCount > result.maxAccessibilityElementsInContext,
      "fixture must exceed K",
    );
    assert.ok(
      result.oversizedContentElementCount <= result.maxAccessibilityElementsInContext,
      `content elements must be <= K, got ${result.oversizedContentElementCount}`,
    );
    assert.equal(
      result.oversizedContentElementCountField,
      result.oversizedRawCount,
      "content elementCount must be the pre-trim total",
    );
    assert.equal(result.oversizedContentTruncated, true);
    assert.equal(
      result.oversizedContentStaticRoles,
      0,
      "static text / non-interactive roles must be dropped from content",
    );
    assert.deepEqual(result.oversizedDetails, {
      elementCount: result.oversizedRawCount,
      truncated: true,
    });
    assert.match(
      result.oversizedMarker,
      /\[PIPIUI_COMPUTER_SCREENSHOT:bridge-over-id\]/,
      "oversized AX path must keep screenshot marker parseable",
    );
    assert.equal(
      result.compactOversized.elements.length <= result.maxAccessibilityElementsInContext,
      true,
    );
    assert.equal(result.compactOversized.elementCount, result.oversizedRawCount);
    assert.equal(result.compactOversized.truncated, true);

    // P1 — model screenshot FIFO 12→3
    assert.deepEqual(result.fifoShotIds, ["aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "bbbbbbbb-bbbb-4bbb-8bbb-000000000002", "cccccccc-cccc-4ccc-8ccc-000000000003", "dddddddd-dddd-4ddd-8ddd-000000000004"]);
    assert.deepEqual(
      result.fifoInjectedImageCounts,
      [0, 1, 1, 1],
      "oldest of 4 retained shots must miss inject; newest 3 must inject",
    );
    assert.equal(
      result.fifoMarkerStillPresent,
      true,
      "markers remain in text even when image cache-misses",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
