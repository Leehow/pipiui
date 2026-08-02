import Foundation
import XCTest
@testable import PipiUI

final class ProductionBrowserTunnelE2ETests: XCTestCase {
    @MainActor
    func testProductionBrowserCompletesRealTunnelCommandWithoutHTTPFallback() async throws {
        guard ProcessInfo.processInfo.environment[
            "PIPIUI_RUN_PRODUCTION_BROWSER_E2E"
        ] == "1" else {
            throw XCTSkip(
                "Set PIPIUI_RUN_PRODUCTION_BROWSER_E2E=1 to run the real Chrome/WKWebView gate"
            )
        }

        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let relayURL = repositoryURL.appendingPathComponent("Relay")
        let tsxURL = relayURL.appendingPathComponent("node_modules/.bin/tsx")
        let harnessURL = relayURL.appendingPathComponent(
            "test/production-browser-e2e-harness.ts"
        )
        let chromeURL = URL(
            fileURLWithPath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        )
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: tsxURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: harnessURL.path))
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: chromeURL.path))

        try Self.runProcess(
            executable: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: ["npm", "run", "build"],
            currentDirectory: relayURL
        )

        let standardOutput = Pipe()
        let standardError = Pipe()
        let standardInput = Pipe()
        let output = ProductionE2EOutput(pipe: standardOutput)
        let errors = ProductionE2ETextOutput(pipe: standardError)
        let harness = Process()
        harness.executableURL = tsxURL
        harness.arguments = [harnessURL.path]
        harness.currentDirectoryURL = relayURL
        harness.standardOutput = standardOutput
        harness.standardError = standardError
        harness.standardInput = standardInput
        try harness.run()
        print("PIPI_E2E_SWIFT harness-started")

        var relayClient: RemoteRelayClient?
        var peerTransport: WebKitRemotePeerTransport?
        defer {
            relayClient?.stop()
            peerTransport?.stop()
            if harness.isRunning {
                try? Self.send(["type": "shutdown"], to: standardInput)
                harness.terminate()
            }
            output.stop()
            errors.stop()
        }

        let ready = try await requireMessage(
            "ready",
            from: output,
            process: harness,
            errors: errors,
            timeout: 10
        )
        print("PIPI_E2E_SWIFT relay-ready")
        let socketText = try XCTUnwrap(ready["webSocketURL"] as? String)
        let publicText = try XCTUnwrap(ready["publicURL"] as? String)
        let configuredSocketURL = try XCTUnwrap(URL(string: socketText))
        let publicURL = try XCTUnwrap(URL(string: publicText))

        let peerReady = expectation(description: "retained production WK host ready")
        let didPublishPeerReady = ProductionE2ELockedBox(false)
        let peer = WebKitRemotePeerTransport { state in
            if state == .ready {
                var shouldFulfill = false
                didPublishPeerReady.withValue {
                    if !$0 {
                        $0 = true
                        shouldFulfill = true
                    }
                }
                if shouldFulfill { peerReady.fulfill() }
            }
        }
        peerTransport = peer
        peer.start()
        await fulfillment(of: [peerReady], timeout: 10)
        XCTAssertTrue(
            peer.hasVisibleHostWindowForTesting,
            "production WK host must remain in a genuinely visible window"
        )
        // The production failure only appeared after WebKit evaluated the
        // never-ordered offscreen host as occluded and suspended its
        // WebContent process. Exercise the host after that grace period.
        try await Task.sleep(for: .seconds(8))
        XCTAssertTrue(peer.hasVisibleHostWindowForTesting)
        print("PIPI_E2E_SWIFT peer-ready")

        let commandCount = ProductionE2ELockedBox(0)
        let controller = RemoteHostController { request, respond in
            commandCount.withValue { $0 += 1 }
            guard request.command == .index else {
                respond(.json(status: 422, ["error": "unexpected E2E command"]))
                return
            }
            respond(.json([
                "projects": [[
                    "id": "e2e-project",
                    "name": "E2E Project",
                ]],
                "sessions": [],
            ]))
        }

        let states = ProductionE2ELockedBox<[RemoteRelayConnectionState]>([])
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: configuredSocketURL,
            publicURL: publicURL,
            deviceID: UUID().uuidString.lowercased(),
            displayName: "Capability Tunnel E2E"
        )
        let client = RemoteRelayClient(
            controller: controller,
            configuration: configuration,
            peerTransport: peer,
            configurationValidator: { _ in true },
            retryDelayProvider: { _ in 1 },
            stateChanged: { state in
                states.withValue { $0.append(state) }
            }
        )
        relayClient = client
        client.start()
        print("PIPI_E2E_SWIFT relay-client-started")

        let pairing = expectation(description: "Relay published pair URL")
        let pairResult = ProductionE2ELockedBox<Result<URL, Error>?>(nil)
        client.beginPairing { result in
            pairResult.withValue { $0 = result }
            pairing.fulfill()
        }
        await fulfillment(of: [pairing], timeout: 10)
        print("PIPI_E2E_SWIFT pair-created")
        guard case .success(let pairURL) = pairResult.value else {
            return XCTFail("pair URL unavailable: \(String(describing: pairResult.value))")
        }
        try Self.send([
            "type": "run",
            "pairURL": pairURL.absoluteString,
        ], to: standardInput)

        let complete = try await requireMessage(
            "complete",
            from: output,
            process: harness,
            errors: errors,
            timeout: 35
        )
        print("PIPI_E2E_SWIFT browser-complete")
        let connected = try XCTUnwrap(complete["connected"] as? [String: Any])
        let connectedTransport = try XCTUnwrap(connected["transport"] as? String)
        XCTAssertTrue(connectedTransport.contains("服务器能力隧道"))
        XCTAssertEqual(connected["hashCleared"] as? Bool, true)
        XCTAssertEqual(connected["project"] as? String, "e2e-project")
        XCTAssertEqual(commandCount.value, 1)
        XCTAssertEqual(complete["serverCommandHTTPStatus"] as? Int, 404)
        XCTAssertEqual(connected["rtcConstructorCalls"] as? Int, 0)
        XCTAssertEqual(complete["tunnelRooms"] as? Int, 0)
        XCTAssertTrue(states.value.contains(.connected))

        client.stop()
        try await Task.sleep(nanoseconds: 100_000_000)
        try Self.send(["type": "shutdown"], to: standardInput)
        harness.waitUntilExit()
        XCTAssertEqual(
            harness.terminationStatus,
            0,
            "harness stderr:\n\(errors.value)"
        )
    }

    private static func runProcess(
        executable: URL,
        arguments: [String],
        currentDirectory: URL
    ) throws {
        let process = Process()
        let output = Pipe()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = currentDirectory
        process.standardOutput = output
        process.standardError = output
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let data = output.fileHandleForReading.readDataToEndOfFile()
            throw ProductionE2EFailure.message(
                String(data: data, encoding: .utf8) ?? "npm build failed"
            )
        }
    }

    private static func send(
        _ value: [String: Any],
        to pipe: Pipe
    ) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        pipe.fileHandleForWriting.write(data)
        pipe.fileHandleForWriting.write(Data([0x0A]))
    }

    @MainActor
    private func requireMessage(
        _ type: String,
        from output: ProductionE2EOutput,
        process: Process,
        errors: ProductionE2ETextOutput,
        timeout: TimeInterval
    ) async throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let message = output.take(type: type) { return message }
            if let message = output.take(type: "error") {
                throw ProductionE2EFailure.message(
                    String(describing: message["message"] ?? message)
                )
            }
            if !process.isRunning {
                throw ProductionE2EFailure.message(
                    "harness exited \(process.terminationStatus): \(errors.value)"
                )
            }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        throw ProductionE2EFailure.message(
            "timed out waiting for \(type); stderr: \(errors.value)"
        )
    }
}

