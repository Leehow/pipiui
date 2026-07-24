import SwiftUI
import AppKit

/// Menu access to the log files.
///
/// A log nobody can find is a log nobody reads, so the folder is one shortcut
/// away. `标记` writes a separator line on demand: press it the moment something
/// looks wrong, then read the file backwards from the mark instead of guessing
/// which of the last thousand lines matter.
public struct LogCommands: Commands {
    public init() {}

    public var body: some Commands {
        CommandGroup(replacing: .help) {
            Button("打开日志文件夹") {
                LogAccess.revealLogsFolder()
            }
            .keyboardShortcut("l", modifiers: [.command, .shift])

            Button("在日志中打一个标记") {
                LogAccess.writeUserMark()
            }
            .keyboardShortcut("m", modifiers: [.command, .option])
        }
    }
}

public enum LogAccess {
    /// Opens `~/Library/Logs/PipiUI`, selecting today's log file when it exists.
    public static func revealLogsFolder() {
        let directory = Log.logsDirectoryURL
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        if let newest = newestLogFile(in: directory) {
            NSWorkspace.shared.activateFileViewerSelecting([newest])
        } else {
            NSWorkspace.shared.open(directory)
        }
    }

    /// Flushes a visually distinct marker so the user can bracket a reproduction.
    public static func writeUserMark() {
        let stamp = ISO8601DateFormatter().string(from: Date())
        PipiLogger.shared.logSync(
            .error, // .error so it survives any minimum-level setting
            "########## USER MARK \(stamp) ##########",
            category: .app
        )
        LaunchDiagnostics.snapshot(label: "user mark")
        PipiLogger.shared.flushSync()
    }

    static func newestLogFile(in directory: URL) -> URL? {
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        ) else {
            return nil
        }
        return entries
            .filter { $0.pathExtension == FileLogSink.fileExtension }
            .max { a, b in
                let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return da < db
            }
    }
}
