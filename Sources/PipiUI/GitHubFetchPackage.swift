import Foundation

/// The bundled local Pi package that owns PipiUI's specialized GitHub reader.
///
/// Pi loads this directory as a package (`package.json` → `pi.extensions`) via
/// `-e`; it has no npm runtime dependencies and can later be published as-is.
enum GitHubFetchPackage {
    static let packageName = "pipiui-github-fetch"
    static let relativePiExtPath = "packages/github-fetch"
    static let requiredRelativePaths = [
        "package.json",
        "extensions/github-fetch.ts",
        "README.md",
        "LICENSE",
    ]

    static func installedPath(
        in piExtRoot: URL,
        fileManager: FileManager = .default
    ) -> String? {
        let packageURL = piExtRoot.appendingPathComponent(relativePiExtPath, isDirectory: true)
        guard requiredRelativePaths.allSatisfy({
            fileManager.fileExists(atPath: packageURL.appendingPathComponent($0).path)
        }) else {
            return nil
        }
        return packageURL.path
    }
}
