import Foundation

/// Resolve on-disk paths for transcript / tool images (known path, footnotes, content match).
package enum ImagePathResolver {

    /// Prefer knownPath → footnotePaths[imageIndex] → content match under project/.pi/attachments.
    package static func resolve(
        data: Data,
        knownPath: String?,
        footnotePaths: [String] = [],
        imageIndex: Int = 0,
        projectURL: URL? = nil
    ) -> String? {
        if let knownPath, !knownPath.isEmpty {
            if FileManager.default.fileExists(atPath: knownPath) {
                return knownPath
            }
        }

        if imageIndex >= 0, imageIndex < footnotePaths.count {
            let p = footnotePaths[imageIndex]
            if !p.isEmpty, FileManager.default.fileExists(atPath: p) {
                return p
            }
        }

        if let projectURL, let matched = matchAttachment(data: data, projectURL: projectURL) {
            return matched
        }

        // knownPath may still be useful for display/save even if missing — only return if exists above.
        // If footnote path was listed but missing, try next strategies already done.
        return nil
    }

    /// Paths listed by `ImageAttachment.messageWithAttachmentPaths` footnotes.
    package static func attachmentPaths(fromMessageText text: String) -> [String] {
        ImageAttachment.attachmentPaths(fromMessageText: text)
    }

    /// Size-prefilter then byte-equal match under `<project>/.pi/attachments`. Caps ~200 files.
    package static func matchAttachment(data: Data, projectURL: URL) -> String? {
        let dir = projectURL
            .appendingPathComponent(".pi", isDirectory: true)
            .appendingPathComponent("attachments", isDirectory: true)

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else {
            return nil
        }

        guard let enumerator = FileManager.default.enumerator(
            at: dir,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
            options: [.skipsHiddenFiles, .skipsSubdirectoryDescendants]
        ) else { return nil }

        let targetSize = data.count
        var checked = 0
        let cap = 200

        for case let url as URL in enumerator {
            if checked >= cap { break }
            checked += 1

            guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
                  values.isRegularFile == true,
                  let size = values.fileSize,
                  size == targetSize else { continue }

            guard let fileData = try? Data(contentsOf: url) else { continue }
            if fileData == data {
                // Prefer symlink-resolved path so /var vs /private/var compares cleanly.
                return url.resolvingSymlinksInPath().path
            }
        }
        return nil
    }
}
