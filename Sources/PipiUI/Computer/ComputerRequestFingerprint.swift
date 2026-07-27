import Foundation
import CryptoKit

extension ComputerRequest {
    /// Includes the complete request, including typed text, but returns only a digest.
    /// The source bytes are transient and never enter UI state or the audit log.
    func approvalFingerprint() throws -> String {
        let rows: [[String: Any]] = actions.map { action in
            var row: [String: Any] = [
                "type": action.kind.rawValue,
                "keys": action.keys,
            ]
            if let coordinate = action.coordinate {
                row["coordinate"] = [coordinate.x, coordinate.y]
            }
            if let start = action.startCoordinate {
                row["startCoordinate"] = [start.x, start.y]
            }
            if let text = action.text { row["text"] = text }
            if let direction = action.scrollDirection { row["scrollDirection"] = direction }
            if let amount = action.scrollAmount { row["scrollAmount"] = amount }
            if let duration = action.duration { row["duration"] = duration }
            return row
        }
        let data = try JSONSerialization.data(
            withJSONObject: rows,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