private enum ProductionE2EFailure: Error {
    case message(String)
}

private final class ProductionE2ELockedBox<Value>: @unchecked Sendable {
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

    func withValue(_ operation: (inout Value) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        operation(&storage)
    }
}

private final class ProductionE2EOutput: @unchecked Sendable {
    private let lock = NSLock()
    private let pipe: Pipe
    private var buffer = Data()
    private var messages: [[String: Any]] = []

    init(pipe: Pipe) {
        self.pipe = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            self?.append(handle.availableData)
        }
    }

    func stop() {
        pipe.fileHandleForReading.readabilityHandler = nil
    }

    func take(type: String) -> [String: Any]? {
        lock.lock()
        defer { lock.unlock() }
        guard let index = messages.firstIndex(where: {
            $0["type"] as? String == type
        }) else {
            return nil
        }
        return messages.remove(at: index)
    }

    private func append(_ data: Data) {
        guard !data.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer[..<newline]
            buffer.removeSubrange(...newline)
            guard let text = String(data: line, encoding: .utf8),
                  text.hasPrefix("PIPI_E2E "),
                  let value = try? JSONSerialization.jsonObject(
                    with: Data(text.dropFirst("PIPI_E2E ".count).utf8)
                  ) as? [String: Any] else {
                continue
            }
            print(text)
            messages.append(value)
        }
    }
}

private final class ProductionE2ETextOutput: @unchecked Sendable {
    private let lock = NSLock()
    private let pipe: Pipe
    private var storage = Data()

    init(pipe: Pipe) {
        self.pipe = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            self?.append(handle.availableData)
        }
    }

    var value: String {
        lock.lock()
        defer { lock.unlock() }
        return String(data: storage, encoding: .utf8) ?? ""
    }

    func stop() {
        pipe.fileHandleForReading.readabilityHandler = nil
    }

    private func append(_ data: Data) {
        guard !data.isEmpty else { return }
        lock.lock()
        storage.append(data)
        lock.unlock()
    }
}
