import Foundation
import CoreGraphics

struct ComputerDisplayGeometry: Equatable, Sendable {
    let displayID: CGDirectDisplayID
    let globalBounds: CGRect
    let pixelWidth: Int
    let pixelHeight: Int
}

struct ComputerCaptureDescriptor: Equatable, Sendable {
    let displayID: CGDirectDisplayID
    let outputSize: ComputerImageSize
    let globalBounds: CGRect

    static func resolve(
        selectedDisplayID: CGDirectDisplayID,
        geometries: [ComputerDisplayGeometry],
        maxLongEdge: Int
    ) throws -> ComputerCaptureDescriptor {
        guard let geometry = geometries.first(where: {
            $0.displayID == selectedDisplayID
        }) else {
            throw ComputerCaptureDescriptorError.selectedDisplayUnavailable
        }
        guard geometry.pixelWidth > 0,
              geometry.pixelHeight > 0,
              geometry.globalBounds.width > 0,
              geometry.globalBounds.height > 0 else {
            throw ComputerCaptureDescriptorError.invalidDisplayGeometry
        }
        return ComputerCaptureDescriptor(
            displayID: geometry.displayID,
            outputSize: ComputerUseSettings.downscaledSize(
                pixelWidth: geometry.pixelWidth,
                pixelHeight: geometry.pixelHeight,
                maxLongEdge: maxLongEdge
            ),
            globalBounds: geometry.globalBounds
        )
    }

    func validateAdvertisement(
        displayID advertisedDisplayID: Int?,
        width: Int?,
        height: Int?
    ) throws {
        guard advertisedDisplayID == Int(displayID),
              width == outputSize.width,
              height == outputSize.height else {
            throw ComputerCaptureDescriptorError.providerDescriptorMismatch
        }
    }
}
enum ComputerCaptureDescriptorError: LocalizedError, Equatable {
    case selectedDisplayUnavailable
    case invalidDisplayGeometry
    case providerDescriptorMismatch
    case capturedSizeMismatch

    var errorDescription: String? {
        switch self {
        case .selectedDisplayUnavailable:
            return "the selected display is unavailable; choose an active display and restart the session"
        case .invalidDisplayGeometry:
            return "the selected display reported invalid point or pixel geometry"
        case .providerDescriptorMismatch:
            return "the session's advertised display no longer matches the selected display; restart the session"
        case .capturedSizeMismatch:
            return "ScreenCaptureKit returned dimensions that differ from the advertised computer tool"
        }
    }
}
