import Foundation

/// Opens macOS Terminal running `jcode login` so the user can complete jcode's
/// interactive provider login (OAuth browser flow / API key entry). PipiUI does
/// not embed a terminal or capture the result — the user finishes in Terminal.
enum JcodeLoginLauncher {
    /// Run `jcode login` in a new Terminal window via AppleScript. Brings
    /// Terminal to front. Best-effort: if AppleScript fails, no-op (the user can
    /// still run jcode login manually).
    static func openLoginInTerminal() {
        // Prefer bare `jcode login` (installer writes ~/.local/bin to .zshenv, so
        // a fresh Terminal resolves it). Fall back to the absolute path.
        let cmd: String
        if let bin = JcodeBridge.findJcodeExecutable() {
            // Quote the path in case it contains spaces; jcode is the binary itself.
            cmd = "'\(bin)' login"
        } else {
            cmd = "jcode login"
        }
        // osascript: tell Terminal to run the command in a new window and activate.
        let script = """
        tell application "Terminal"
            activate
            do script "\(cmd.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))"
        end tell
        """
        // NSAppleScript runs on main; for a fire-and-forget UI action that's fine.
        DispatchQueue.global(qos: .userInitiated).async {
            let appleScript = NSAppleScript(source: script)
            var errorInfo: NSDictionary?
            appleScript?.executeAndReturnError(&errorInfo)
            if let errorInfo {
                Log.warn("jcode login AppleScript failed: \(errorInfo)", category: .session)
            }
        }
    }
}
