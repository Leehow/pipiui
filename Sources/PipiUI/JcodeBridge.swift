import Foundation

/// NDJSON line framing over a byte stream (mirrors jcode's sdk/typescript/src/framing.ts).
/// Encode: `JSON.stringify(frame) + "\n"`. Decode: buffer, split on "\n", trim, skip blanks.
struct NdjsonCodec {
    private var buffer = Data()

    mutating func push(_ data: Data) -> [[String: Any]] {
        buffer.append(data)
        var out: [[String: Any]] = []
        while let nlRange = buffer.range(of: Data([0x0A])) {  // "\n"
            let lineData = buffer[..<nlRange.lowerBound]       // before the newline
            // Half-open range: nlRange.upperBound is already one past the newline
            // byte, so this consumes exactly the line content + the single "\n".
            // (A closed range ...nlRange.upperBound over-removes and crashes
            // Foundation's inline Data representation on this toolchain.)
            buffer.removeSubrange(buffer.startIndex..<nlRange.upperBound)
            guard let line = String(data: lineData, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespaces),
                  !line.isEmpty,
                  let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)),
                  let dict = obj as? [String: Any] else { continue }
            out.append(dict)
        }
        return out
    }

    static func encode(_ frame: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(frame),
              let data = try? JSONSerialization.data(withJSONObject: frame),
              let s = String(data: data, encoding: .utf8) else { return "" }
        return s + "\n"
    }
}

import Network  // NWConnection

/// Drives one `jcode api-bridge` subprocess: spawns it with a private `--api-socket`,
/// connects a `NWConnection` to that socket, frames NDJSON, and delivers parsed frames
/// on the main thread. Engine-agnostic transport — JcodeBackend layers protocol semantics on top.
final class JcodeBridge {
    var onEvent: (([String: Any]) -> Void)?   // every server frame (event or reply)
    var onExit: ((Int32, String) -> Void)?
    private(set) var isRunning = false

    private let process = Process()
    private var connection: NWConnection?
    private var codec = NdjsonCodec()
    private var stderrTail = ""
    private let socketURL: URL
    /// The cwd passed to init; JcodeBackend reads it to send `create_session`'s working_dir.
    let workingDir: URL

    // MARK: - Task 2: socket connect + hello handshake + request/reply correlation

    private var nextID: Int = 0
    private var pending: [Int: ([String: Any]) -> Void] = [:]   // reply_to -> completion (main thread)
    private(set) var isReady = false                             // hello_ok received

