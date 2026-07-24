import AppKit
import UniformTypeIdentifiers

/// Composer-only image attachment before send.
struct DraftImage: Identifiable {
    let id: UUID
    let data: Data
    let mimeType: String
    let preview: NSImage

    init(id: UUID = UUID(), data: Data, mimeType: String, preview: NSImage) {
        self.id = id
        self.data = data
        self.mimeType = mimeType
        self.preview = preview
    }
}

package enum ImageAttachment {
    package static let maxBytes = 20 * 1024 * 1024
    package static let maxEdge: CGFloat = 2000

    enum LoadError: LocalizedError {
        case tooLarge
        case unsupported
        case corrupt

        var errorDescription: String? {
            switch self {
            case .tooLarge: return "图片超过 20MB，已忽略"
            case .unsupported: return "不支持的图片格式"
            case .corrupt: return "无法读取图片"
            }
        }
    }

    // MARK: - Build draft images

    static func make(from data: Data, sourceMIME: String? = nil) -> Result<DraftImage, LoadError> {
        guard !data.isEmpty else { return .failure(.corrupt) }
        guard data.count <= maxBytes else { return .failure(.tooLarge) }
        guard let image = NSImage(data: data) else { return .failure(.corrupt) }
        return normalize(image: image, preferredMIME: sourceMIME, originalData: data)
    }

    static func make(from url: URL) -> Result<DraftImage, LoadError> {
        let values = try? url.resourceValues(forKeys: [.contentTypeKey, .fileSizeKey])
        if let size = values?.fileSize, size > maxBytes { return .failure(.tooLarge) }
        guard let data = try? Data(contentsOf: url) else { return .failure(.corrupt) }
        let mime = mimeType(for: url, contentType: values?.contentType, data: data)
        return make(from: data, sourceMIME: mime)
    }

    static func make(from image: NSImage) -> Result<DraftImage, LoadError> {
        normalize(image: image, preferredMIME: "image/png", originalData: nil)
    }

    /// Images currently on the general pasteboard (bitmap and/or image file URLs).
    static func imagesFromPasteboard(_ pb: NSPasteboard = .general) -> [DraftImage] {
        var results: [DraftImage] = []
        var seen = Set<Data>()

        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [
            .urlReadingFileURLsOnly: true,
            .urlReadingContentsConformToTypes: [UTType.image.identifier]
        ]) as? [URL] {
            for url in urls {
                if case .success(let draft) = make(from: url), seen.insert(draft.data).inserted {
                    results.append(draft)
                }
            }
        }

        if results.isEmpty,
           let images = pb.readObjects(forClasses: [NSImage.self], options: nil) as? [NSImage] {
            for image in images {
                if case .success(let draft) = make(from: image), seen.insert(draft.data).inserted {
                    results.append(draft)
                }
            }
        }

        // Raw image data representations (screenshot tools often put TIFF/PNG)
        if results.isEmpty {
            for type in [NSPasteboard.PasteboardType.png, .tiff] {
                if let data = pb.data(forType: type),
                   case .success(let draft) = make(from: data, sourceMIME: type == .png ? "image/png" : "image/tiff"),
                   seen.insert(draft.data).inserted {
                    results.append(draft)
                }
            }
        }

        return results
    }

    static func pasteboardHasImage(_ pb: NSPasteboard = .general) -> Bool {
        if pb.canReadObject(forClasses: [NSImage.self], options: nil) { return true }
        if pb.availableType(from: [.png, .tiff]) != nil { return true }
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [
            .urlReadingFileURLsOnly: true,
            .urlReadingContentsConformToTypes: [UTType.image.identifier]
        ]) as? [URL], !urls.isEmpty {
            return true
        }
        return false
    }

    /// RPC `images` field payload.
    static func rpcPayload(from images: [DraftImage]) -> [[String: Any]] {
        images.map {
            ["type": "image", "data": $0.data.base64EncodedString(), "mimeType": $0.mimeType]
        }
    }

    /// Persist drafts under `<project>/.pi/attachments/` so that if the model
    /// tries `read` on a path (common coding-agent habit), the file actually exists.
    /// Returns absolute paths written successfully.
    @discardableResult
    static func saveToProjectAttachments(_ images: [DraftImage], projectURL: URL) -> [URL] {
        guard !images.isEmpty else { return [] }
        let dir = projectURL
            .appendingPathComponent(".pi", isDirectory: true)
            .appendingPathComponent("attachments", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            return []
        }

        let stamp = ISO8601DateFormatter()
        stamp.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var urls: [URL] = []
        for (idx, img) in images.enumerated() {
            let ext = fileExtension(for: img.mimeType)
            let name = "\(stamp.string(from: Date()).replacingOccurrences(of: ":", with: "-"))-\(idx).\(ext)"
            let url = dir.appendingPathComponent(name)
            do {
                try img.data.write(to: url, options: .atomic)
                urls.append(url)
            } catch {
                continue
            }
        }
        return urls
    }

    /// Footer note appended after attachment path lines (kept in sync with strip).
    private static let attachmentDisplayNote =
        "(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)"

    /// Append readable absolute paths so models that prefer tools over vision can `read` them.
    package static func messageWithAttachmentPaths(text: String, paths: [URL]) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !paths.isEmpty else { return trimmed }
        var lines: [String] = []
        if !trimmed.isEmpty { lines.append(trimmed) }
        lines.append("")
        if paths.count == 1 {
            lines.append("Attached image file: \(paths[0].path)")
        } else {
            lines.append("Attached image files:")
            for p in paths { lines.append("- \(p.path)") }
        }
        lines.append(attachmentDisplayNote)
        return lines.joined(separator: "\n")
    }

    /// Absolute paths listed by `messageWithAttachmentPaths` footnotes (order preserved).
    package static func attachmentPaths(fromMessageText text: String) -> [String] {
        var paths: [String] = []
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var i = 0
        while i < lines.count {
            let t = lines[i].trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("Attached image file: ") {
                let p = String(t.dropFirst("Attached image file: ".count))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !p.isEmpty { paths.append(p) }
                i += 1
                continue
            }
            if t == "Attached image files:" {
                i += 1
                while i < lines.count {
                    let lt = lines[i].trimmingCharacters(in: .whitespaces)
                    if lt.hasPrefix("- ") {
                        let p = String(lt.dropFirst(2))
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        if !p.isEmpty { paths.append(p) }
                        i += 1
                    } else if lt.isEmpty {
                        break
                    } else {
                        break
                    }
                }
                continue
            }
            i += 1
        }
        return paths
    }

    /// Remove path footnotes added by `messageWithAttachmentPaths` for UI display.
    /// Keeps the user's real prose; safe no-op if no footer present.
    package static func stripAttachmentPathsForDisplay(_ text: String) -> String {
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        // Tolerate trailing blank lines when matching the footer.
        while lines.last?.trimmingCharacters(in: .whitespaces).isEmpty == true {
            lines.removeLast()
        }
        guard !lines.isEmpty else { return text }

        let last = lines[lines.count - 1].trimmingCharacters(in: .whitespaces)
        let isNote = last == attachmentDisplayNote
            || last.hasPrefix("(Images are also embedded multimodally")
        guard isNote else { return text }

        lines.removeLast()

        // Optional blank line before the note (after path block).
        if lines.last?.trimmingCharacters(in: .whitespaces).isEmpty == true {
            lines.removeLast()
        }

        // Single: "Attached image file: <path>"
        // Multi:  "Attached image files:" then one or more "- <path>" lines
        if let idx = lines.lastIndex(where: { line in
            let t = line.trimmingCharacters(in: .whitespaces)
            return t.hasPrefix("Attached image file: ") || t == "Attached image files:"
        }) {
            let header = lines[idx].trimmingCharacters(in: .whitespaces)
            if header.hasPrefix("Attached image file: ") {
                // Ensure nothing but optional blanks between header and note.
                let between = lines[(idx + 1)...]
                let onlyBlanks = between.allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
                if onlyBlanks {
                    lines.removeSubrange(idx...)
                } else {
                    return text
                }
            } else {
                // Multi-file header; following non-empty lines must be "- " paths.
                var end = idx + 1
                while end < lines.count {
                    let t = lines[end].trimmingCharacters(in: .whitespaces)
                    if t.isEmpty { break }
                    if t.hasPrefix("- ") {
                        end += 1
                    } else {
                        return text
                    }
                }
                // Require at least one path line for multi header.
                guard end > idx + 1 else { return text }
                let afterPaths = lines[end...]
                let onlyBlanks = afterPaths.allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
                guard onlyBlanks else { return text }
                lines.removeSubrange(idx...)
            }
        } else {
            return text
        }

        // Remove one preceding empty line left by the appender.
        if lines.last?.trimmingCharacters(in: .whitespaces).isEmpty == true {
            lines.removeLast()
        }

        // Rejoin; trim only trailing whitespace/newlines from the result.
        var result = lines.joined(separator: "\n")
        while result.hasSuffix("\n") || result.hasSuffix(" ") || result.hasSuffix("\t") {
            result.removeLast()
        }
        return result
    }

    private static func fileExtension(for mime: String) -> String {
        switch mime.lowercased() {
        case "image/jpeg", "image/jpg": return "jpg"
        case "image/gif": return "gif"
        case "image/webp": return "webp"
        default: return "png"
        }
    }

    // MARK: - Normalize / encode

    private static func normalize(image: NSImage, preferredMIME: String?, originalData: Data?) -> Result<DraftImage, LoadError> {
        let resized = resizeIfNeeded(image)
        let wantsJPEG = shouldUseJPEG(preferredMIME: preferredMIME, image: resized)
        let mime = wantsJPEG ? "image/jpeg" : "image/png"

        // Reuse original bytes when already small enough and compatible (skip re-encode).
        if let originalData,
           originalData.count <= maxBytes,
           !needsResize(image),
           let preferredMIME,
           isCompatible(mime: preferredMIME, wantsJPEG: wantsJPEG),
           NSImage(data: originalData) != nil {
            return .success(DraftImage(data: originalData, mimeType: normalizeMIME(preferredMIME), preview: image))
        }

        guard let data = encode(resized, asJPEG: wantsJPEG) else { return .failure(.corrupt) }
        guard data.count <= maxBytes else { return .failure(.tooLarge) }
        let preview = NSImage(data: data) ?? resized
        return .success(DraftImage(data: data, mimeType: mime, preview: preview))
    }

    private static func needsResize(_ image: NSImage) -> Bool {
        let size = image.size
        return size.width > maxEdge || size.height > maxEdge
    }

    private static func resizeIfNeeded(_ image: NSImage) -> NSImage {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return image }
        let longest = max(size.width, size.height)
        guard longest > maxEdge else { return image }
        let scale = maxEdge / longest
        let newSize = NSSize(width: floor(size.width * scale), height: floor(size.height * scale))
        let out = NSImage(size: newSize)
        out.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: NSRect(origin: .zero, size: newSize),
                   from: NSRect(origin: .zero, size: size),
                   operation: .copy,
                   fraction: 1.0)
        out.unlockFocus()
        return out
    }

    private static func encode(_ image: NSImage, asJPEG: Bool) -> Data? {
        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff) else { return nil }
        if asJPEG {
            return rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85])
        }
        return rep.representation(using: .png, properties: [:])
    }

    private static func shouldUseJPEG(preferredMIME: String?, image: NSImage) -> Bool {
        let mime = preferredMIME?.lowercased() ?? ""
        if mime.contains("jpeg") || mime.contains("jpg") || mime.contains("heic") || mime.contains("heif") {
            return true
        }
        if mime.contains("png") || mime.contains("gif") || mime.contains("webp") {
            return false
        }
        // Default: JPEG if no alpha, else PNG
        return !imageHasAlpha(image)
    }

    private static func imageHasAlpha(_ image: NSImage) -> Bool {
        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff) else { return true }
        return rep.hasAlpha
    }

    private static func isCompatible(mime: String, wantsJPEG: Bool) -> Bool {
        let m = mime.lowercased()
        if wantsJPEG { return m.contains("jpeg") || m.contains("jpg") }
        return m.contains("png") || m.contains("gif") || m.contains("webp")
    }

    private static func normalizeMIME(_ mime: String) -> String {
        let m = mime.lowercased()
        if m.contains("jpeg") || m.contains("jpg") { return "image/jpeg" }
        if m.contains("png") { return "image/png" }
        if m.contains("gif") { return "image/gif" }
        if m.contains("webp") { return "image/webp" }
        if m.contains("heic") || m.contains("heif") { return "image/jpeg" }
        if m.contains("tiff") { return "image/png" }
        return mime
    }

    private static func mimeType(for url: URL, contentType: UTType?, data: Data) -> String {
        if let contentType {
            if contentType.conforms(to: .jpeg) { return "image/jpeg" }
            if contentType.conforms(to: .png) { return "image/png" }
            if contentType.conforms(to: .gif) { return "image/gif" }
            if contentType.conforms(to: .webP) { return "image/webp" }
            if contentType.conforms(to: .heic) || contentType.conforms(to: .heif) { return "image/heic" }
            if let mime = contentType.preferredMIMEType { return mime }
        }
        switch url.pathExtension.lowercased() {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic", "heif": return "image/heic"
        default: break
        }
        if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if data.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if data.starts(with: Array("GIF8".utf8)) { return "image/gif" }
        return "image/png"
    }
}
