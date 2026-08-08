import AppKit
import Foundation

/// 在项目目录打开系统终端（聊天栏右侧快捷栏的「终端」按钮）。
package enum ProjectTerminalLauncher {

    /// Test seam: swap this out so tests never launch a real Terminal window.
    nonisolated(unsafe) package static var openHandler: (URL) -> Void = { directory in
        let terminal = URL(fileURLWithPath: "/System/Applications/Utilities/Terminal.app")
        NSWorkspace.shared.open(
            [directory],
            withApplicationAt: terminal,
            configuration: NSWorkspace.OpenConfiguration()
        )
    }

    @discardableResult
    package static func open(at directory: URL) -> Bool {
        guard FileManager.default.fileExists(atPath: directory.path) else { return false }
        openHandler(directory)
        return true
    }
}
