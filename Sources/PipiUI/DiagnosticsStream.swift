import Foundation

/// Lightweight, reversible stream-path diagnostics.
///
/// Appends monotonic-timestamped lines to a temp file so a real run can tell
/// whether "spin then dump" is missing upstream deltas vs. App-side gating.
/// Does not participate in streaming / flush / visibility logic.
///
/// Hot path: lines are queued and written through a long-lived handle with
/// coalesced flushes — never open/seek/write/close per event.
enum DiagnosticsStream {
    static let logURL: URL = FileManager.default.temporaryDirectory
        .appendingPathComponent("pipiui-stream-diag.log")

    private static let queue = DispatchQueue(label: "pipiui.stream-diag", qos: .utility)
    private static var handle: FileHandle?
    private static var pending = Data()
    private static var flushScheduled = false
    private static let flushInterval: TimeInterval = 0.05
    private static let flushByteThreshold = 16_384

    /// Clear / recreate the log file (call on each process start).
    static func reset() {
        queue.sync {
            flushScheduled = false
            pending.removeAll(keepingCapacity: false)
            if let handle {
                try? handle.close()
                self.handle = nil
            }
            let fm = FileManager.default
            try? fm.removeItem(at: logURL)
            fm.createFile(atPath: logURL.path, contents: nil, attributes: nil)
            openHandleLocked()
            appendLineLocked("RESET path=\(logURL.path)")
            flushLocked()
        }
    }

    /// Append one diagnostic line with a monotonic uptime timestamp.
    static func append(_ line: String) {
        queue.async {
            appendLineLocked(line)
            if pending.count >= flushByteThreshold {
                flushLocked()
            } else {
                scheduleFlushLocked()
            }
        }
    }

    /// Force any buffered diagnostics to disk (tests / shutdown).
    static func flush() {
        queue.sync {
            flushLocked()
        }
    }

    private static func appendLineLocked(_ line: String) {
        let stamp = String(format: "%.3f", ProcessInfo.processInfo.systemUptime)
        let full = "\(stamp) \(line)\n"
        guard let data = full.data(using: .utf8) else { return }
        pending.append(data)
    }

    private static func scheduleFlushLocked() {
        guard !flushScheduled else { return }
        flushScheduled = true
        queue.asyncAfter(deadline: .now() + flushInterval) {
            flushScheduled = false
            flushLocked()
        }
    }

    private static func flushLocked() {
        guard !pending.isEmpty else { return }
        if handle == nil {
            openHandleLocked()
        }
        guard let handle else {
            // Last resort: atomic create with full buffer.
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: pending, attributes: nil)
            }
            pending.removeAll(keepingCapacity: true)
            return
        }
        do {
            try handle.write(contentsOf: pending)
        } catch {
            // Handle may be stale after external truncate; reopen once.
            try? handle.close()
            self.handle = nil
            openHandleLocked()
            try? self.handle?.write(contentsOf: pending)
        }
        pending.removeAll(keepingCapacity: true)
    }

    private static func openHandleLocked() {
        let fm = FileManager.default
        if !fm.fileExists(atPath: logURL.path) {
            fm.createFile(atPath: logURL.path, contents: nil, attributes: nil)
        }
        guard let h = try? FileHandle(forWritingTo: logURL) else { return }
        _ = try? h.seekToEnd()
        handle = h
    }
}
