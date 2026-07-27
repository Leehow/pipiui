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

enum ComputerApplicationOpenAuditOutcome: String, Sendable {
    case authorizationRequired = "authorization_required"
    case busy
    case rejected
    case launched
    case failed
    case cancellationRequested = "cancellation_requested"
    case cancellationSettled = "cancellation_settled"
    case cancellationCallbackFailed = "cancellation_callback_failed"
    // Retained for decoding/inspection of audit files written before the
    // request/settlement split.
    case cancelled
}

struct ComputerApplicationOpenAuditRecord: Sendable {
    let timestamp: Date
    let auditSessionID: String
    let target: ComputerResolvedApplication?
    let processID: Int32?
    let outcome: ComputerApplicationOpenAuditOutcome
    let focusDrift: Bool
    let cancelled: Bool

    func encodedData() throws -> Data {
        let formatter = ISO8601DateFormatter()
        var object: [String: Any] = [
            "timestamp": formatter.string(from: timestamp),
            "session": auditSessionID,
            "operation": "open_application",
            "outcome": outcome.rawValue,
            "focusDrift": focusDrift,
            "cancelled": cancelled,
        ]
        if let target {
            object["bundleID"] = target.codeIdentity.normalizedBundleID
            object["codeIdentity"] = target.codeIdentity.auditFingerprint
            object["signingIdentifier"] =
                target.codeIdentity.signingIdentifier
            if let team = target.codeIdentity.teamIdentifier {
                object["teamIdentifier"] = team
            }
        }
        if let processID, processID > 0 {
            object["processID"] = processID
        }
        return try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys]
        )
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
        guard let data = try? record.encodedData() else { return }
        append(data)
    }

    func append(_ record: ComputerApplicationOpenAuditRecord) {
        guard let data = try? record.encodedData() else { return }
        append(data)
    }

    private func append(_ encoded: Data) {
        queue.async { [fileURL] in
            var data = encoded
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
