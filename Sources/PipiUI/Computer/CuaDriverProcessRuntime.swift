import Foundation
import Darwin

/// Owns one embedded Cua daemon generation and its stdio MCP proxy.
///
/// All process and JSON-RPC work is serialized on `queue`. The GUI app spawns
/// both children directly, preserving the macOS TCC responsibility chain.
final class CuaDriverProcessRuntime: CuaDriverTransport, @unchecked Sendable {
    static let hostBundleID = "com.leehow.pipiui"
    static let requestedProtocolVersion = "2025-06-18"
    static let supportedProtocolVersions: Set<String> = ["2025-06-18"]
    static let environmentOverlay = [
        "CUA_DRIVER_EMBEDDED": "1",
        "CUA_DRIVER_HOST_BUNDLE_ID": hostBundleID,
        "CUA_DRIVER_PERMISSION_MODE": "unrestricted",
        "CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS": "1",
        "CUA_DRIVER_RS_TELEMETRY_ENABLED": "false",
    ]

    private let queue = DispatchQueue(label: "com.leehow.pipiui.cua-driver")
    private let queueKey = DispatchSpecificKey<UInt8>()
    private let cancellationLock = NSLock()
    private let startupTimeout: TimeInterval
    private let responseTimeout: TimeInterval
    private let driverPathOverride: String?

    private var daemon: Process?
    private var daemonLivenessInput: FileHandle?
    private var proxy: Process?
    private var proxyInput: FileHandle?
    private var proxyOutput: FileHandle?
    private var readBuffer = Data()
    private var nextID = 0
    private var generation: UInt64 = 0
    private var socketURL: URL?
    private var initialized = false
    private var cancellationEpoch: UInt64 = 0
    private struct RegisteredProcess {
        let process: Process
        let epoch: UInt64
    }
    private var registeredProcesses:
        [ObjectIdentifier: RegisteredProcess] = [:]

    init(
        driverPathOverride: String? = nil,
        startupTimeout: TimeInterval = 10,
        responseTimeout: TimeInterval = 32
    ) {
        self.driverPathOverride = driverPathOverride
        self.startupTimeout = startupTimeout
        self.responseTimeout = responseTimeout
        queue.setSpecific(key: queueKey, value: 1)
    }

    deinit {
        _ = signalCancellation()
        if DispatchQueue.getSpecific(key: queueKey) == 1 {
            stopLocked()
        } else {
            queue.sync { stopLocked() }
        }
    }

