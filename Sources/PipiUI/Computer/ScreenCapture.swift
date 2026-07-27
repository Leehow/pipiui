import Foundation
import AppKit
import CoreGraphics
import ScreenCaptureKit

final class ComputerActivationGenerationMonitor: @unchecked Sendable {
    static let shared = ComputerActivationGenerationMonitor()

    private let lock = NSLock()
    private var value: UInt64 = 0
    private var observer: NSObjectProtocol?

    var generation: UInt64 {
        lock.withLock { value }
    }

    private init() {
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.lock.withLock {
                self?.value &+= 1
            }
        }
    }

    deinit {
        if let observer {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
    }
}

struct ComputerScreenshot: Sendable {
    let pngData: Data
    let imageSize: ComputerImageSize
    let displayID: CGDirectDisplayID
    let app: ComputerApplicationIdentity
    let targetWindowIDs: [CGWindowID]

    init(
        pngData: Data,
        imageSize: ComputerImageSize,
        displayID: CGDirectDisplayID,
        app: ComputerApplicationIdentity,
        targetWindowIDs: [CGWindowID] = []
    ) {
        self.pngData = pngData
        self.imageSize = imageSize
        self.displayID = displayID
        self.app = app
        self.targetWindowIDs = targetWindowIDs
    }

    var base64: String { pngData.base64EncodedString() }
}

enum ComputerScreenCaptureError: LocalizedError {
    case permissionMissing
    case displayUnavailable
    case encodingFailed
    case frontmostApplicationUnavailable
    case targetApplicationUnavailable
    case targetWindowUnavailable
    case targetIdentityMismatch
    case targetChangedDuringCapture
    case activationChangedDuringCapture

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
        case .targetApplicationUnavailable:
            return "the exact target application is unavailable to ScreenCaptureKit"
        case .targetWindowUnavailable:
            return "the exact target application has no capturable window on the selected display"
        case .targetIdentityMismatch:
            return "ScreenCaptureKit target bundle or process identity does not match"
        case .targetChangedDuringCapture:
            return "the exact target window set changed during capture"
        case .activationChangedDuringCapture:
            return "application activation changed during target capture"
        }
    }
}

enum ComputerScreenCapture {
    /// Captures one selected display into a downscaled in-memory PNG.
    /// No screenshot bytes or intermediate bitmap are written to disk.
    static func capture(
        descriptor: ComputerCaptureDescriptor,
        app expectedApp: ComputerApplicationIdentity
    ) async throws -> ComputerScreenshot {
        guard CGPreflightScreenCaptureAccess() else {
            throw ComputerScreenCaptureError.permissionMissing
        }
        let activationGeneration =
            ComputerActivationGenerationMonitor.shared.generation
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let display = content.displays.first(where: {
            $0.displayID == descriptor.displayID
        }) else {
            throw ComputerScreenCaptureError.displayUnavailable
        }
        let selectedWindows = try targetWindows(
            in: content,
            descriptor: descriptor,
            expectedApp: expectedApp
        )
        let targetWindowIDs = selectedWindows.map(\.windowID).sorted()
        let filter = SCContentFilter(
            display: display,
            including: selectedWindows
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
        let postContent = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        let postWindowIDs = try targetWindows(
            in: postContent,
            descriptor: descriptor,
            expectedApp: expectedApp
        ).map(\.windowID).sorted()
        guard postWindowIDs == targetWindowIDs else {
            throw ComputerScreenCaptureError.targetChangedDuringCapture
        }
        guard ComputerActivationGenerationMonitor.shared.generation
                == activationGeneration else {
            throw ComputerScreenCaptureError.activationChangedDuringCapture
        }
        let representation = NSBitmapImageRep(cgImage: cgImage)
        guard let png = representation.representation(using: .png, properties: [:]) else {
            throw ComputerScreenCaptureError.encodingFailed
        }
        return ComputerScreenshot(
            pngData: png,
            imageSize: ComputerImageSize(width: cgImage.width, height: cgImage.height),
            displayID: descriptor.displayID,
            app: expectedApp,
            targetWindowIDs: targetWindowIDs
        )
    }

    private static func targetWindows(
        in content: SCShareableContent,
        descriptor: ComputerCaptureDescriptor,
        expectedApp: ComputerApplicationIdentity
    ) throws -> [SCWindow] {
        let matchingApplications = content.applications.filter {
            $0.processID == expectedApp.processID
                && $0.bundleIdentifier.lowercased()
                    == expectedApp.normalizedBundleID
        }
        guard matchingApplications.count == 1 else {
            throw matchingApplications.isEmpty
                ? ComputerScreenCaptureError.targetApplicationUnavailable
                : ComputerScreenCaptureError.targetIdentityMismatch
        }
        let windows = content.windows.filter { window in
            guard window.isOnScreen,
                  window.windowLayer == 0,
                  window.frame.width > 0,
                  window.frame.height > 0,
                  window.frame.intersects(descriptor.globalBounds),
                  let owner = window.owningApplication else {
                return false
            }
            return owner.processID == expectedApp.processID
                && owner.bundleIdentifier.lowercased()
                    == expectedApp.normalizedBundleID
        }
        guard !windows.isEmpty else {
            throw ComputerScreenCaptureError.targetWindowUnavailable
        }
        return windows.sorted { $0.windowID < $1.windowID }
    }
}
