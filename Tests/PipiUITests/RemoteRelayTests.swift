import XCTest
@testable import PipiUI

final class RemoteRelayTests: XCTestCase {
    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    @discardableResult
    private func waitUntil(
        timeout: TimeInterval = 5,
        _ condition: () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        return condition()
    }

    func testCommandAllowlistMapsOnlyExistingLocalRoutes() {
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "GET", path: "/api/index"
        ), .index)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/api/send"
        ), .promptSend)
        XCTAssertNil(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/rpc"
        ))
        XCTAssertNil(RemoteRelayCommand.localHTTPCommand(
            method: "GET", path: "https://example.test/arbitrary"
        ))
        XCTAssertEqual(Set(RemoteRelayCommand.allCases.map(\.rawValue)), [
            "index",
            "session.create",
            "session.open",
            "snapshot",
            "prompt.send",
            "generation.stop",
        ])
    }

    func testStrictRequestDecoderAcceptsV1AndRejectsUnknownFieldsAndVersions() throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let requestID = UUID().uuidString.lowercased()
        let valid: [String: Any] = [
            "v": 1,
            "type": "request",
            "requestID": requestID,
            "command": "index",
            "deadlineMs": 1_010_000,
            "body": [:],
        ]
        let data = try JSONSerialization.data(withJSONObject: valid)
        XCTAssertEqual(
            try RemoteRelayProtocol.decodeRequest(data, now: now).command,
            .index
        )

        var unknownField = valid
        unknownField["headers"] = ["authorization": "must-not-forward"]
        XCTAssertThrowsError(try RemoteRelayProtocol.decodeRequest(
            JSONSerialization.data(withJSONObject: unknownField),
            now: now
        )) {
            XCTAssertEqual($0 as? RemoteRelayProtocolError, .invalidEnvelope)
        }

        var wrongVersion = valid
        wrongVersion["v"] = 2
        XCTAssertThrowsError(try RemoteRelayProtocol.decodeRequest(
            JSONSerialization.data(withJSONObject: wrongVersion),
            now: now
        )) {
            XCTAssertEqual($0 as? RemoteRelayProtocolError, .protocolMismatch)
        }
    }

    func testRequestDecoderRejectsExpiredOrOverlongDeadlines() throws {
        let now = Date(timeIntervalSince1970: 2_000)
        func data(deadlineMs: Int64) throws -> Data {
            try JSONSerialization.data(withJSONObject: [
                "v": 1,
                "type": "request",
                "requestID": UUID().uuidString,
                "command": "snapshot",
                "deadlineMs": deadlineMs,
                "body": ["sessionID": "opaque"],
            ])
        }
        XCTAssertThrowsError(try RemoteRelayProtocol.decodeRequest(
            data(deadlineMs: 1_999_000), now: now
        ))
        XCTAssertThrowsError(try RemoteRelayProtocol.decodeRequest(
            data(deadlineMs: 2_020_000), now: now
        ))
    }

    func testMacCommandSchemaRejectsUnknownFieldsAndOversizedPrompts() throws {
        XCTAssertTrue(RemoteCommandSchema.validate(
            command: .sessionOpen,
            body: Data(#"{"sessionID":"opaque"}"#.utf8)
        ))
        XCTAssertFalse(RemoteCommandSchema.validate(
            command: .sessionOpen,
            body: Data(#"{"sessionID":"opaque","url":"https://forbidden"}"#.utf8)
        ))
        XCTAssertFalse(RemoteCommandSchema.validate(
            command: .promptSend,
            body: try JSONSerialization.data(withJSONObject: [
                "sessionID": "opaque",
                "text": String(repeating: "x", count: 64 * 1024 + 1),
                "commandID": UUID().uuidString,
            ])
        ))
    }

    func testSettingsRequireSecureSchemesAndExactHostPath() throws {
        XCTAssertNotNil(RemoteRelaySettings.validatedWebSocketURL(
            "wss://pipi.aichattrpg.com/host/ws"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedWebSocketURL(
            "ws://pipi.aichattrpg.com/host/ws"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedWebSocketURL(
            "wss://pipi.aichattrpg.com/arbitrary"
        ))
        XCTAssertNotNil(RemoteRelaySettings.validatedPublicURL(
            "https://pipi.aichattrpg.com/"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedPublicURL(
            "http://pipi.aichattrpg.com/"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedPublicURL(
            "https://user:password@pipi.aichattrpg.com/"
        ))
        XCTAssertNotNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://pipi.aichattrpg.com/host/ws",
            publicURL: "https://pipi.aichattrpg.com/"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://evil.example/host/ws",
            publicURL: "https://pipi.aichattrpg.com/"
        ))
    }

    func testMismatchedPersistedHostsFallBackAsAPair() throws {
        let suite = "RemoteRelayHostPairTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(
            "wss://evil.example/host/ws",
            forKey: "pipiui.remoteRelay.webSocketURL"
        )
        defaults.set(
            "https://pipi.aichattrpg.com/",
            forKey: "pipiui.remoteRelay.publicURL"
        )
        let loaded = RemoteRelaySettings.load(defaults: defaults)
        XCTAssertEqual(loaded.webSocketURL, RemoteRelaySettings.defaultWebSocketURL)
        XCTAssertEqual(loaded.publicURL, RemoteRelaySettings.defaultPublicURL)
    }

    func testMismatchedHostsAreRejectedBeforeCredentialsOrTaskCreation() {
        let credentialsReads = LockedTestBox(0)
        let taskCreations = LockedTestBox(0)
        let states = LockedTestBox<[RemoteRelayConnectionState]>([])
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: RemoteRelayConfiguration(
                enabled: true,
                webSocketURL: URL(string: "wss://evil.example/host/ws")!,
                publicURL: URL(string: "https://pipi.aichattrpg.com/")!,
                deviceID: UUID().uuidString.lowercased(),
                displayName: "Mismatch"
            ),
            taskFactory: { _ in
                taskCreations.withValue { $0 += 1 }
                return FakeRemoteRelayWebSocketTask()
            },
            credentialsProvider: {
                credentialsReads.withValue { $0 += 1 }
                return RemoteRelayCredentials(
                    accessClientID: "must-not-be-read",
                    accessClientSecret: "must-not-be-read",
                    deviceSecret: "must-not-be-read"
                )
            },
            stateChanged: { state in states.withValue { $0.append(state) } }
        )
        client.start()
        XCTAssertTrue(waitUntil { states.value.contains(.invalidConfiguration) })
        XCTAssertEqual(credentialsReads.value, 0)
        XCTAssertEqual(taskCreations.value, 0)
        client.stop()
    }

    func testSettingsPersistOnlyNonSecretConfiguration() throws {
        let suite = "RemoteRelayTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.register(defaults: [
            "unrelated.registered.token": "not-a-relay-secret",
        ])
        var configuration = RemoteRelaySettings.load(defaults: defaults)
        configuration.enabled = true
        configuration.displayName = "Test Mac"
        RemoteRelaySettings.save(configuration, defaults: defaults)

        XCTAssertTrue(
            defaults.dictionaryRepresentation().keys.contains("unrelated.registered.token"),
            "fixture must prove dictionaryRepresentation includes registered defaults"
        )
        let serialized = (defaults.persistentDomain(forName: suite) ?? [:]).description
        XCTAssertFalse(serialized.contains(RemoteRelayCredential.deviceSecret.rawValue))
        XCTAssertFalse(serialized.contains(RemoteRelayCredential.accessClientSecret.rawValue))
        XCTAssertFalse(serialized.localizedCaseInsensitiveContains("token"))
    }

    func testControllerRejectsExpiredDeadlineBeforeCommandExecution() {
        let controller = RemoteHostController(store: AppStore.shared)
        let expectation = expectation(description: "response")
        controller.handle(RemoteCommandRequest(
            command: .index,
            body: Data("{}".utf8),
            deadline: Date(timeIntervalSince1970: 0)
        )) { response in
            XCTAssertEqual(response.status, 408)
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)
    }

    func testConnectionStatesExposeRequiredPresentation() {
        XCTAssertEqual(RemoteRelayConnectionState.disabled.displayText, "已关闭")
        XCTAssertTrue(RemoteRelayConnectionState.connecting.displayText.contains("连接"))
        XCTAssertTrue(RemoteRelayConnectionState.connected.displayText.contains("已连接"))
        XCTAssertTrue(RemoteRelayConnectionState.retrying(seconds: 3).displayText.contains("3"))
        XCTAssertTrue(
            RemoteRelayConnectionState.authenticationFailed.displayText.contains("认证失败")
        )
        XCTAssertTrue(
            RemoteRelayConnectionState.invalidConfiguration.displayText.contains("主机名")
        )
        XCTAssertTrue(RemoteRelayConnectionState.protocolMismatch.displayText.contains("协议"))
    }

    func testRelayQRCodeIsDescribedAsPersistentAccessLoginNotOneTimePairing() throws {
        let sheet = try String(
            contentsOf: repositoryRoot()
                .appendingPathComponent("Sources/PipiUI/Views/RemoteConnectionSheet.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(sheet.contains("可重复使用的 Cloudflare Access 登录入口"))
        XCTAssertFalse(sheet.contains("Relay 提供的短期一次性配对载荷"))
    }

    func testStaleCallbacksCannotCancelReplacementSocketOrScheduleDuplicateRetry() {
        let first = FakeRemoteRelayWebSocketTask()
        let second = FakeRemoteRelayWebSocketTask()
        let tasks = LockedTestBox([first, second])
        let factoryIndex = LockedTestBox(0)
        let scheduled = LockedTestBox<[DispatchWorkItem]>([])
        let states = LockedTestBox<[RemoteRelayConnectionState]>([])
        let lifecycleQueue = DispatchQueue(label: "RemoteRelayTests.lifecycle")
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: URL(string: "ws://127.0.0.1:1/host/ws")!,
            publicURL: URL(string: "http://127.0.0.1:1/")!,
            deviceID: UUID().uuidString.lowercased(),
            displayName: "Lifecycle Test"
        )
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: configuration,
            lifecycleQueue: lifecycleQueue,
            taskFactory: { _ in
                let index = factoryIndex.withValue { value -> Int in
                    defer { value += 1 }
                    return value
                }
                return tasks.value[index]
            },
            credentialsProvider: {
                RemoteRelayCredentials(
                    accessClientID: "test-client-id",
                    accessClientSecret: "test-client-secret",
                    deviceSecret: "test-device-secret"
                )
            },
            configurationValidator: { _ in true },
            retryDelayProvider: { _ in 0 },
            retryScheduler: { item, _ in
                scheduled.withValue { $0.append(item) }
            },
            stateChanged: { state in
                states.withValue { $0.append(state) }
            }
        )
        client.start()
        XCTAssertTrue(waitUntil { first.sendCompletionCount == 1 })
        guard case .string = first.sentMessages.first else {
            return XCTFail("hello must use a WebSocket text frame")
        }
        first.completeSend(at: 0, error: nil)
        XCTAssertTrue(waitUntil { first.receiveHandlerCount == 1 })

        guard let staleReceive = first.receiveHandlers.first else {
            return XCTFail("first task must have an installed receive callback")
        }
        staleReceive(.failure(TestRelayError.disconnected))
        XCTAssertTrue(waitUntil { scheduled.value.count == 1 })
        // A duplicate callback for the same failed generation is idempotently ignored.
        staleReceive(.failure(TestRelayError.disconnected))
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        XCTAssertEqual(scheduled.value.count, 1)

        let retry = scheduled.value[0]
        lifecycleQueue.async { retry.perform() }
        XCTAssertTrue(waitUntil { second.sendCompletionCount == 1 })
        second.completeSend(at: 0, error: nil)
        XCTAssertTrue(waitUntil { states.value.contains(.connected) })

        // A delayed callback from task A after task B is online cannot cancel B.
        staleReceive(.failure(TestRelayError.disconnected))
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        XCTAssertEqual(second.cancelCount, 0)
        XCTAssertEqual(scheduled.value.count, 1)

        client.stop()
        XCTAssertTrue(waitUntil { second.cancelCount == 1 })
    }

    func testRealURLSessionTransportUsesTextHelloAndCorrelatedTextResponseWithNode() throws {
        let root = repositoryRoot()
        let relay = root.appendingPathComponent("Relay", isDirectory: true)
        let fixture = relay.appendingPathComponent("test/swift-transport-fixture.mjs")
        let wsModule = relay.appendingPathComponent("node_modules/ws")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: wsModule.path),
            "run `cd Relay && npm install` before the Swift transport integration test"
        )

        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-relay-integration-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: temporary) }
        let portFile = temporary.appendingPathComponent("port")
        let resultFile = temporary.appendingPathComponent("result.json")
        let deviceID = UUID().uuidString.lowercased()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [
            "node",
            fixture.path,
            portFile.path,
            resultFile.path,
            deviceID,
        ]
        process.currentDirectoryURL = relay
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        try process.run()
        defer {
            if process.isRunning {
                process.terminate()
                process.waitUntilExit()
            }
        }
        XCTAssertTrue(waitUntil {
            FileManager.default.fileExists(atPath: portFile.path) || !process.isRunning
        })
        let portText = try String(contentsOf: portFile, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let port = try XCTUnwrap(Int(portText).flatMap { $0 > 0 ? $0 : nil })
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: try XCTUnwrap(URL(string: "ws://127.0.0.1:\(port)/host/ws")),
            publicURL: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/")),
            deviceID: deviceID,
            displayName: "Swift Integration"
        )
        let connected = expectation(description: "Swift client connected")
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: configuration,
            credentialsProvider: {
                RemoteRelayCredentials(
                    accessClientID: "integration-client-id",
                    accessClientSecret: "integration-client-secret",
                    deviceSecret: "integration-device-secret"
                )
            },
            configurationValidator: { _ in true },
            stateChanged: { state in
                if state == .connected { connected.fulfill() }
            }
        )
        client.start()
        wait(for: [connected], timeout: 5)
        XCTAssertTrue(waitUntil(timeout: 5) {
            FileManager.default.fileExists(atPath: resultFile.path) || !process.isRunning
        })
        client.stop()

        let data = try Data(contentsOf: resultFile)
        let result = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(result["ok"] as? Bool, true)
        XCTAssertEqual(result["helloText"] as? Bool, true)
        XCTAssertEqual(result["responseText"] as? Bool, true)
        XCTAssertEqual(result["correlated"] as? Bool, true)
        XCTAssertTrue(waitUntil(timeout: 2) { !process.isRunning })
        XCTAssertEqual(process.terminationStatus, 0)
    }
}

