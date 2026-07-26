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
        XCTAssertTrue(source.contains("injectInMemoryScreenshots("))
        XCTAssertTrue(source.contains("PIPIUI_COMPUTER_CAPABILITY"))
        XCTAssertTrue(source.contains("computerCapability: COMPUTER_CAPABILITY"))
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
            "if ComputerUseSettings.isEnabled(), let computerUseExtension"
        ))
        XCTAssertTrue(subagent.contains(#"excluded.add("computer")"#))
        XCTAssertTrue(subagent.contains(#"t !== "computer""#))
        XCTAssertTrue(subagent.contains(
            "delete env.PIPIUI_COMPUTER_CAPABILITY"
        ))
        XCTAssertTrue(subagent.contains("env: pipiuiChildProcessEnv()"))
        XCTAssertTrue(coordinator.contains(
            "Every accepted batch finishes with one fresh in-memory screenshot"
        ))
        XCTAssertTrue(coordinator.contains("ComputerScreenCapture.capture("))
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
  mergeBeta,
  normalizeActions,
  retainScreenshot,
} from "./pipiui-computer-use.ts";

const handlers = new Map<string, Function>();
let registered: any;
computerExtension({
  registerTool(tool: any) { registered = tool; },
  on(name: string, handler: Function) { handlers.set(name, handler); },
} as any);

const provider = handlers.get("before_provider_request")!;
const anthropic = provider(
  { payload: { messages: [], tools: [
    { name: "computer", description: "custom" },
    { name: "read", description: "unchanged" },
  ] } },
  { model: { provider: "anthropic", api: "anthropic-messages" } },
);
const openai = provider(
  { payload: { messages: [], tools: [{ name: "computer", description: "custom" }] } },
  { model: { provider: "openai-codex", api: "openai-codex-responses" } },
);

const headerEvent: any = { headers: { "anthropic-beta": "existing-beta" } };
handlers.get("before_provider_headers")!(
  headerEvent,
  { model: { provider: "anthropic", api: "anthropic-messages" } },
);

const id = retainScreenshot("png-base64", "image/png");
const persisted = [{
  role: "toolResult",
  content: [{ type: "text", text: `[PIPIUI_COMPUTER_SCREENSHOT:${id}]` }],
}];
const injected = injectInMemoryScreenshots(persisted as any[]);

let bridgedBody: any;
(globalThis as any).fetch = async (_url: string, options: any) => {
  bridgedBody = JSON.parse(options.body);
  return {
    async json() {
      return {
        ok: true,
        batchOK: true,
        outcomes: [],
        foregroundApp: { name: "Editor", bundleID: "com.example.editor" },
        windowTitle: "Document",
        displayID: 1,
        width: 100,
        height: 80,
        focusDrift: false,
        base64: "result-png",
        mimeType: "image/png",
      };
    },
  };
};

(async () => {
  const executed = await registered.execute(
    "call-id",
    { actions: [{ type: "screenshot" }] },
  );
  process.stdout.write(JSON.stringify({
    registered: registered?.name === "computer",
    batch: normalizeActions({ actions: [{ type: "click" }, { type: "type" }] }).length === 2,
    single: normalizeActions({ action: "left_click", coordinate: [1, 2] }).length === 1,
    anthropicTyped:
      anthropic.tools[0].type === "computer_20251124"
      && anthropic.tools[1].name === "read",
    openaiUntouched: openai === undefined,
    betaMerged:
      headerEvent.headers["anthropic-beta"]
        === "existing-beta,computer-use-2025-11-24",
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
      bridgedBody.sessionKey === "test-capability"
      && bridgedBody.computerCapability === "test-computer-capability",
    resultMarkerOnly:
      executed.content.length === 1
      && executed.content[0].type === "text"
      && executed.content[0].text.includes("[PIPIUI_COMPUTER_SCREENSHOT:")
      && !executed.content[0].text.includes("result-png"),
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
