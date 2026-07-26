import Foundation

struct ComputerAuditRecord {
    let timestamp: Date
    let auditSessionID: String
    let app: ComputerApplicationIdentity
    let actions: [ComputerAction]
    let outcomes: [ComputerActionOutcome]
    let focusDrift: Bool

    func encodedData() throws -> Data {
        let formatter = ISO8601DateFormatter()
        let object: [String: Any] = [
            "timestamp": formatter.string(from: timestamp),
            "session": auditSessionID,
            "bundleID": app.normalizedBundleID,
            "appName": app.name,
            "actions": actions.map(\.auditMetadata),
            "outcomes": outcomes.map(\.dictionary),
            "focusDrift": focusDrift,
        ]
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}

final class ComputerAuditLog: @unchecked Sendable {
    static let shared = ComputerAuditLog()

    private let queue = DispatchQueue(label: "pipiui.computer.audit", qos: .utility)
    private let fileURL: URL

    init(fileManager: FileManager = .default) {
        let directory = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("PipiUI", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("computer-audit.jsonl")
    }

    func append(_ record: ComputerAuditRecord) {
        queue.async { [fileURL] in
            guard var data = try? record.encodedData() else { return }
            data.append(0x0A)
            if !FileManager.default.fileExists(atPath: fileURL.path) {
                try? data.write(to: fileURL, options: .atomic)
                return
            }
            guard let handle = try? FileHandle(forWritingTo: fileURL) else { return }
            defer { try? handle.close() }
            do {
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } catch {
                // Auditing must never crash the app or leak request contents to diagnostics.
            }
        }
    }
}
