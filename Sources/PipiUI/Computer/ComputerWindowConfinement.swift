import Foundation
import CoreGraphics

struct ComputerWindowHitRecord: Equatable, Sendable {
    let ownerPID: Int32
    let bounds: CGRect
    let alpha: Double
    let isOnScreen: Bool
}

enum ComputerWindowConfinementError: LocalizedError, Equatable {
    case noVisibleWindow
    case differentApplication(expectedPID: Int32, actualPID: Int32)

    var errorDescription: String? {
        switch self {
        case .noVisibleWindow:
            return "pointer action rejected: no visible application window owns that point"
        case .differentApplication:
            return "pointer action rejected: the topmost window belongs to another application or system UI"
        }
    }
}

enum ComputerWindowConfinement {
    /// CGWindowList rows are documented in front-to-back order. The first visible
    /// row containing the point owns it, including Dock/menu/system overlays.
    static func topmostOwner(
        at point: CGPoint,
        rows: [ComputerWindowHitRecord]
    ) -> Int32? {
        rows.first {
            $0.isOnScreen && $0.alpha > 0 && !$0.bounds.isEmpty
                && $0.bounds.contains(point)
        }?.ownerPID
    }

    static func authorize(
        point: CGPoint,
        targetPID: Int32,
        rows: [ComputerWindowHitRecord]
    ) throws {
        guard let owner = topmostOwner(at: point, rows: rows) else {
            throw ComputerWindowConfinementError.noVisibleWindow
        }
        guard owner == targetPID else {
            throw ComputerWindowConfinementError.differentApplication(
                expectedPID: targetPID,
                actualPID: owner
            )
        }
    }

    static func authorizeLive(point: CGPoint, targetPID: Int32) throws {
        guard let values = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else {
            throw ComputerWindowConfinementError.noVisibleWindow
        }
        let rows = values.compactMap { value -> ComputerWindowHitRecord? in
            guard let owner = (value[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
                  let dictionary = value[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(
                    dictionaryRepresentation: dictionary as CFDictionary
                  ) else {
                return nil
            }
            let alpha = (value[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1
            let onScreen = (value[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? true
            return ComputerWindowHitRecord(
                ownerPID: owner,
                bounds: bounds,
                alpha: alpha,
                isOnScreen: onScreen
            )
        }
        try authorize(point: point, targetPID: targetPID, rows: rows)
    }
}
