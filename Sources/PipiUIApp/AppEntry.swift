import PipiUI

/// Thin executable entry so the `PipiUI` module can be a library (testable without `@main`).
@main
enum PipiUIMainEntry {
    static func main() {
        // Earliest hooks: logging + crash capture before SwiftUI starts.
        Log.bootstrap()
        // fd 2 must be redirected before AppKit/WebKit start writing to it, otherwise
        // the lines that explain a trap go to /dev/null when launched from Finder.
        Log.noteStderrCapture(StderrCapture.install())
        CrashReporting.install()
        PipiUIApp.main()
    }
}
