import Foundation

/// Resolver for the built-in, resource-backed Pi Computer Use strategy.
///
/// The TypeScript resource is the sole authoritative strategy implementation.
/// Swift owns only discovery and installation paths.
enum ComputerUseStrategyResource {
    static let fileName = "computer-use-strategy.ts"
    static let runtimeProtocolName = "pipiui-computer-runtime"
    static let runtimeProtocolVersion = 1

    static func bundledURL(bundle: Bundle = PipiResourceBundle.shared) -> URL? {
        bundle.url(forResource: "PiExt", withExtension: nil)?
            .appendingPathComponent(fileName)
    }

    static func bundledSource(bundle: Bundle = PipiResourceBundle.shared) throws -> String {
        guard let url = bundledURL(bundle: bundle) else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try String(contentsOf: url, encoding: .utf8)
    }
}
