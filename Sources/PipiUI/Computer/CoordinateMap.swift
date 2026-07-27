import Foundation
import CoreGraphics

enum ComputerCoordinatePolicy {
    case reject
    case clamp
}

enum ComputerCoordinateError: LocalizedError, Equatable {
    case invalidImageSize
    case invalidDisplayBounds
    case outOfBounds

    var errorDescription: String? {
        switch self {
        case .invalidImageSize: return "invalid screenshot dimensions"
        case .invalidDisplayBounds: return "invalid display bounds"
        case .outOfBounds: return "computer coordinate is outside the screenshot"
        }
    }
}

enum ComputerCoordinateMap {
    /// Maps model screenshot pixels into Quartz global desktop points.
    ///
    /// `CGDisplayBounds` and `CGEvent` share the same global coordinate space.
    static func globalPoint(
        imagePoint: ComputerImagePoint,
        imageSize: ComputerImageSize,
        displayBounds: CGRect,
        policy: ComputerCoordinatePolicy = .reject
    ) throws -> CGPoint {
        guard imageSize.isValid else { throw ComputerCoordinateError.invalidImageSize }
        guard displayBounds.width > 0, displayBounds.height > 0 else {
            throw ComputerCoordinateError.invalidDisplayBounds
        }

        let maxX = Double(imageSize.width - 1)
        let maxY = Double(imageSize.height - 1)
        let point: ComputerImagePoint
        switch policy {
        case .reject:
            guard imagePoint.x.isFinite, imagePoint.y.isFinite,
                  imagePoint.x >= 0, imagePoint.y >= 0,
                  imagePoint.x <= maxX, imagePoint.y <= maxY else {
                throw ComputerCoordinateError.outOfBounds
            }
            point = imagePoint
        case .clamp:
            guard imagePoint.x.isFinite, imagePoint.y.isFinite else {
                throw ComputerCoordinateError.outOfBounds
            }
            point = ComputerImagePoint(
                x: min(max(0, imagePoint.x), maxX),
                y: min(max(0, imagePoint.y), maxY)
            )
        }

        return CGPoint(
            x: displayBounds.origin.x
                + CGFloat(point.x / Double(imageSize.width)) * displayBounds.width,
            y: displayBounds.origin.y
                + CGFloat(point.y / Double(imageSize.height)) * displayBounds.height
        )
    }
}
