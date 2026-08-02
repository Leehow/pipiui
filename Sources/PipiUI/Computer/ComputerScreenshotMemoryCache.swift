import Foundation

/// Process-local FIFO cache of computer/open_application PNG screenshots.
///
/// Bridge success paths retain bytes here and advertise a stable `screenshotId`.
/// The Node extension reuses that id in the marker-only toolResult; ChatSession
/// resolves the same id into `ToolRun.images` for transcript thumbnails.
///
/// Never write these bytes to session JSONL, toolResult text, or logs.
enum ComputerScreenshotMemoryCache {
    static let maxCount = 12

    struct Entry: Equatable, Sendable {
        let data: Data
        let mimeType: String
    }

    private static let lock = NSLock()
    private static var order: [String] = []
    private static var store: [String: Entry] = [:]

    /// Retain PNG bytes under a stable id (lowercase UUID by default).
    @discardableResult
    static func retain(
        pngData: Data,
        mimeType: String = "image/png",
        id: String? = nil
    ) -> String {
        let screenshotId: String = {
            if let id, !id.isEmpty { return id }
            return UUID().uuidString.lowercased()
        }()
        let entry = Entry(data: pngData, mimeType: mimeType)
        lock.lock()
        defer { lock.unlock() }
        if store[screenshotId] == nil {
            order.append(screenshotId)
        }
        store[screenshotId] = entry
        while order.count > maxCount {
            let oldest = order.removeFirst()
            store.removeValue(forKey: oldest)
        }
        return screenshotId
    }

    static func entry(for id: String) -> Entry? {
        lock.lock()
        defer { lock.unlock() }
        return store[id]
    }

    static func removeAll() {
        lock.lock()
        defer { lock.unlock() }
        order.removeAll(keepingCapacity: false)
        store.removeAll(keepingCapacity: false)
    }

    /// Cache PNG bytes and stamp `screenshotId` / `mimeType` / `base64` on a bridge payload.
    static func attach(
        to response: inout [String: Any],
        pngData: Data,
        mimeType: String = "image/png"
    ) {
        let id = retain(pngData: pngData, mimeType: mimeType)
        response["screenshotId"] = id
        response["mimeType"] = mimeType
        response["base64"] = pngData.base64EncodedString()
    }

    /// Same as `attach(pngData:)` when the path already holds base64 PNG text (Cua).
    static func attach(
        to response: inout [String: Any],
        base64PNG: String,
        mimeType: String = "image/png"
    ) {
        let pngData = Data(base64Encoded: base64PNG) ?? Data()
        let id = retain(pngData: pngData, mimeType: mimeType)
        response["screenshotId"] = id
        response["mimeType"] = mimeType
        response["base64"] = base64PNG
    }
}

/// Opaque toolResult marker shared with the bundled Computer Use strategy.
enum ComputerScreenshotMarker {
    static let name = "PIPIUI_COMPUTER_SCREENSHOT"

    /// Matches `[PIPIUI_COMPUTER_SCREENSHOT:<uuid>]` (hex case-insensitive).
    private static let regex: NSRegularExpression = {
        let pattern = "\\[\(NSRegularExpression.escapedPattern(for: name)):([0-9a-fA-F-]+)\\]"
        return try! NSRegularExpression(pattern: pattern)
    }()

    static func ids(in text: String) -> [String] {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard match.numberOfRanges >= 2,
                  let idRange = Range(match.range(at: 1), in: text)
            else { return nil }
            return String(text[idRange])
        }
    }

    /// Strip markers for UI only — does not alter session JSONL / model context.
    static func displayText(_ text: String) -> String {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        let stripped = regex.stringByReplacingMatches(
            in: text,
            range: range,
            withTemplate: ""
        )
        return stripped
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Resolve marker ids through the process-local PNG cache (miss → omit).
    static func images(fromText text: String) -> [ImageBlock] {
        ids(in: text).compactMap { id in
            guard let entry = ComputerScreenshotMemoryCache.entry(for: id),
                  !entry.data.isEmpty
            else { return nil }
            return ImageBlock(id: id, data: entry.data, mimeType: entry.mimeType)
        }
    }
}
