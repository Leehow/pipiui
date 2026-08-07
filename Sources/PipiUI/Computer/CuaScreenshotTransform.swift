import Foundation
import AppKit

struct CuaScreenshotTransform: Equatable, Sendable {
    let sourceSize: ComputerImageSize
    let advertisedSize: ComputerImageSize
    let scale: Double
    let offsetX: Double
    let offsetY: Double

    init(
        sourceSize: ComputerImageSize,
        advertisedSize: ComputerImageSize
    ) throws {
        guard sourceSize.isValid, advertisedSize.isValid else {
            throw CuaIntegrationError.invalidScreenshotDimensions
        }
        self.sourceSize = sourceSize
        self.advertisedSize = advertisedSize
        scale = min(
            Double(advertisedSize.width) / Double(sourceSize.width),
            Double(advertisedSize.height) / Double(sourceSize.height)
        )
        offsetX = (
            Double(advertisedSize.width) - Double(sourceSize.width) * scale
        ) / 2
        offsetY = (
            Double(advertisedSize.height) - Double(sourceSize.height) * scale
        ) / 2
    }

    func sourceToAdvertised(
        _ point: ComputerImagePoint
    ) -> ComputerImagePoint {
        ComputerImagePoint(
            x: point.x * scale + offsetX,
            y: point.y * scale + offsetY
        )
    }

    func advertisedToSource(
        _ point: ComputerImagePoint
    ) throws -> ComputerImagePoint {
        let xMax = offsetX + Double(sourceSize.width) * scale
        let yMax = offsetY + Double(sourceSize.height) * scale
        guard point.x >= offsetX,
              point.y >= offsetY,
              point.x < xMax,
              point.y < yMax else {
            // Symmetric letterbox: xMax == advertisedWidth - offsetX (same for y).
            let validRange =
                "x in [\(offsetX), \(xMax)), y in [\(offsetY), \(yMax))"
            throw CuaIntegrationError.coordinateOutsideScreenshot(
                validRange: validRange
            )
        }
        return ComputerImagePoint(
            x: min(
                Double(sourceSize.width),
                max(0, (point.x - offsetX) / scale)
            ),
            y: min(
                Double(sourceSize.height),
                max(0, (point.y - offsetY) / scale)
            )
        )
    }

    var dictionary: [String: Any] {
        [
            "sourceWidth": sourceSize.width,
            "sourceHeight": sourceSize.height,
            "advertisedWidth": advertisedSize.width,
            "advertisedHeight": advertisedSize.height,
            "scale": scale,
            "offsetX": offsetX,
            "offsetY": offsetY,
        ]
    }

    @MainActor
    func renderAdvertisedPNG(base64: String) throws -> String {
        guard let data = Data(base64Encoded: base64),
              let source = NSImage(data: data) else {
            throw CuaIntegrationError.invalidScreenshotData
        }
        if sourceSize == advertisedSize {
            return base64
        }

        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: advertisedSize.width,
            pixelsHigh: advertisedSize.height,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            throw CuaIntegrationError.invalidScreenshotData
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor.black.setFill()
        NSRect(
            x: 0,
            y: 0,
            width: advertisedSize.width,
            height: advertisedSize.height
        ).fill()
        // NSImage uses a bottom-left drawing origin. The centered letterbox
        // offsets are symmetric, so the model/Cua top-left transform remains
        // identical for both axes.
        source.draw(
            in: NSRect(
                x: offsetX,
                y: offsetY,
                width: Double(sourceSize.width) * scale,
                height: Double(sourceSize.height) * scale
            ),
            from: .zero,
            operation: .copy,
            fraction: 1
        )
        NSGraphicsContext.restoreGraphicsState()
        guard let png = bitmap.representation(
            using: .png,
            properties: [:]
        ) else {
            throw CuaIntegrationError.invalidScreenshotData
        }
        return png.base64EncodedString()
    }
}

enum CuaIntegrationError: LocalizedError, Equatable {
    case invalidScreenshotDimensions
    case invalidScreenshotData
    case coordinateOutsideScreenshot(validRange: String)
    case targetMissing
    case targetLost
    case invalidLaunchResult
    case bundleMismatch(expected: String, actual: String)
    case invalidAction(String)

    var errorDescription: String? {
        switch self {
        case .invalidScreenshotDimensions:
            return "Cua Driver returned invalid screenshot dimensions."
        case .invalidScreenshotData:
            return "Cua Driver returned invalid in-memory screenshot data."
        case .coordinateOutsideScreenshot(let validRange):
            return "Action coordinate falls inside the letterbox margin, outside the target screenshot. "
                + "valid coordinate range: \(validRange). "
                + "Re-capture a fresh screenshot and recompute coordinates before retrying; "
                + "do not reuse this coordinate."
        case .targetMissing:
            return "No desktop target is selected for this session; call open_application first."
        case .targetLost:
            return "The selected desktop target exited or no longer owns a usable window; call open_application again."
        case .invalidLaunchResult:
            return "Cua Driver launch_app returned no valid pid/window target."
        case .bundleMismatch(let expected, let actual):
            return "Cua Driver opened bundle \(actual), expected exact bundle \(expected)."
        case .invalidAction(let message):
            return "Invalid Cua desktop action: \(message)"
        }
    }
}
