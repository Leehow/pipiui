import Foundation
import AppKit
import CoreGraphics

enum ComputerFrontmostApplication {
    static func current() -> ComputerApplicationIdentity? {
        guard let running = NSWorkspace.shared.frontmostApplication,
              let bundleID = running.bundleIdentifier,
              !bundleID.isEmpty else {
            return nil
        }
        return ComputerApplicationIdentity(
            bundleID: bundleID,
            name: running.localizedName ?? bundleID,
            processID: running.processIdentifier,
            windowTitle: frontWindowTitle(processID: running.processIdentifier)
        )
    }

    static func isRunning(_ identity: ComputerApplicationIdentity) -> Bool {
        guard let running = NSRunningApplication(
            processIdentifier: identity.processID
        ), !running.isTerminated,
        running.bundleIdentifier?.lowercased() == identity.normalizedBundleID else {
            return false
        }
        return true
    }

    private static func frontWindowTitle(processID: pid_t) -> String? {
        guard let rows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else {
            return nil
        }
        for row in rows {
            let ownerPID = (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
            let layer = (row[kCGWindowLayer as String] as? NSNumber)?.intValue
            guard ownerPID == processID, layer == 0 else { continue }
            let title = (row[kCGWindowName as String] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let title, !title.isEmpty {
                return title
            }
        }
        return nil
    }
}
