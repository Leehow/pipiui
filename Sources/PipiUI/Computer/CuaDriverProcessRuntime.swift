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
    /// Per-stream stderr tail capacity (bytes). Newest bytes are kept; the
    /// oldest overflow is discarded so a chatty generation can never block its
    /// stderr pipe.
    static let stderrTailCapacity = 16_384
    /// Maximum time to wait for a terminated child's stderr drain to reach EOF
    /// when capturing failure diagnostics. EOF is delivered within
    /// milliseconds of the child closing its stderr, so this budget only bounds
    /// the pathological case; it never gates the emergency-cancel path.
    static let stderrFlushBudget: TimeInterval = 0.3
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
    private var daemonStderrPipe: Pipe?
    private var daemonStderrTail: BoundedPipeTail?
    private var proxyStderrPipe: Pipe?
    private var proxyStderrTail: BoundedPipeTail?
    private var cancellationEpoch: UInt64 = 0
    private var shutdownRequested = false
    private struct RegisteredProcess {
        let process: Process
        let epoch: UInt64
        let socketURL: URL
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
        let expectedEpoch = try epochForNewCall()
        return try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                do {
                    try checkCancellation(expectedEpoch)
                    try ensureStarted(expectedEpoch: expectedEpoch)
                    let result = try callToolLocked(tool, arguments)
                    continuation.resume(returning: result)
                } catch {
                    if Self.requiresGenerationTeardown(error) {
                        // A user-driven cancel bumps the epoch before tearing
                        // the generation down; that path is already logged at
                        // the stop entry point, so do not double-log it as a
                        // fatal failure here.
                        let cancelledHere = cancellationLock.withLock {
                            cancellationEpoch != expectedEpoch
                        }
                        if !cancelledHere {
                            logFatalGenerationFailure(error)
                        }
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
    /// normal cleanup, with a delayed exact-generation kill/socket fallback.
    func cancelAndStop() {
        Log.info("cua-driver stop/cancel requested", category: .process)
        let cancellation = signalCancellation()
        queue.async { [self] in
            stopLocked()
        }
        DispatchQueue.global(qos: .userInitiated).asyncAfter(
            deadline: .now() + 0.4
        ) { [self] in
            forceKill(
                processes: cancellation.processes,
                socketURLs: cancellation.socketURLs,
                olderThanEpoch: cancellation.epoch
            )
        }
    }

    /// App-termination boundary. Unlike interactive cancellation, this waits
    /// for the SIGTERM-to-SIGKILL escalation and serialized teardown so the
    /// host cannot exit and orphan an embedded driver generation. Escalation
    /// must happen before queue synchronization: the queue may currently be
    /// blocked reading from the very proxy that shutdown needs to reap.
    func shutdownAndWait() {
        Log.info("cua-driver synchronous shutdown requested", category: .process)
        let cancellation = signalCancellation(final: true)

        let gracefulDeadline = Date().addingTimeInterval(0.4)
        while cancellation.processes.contains(where: \.isRunning),
              Date() < gracefulDeadline {
            Thread.sleep(forTimeInterval: 0.01)
        }
        forceKill(
            processes: cancellation.processes,
            socketURLs: cancellation.socketURLs,
            olderThanEpoch: cancellation.epoch
        )

        if DispatchQueue.getSpecific(key: queueKey) == 1 {
            stopLocked()
        } else {
            // A forced proxy exit wakes any in-flight poll/read immediately.
            // Its queued error cleanup runs first; this barrier then proves
            // every owned Process has reached terminate(...).waitUntilExit().
            queue.sync { stopLocked() }
        }
    }

    private func epochForNewCall() throws -> UInt64 {
        try cancellationLock.withLock {
            guard !shutdownRequested else {
                throw CuaDriverError.cancelled
            }
            return cancellationEpoch
        }
    }

    private func checkCancellation(_ expectedEpoch: UInt64) throws {
        guard cancellationLock.withLock({
            cancellationEpoch == expectedEpoch
        }) else {
            throw CuaDriverError.cancelled
        }
    }

    private func signalCancellation(final: Bool = false) -> (
        epoch: UInt64,
        processes: [Process],
        socketURLs: [URL]
    ) {
        cancellationLock.withLock {
            if final { shutdownRequested = true }
            cancellationEpoch &+= 1
            let registrations = Array(registeredProcesses.values)
            let processes = registrations.map(\.process)
            for process in processes where process.isRunning {
                Darwin.kill(process.processIdentifier, SIGTERM)
            }
            return (
                cancellationEpoch,
                processes,
                Array(Set(registrations.map(\.socketURL)))
            )
        }
    }

    private func forceKill(
        processes: [Process],
        socketURLs: [URL],
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
        for socketURL in socketURLs {
            try? FileManager.default.removeItem(at: socketURL)
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
        let daemonStderr = Pipe()
        daemonProcess.standardError = daemonStderr
        try daemonProcess.run()
        let daemonTail = BoundedPipeTail(
            capacity: Self.stderrTailCapacity
        )
        attachStderrDrain(pipe: daemonStderr, tail: daemonTail)
        // Close the parent's copy of the write end. The child holds its own
        // dup'd stderr and is unaffected; closing our copy means that when the
        // child exits the read end observes EOF, which the drain handler turns
        // into a completeness signal for deterministic failure capture.
        try? daemonStderr.fileHandleForWriting.close()
        daemonStderrPipe = daemonStderr
        daemonStderrTail = daemonTail
        daemon = daemonProcess
        daemonLivenessInput = liveness.fileHandleForWriting
        try register(
            process: daemonProcess,
            socketURL: socket,
            expectedEpoch: expectedEpoch
        )

        let deadline = Date().addingTimeInterval(startupTimeout)
        while !isPrivateOwnedSocket(at: socket) {
            guard daemonProcess.isRunning else {
                let message = exitDiagnostics(
                    role: "serve daemon",
                    process: daemonProcess,
                    tail: daemonStderrTail
                )
                stopLocked()
                throw CuaDriverError.processExited(message)
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
        let proxyStderr = Pipe()
        proxyProcess.standardError = proxyStderr
        try proxyProcess.run()
        let proxyTail = BoundedPipeTail(
            capacity: Self.stderrTailCapacity
        )
        attachStderrDrain(pipe: proxyStderr, tail: proxyTail)
        // See daemon setup: closing the parent's write-end copy lets the read
        // end observe EOF when the proxy exits.
        try? proxyStderr.fileHandleForWriting.close()
        proxyStderrPipe = proxyStderr
        proxyStderrTail = proxyTail
        proxy = proxyProcess
        try register(
            process: proxyProcess,
            socketURL: socket,
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

        Log.info(
            "cua-driver generation \(generation) started "
                + "(daemon pid=\(daemonProcess.processIdentifier), "
                + "proxy pid=\(proxyProcess.processIdentifier))",
            category: .process
        )

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
        socketURL: URL,
        expectedEpoch: UInt64
    ) throws {
        let accepted = cancellationLock.withLock {
            guard cancellationEpoch == expectedEpoch else { return false }
            registeredProcesses[ObjectIdentifier(process)] = RegisteredProcess(
                process: process,
                epoch: expectedEpoch,
                socketURL: socketURL
            )
            return true
        }
        guard accepted else {
            // Registration can lose a race with final App shutdown after the
            // child has already spawned. Reap that unregistered child here;
            // it is absent from shutdown's registered-generation snapshot.
            terminate(process)
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
            throw CuaDriverError.processExited(
                exitDiagnostics(
                    role: "MCP proxy",
                    process: proxy,
                    tail: proxyStderrTail
                )
            )
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
            throw CuaDriverError.processExited(
                exitDiagnostics(
                    role: "MCP proxy stdin",
                    process: proxy,
                    tail: proxyStderrTail
                )
            )
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
                throw CuaDriverError.processExited(
                    exitDiagnostics(
                        role: "MCP proxy stdout",
                        process: proxy,
                        tail: proxyStderrTail
                    )
                )
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
                throw CuaDriverError.processExited(
                    exitDiagnostics(
                        role: "MCP proxy stdout",
                        process: proxy,
                        tail: proxyStderrTail
                    )
                )
            }
            readBuffer.append(bytes, count: count)
        }
    }

    private func stopLocked() {
        initialized = false
        detachStderrDrain(pipe: daemonStderrPipe)
        detachStderrDrain(pipe: proxyStderrPipe)
        try? daemonStderrPipe?.fileHandleForReading.close()
        try? daemonStderrPipe?.fileHandleForWriting.close()
        daemonStderrPipe = nil
        try? proxyStderrPipe?.fileHandleForReading.close()
        try? proxyStderrPipe?.fileHandleForWriting.close()
        proxyStderrPipe = nil
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
        daemonStderrTail = nil
        proxyStderrTail = nil
        if let socketURL {
            try? FileManager.default.removeItem(at: socketURL)
        }
        socketURL = nil
    }

    private func attachStderrDrain(pipe: Pipe, tail: BoundedPipeTail) {
        let handle = pipe.fileHandleForReading
        handle.readabilityHandler = { [weak tail] handle in
            let chunk = handle.availableData
            if chunk.isEmpty {
                // EOF: the child closed its stderr. Drop the handler and mark
                // the tail complete. EOF is delivered only after every data
                // chunk, so this proves the tail holds everything the child
                // wrote, letting failure capture serialize behind the flush.
                handle.readabilityHandler = nil
                tail?.markEOF()
                return
            }
            tail?.append(chunk)
        }
    }

    private func detachStderrDrain(pipe: Pipe?) {
        // Clearing the handler stops further dispatch callbacks; closing the
        // pipe handles (in stopLocked) prevents an fd leak and lets any
        // in-flight reader observe EOF.
        pipe?.fileHandleForReading.readabilityHandler = nil
    }

    /// Waits (bounded) for the drain handler to report EOF on a child's
    /// stderr, but only when that child has already terminated — at which
    /// point EOF is imminent. This closes the race where a fast-exit child
    /// writes its final stderr and exits before the async readability handler
    /// has flushed it into the tail. Never blocks for a still-running child,
    /// so hung-process and timeout paths are unaffected.
    private func waitForStderrEOF(
        process: Process?,
        tail: BoundedPipeTail?
    ) {
        guard let process, let tail, process.isRunning == false else { return }
        _ = tail.waitForEOF(timeout: Self.stderrFlushBudget)
    }

    /// Enriches a role label with the process exit status/reason (when the
    /// process has already terminated) and a sanitized stderr tail, so a
    /// transport error carries actionable evidence instead of a bare name.
    private func exitDiagnostics(
        role: String,
        process: Process?,
        tail: BoundedPipeTail?
    ) -> String {
        // Serialize behind the async drain so a just-exited child's final
        // stderr is guaranteed to be in the tail before we snapshot it.
        waitForStderrEOF(process: process, tail: tail)
        var segments: [String] = []
        if let process, process.isRunning == false {
            segments.append("status=\(process.terminationStatus)")
            segments.append(
                "reason=\(Self.reasonString(process.terminationReason))"
            )
        }
        if let tail {
            let text = tail.sanitizedTail()
            if !text.isEmpty {
                segments.append("stderr=\(text)")
            }
        }
        guard !segments.isEmpty else { return role }
        return "\(role) (\(segments.joined(separator: ", ")))"
    }

    /// Redacted stderr snapshot of both children, for fatal logs whose error
    /// did not already embed stderr (e.g. protocol timeouts).
    private func snapshotStderr() -> String {
        var parts: [String] = []
        let daemonText = daemonStderrTail?.sanitizedTail() ?? ""
        if !daemonText.isEmpty {
            parts.append("daemon stderr=\(daemonText)")
        }
        let proxyText = proxyStderrTail?.sanitizedTail() ?? ""
        if !proxyText.isEmpty {
            parts.append("proxy stderr=\(proxyText)")
        }
        return parts.joined(separator: " ")
    }

    private func logFatalGenerationFailure(_ error: Error) {
        // A non-exit failure (e.g. a protocol timeout) still benefits from any
        // stderr the children emitted. Only children that have already exited
        // can reach EOF, so this never blocks for a live, hung process; for a
        // crash, the exiting path's `exitDiagnostics` already observed EOF and
        // the wait returns immediately.
        waitForStderrEOF(process: daemon, tail: daemonStderrTail)
        waitForStderrEOF(process: proxy, tail: proxyStderrTail)
        var detail = Self.logLabel(for: error)
        if !detail.contains("stderr=") {
            let snapshot = snapshotStderr()
            if !snapshot.isEmpty {
                detail += " " + snapshot
            }
        }
        Log.error(
            "cua-driver generation \(generation) fatal: \(detail)",
            category: .process
        )
    }

    /// Compact, secret-free label for a driver error, suitable for the
    /// unified log. Omits embedded socket paths and tool messages; for
    /// `.processExited` the role already carries exit status and redacted
    /// stderr, which is safe to repeat.
    private static func logLabel(for error: Error) -> String {
        guard let driverError = error as? CuaDriverError else {
            return "unknown"
        }
        switch driverError {
        case .cancelled:
            return "cancelled"
        case .helperMissing:
            return "helperMissing"
        case .helperNotExecutable:
            return "helperNotExecutable"
        case .startupTimedOut:
            return "startupTimedOut"
        case .permissionAttribution:
            return "permissionAttribution"
        case .startupContract:
            return "startupContract"
        case .protocolFailure:
            return "protocolFailure"
        case .toolFailure(let tool, _):
            return "toolFailure(\(tool))"
        case .processExited(let role):
            return "processExited(\(role))"
        }
    }

    private static func reasonString(
        _ reason: Process.TerminationReason
    ) -> String {
        switch reason {
        case .exit: return "exit"
        case .uncaughtSignal: return "uncaughtSignal"
        @unknown default: return "unknown"
        }
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
