import AppKit
import Foundation
import SwiftTerm

/// Session-owned embedded terminal. Holds one `LocalProcessTerminalView` for the
/// life of the chat session so collapse/expand of the right panel reattaches the
/// same shell (process + scrollback) instead of spawning a fresh one.
///
/// The view must outlive its SwiftUI host: when the right panel hides, the
/// representable leaves the hierarchy, but this store keeps the NSView + PTY.
final class TerminalSessionStore: ObservableObject {
    let projectURL: URL
    /// OSC title from the shell, when available.
    @Published private(set) var title: String = "终端"
    /// Last known cwd reported via OSC 7 (falls back to project path).
    @Published private(set) var workingDirectory: String?

    private var terminalView: PipiLocalTerminalView?
    private var didStartProcess = false
    private let processBridge = ProcessBridge()

    init(projectURL: URL) {
        self.projectURL = projectURL
        self.workingDirectory = projectURL.path
        processBridge.owner = self
    }

    deinit {
        // ChatSession may tear down off-main; terminate hop is safe either way.
        let view = terminalView
        if Thread.isMainThread {
            view?.terminate()
        } else {
            DispatchQueue.main.async {
                view?.terminate()
            }
        }
    }

    /// Lazily create (and start) the terminal view. Safe to call repeatedly —
    /// returns the same instance so the panel can re-embed it.
    @MainActor
    func ensureTerminalView() -> PipiLocalTerminalView {
        if let terminalView { return terminalView }

        // Non-zero initial frame avoids SwiftTerm treating first layout as empty.
        let view = PipiLocalTerminalView(frame: CGRect(x: 0, y: 0, width: 640, height: 480))
        view.font = NSFont.monospacedSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
        view.configureNativeColors()
        view.changeScrollback(10_000)
        view.optionAsMetaKey = true
        view.processDelegate = processBridge
        terminalView = view

        if !didStartProcess {
            didStartProcess = true
            let shell = Self.preferredShell()
            let cwd = FileManager.default.fileExists(atPath: projectURL.path)
                ? projectURL.path
                : nil
            view.startProcess(
                executable: shell,
                args: ["-l"],
                currentDirectory: cwd
            )
        }
        return view
    }

    /// Re-apply system appearance colors (dark/light flip while panel is open).
    @MainActor
    func applyAppearance() {
        guard let terminalView else { return }
        terminalView.configureNativeColors()
        // Nudge a redraw so palette changes paint immediately.
        terminalView.feed(text: "")
    }

    fileprivate func handleTitle(_ title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.title = trimmed
    }

    fileprivate func handleDirectory(_ directory: String?) {
        if let directory, !directory.isEmpty {
            workingDirectory = directory
        }
    }

    fileprivate func handleProcessTerminated(exitCode: Int32?) {
        let code = exitCode.map(String.init) ?? "?"
        // Keep the view; user can still scroll history. Soft notice only.
        title = "终端（已退出 \(code)）"
    }

    private static func preferredShell() -> String {
        if let shell = ProcessInfo.processInfo.environment["SHELL"], !shell.isEmpty,
           FileManager.default.isExecutableFile(atPath: shell) {
            return shell
        }
        for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return "/bin/zsh"
    }
}

// MARK: - Zero-size frame guard

/// `LocalProcessTerminalView` subclass that ignores zero-size frames.
/// SwiftTerm can clear/resize the buffer when given a 0×0 frame (panel hide /
/// SwiftUI reparent); keep the last real size so scrollback survives.
final class PipiLocalTerminalView: LocalProcessTerminalView {
    override func setFrameSize(_ newSize: NSSize) {
        guard newSize.width > 0, newSize.height > 0 else { return }
        super.setFrameSize(newSize)
    }

    override var frame: CGRect {
        get { super.frame }
        set {
            guard newValue.size.width > 0, newValue.size.height > 0 else { return }
            super.frame = newValue
        }
    }
}

// MARK: - Process delegate bridge

/// Separate bridge so the store stays a plain ObservableObject and the weak
/// `processDelegate` does not create a retain cycle with the view.
private final class ProcessBridge: LocalProcessTerminalViewDelegate {
    weak var owner: TerminalSessionStore?

    func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}

    func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
        DispatchQueue.main.async { [weak owner] in
            owner?.handleTitle(title)
        }
    }

    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {
        DispatchQueue.main.async { [weak owner] in
            owner?.handleDirectory(directory)
        }
    }

    func processTerminated(source: TerminalView, exitCode: Int32?) {
        DispatchQueue.main.async { [weak owner] in
            owner?.handleProcessTerminated(exitCode: exitCode)
        }
    }
}
