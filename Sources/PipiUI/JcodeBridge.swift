import Foundation

/// NDJSON line framing over a byte stream (mirrors jcode's sdk/typescript/src/framing.ts).
/// Encode: `JSON.stringify(frame) + "\n"`. Decode: buffer, split on "\n", trim, skip blanks.
struct NdjsonCodec {
    private var buffer = ""

    mutating func push(_ data: Data) -> [[String: Any]] {
        buffer += String(data: data, encoding: .utf8) ?? ""
        var out: [[String: Any]] = []
        while let nl = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<nl]).trimmingCharacters(in: .whitespaces)
            buffer = String(buffer[buffer.index(after: nl)...])
            guard !line.isEmpty,
                  let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)),
                  let dict = obj as? [String: Any] else { continue }
            out.append(dict)
        }
        return out
    }

    static func encode(_ frame: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(frame),
              let data = try? JSONSerialization.data(withJSONObject: frame) else { return "" }
        return String(data: data, encoding: .utf8)! + "\n"
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
        process.standardError = Pipe()  // captured via readabilityHandler below
        let errPipe = Pipe()
        process.standardError = errPipe
        errPipe.fileHandleForReading.readabilityHandler = { [weak self] h in
            let t = String(data: h.availableData, encoding: .utf8) ?? ""
            guard !t.isEmpty else { return }
            DispatchQueue.main.async { self?.stderrTail = String((self!.stderrTail + t).suffix(4000)) }
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

    /// Tear down: cancel connection, terminate process. Idempotent.
    func terminate() {
        guard isRunning else { return }
        isRunning = false
        connection?.cancel()
        process.terminate()
    }
}
