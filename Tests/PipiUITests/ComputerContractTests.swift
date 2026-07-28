import XCTest
@testable import PipiUI

final class ComputerContractTests: XCTestCase {
    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "pipiui-computer-extension-\(UUID().uuidString)",
                isDirectory: true
            )
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    func testBatchAndAnthropicSingleActionNormalization() throws {
        let batch = try ComputerRequest.normalize(J([
            "actions": [
                ["type": "click", "x": 30, "y": 40],
                ["type": "type", "text": "hello"],
                ["type": "keypress", "keys": ["ENTER"]],
            ],
        ]))
        XCTAssertEqual(
            batch.actions.map(\.kind),
            [.leftClick, .type, .key]
        )
        XCTAssertEqual(batch.actions[0].coordinate, .init(x: 30, y: 40))

        let single = try ComputerRequest.normalize(J([
            "type": "mouse_move",
            "coordinate": [10, 20],
        ]))
        XCTAssertEqual(single.actions.count, 1)
        XCTAssertEqual(single.actions[0].kind, .mouseMove)
    }

    func testCuaScalarValidationRejectsNonFiniteHugeAndFractionalValues() throws {
        let invalidActions: [[String: Any]] = [
            ["type": "click", "x": 1e308, "y": 1],
            ["type": "click", "coordinate": [Double.infinity, 1]],
            ["type": "wait", "duration": 1e308],
            ["type": "wait", "duration_ms": 1e308],
            ["type": "wait", "duration": -1],
            ["type": "scroll", "x": 1, "y": 1, "amount": 1e308],
            ["type": "scroll", "x": 1, "y": 1, "amount": 50.5],
            ["type": "click", "element_index": 1.5],
            [
                "type": "type",
                "text": String(
                    repeating: "a",
                    count: ComputerRuntimeBudget.maximumTypedUTF16Units + 1
                ),
            ],
        ]
        for action in invalidActions {
            XCTAssertThrowsError(try ComputerAction.parse(J(action))) {
                XCTAssertTrue(
                    $0 is ComputerRequestError,
                    "expected explicit invalid_action for \(action), got \($0)"
                )
            }
        }

        let boundary = try ComputerAction.parse(J([
            "type": "scroll",
            "x": 1_000_000,
            "y": -1_000_000,
            "amount": 50,
            "duration_ms": 10_000,
        ]))
        XCTAssertEqual(boundary.scrollAmount, 50)
        XCTAssertEqual(boundary.duration, 10)
    }

    func testCapabilityTokenGenerationAndValidation() {
        let token = BridgeCapabilityToken.generate()
        let desktopToken = BridgeCapabilityToken.generate()
        XCTAssertGreaterThanOrEqual(token.utf8.count, 32)
        XCTAssertNotEqual(token, desktopToken)
        XCTAssertTrue(BridgeCapabilityToken.matches(token, expected: token))
        XCTAssertFalse(BridgeCapabilityToken.matches(token + "x", expected: token))
        XCTAssertFalse(BridgeCapabilityToken.matches("", expected: ""))
        XCTAssertTrue(BridgeRequestLimits.acceptsContentLength(
            BridgeRequestLimits.maximumBodyBytes
        ))
        XCTAssertFalse(BridgeRequestLimits.acceptsContentLength(
            BridgeRequestLimits.maximumBodyBytes + 1
        ))
    }

    func testBridgeHTTPParserRequiresBoundedPostRPC() {
        let valid = Data(
            "POST /rpc HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}".utf8
        )
        guard case .complete(let body) = BridgeServer.parseRequestBody(valid) else {
            return XCTFail("expected complete POST /rpc")
        }
        XCTAssertEqual(body, Data("{}".utf8))

        let missingLength = Data("POST /rpc HTTP/1.1\r\n\r\n{}".utf8)
        guard case .invalid = BridgeServer.parseRequestBody(missingLength) else {
            return XCTFail("missing Content-Length must be rejected")
        }

        let wrongRoute = Data(
            "POST /other HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}".utf8
        )
        guard case .invalid = BridgeServer.parseRequestBody(wrongRoute) else {
            return XCTFail("non-/rpc route must be rejected")
        }

        let incomplete = Data(
            "POST /rpc HTTP/1.1\r\nContent-Length: 4\r\n\r\n{}".utf8
        )
        guard case .incomplete = BridgeServer.parseRequestBody(incomplete) else {
            return XCTFail("short bodies must remain incomplete")
        }
    }

    func testAuditEncodingOmitsTextScreenshotWindowAndCapability() throws {
        let secret = "TOP-SECRET-TYPED-PAYLOAD"
        let token = "CAPABILITY-TOKEN-MUST-NOT-APPEAR"
        let action = try ComputerAction.parse(J([
            "type": "type",
            "text": secret,
        ]))
        let record = ComputerAuditRecord(
            timestamp: Date(timeIntervalSince1970: 0),
            auditSessionID: "audit-safe-session",
            app: ComputerApplicationIdentity(
                bundleID: "com.example.editor",
                name: "Editor",
                processID: 1,
                windowTitle: "Sensitive window title"
            ),
            actions: [action],
            outcomes: [.init(index: 0, kind: .type, ok: true, message: "executed")],
            focusDrift: false
        )
        let encoded = String(decoding: try record.encodedData(), as: UTF8.self)
        XCTAssertFalse(encoded.contains(secret))
        XCTAssertFalse(encoded.contains("Sensitive window title"))
        XCTAssertFalse(encoded.contains("\"base64\""))
        XCTAssertTrue(encoded.contains("\"characterCount\""))
        XCTAssertFalse(encoded.contains(token))
    }

    func testProviderAndMountContractsRemainSeparated() throws {
        let source = ComputerUseExtension.source
        XCTAssertTrue(source.contains(#"type: "computer_20251124""#))
        XCTAssertTrue(source.contains("computer-use-2025-11-24"))
        XCTAssertTrue(source.contains("mergeBeta("))
        XCTAssertTrue(source.contains("actions: Type.Optional(Type.Array"))
        XCTAssertTrue(source.contains("every accepted batch returns a fresh screenshot"))
        XCTAssertTrue(source.contains(#"pi.on("context""#))
        XCTAssertTrue(source.contains("retainScreenshot("))
        XCTAssertTrue(source.contains("result.screenshotId"))
        XCTAssertTrue(source.contains("injectInMemoryScreenshots("))
        XCTAssertTrue(source.contains("PIPIUI_COMPUTER_CAPABILITY"))
        XCTAssertTrue(source.contains("computerCapability: COMPUTER_CAPABILITY"))
        XCTAssertTrue(source.contains(#"action: "computer_cancel""#))
        XCTAssertTrue(source.contains("externalSignal?: AbortSignal"))
        XCTAssertTrue(source.contains(
            #"externalSignal?.addEventListener("abort", forwardAbort"#
        ))
        XCTAssertTrue(source.contains(
            #"externalSignal?.removeEventListener("abort", forwardAbort)"#
        ))
        XCTAssertTrue(source.contains(#"name: "open_application""#))
        XCTAssertTrue(source.contains(#"action: "computer_open_application""#))
        XCTAssertTrue(source.contains(
            "bundle_identifier: Type.Optional(Type.String"
        ))
        XCTAssertTrue(source.contains(
            "application_name: Type.Optional(Type.String"
        ))
        XCTAssertFalse(source.contains(
            "path: Type.Optional(Type.String"
        ))
        XCTAssertFalse(source.contains(
            "url: Type.Optional(Type.String"
        ))
        XCTAssertTrue(source.contains(
            "open_application requires bundle_identifier or application_name"
        ))
        XCTAssertTrue(source.contains("lifecycleShellBlockReason"))
        XCTAssertTrue(source.contains("Do not use shell open"))
        XCTAssertTrue(source.contains("element_index: Type.Optional"))
        XCTAssertTrue(source.contains("element_token: Type.Optional"))
        XCTAssertTrue(source.contains("delivery_mode: Type.Optional"))
        XCTAssertTrue(source.contains("additionalProperties: false"))
        XCTAssertTrue(source.contains("This is unrestricted mode"))
        XCTAssertTrue(source.contains(
            "Use this deterministic lifecycle tool instead of pixel clicks"
        ))
        XCTAssertTrue(source.contains(
            "then use computer AX actions or a keyboard shortcut"
        ))
        XCTAssertTrue(source.contains(
            "For Finder folder navigation, prefer Cmd-Shift-G"
        ))
        XCTAssertTrue(source.contains(
            "Routing priority: deterministic app lifecycle first"
        ))
        XCTAssertTrue(source.contains(
            "running-state checks and graceful quit"
        ))
        XCTAssertTrue(source.contains(
            "do not default to force quit or kill -9"
        ))
        XCTAssertTrue(source.contains(
            "Prefer the browser tool for ordinary web tasks"
        ))
        XCTAssertTrue(source.contains(
            "one complete percent-encoded URL"
        ))
        XCTAssertTrue(source.contains(
            #"printf '%s' '<URL>' | pbcopy"#
        ))
        XCTAssertTrue(source.contains(
            "one computer batch: CMD+L, CMD+V, RETURN, wait"
        ))
        XCTAssertTrue(source.contains(
            "Do not use AppleScript/osascript or shell open for external-browser navigation"
        ))
        XCTAssertTrue(source.contains(
            "Prefer element_index/element_token AX actions over screenshot coordinates"
        ))
        XCTAssertTrue(source.contains(
            "Use screenshot coordinates only as a fallback"
        ))
        XCTAssertTrue(source.contains(
            "Never shell open"
        ))
        XCTAssertTrue(source.contains("requestID"))
        XCTAssertTrue(source.contains("PIPIUI_COMPUTER_DISPLAY_ID"))
        XCTAssertTrue(source.contains(
            "Keep only an opaque marker in agent"
        ))
        XCTAssertFalse(source.contains(#"name: "computer_call""#))
        XCTAssertFalse(source.contains(#"type: "computer_call""#))
        XCTAssertFalse(source.contains(#"name: "computer_call_output""#))

        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let chat = try String(contentsOf:
            root.appendingPathComponent("Sources/PipiUI/ChatSession.swift"))
        let coordinator = try String(contentsOf:
            root.appendingPathComponent(
                "Sources/PipiUI/Computer/ComputerCoordinatorExecution.swift"
            ))
        let subagent = try String(contentsOf:
            root.appendingPathComponent(
                "Sources/PipiUI/PiExt/subagent/index.ts"
            ))
        let signing = try String(contentsOf: root.appendingPathComponent("make-app.sh"))
        let audit = try String(contentsOf:
            root.appendingPathComponent("Sources/PipiUI/Computer/ComputerAudit.swift"))

        XCTAssertTrue(chat.contains(
            "if computerCaptureDescriptor != nil, let computerUseExtension"
        ))
        XCTAssertTrue(chat.contains(
            "args += ToolSkillSettings.excludeToolsCLIArgs()"
        ))
        XCTAssertTrue(subagent.contains("PIPIUI_COMPUTER_EXT"))
        XCTAssertTrue(subagent.contains("resolveSubagentToolSelection({"))
        XCTAssertTrue(subagent.contains("sanitizeDisabledToolNames(out)"))
        XCTAssertTrue(subagent.contains(
            "delete env.PIPIUI_COMPUTER_CAPABILITY"
        ))
        guard let childEnvStart = subagent.range(
            of: "const childEnv = pipiuiChildProcessEnv({"
        ), let childSpawnStart = subagent.range(
            of: "const proc = spawn(invocation.command",
            range: childEnvStart.upperBound..<subagent.endIndex
        ) else {
            return XCTFail("missing dispatched Pi child environment block")
        }
        let childEnvBlock = subagent[
            childEnvStart.lowerBound..<childSpawnStart.lowerBound
        ]
        XCTAssertTrue(childEnvBlock.contains("}, true);"))
        XCTAssertTrue(chat.contains(
            #"extraEnv["PIPIUI_COMPUTER_EXT"] = computerUseExtension"#
        ))
        XCTAssertTrue(coordinator.contains(
            "Every non-cancelled accepted batch returns one fresh in-memory screenshot"
        ))
        XCTAssertTrue(coordinator.contains(
            "screenshot = try await openApplicationScreenshotProvider("
        ))
        XCTAssertTrue(signing.contains(#"PIPIUI_SIGN_ID:-PipiUI Dev"#))
        XCTAssertTrue(signing.contains(#"CODE_SIGN_ID="-""#))
        XCTAssertFalse(audit.contains("\"base64\""))
        XCTAssertFalse(audit.contains("pngData"))
    }

    func testGeneratedExtensionProviderAndMemoryOnlyTransforms() throws {
        let jiti = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(
                ".npm-global/lib/node_modules/@earendil-works/"
                    + "pi-coding-agent/node_modules/.bin/jiti"
            )
        guard FileManager.default.isExecutableFile(atPath: jiti.path) else {
            throw XCTSkip("installed Pi jiti runtime is unavailable")
        }
        let directory = try temporaryDirectory()
        let installedNodeModules = jiti
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let temporaryNodeModules = directory.appendingPathComponent(
            "node_modules",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: temporaryNodeModules,
            withIntermediateDirectories: true
        )
        try FileManager.default.createSymbolicLink(
            at: temporaryNodeModules.appendingPathComponent("typebox"),
            withDestinationURL: installedNodeModules.appendingPathComponent("typebox")
        )
        _ = try XCTUnwrap(ComputerUseExtension.install(into: directory))
        let harness = directory.appendingPathComponent("harness.ts")
        let script = #"""
import computerExtension, {
  injectInMemoryScreenshots,
  lifecycleShellBlockReason,
  mergeBeta,
  normalizeActions,
  retainScreenshot,
} from "./pipiui-computer-use.ts";

const handlers = new Map<string, Function>();
const registered = new Map<string, any>();
computerExtension({
  registerTool(tool: any) { registered.set(tool.name, tool); },
  on(name: string, handler: Function) { handlers.set(name, handler); },
} as any);
const computerTool = registered.get("computer");
const openApplicationTool = registered.get("open_application");

const provider = handlers.get("before_provider_request")!;
const anthropic = provider(
  { payload: { messages: [], tools: [
    { name: "computer", description: "custom" },
    { name: "open_application", description: "custom app launcher" },
    { name: "read", description: "unchanged" },
  ] } },
  { model: {
    provider: "anthropic",
    api: "anthropic-messages",
    id: "claude-sonnet-5-20260701",
  } },
);
const olderAnthropic = provider(
  { payload: { messages: [], tools: [{ name: "computer", description: "custom" }] } },
  { model: {
    provider: "anthropic",
    api: "anthropic-messages",
    id: "claude-opus-4-1-20250805",
  } },
);
const proxyAnthropic = provider(
  { payload: { messages: [], tools: [{ name: "computer", description: "custom" }] } },
  { model: {
    provider: "anthropic-proxy",
    api: "anthropic-messages",
    id: "claude-sonnet-5",
  } },
);
const unknownAnthropic = provider(
  { payload: { messages: [], tools: [{ name: "computer", description: "custom" }] } },
  { model: { provider: "anthropic", api: "anthropic-messages", id: "claude-future" } },
);
const unsupportedOpus5 = provider(
  { payload: { messages: [], tools: [{ name: "computer", description: "custom" }] } },
  { model: { provider: "anthropic", api: "anthropic-messages", id: "claude-opus-5" } },
);
const openai = provider(
  { payload: { messages: [], tools: [{ name: "computer", description: "custom" }] } },
  { model: { provider: "openai-codex", api: "openai-codex-responses" } },
);

const headerEvent: any = { headers: { "anthropic-beta": "existing-beta" } };
handlers.get("before_provider_headers")!(
  headerEvent,
  { model: {
    provider: "anthropic",
    api: "anthropic-messages",
    id: "claude-opus-4-8-20260601",
  } },
);
const proxyHeaderEvent: any = { headers: {} };
handlers.get("before_provider_headers")!(
  proxyHeaderEvent,
  { model: {
    provider: "anthropic-proxy",
    api: "anthropic-messages",
    id: "claude-opus-4-8",
  } },
);

const id = retainScreenshot("png-base64", "image/png");
const persisted = [{
  role: "toolResult",
  content: [{ type: "text", text: `[PIPIUI_COMPUTER_SCREENSHOT:${id}]` }],
}];
const injected = injectInMemoryScreenshots(persisted as any[]);

const bridgedBodies: any[] = [];
(globalThis as any).fetch = async (_url: string, options: any) => {
  const bridgedBody = JSON.parse(options.body);
  bridgedBodies.push(bridgedBody);
  const waitsForAbort =
    bridgedBody.bundle_identifier === "com.example.Abort"
    || (
      bridgedBody.action === "computer_batch"
      && bridgedBody.actions?.[0]?.type === "wait_for_abort"
    );
  if (waitsForAbort) {
    return await new Promise((_resolve, reject) => {
      const fail = () => reject(new Error("mock bridge aborted"));
      if (options.signal?.aborted) fail();
      else options.signal?.addEventListener("abort", fail, { once: true });
    });
  }
  return {
    async json() {
      const opened = bridgedBody.action === "computer_open_application";
      return {
        ok: true,
        ...(opened
          ? { openedApplication: true }
          : { batchOK: true, outcomes: [], focusDrift: false }),
        foregroundApp: opened
          ? { name: "Google Chrome", bundleID: "com.google.Chrome", processID: 42 }
          : { name: "Editor", bundleID: "com.example.editor", processID: 41 },
        windowTitle: opened ? "New Tab" : "Document",
        displayID: 1,
        width: 100,
        height: 80,
        base64: "result-png",
        mimeType: "image/png",
        screenshotId: "bridge-shot-id-001",
        accessibility: {
          tree_markdown: "[element_index 0] duplicated markdown",
          elements: [{
            element_index: 0,
            element_token: "required-token",
            role: "AXButton",
          }],
          truncated: true,
        },
      };
    },
  };
};

(async () => {
  const executed = await computerTool.execute(
    "call-id",
    { actions: [{ type: "screenshot" }] },
  );
  const opened = await openApplicationTool.execute(
    "open-call-id",
    { bundle_identifier: "com.google.Chrome" },
  );
  const batchBody = bridgedBodies[0];
  const openBody = bridgedBodies[1];
  const batchAbortController = new AbortController();
  const batchAbortPromise = computerTool.execute(
    "batch-abort-call-id",
    { actions: [{ type: "wait_for_abort" }] },
    batchAbortController.signal,
  ).then(() => false, () => true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  batchAbortController.abort();
  const batchAbortRejected = await batchAbortPromise;
  const openAbortController = new AbortController();
  const openAbortPromise = openApplicationTool.execute(
    "open-abort-call-id",
    { bundle_identifier: "com.example.Abort" },
    openAbortController.signal,
  ).then(() => false, () => true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  openAbortController.abort();
  const openAbortRejected = await openAbortPromise;
  const abortedBatchBody = bridgedBodies.find(
    (body) =>
      body.action === "computer_batch"
      && body.actions?.[0]?.type === "wait_for_abort",
  );
  const abortedOpenBody = bridgedBodies.find(
    (body) =>
      body.action === "computer_open_application"
      && body.bundle_identifier === "com.example.Abort",
  );
  const batchCancelBody = bridgedBodies.find(
    (body) =>
      body.action === "computer_cancel"
      && body.requestID === abortedBatchBody?.requestID,
  );
  const openCancelBody = bridgedBodies.find(
    (body) =>
      body.action === "computer_cancel"
      && body.requestID === abortedOpenBody?.requestID,
  );
  const openSchema = openApplicationTool.parameters;
  process.stdout.write(JSON.stringify({
    registered:
      computerTool?.name === "computer"
      && openApplicationTool?.name === "open_application",
    batch: normalizeActions({ actions: [{ type: "click" }, { type: "type" }] }).length === 2,
    single: normalizeActions({ action: "left_click", coordinate: [1, 2] }).length === 1,
    anthropicTyped:
      anthropic.tools[0].type === "computer_20251124"
      && anthropic.tools[1].name === "open_application"
      && anthropic.tools[2].name === "read",
    olderAnthropicCustom: olderAnthropic === undefined,
    proxyAnthropicCustom: proxyAnthropic === undefined,
    unknownAnthropicCustom: unknownAnthropic === undefined,
    unsupportedOpus5Custom: unsupportedOpus5 === undefined,
    openaiUntouched: openai === undefined,
    betaMerged:
      headerEvent.headers["anthropic-beta"]
        === "existing-beta,computer-use-2025-11-24",
    proxyBetaUntouched:
      proxyHeaderEvent.headers["anthropic-beta"] === undefined,
    imageInjected:
      injected[0].content[1].type === "image"
      && injected[0].content[1].data === "png-base64",
    persistedUnchanged:
      persisted[0].content.length === 1
      && persisted[0].content[0].type === "text",
    mergeDedup:
      mergeBeta("x,computer-use-2025-11-24", "computer-use-2025-11-24")
        === "x,computer-use-2025-11-24",
    bridgeCapabilities:
      batchBody.sessionKey === "test-capability"
      && batchBody.computerCapability === "test-computer-capability"
      && batchBody.displayID === 7
      && batchBody.displayWidth === 1440
      && batchBody.displayHeight === 900
      && typeof batchBody.requestID === "string"
      && batchBody.requestID.length > 20,
    openApplicationSchema:
      openSchema.additionalProperties === false
      && (
        !Array.isArray(openSchema.required)
        || openSchema.required.length === 0
      )
      && openSchema.properties.bundle_identifier.type === "string"
      && openSchema.properties.application_name.type === "string"
      && !("path" in openSchema.properties)
      && !("url" in openSchema.properties)
      && !("command" in openSchema.properties)
      ,
    openApplicationBridge:
      openBody.action === "computer_open_application"
      && openBody.bundle_identifier === "com.google.Chrome"
      && !("path" in openBody)
      && !("url" in openBody)
      && openBody.sessionKey === "test-capability"
      && openBody.computerCapability === "test-computer-capability"
      && openBody.displayID === 7
      && typeof openBody.requestID === "string"
      && openBody.requestID.length > 20,
    browserAppClipboardRoute:
      computerTool.description.includes(
        "Prefer the browser tool for ordinary web tasks"
      )
      && computerTool.description.includes(
        "one complete percent-encoded URL"
      )
      && computerTool.description.includes(
        "printf '%s' '<URL>' | pbcopy"
      )
      && computerTool.description.includes(
        "one computer batch: CMD+L, CMD+V, RETURN, wait"
      )
      && computerTool.description.includes(
        "Do not use AppleScript/osascript or shell open for external-browser navigation"
      ),
    shellOpenBlocked:
      [
        "/usr/bin/open /Users/me/Downloads",
        "exec /usr/bin/open /Users/me/Downloads",
        "env /usr/bin/open /Users/me/Downloads",
        "\"/usr/bin/open\" /Users/me/Downloads",
        "command open /Users/me/Downloads",
        "sh -c '/usr/bin/open /Users/me/Downloads'",
        "/bin/zsh -c 'exec open /Users/me/Downloads'",
        "/usr/bin/env /usr/bin/open /Users/me/Downloads",
        "env -u FOO /usr/bin/open /Users/me/Downloads",
        "command -p /usr/bin/open /Users/me/Downloads",
        "exec -- /usr/bin/open /Users/me/Downloads",
        "bash -lc '/usr/bin/open /Users/me/Downloads'",
        "VAR=x /usr/bin/open /Users/me/Downloads",
      ].every((command) =>
        lifecycleShellBlockReason(
          "bash",
          { command },
        )?.includes("Do not use shell open") === true
      )
      && [
        "pgrep -x Finder",
        "osascript -e 'tell application \"Finder\" to quit'",
        "swift test",
        "echo /usr/bin/open is blocked only in command position",
        "tool --open file",
      ].every((command) =>
        lifecycleShellBlockReason("bash", { command }) === null
      ),
    batchAbortSignal:
      batchAbortRejected
      && typeof abortedBatchBody?.requestID === "string"
      && batchCancelBody?.requestID === abortedBatchBody.requestID
      && batchCancelBody?.sessionKey === "test-capability"
      && batchCancelBody?.computerCapability
        === "test-computer-capability",
    openAbortSignal:
      openAbortRejected
      && typeof abortedOpenBody?.requestID === "string"
      && openCancelBody?.requestID === abortedOpenBody.requestID
      && openCancelBody?.sessionKey === "test-capability"
      && openCancelBody?.computerCapability
        === "test-computer-capability",
    resultMarkerOnly:
      executed.content.length === 1
      && executed.content[0].type === "text"
      && executed.content[0].text.includes(
        "[PIPIUI_COMPUTER_SCREENSHOT:bridge-shot-id-001]"
      )
      && !executed.content[0].text.includes("result-png")
      && !executed.content[0].text.includes("screenshotId"),
    openResultMarkerOnly:
      opened.content.length === 1
      && opened.content[0].type === "text"
      && opened.content[0].text.includes(
        "[PIPIUI_COMPUTER_SCREENSHOT:bridge-shot-id-001]"
      )
      && !opened.content[0].text.includes("result-png")
      && opened.details.foregroundApp.bundleID === "com.google.Chrome"
      && opened.details.openedTarget === undefined,
    compactAccessibilityResult:
      executed.content[0].text.includes("required-token")
      && !executed.content[0].text.includes("duplicated markdown")
      && executed.details.accessibility.elementCount === 1
      && executed.details.accessibility.truncated === true
      && executed.details.accessibility.elements === undefined
      && executed.details.outcomes === undefined,
  }));
})().catch((error) => {
  process.stderr.write(String(error?.stack || error));
  process.exitCode = 1;
});
"""#
        try script.write(to: harness, atomically: true, encoding: .utf8)

        let process = Process()
        process.executableURL = jiti
        process.arguments = [harness.path]
        process.currentDirectoryURL = directory
        process.environment = ProcessInfo.processInfo.environment.merging(
            [
                "PIPIUI_BRIDGE_PORT": "1",
                "PIPIUI_SESSION_KEY": "test-capability",
                "PIPIUI_COMPUTER_CAPABILITY": "test-computer-capability",
                "PIPIUI_COMPUTER_DISPLAY_ID": "7",
                // Pin geometry so host PIPIUI_COMPUTER_* env cannot flake the contract.
                "PIPIUI_COMPUTER_WIDTH": "1440",
                "PIPIUI_COMPUTER_HEIGHT": "900",
            ],
            uniquingKeysWith: { _, new in new }
        )
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        process.waitUntilExit()
        let stderr = String(
            data: errors.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        XCTAssertEqual(process.terminationStatus, 0, stderr)
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let checks = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Bool]
        )
        for (name, passed) in checks {
            XCTAssertTrue(passed, "extension contract failed: \(name)")
        }
    }
}
