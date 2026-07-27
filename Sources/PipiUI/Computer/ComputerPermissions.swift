import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

struct ComputerPermissionSnapshot: Equatable {
    let screenRecording: Bool
    let accessibility: Bool

    var isReady: Bool { screenRecording && accessibility }
}

enum ComputerPermissions {
    static func snapshot() -> ComputerPermissionSnapshot {
        ComputerPermissionSnapshot(
            screenRecording: CGPreflightScreenCaptureAccess(),
            accessibility: AXIsProcessTrusted()
        )
    }

    @discardableResult
    static func requestScreenRecording() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    @discardableResult
    static func requestAccessibility() -> Bool {
        let options = [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true,
        ] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    static func openScreenRecordingSettings() {
        openSystemSettings(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        )
    }

    static func openAccessibilitySettings() {
        openSystemSettings(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        )
    }

    private static func openSystemSettings(_ value: String) {
        guard let url = URL(string: value) else { return }
        NSWorkspace.shared.open(url)
    }
}
