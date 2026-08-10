import Foundation

/// Bundled local Pi package for arXiv papers. It has no npm runtime dependencies.
enum ArxivFetchPackage {
    static let packageName = "pipiui-arxiv-fetch"
    static let relativePiExtPath = "packages/arxiv-fetch"
    static let requiredRelativePaths = ["package.json", "extensions/arxiv-fetch.ts", "README.md", "LICENSE"]

    static func installedPath(in piExtRoot: URL, fileManager: FileManager = .default) -> String? {
        let package = piExtRoot.appendingPathComponent(relativePiExtPath, isDirectory: true)
        guard requiredRelativePaths.allSatisfy({ fileManager.fileExists(atPath: package.appendingPathComponent($0).path) }) else { return nil }
        return package.path
    }
}
