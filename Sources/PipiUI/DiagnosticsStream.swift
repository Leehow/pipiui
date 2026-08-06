import Foundation

/// Lightweight, reversible stream-path diagnostics.
///
/// Appends monotonic-timestamped lines to a temp file so a real run can tell
/// whether "spin then dump" is missing upstream deltas vs. App-side gating.
/// Does not participate in streaming / flush / visibility logic.
enum DiagnosticsStream {
    static let logURL: URL = FileManager.default.temporaryDirectory
        .appendingPathComponent("pipiui-stream-diag.log")

    private static let queue = DispatchQueue(label: "pipiui.stream-diag", qos: .utility)

    /// Clear / recreate the log file (call on each process start).
    static func reset() {
        queue.sync {
            let fm = FileManager.default
            try? fm.removeItem(at: logURL)
            fm.createFile(atPath: logURL.path, contents: nil, attributes: nil)
            writeLineLocked("RESET path=\(logURL.path)")
        }
    }

    /// Append one diagnostic line with a monotonic uptime timestamp.
    static func append(_ line: String) {
        queue.async {
            writeLineLocked(line)
        }
    }

    private static func writeLineLocked(_ line: String) {
        let stamp = String(format: "%.3f", ProcessInfo.processInfo.systemUptime)
        let full = "\(stamp) \(line)\n"
        guard let data = full.data(using: .utf8) else { return }
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: data, attributes: nil)
            return
        }
        guard let handle = try? FileHandle(forWritingTo: logURL) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    }
}