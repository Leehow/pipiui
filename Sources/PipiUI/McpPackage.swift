import Foundation

/// Fixed, app-owned installation of the reviewed `pi-mcp-extension` package.
/// The package stays in PipiUI's private managed-npm prefix; PipiUI never
/// registers it in the user's global pi settings.
enum McpPackage {
    static let packageName = "pi-mcp-extension"
    static let packageVersion = "1.5.0"

    /// Ensure a private, pinned package is ready for `pi -e`. A user-managed
    /// global registration deliberately wins, avoiding a duplicate extension
    /// load; pi will load that registration through its normal settings.
    static func ensureInstalled() -> String? {
        switch ManagedNpmPackage.globalRegistration(package: packageName) {
        case .registered(let source, _):
            Log.info(
                "MCP uses the user-registered \(source); PipiUI will not mount a duplicate managed package.",
                category: .process
            )
            return nil
        case .unreadableSettings:
            Log.warn(
                "MCP managed package was not mounted because ~/.pi/agent/settings.json is unreadable; refusing a possible duplicate extension load.",
                category: .process
            )
            return nil
        case .notRegistered:
            do {
                _ = try ManagedNpmPackage.ensureInstalled(
                    package: packageName,
                    version: packageVersion
                )
                return try ManagedNpmPackage.resolvedEntrypoint(
                    package: packageName,
                    version: packageVersion
                )
            } catch {
                Log.error(
                    "MCP managed package \(packageName)@\(packageVersion) is unavailable: \(error.localizedDescription)",
                    category: .process
                )
                return nil
            }
        }
    }
}