private enum TestRelayError: Error {
    case disconnected
}

private final class LockedTestBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: Value

    init(_ value: Value) {
        storage = value
    }

    var value: Value {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    @discardableResult
    func withValue<Result>(_ body: (inout Value) -> Result) -> Result {
        lock.lock()
        defer { lock.unlock() }
        return body(&storage)
    }
}

private final class FakeRemoteRelayWebSocketTask:
    RemoteRelayWebSocketTask,
    @unchecked Sendable
{
    typealias ReceiveHandler = @Sendable (
        Result<URLSessionWebSocketTask.Message, Error>
    ) -> Void

    private let lock = NSLock()
    private var messages: [URLSessionWebSocketTask.Message] = []
    private var sendHandlers: [@Sendable (Error?) -> Void] = []
    private var receiveCallbacks: [ReceiveHandler] = []
    private var cancellations = 0

    var sentMessages: [URLSessionWebSocketTask.Message] {
        lock.lock()
        defer { lock.unlock() }
        return messages
    }

    var sendCompletionCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return sendHandlers.count
    }

    var receiveHandlerCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return receiveCallbacks.count
    }

    var receiveHandlers: [ReceiveHandler] {
        lock.lock()
        defer { lock.unlock() }
        return receiveCallbacks
    }

    var cancelCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return cancellations
    }

    func resume() {}

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        lock.lock()
        cancellations += 1
        lock.unlock()
    }

    func send(
        _ message: URLSessionWebSocketTask.Message,
        completionHandler: @escaping @Sendable (Error?) -> Void
    ) {
        lock.lock()
        messages.append(message)
        sendHandlers.append(completionHandler)
        lock.unlock()
    }

    func receive(completionHandler: @escaping ReceiveHandler) {
        lock.lock()
        receiveCallbacks.append(completionHandler)
        lock.unlock()
    }

    func sendPing(pongReceiveHandler: @escaping @Sendable (Error?) -> Void) {}

    func completeSend(at index: Int, error: Error?) {
        lock.lock()
        let callback = sendHandlers[index]
        lock.unlock()
        callback(error)
    }
}
