import Foundation
import AppKit
import CoreGraphics
import ScreenCaptureKit

struct ComputerScreenshot: Sendable {
    let pngData: Data
    let imageSize: ComputerImageSize
    let displayID: CGDirectDisplayID
    let app: ComputerApplicationIdentity

    var base64: String { pngData.base64EncodedString() }
}

enum ComputerScreenCaptureError: LocalizedError {
    case permissionMissing
    case displayUnavailable
    case encodingFailed
    case frontmostApplicationUnavailable

    var errorDescription: String? {
        switch self {
        case .permissionMissing:
            return "Screen Recording permission is required"
        case .displayUnavailable:
            return "the selected display is unavailable"
        case .encodingFailed:
            return "failed to encode the screenshot as PNG"
        case .frontmostApplicationUnavailable:
            return "frontmost application identity is unavailable"
        }
    }
}

enum ComputerScreenCapture {
    /// Captures one selected display into a downscaled in-memory PNG.
    /// No screenshot bytes or intermediate bitmap are written to disk.
    static func capture(
        descriptor: ComputerCaptureDescriptor,
        app expectedApp: ComputerApplicationIdentity? = nil
    ) async throws -> ComputerScreenshot {
        guard CGPreflightScreenCaptureAccess() else {
            throw ComputerScreenCaptureError.permissionMissing
        }
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let display = content.displays.first(where: {
            $0.displayID == descriptor.displayID
        }) else {
            throw ComputerScreenCaptureError.displayUnavailable
        }

        let ownBundleID = Bundle.main.bundleIdentifier?.lowercased()
        let excludedApps = content.applications.filter {
            $0.bundleIdentifier.lowercased() == ownBundleID
        }
        let filter = SCContentFilter(
            display: display,
            excludingApplications: excludedApps,
            exceptingWindows: []
        )
        let configuration = SCStreamConfiguration()
        configuration.width = descriptor.outputSize.width
        configuration.height = descriptor.outputSize.height
        configuration.showsCursor = true
        configuration.scalesToFit = true

        let cgImage = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
        guard cgImage.width == descriptor.outputSize.width,
              cgImage.height == descriptor.outputSize.height else {
            throw ComputerCaptureDescriptorError.capturedSizeMismatch
        }
        let representation = NSBitmapImageRep(cgImage: cgImage)
        guard let png = representation.representation(using: .png, properties: [:]) else {
            throw ComputerScreenCaptureError.encodingFailed
        }
        let resolvedApp: ComputerApplicationIdentity?
        if let expectedApp {
            resolvedApp = expectedApp
        } else {
            resolvedApp = await MainActor.run {
                ComputerFrontmostApplication.current()
            }
        }
        guard let app = resolvedApp else {
            throw ComputerScreenCaptureError.frontmostApplicationUnavailable
        }
        return ComputerScreenshot(
            pngData: png,
            imageSize: ComputerImageSize(width: cgImage.width, height: cgImage.height),
            displayID: descriptor.displayID,
            app: app
        )
    }
}
