import Foundation
import Darwin

/// Manages one `pi --mode rpc` subprocess: JSONL framing, request/response
/// correlation and event delivery (all callbacks on the main thread).
final class PiProcess {
    private let process = Process()
    private let stdinPipe = Pipe()
    private let stdoutPipe = Pipe()
    private let stderrPipe = Pipe()
    private var framer = LineFramer()
    private var pending: [String: (J) -> Void] = [:] // main thread only
    private let stdinQueue = DispatchQueue(label: "pipiui.pi.stdin")
    private(set) var isRunning = false

    var onEvent: ((J) -> Void)?
    var onExit: ((Int32, String) -> Void)?
    private var stderrTail = ""

    static func findPiExecutable() -> String? {
        let fm = FileManager.default
        var candidates = [
            NSHomeDirectory() + "/.npm-global/bin/pi",
            "/opt/homebrew/bin/pi",
            "/usr/local/bin/pi",
        ]
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates += path.split(separator: ":").map { String($0) + "/pi" }
        }
        return candidates.first { fm.isExecutableFile(atPath: $0) }
    }

    init?(cwd: URL, arguments: [String], extraEnv: [String: String] = [:]) {
        guard let pi = Self.findPiExecutable() else { return nil }

        var env = ProcessInfo.processInfo.environment
        env.merge(extraEnv) { _, new in new }
        let extraDirs = [
            (pi as NSString).deletingLastPathComponent,
            "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
        ]
        let existing = env["PATH"] ?? ""
        env["PATH"] = (extraDirs + [existing]).joined(separator: ":")

        process.executableURL = URL(fileURLWithPath: pi)
        process.arguments = ["--mode", "rpc"] + arguments
        process.currentDirectoryURL = cwd
        process.environment = env
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.consume(data)
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let text = String(data: handle.availableData, encoding: .utf8), !text.isEmpty else { return }
            DispatchQueue.main.async {
                self?.stderrTail = String((self!.stderrTail + text).suffix(4000))
            }
        }
        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self else { return }
                self.isRunning = false
                self.stdoutPipe.fileHandleForReading.readabilityHandler = nil
                self.stderrPipe.fileHandleForReading.readabilityHandler = nil
                self.failAllPending(error: "process exited")
                self.onExit?(proc.terminationStatus, self.stderrTail)
            }
        }

        do {
            try process.run()
            isRunning = true
        } catch {
            return nil
        }
    }

    /// Split accumulated stdout on LF only (protocol requirement), strip trailing CR.
    /// Framing is O(n) via `LineFramer`; a single 11.5 MB response line must not be
    /// rescanned per chunk (that cost 20–30 s to open a long session).
    private func consume(_ data: Data) {
        for line in framer.push(data) {
            guard !line.isEmpty, let json = J.parse(line) else { continue }
            DispatchQueue.main.async { [weak self] in
                self?.dispatch(json)
            }
        }
    }

    private func dispatch(_ json: J) {
        if json["type"].string == "response", let id = json["id"].string,
           let completion = pending.removeValue(forKey: id) {
            completion(json)
            return
        }
        onEvent?(json)
    }

    /// Fail one pending request (main thread). No-op if already settled.
    private func failPending(id: String, error: String) {
        guard let completion = pending.removeValue(forKey: id) else { return }
        completion(J([
            "type": "response",
            "id": id,
            "success": false,
            "error": error,
        ]))
    }

    /// Fail every outstanding request (main thread). Safe to call more than once.
    private func failAllPending(error: String) {
        let all = pending
        pending.removeAll()
        for (id, completion) in all {
            completion(J([
                "type": "response",
                "id": id,
                "success": false,
                "error": error,
            ]))
        }
    }

    /// Best-effort SIGTERM to descendant processes (subagent `pi` children).
    private static func signalChildren(of pid: Int32, signal sig: Int32) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        p.arguments = ["-P", "\(pid)"]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = Pipe()
        do {
            try p.run()
            p.waitUntilExit()
        } catch {
            return
        }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        guard let text = String(data: data, encoding: .utf8) else { return }
        for line in text.split(whereSeparator: \.isNewline) {
            guard let child = Int32(line) else { continue }
            signalChildren(of: child, signal: sig)
            kill(child, sig)
        }
    }

    /// Send a raw command without waiting for the response.
    /// Large payloads are written on a dedicated serial queue so the main thread never blocks on a full pipe.
    /// `failure` runs on the main thread if the process is dead or the write fails.
    func send(_ object: [String: Any], failure: (() -> Void)? = nil) {
        guard isRunning else {
            failure?()
            return
        }
        guard JSONSerialization.isValidJSONObject(object),
              var data = try? JSONSerialization.data(withJSONObject: object) else {
            failure?()
            return
        }
        data.append(0x0A)
        stdinQueue.async { [weak self] in
            guard let self else {
                DispatchQueue.main.async { failure?() }
                return
            }
            do {
                try self.stdinPipe.fileHandleForWriting.write(contentsOf: data)
            } catch {
                DispatchQueue.main.async { failure?() }
            }
        }
    }

    /// Send a command with an auto-generated id; completion runs on main thread.
    /// If the process is not running, the write fails, or the process exits before a response,
    /// completion still fires once with `success: false`.
    func request(_ object: [String: Any], completion: ((J) -> Void)? = nil) {
        var object = object
        let id = UUID().uuidString
        object["id"] = id
        if let completion {
            pending[id] = completion
        }
        send(object) { [weak self] in
            self?.failPending(id: id, error: "process not running")
        }
    }

    /// SIGTERM this pi process and any descendant subagent processes.
    /// Pending request completions are settled immediately (idempotent with `terminationHandler`)
    /// so callers are not left hanging if this instance is released before the handler's main.async runs.
    func terminate() {
        guard isRunning else { return }
        isRunning = false
        let pid = process.processIdentifier
        Self.signalChildren(of: pid, signal: SIGTERM)
        process.terminate()
        // Settle on the calling thread (normally main). failAllPending is idempotent.
        failAllPending(error: "process exited")
    }

    /// Last-resort kill when a graceful terminate does not exit in time.
    func forceKill() {
        let pid = process.processIdentifier
        Self.signalChildren(of: pid, signal: SIGKILL)
        if process.isRunning {
            kill(pid, SIGKILL)
        }
        isRunning = false
        failAllPending(error: "process exited")
    }

    deinit {
        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil
        if process.isRunning {
            let pid = process.processIdentifier
            Self.signalChildren(of: pid, signal: SIGTERM)
            process.terminate()
        }
        // Last resort: if still holding pending (e.g. released without terminate()),
        // fire completions now. Safe when already drained by terminate()/handler.
        // Convention is main-thread callbacks; deinit may run elsewhere — still better
        // than never calling (hang). Callers should prefer terminate() on main.
        failAllPending(error: "process exited")
    }
}
