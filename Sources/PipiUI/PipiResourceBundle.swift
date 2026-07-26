import Foundation

/// Resolves resources from the standard location inside a signed macOS app.
///
/// SwiftPM's generated `Bundle.module` accessor looks beside a command-line
/// executable. A packaged `.app` cannot put extra bundles at its root without
/// invalidating its signature, so `make-app.sh` embeds the bundle under
/// `Contents/Resources` and packaged builds resolve it here.
enum PipiResourceBundle {
    static let shared: Bundle = {
        if let resourceURL = Bundle.main.resourceURL {
            let embeddedURL = resourceURL.appendingPathComponent(
                "PipiUI_PipiUI.bundle",
                isDirectory: true
            )
            if let embedded = Bundle(url: embeddedURL) {
                return embedded
            }
        }
        return Bundle.module
    }()
}
