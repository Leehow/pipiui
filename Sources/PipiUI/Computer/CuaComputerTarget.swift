import Foundation

struct CuaComputerTarget: Equatable, Sendable {
    let id: UUID
    let bundleID: String
    let name: String
    let processID: Int32
    var windowIDs: [UInt32]
    var primaryWindowID: UInt32
    var revision: UInt64
    var screenshotIdentity: String
    var elementTokens: [Int: String]
    var transform: CuaScreenshotTransform

    var applicationIdentity: ComputerApplicationIdentity {
        ComputerApplicationIdentity(
            bundleID: bundleID,
            name: name,
            processID: processID,
            windowTitle: nil
        )
    }

    var dictionary: [String: Any] {
        [
            "id": id.uuidString,
            "bundleID": bundleID,
            "name": name,
            "processID": processID,
            "windowID": primaryWindowID,
            "windowIDs": windowIDs,
            "revision": revision,
            "screenshotIdentity": screenshotIdentity,
        ]
    }

    var screenshotDictionary: [String: Any] {
        [
            "targetID": id.uuidString,
            "revision": revision,
            "windowID": primaryWindowID,
            "windowIDs": windowIDs,
            "screenshotIdentity": screenshotIdentity,
            "coordinateTransform": transform.dictionary,
        ]
    }
}

struct CuaWindowRecord: Equatable, Sendable {
    let windowID: UInt32
    let processID: Int32
    let appName: String
    let title: String
    let width: Double
    let height: Double
    let zIndex: Int
    let isOnScreen: Bool
    let onCurrentSpace: Bool

    private var visibilityRank: Int {
        switch (onCurrentSpace, isOnScreen) {
        case (true, true): 3
        case (false, true): 2
        case (true, false): 1
        case (false, false): 0
        }
    }

    private var hasPlausibleDocumentSize: Bool {
        width >= 320 && height >= 240
    }

    private var visibleArea: Double {
        guard width.isFinite, height.isFinite, width > 0, height > 0 else {
            return 0
        }
        return width * height
    }

    private var hasTitle: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    init?(_ value: [String: Any]) {
        guard let rawWindowID = value["window_id"] as? NSNumber,
              let rawPID = value["pid"] as? NSNumber,
              rawWindowID.uint64Value > 0,
              rawWindowID.uint64Value <= UInt64(UInt32.max),
              rawPID.int64Value > 0,
              rawPID.int64Value <= Int64(Int32.max) else {
            return nil
        }
        windowID = rawWindowID.uint32Value
        processID = rawPID.int32Value
        appName = value["app_name"] as? String ?? ""
        title = value["title"] as? String ?? ""
        let bounds = value["bounds"] as? [String: Any]
        width = Self.dimension(bounds?["width"])
        height = Self.dimension(bounds?["height"])
        zIndex = (value["z_index"] as? NSNumber)?.intValue ?? -1
        isOnScreen = (value["is_on_screen"] as? NSNumber)?.boolValue ?? false
        onCurrentSpace =
            (value["on_current_space"] as? NSNumber)?.boolValue ?? false
    }

    /// Deterministically ranks an initial primary window without changing the
    /// later exact-window pin. Cua reports utility/overlay windows alongside
    /// document windows, so upstream list order is not a useful primary signal.
    func isPreferredPrimary(over other: CuaWindowRecord) -> Bool {
        if visibilityRank != other.visibilityRank {
            return visibilityRank > other.visibilityRank
        }
        if hasPlausibleDocumentSize != other.hasPlausibleDocumentSize {
            return hasPlausibleDocumentSize
        }
        if hasTitle != other.hasTitle {
            return hasTitle
        }
        if visibleArea != other.visibleArea {
            return visibleArea > other.visibleArea
        }
        if zIndex != other.zIndex {
            return zIndex > other.zIndex
        }
        return windowID < other.windowID
    }

    private static func dimension(_ value: Any?) -> Double {
        guard let number = value as? NSNumber else { return 0 }
        let dimension = number.doubleValue
        return dimension.isFinite && dimension > 0 ? dimension : 0
    }
}

struct CuaWindowState: @unchecked Sendable {
    let base64: String
    let mimeType: String
    let sourceSize: ComputerImageSize
    let screenshotIdentity: String
    let elementTokens: [Int: String]
    let accessibility: [String: Any]

    init(result: CuaToolResult) throws {
        guard let image = result.image,
              let width = (result.structuredContent["screenshot_width"]
                    as? NSNumber)?.intValue,
              let height = (result.structuredContent["screenshot_height"]
                    as? NSNumber)?.intValue,
              width > 0,
              height > 0 else {
            throw CuaIntegrationError.invalidScreenshotData
        }
        base64 = image.data
        mimeType = image.mimeType
        sourceSize = ComputerImageSize(width: width, height: height)
        screenshotIdentity =
            result.structuredContent["snapshot_id"] as? String
            ?? UUID().uuidString
        var tokens: [Int: String] = [:]
        for element in result.structuredContent["elements"]
            as? [[String: Any]] ?? [] {
            guard let rawIndex = element["element_index"] as? NSNumber,
                  rawIndex.int64Value >= 0,
                  rawIndex.int64Value <= Int64(Int.max),
                  let token = element["element_token"] as? String,
                  !token.isEmpty else { continue }
            tokens[rawIndex.intValue] = token
        }
        elementTokens = tokens
        accessibility = result.structuredContent
    }
}

final class CuaInFlightOperation {
    let requestID: String
    let sessionKey: String
    let reply: ComputerResponseGate
    var task: Task<Void, Never>?

    init(
        requestID: String,
        sessionKey: String,
        reply: ComputerResponseGate
    ) {
        self.requestID = requestID
        self.sessionKey = sessionKey
        self.reply = reply
    }
}
