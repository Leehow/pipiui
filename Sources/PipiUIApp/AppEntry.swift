import PipiUI

/// Thin executable entry so the `PipiUI` module can be a library (testable without `@main`).
@main
enum PipiUIMainEntry {
    static func main() {
        PipiUIApp.main()
    }
}