    /// Resolve jcode binary: honor JCODE_BINARY, else PATH lookups matching the installer
    /// (`~/.local/bin/jcode`, /opt/homebrew/bin, /usr/local/bin, $PATH).
    static func findJcodeExecutable() -> String? {
        let fm = FileManager.default
        var candidates = [
            ProcessInfo.processInfo.environment["JCODE_BINARY"],
            NSHomeDirectory() + "/.local/bin/jcode",
            "/opt/homebrew/bin/jcode",
            "/usr/local/bin/jcode",
        ].compactMap { $0 }
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates += path.split(separator: ":").map { String($0) + "/jcode" }
        }
        return candidates.first { fm.isExecutableFile(atPath: $0) }
    }

    /// Spawn `jcode api-bridge` and connect. Returns nil if the binary is missing,
    /// the socket never appears, or the connection fails.
    init?(cwd: URL, provider: String? = nil, extraEnv: [String: String] = [:]) {
        workingDir = cwd
        guard let jcode = Self.findJcodeExecutable() else { return nil }

        // Private socket under TMPDIR (macOS) — never the shared daemon socket.
        let runtimeDir = ProcessInfo.processInfo.environment["JCODE_RUNTIME_DIR"]
            ?? ProcessInfo.processInfo.environment["TMPDIR"]
            ?? NSTemporaryDirectory()
        let dir = URL(fileURLWithPath: runtimeDir, isDirectory: true)
        socketURL = dir.appendingPathComponent("pipiui-jcode-\(UUID().uuidString).sock")
        try? FileManager.default.removeItem(at: socketURL)

        var env = ProcessInfo.processInfo.environment
        for (k, v) in extraEnv { env[k] = v }
        env["JCODE_API_SOCKET"] = socketURL.path
        env["JCODE_RUNTIME_DIR"] = dir.path

        var args = ["api-bridge", "--api-socket", socketURL.path, "--quiet", "--no-update"]
        if let provider { args += ["--provider", provider] }

        process.executableURL = URL(fileURLWithPath: jcode)
        process.arguments = args
        process.currentDirectoryURL = cwd
        process.environment = env
        let errPipe = Pipe()
        process.standardError = errPipe
        errPipe.fileHandleForReading.readabilityHandler = { [weak self] h in
            let t = String(data: h.availableData, encoding: .utf8) ?? ""
            guard !t.isEmpty else { return }
            DispatchQueue.main.async {
                guard let self else { return }
                self.stderrTail = String((self.stderrTail + t).suffix(4000))
            }
        }
        process.terminationHandler = { [weak self] p in
            DispatchQueue.main.async {
                guard let self else { return }
                self.isRunning = false
                self.connection?.cancel()
                self.onExit?(p.terminationStatus, self.stderrTail)
            }
        }
        do { try process.run(); isRunning = true } catch { return nil }
    }

    /// Send one NDJSON frame. No-op (calls nothing) if not running.
    func sendFrame(_ frame: [String: Any]) {
        guard isRunning else { return }
        let line = NdjsonCodec.encode(frame)
        guard let data = line.data(using: .utf8) else { return }
        connection?.send(content: data, completion: .contentProcessed { _ in })
    }

    // MARK: - Connect + handshake (Task 2)

    /// Poll for the socket file, then connect NWConnection, then send hello.
    /// completion fires once on the main thread: true on hello_ok, false on any failure.
    /// A one-shot guard guards against NWConnection firing the stateUpdateHandler
    /// through both `.failed` and `.cancelled` (e.g. connection fails, then
    /// `terminate()` cancels) which would otherwise double-fire the completion.
    func connectAndHandshake(completion: @escaping (Bool) -> Void) {
        let deadline = Date().addingTimeInterval(30)  // match jcode SDK startupTimeoutMs 30s
        var hasFired = false
        let once: (Bool) -> Void = { ok in
            guard !hasFired else { return }
            hasFired = true
            DispatchQueue.main.async { completion(ok) }
        }
        attemptConnect(deadline: deadline, completion: once)
    }

    private func attemptConnect(deadline: Date, completion: @escaping (Bool) -> Void) {
        guard Date() < deadline else { completion(false); return }
        if FileManager.default.fileExists(atPath: socketURL.path) {
            doConnect(completion: completion)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                self?.attemptConnect(deadline: deadline, completion: completion)
            }
        }
    }

    private func doConnect(completion: @escaping (Bool) -> Void) {
        let conn = NWConnection(to: .unix(path: socketURL.path), using: .tcp)
        connection = conn
        // `conn.start(queue: .global())` runs this handler on a background queue.
        // `startReceiving()` only schedules an async `receive(...)` whose callback
        // hops to main, so it's safe to call from here. `sendHello` synchronously
        // mutates nextID/pending (via `request`), so it must run on main to keep
        // those fields main-thread-confined (handleFrame reads them on main).
        // `completion` here is the one-shot `once` wrapper from
        // `connectAndHandshake`, which delivers on main and guards against
        // double-fire (`.failed` then `.cancelled`).
        conn.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.startReceiving()
                DispatchQueue.main.async { [weak self] in
                    self?.sendHello(completion: completion)
                }
            case .failed, .cancelled:
                completion(false)
            default: break
            }
        }
        conn.start(queue: .global())
    }

    private func startReceiving() {
        receiveLoop()
    }

    private func receiveLoop() {
        connection?.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, error in
            guard let self, let data, error == nil else { return }
            let frames = self.codec.push(data)
            DispatchQueue.main.async {
                for f in frames { self.handleFrame(f) }
            }
            self.receiveLoop()
        }
    }

    /// Dispatch one parsed frame on the main thread. If it carries a `reply_to`
    /// matching a pending request, fire that completion; always deliver to `onEvent`.
    private func handleFrame(_ frame: [String: Any]) {
        // Reply to a request?
        if let replyTo = frame["reply_to"] as? Int, let cb = pending.removeValue(forKey: replyTo) {
            cb(frame)
        }
        // Always deliver (events + replies; JcodeBackend decides what's interesting)
        onEvent?(frame)
    }

    private func sendHello(completion: @escaping (Bool) -> Void) {
        request(["req": "hello", "min_version": 1, "max_version": 1, "client": "pipiui"]) { [weak self] resp in
            let ok = resp["ev"] as? String == "hello_ok"
            self?.isReady = ok
            completion(ok)
        }
    }

    /// Send a request with an auto-incremented id; completion fires on main thread when
    /// the matching `reply_to` frame arrives (or never if the bridge dies first).
    func request(_ req: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        nextID += 1
        let id = nextID
        var frame = req; frame["v"] = 1; frame["id"] = id
        pending[id] = completion
        sendFrame(frame)
    }

    /// Tear down: cancel connection, terminate process. Idempotent.
    func terminate() {
        guard isRunning else { return }
        isRunning = false
        connection?.cancel()
        process.terminate()
    }
}