    func call(
        tool: String,
        arguments: [String: Any]
    ) async throws -> CuaToolResult {
        let expectedEpoch = currentCancellationEpoch()
        return try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                do {
                    try checkCancellation(expectedEpoch)
                    try ensureStarted(expectedEpoch: expectedEpoch)
                    let result = try callToolLocked(tool, arguments)
                    continuation.resume(returning: result)
                } catch {
                    if Self.requiresGenerationTeardown(error) {
                        stopLocked()
                    }
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Do not wait for the serialized JSON-RPC queue here. It may be blocked
    /// in a bounded MCP read, and emergency stop is a main-thread action.
    /// SIGTERM immediately interrupts both children; the owning queue performs
    /// normal handle/socket cleanup as the failed request unwinds.
    func cancelAndStop() {
        let cancellation = signalCancellation()
        queue.async { [self] in
            stopLocked()
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(
            deadline: .now() + 0.4
        ) { [weak self] in
            self?.forceKill(
                processes: cancellation.processes,
                olderThanEpoch: cancellation.epoch
            )
        }
    }

    private func currentCancellationEpoch() -> UInt64 {
        cancellationLock.withLock { cancellationEpoch }
    }

    private func checkCancellation(_ expectedEpoch: UInt64) throws {
        guard cancellationLock.withLock({
            cancellationEpoch == expectedEpoch
        }) else {
            throw CuaDriverError.cancelled
        }
    }

    private func signalCancellation() -> (
        epoch: UInt64,
        processes: [Process]
    ) {
        cancellationLock.withLock {
            cancellationEpoch &+= 1
            let processes = registeredProcesses.values.map(\.process)
            for process in processes where process.isRunning {
                Darwin.kill(process.processIdentifier, SIGTERM)
            }
            return (cancellationEpoch, processes)
        }
    }

    private func forceKill(
        processes: [Process],
        olderThanEpoch: UInt64
    ) {
        cancellationLock.withLock {
            for process in processes {
                let key = ObjectIdentifier(process)
                guard let registered = registeredProcesses[key],
                      registered.process === process,
                      registered.epoch < olderThanEpoch,
                      process.isRunning else { continue }
                Darwin.kill(process.processIdentifier, SIGKILL)
            }
        }
    }

    private static func requiresGenerationTeardown(_ error: Error) -> Bool {
        guard let driverError = error as? CuaDriverError else { return true }
        return driverError.isGenerationFatal
    }

    private func helperURL() throws -> URL {
        let environment = ProcessInfo.processInfo.environment
#if DEBUG
        let environmentOverride = environment["PIPIUI_CUA_DRIVER_PATH"]
#else
        let environmentOverride: String? = nil
#endif
        let path = driverPathOverride
            ?? environmentOverride
            ?? Bundle.main.bundleURL
                .appendingPathComponent("Contents/Helpers/cua-driver").path
        guard FileManager.default.fileExists(atPath: path) else {
            throw CuaDriverError.helperMissing(path)
        }
        guard FileManager.default.isExecutableFile(atPath: path) else {
            throw CuaDriverError.helperNotExecutable(path)
        }
        return URL(fileURLWithPath: path)
    }

    private func trustedEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        for (key, value) in Self.environmentOverlay {
            environment[key] = value
        }
        return environment
    }

    private func ensureStarted(expectedEpoch: UInt64) throws {
        if initialized,
           daemon?.isRunning == true,
           proxy?.isRunning == true {
            return
        }
        stopLocked()

        let helper = try helperURL()
        generation &+= 1
        let socketName = "pipiui-cua-\(ProcessInfo.processInfo.processIdentifier)-\(generation)-\(UUID().uuidString).sock"
        let socket = URL(
            fileURLWithPath: "/tmp",
            isDirectory: true
        ).appendingPathComponent(socketName)
        try? FileManager.default.removeItem(at: socket)
        socketURL = socket

        let liveness = Pipe()
        let daemonProcess = Process()
        daemonProcess.executableURL = helper
        daemonProcess.arguments = [
            "serve",
            "--embedded",
            "--parent-liveness-stdio",
            "--no-permissions-gate",
            "--socket", socket.path,
            "--host-bundle-id", Self.hostBundleID,
            "--permission-mode", "unrestricted",
            "--dangerously-bypass-approvals",
        ]
        daemonProcess.environment = trustedEnvironment()
        daemonProcess.standardInput = liveness
        daemonProcess.standardOutput = FileHandle.nullDevice
        daemonProcess.standardError = FileHandle.nullDevice
        try daemonProcess.run()
        daemon = daemonProcess
        daemonLivenessInput = liveness.fileHandleForWriting
        try register(
            process: daemonProcess,
            expectedEpoch: expectedEpoch
        )

        let deadline = Date().addingTimeInterval(startupTimeout)
        while !isPrivateOwnedSocket(at: socket) {
            guard daemonProcess.isRunning else {
                stopLocked()
                throw CuaDriverError.processExited("serve daemon")
            }
            guard Date() < deadline else {
                stopLocked()
                throw CuaDriverError.startupTimedOut(socket.path)
            }
            try checkCancellation(expectedEpoch)
            Thread.sleep(forTimeInterval: 0.025)
        }

        let toProxy = Pipe()
        let fromProxy = Pipe()
        let proxyProcess = Process()
        proxyProcess.executableURL = helper
        proxyProcess.arguments = [
            "mcp",
            "--embedded",
            "--socket", socket.path,
            "--host-bundle-id", Self.hostBundleID,
        ]
        proxyProcess.environment = trustedEnvironment()
        proxyProcess.standardInput = toProxy
        proxyProcess.standardOutput = fromProxy
        proxyProcess.standardError = FileHandle.nullDevice
        try proxyProcess.run()
        proxy = proxyProcess
        try register(
            process: proxyProcess,
            expectedEpoch: expectedEpoch
        )
        proxyInput = toProxy.fileHandleForWriting
        // A proxy crash must become a normal transport error, never SIGPIPE
        // the GUI host while writing the next JSON-RPC line.
        _ = Darwin.fcntl(
            toProxy.fileHandleForWriting.fileDescriptor,
            F_SETNOSIGPIPE,
            1
        )
        proxyOutput = fromProxy.fileHandleForReading
        readBuffer.removeAll(keepingCapacity: true)
        nextID = 0

        do {
            nextID += 1
            let initialize = try requestLocked(
                id: nextID,
                method: "initialize",
                params: [
                    "protocolVersion": Self.requestedProtocolVersion,
                    "capabilities": [:],
                    "clientInfo": [
                        "name": "PipiUI",
                        "version": "0.1",
                    ],
                ]
            )
            try Self.validateInitializeResponse(initialize)
            try writeJSONLine([
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            ])
            initialized = true

            let permissions = try callToolLocked("check_permissions", [:])
            try Self.validatePermissionSource(
                permissions.structuredContent
            )
        } catch {
            stopLocked()
            throw error
        }
    }

    private func register(
        process: Process,
        expectedEpoch: UInt64
    ) throws {
        let accepted = cancellationLock.withLock {
            guard cancellationEpoch == expectedEpoch else { return false }
            registeredProcesses[ObjectIdentifier(process)] = RegisteredProcess(
                process: process,
                epoch: expectedEpoch
            )
            return true
        }
        guard accepted else {
            Darwin.kill(process.processIdentifier, SIGTERM)
            throw CuaDriverError.cancelled
        }
    }

    static func validateInitializeResponse(
        _ response: [String: Any]
    ) throws {
        guard let initializeResult =
                response["result"] as? [String: Any],
              let protocolVersion =
                initializeResult["protocolVersion"] as? String,
              supportedProtocolVersions.contains(protocolVersion) else {
            throw CuaDriverError.protocolFailure(
                "initialize returned an unsupported protocolVersion"
            )
        }
    }

    static func validatePermissionSource(
        _ structuredContent: [String: Any]
    ) throws {
        let source = structuredContent["source"] as? [String: Any]
        let attribution = source?["attribution"] as? String ?? "missing"
        guard attribution == "host" else {
            throw CuaDriverError.permissionAttribution(attribution)
        }
        guard source?["embedded"] as? Bool == true,
              source?["host_bundle_id"] as? String == hostBundleID else {
            throw CuaDriverError.startupContract(
                "check_permissions did not confirm embedded=true and "
                    + "host_bundle_id=\(hostBundleID)"
            )
        }
    }

    private func unregister(process: Process) {
        cancellationLock.withLock {
            registeredProcesses.removeValue(
                forKey: ObjectIdentifier(process)
            )
        }
    }

    private func isPrivateOwnedSocket(at url: URL) -> Bool {
        var status = stat()
        guard Darwin.lstat(url.path, &status) == 0 else { return false }
        let type = status.st_mode & mode_t(S_IFMT)
        let permissions = status.st_mode & mode_t(0o777)
        return type == mode_t(S_IFSOCK)
            && status.st_uid == geteuid()
            && permissions == mode_t(0o600)
    }

    private func callToolLocked(
        _ tool: String,
        _ arguments: [String: Any]
    ) throws -> CuaToolResult {
        guard initialized,
              proxy?.isRunning == true else {
            throw CuaDriverError.processExited("MCP proxy")
        }
        nextID += 1
        let message = try requestLocked(
            id: nextID,
            method: "tools/call",
            params: [
                "name": tool,
                "arguments": arguments,
            ]
        )
        if let rpcError = message["error"] as? [String: Any] {
            throw CuaDriverError.protocolFailure(
                rpcError["message"] as? String
                    ?? String(describing: rpcError)
            )
        }
        guard let result = message["result"] as? [String: Any] else {
            throw CuaDriverError.protocolFailure(
                "\(tool) returned no result object"
            )
        }
        let content = result["content"] as? [[String: Any]] ?? []
        let structured = result["structuredContent"] as? [String: Any]
            ?? result["structured_content"] as? [String: Any]
            ?? [:]
        let isError = result["isError"] as? Bool
            ?? result["is_error"] as? Bool
            ?? false
        let parsed = CuaToolResult(
            content: content,
            structuredContent: structured,
            isError: isError
        )
        if isError {
            throw CuaDriverError.toolFailure(
                tool: tool,
                message: parsed.text.isEmpty
                    ? String(describing: structured)
                    : parsed.text
            )
        }
        return parsed
    }

    private func requestLocked(
        id: Int,
        method: String,
        params: [String: Any]
    ) throws -> [String: Any] {
        try writeJSONLine([
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        ])
        let deadline = Date().addingTimeInterval(responseTimeout)
        while true {
            let message = try readJSONLine(deadline: deadline)
            if (message["id"] as? NSNumber)?.intValue == id {
                return message
            }
        }
    }

    private func writeJSONLine(_ object: [String: Any]) throws {
        guard let proxyInput else {
            throw CuaDriverError.processExited("MCP proxy stdin")
        }
        var data = try JSONSerialization.data(withJSONObject: object)
        data.append(0x0A)
        do {
            try proxyInput.write(contentsOf: data)
        } catch {
            throw CuaDriverError.processExited("MCP proxy stdin")
        }
    }

    private func readJSONLine(deadline: Date) throws -> [String: Any] {
        while true {
            if let newline = readBuffer.firstIndex(of: 0x0A) {
                let line = readBuffer.subdata(
                    in: readBuffer.startIndex..<newline
                )
                readBuffer.removeSubrange(readBuffer.startIndex...newline)
                if line.isEmpty { continue }
                guard let object = try JSONSerialization.jsonObject(with: line)
                        as? [String: Any] else {
                    throw CuaDriverError.protocolFailure(
                        "MCP proxy emitted a non-object JSON line"
                    )
                }
                return object
            }

            guard let proxyOutput,
                  proxy?.isRunning == true else {
                throw CuaDriverError.processExited("MCP proxy stdout")
            }
            let remaining = deadline.timeIntervalSinceNow
            guard remaining > 0 else {
                throw CuaDriverError.protocolFailure(
                    "timed out waiting for MCP response"
                )
            }
            var descriptor = pollfd(
                fd: proxyOutput.fileDescriptor,
                events: Int16(POLLIN),
                revents: 0
            )
            let timeout = Int32(min(remaining * 1_000, 1_000))
            let pollResult = Darwin.poll(&descriptor, 1, timeout)
            if pollResult < 0 {
                if errno == EINTR { continue }
                throw CuaDriverError.protocolFailure(
                    "poll failed with errno \(errno)"
                )
            }
            if pollResult == 0 { continue }
            var bytes = [UInt8](repeating: 0, count: 64 * 1024)
            let count = bytes.withUnsafeMutableBytes {
                Darwin.read(
                    proxyOutput.fileDescriptor,
                    $0.baseAddress,
                    $0.count
                )
            }
            if count < 0 {
                if errno == EINTR { continue }
                throw CuaDriverError.protocolFailure(
                    "read failed with errno \(errno)"
                )
            }
            guard count > 0 else {
                throw CuaDriverError.processExited("MCP proxy stdout")
            }
            readBuffer.append(bytes, count: count)
        }
    }

    private func stopLocked() {
        initialized = false
        try? daemonLivenessInput?.close()
        daemonLivenessInput = nil
        try? proxyInput?.close()
        proxyInput = nil
        try? proxyOutput?.close()
        proxyOutput = nil
        readBuffer.removeAll(keepingCapacity: false)
        terminate(proxy)
        terminate(daemon)
        proxy = nil
        daemon = nil
        if let socketURL {
            try? FileManager.default.removeItem(at: socketURL)
        }
        socketURL = nil
    }

    private func terminate(_ process: Process?) {
        guard let process else { return }
        defer { unregister(process: process) }
        if process.isRunning {
            process.terminate()
            let deadline = Date().addingTimeInterval(0.4)
            while process.isRunning, Date() < deadline {
                Thread.sleep(forTimeInterval: 0.01)
            }
            if process.isRunning {
                Darwin.kill(process.processIdentifier, SIGKILL)
            }
        }
        process.waitUntilExit()
    }
}
