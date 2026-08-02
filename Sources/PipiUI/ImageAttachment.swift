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

/// Thread-safe path→Data read-through cache for on-disk image files
/// (attachments, RPC path-only blocks, hydrate footnotes).
///
/// Same idea as `ImageDecodeCache` but one layer lower: it dedupes the *disk read*,
/// so history build, live ingest backfill, and repeated hydrate passes never read the
/// same file twice. `NSCache` is internally synchronized → callable from any queue.
package enum ImageFileDataCache {
    private static let cache: NSCache<NSString, NSData> = {
        let c = NSCache<NSString, NSData>()
        c.countLimit = 64
        c.totalCostLimit = 256 * 1024 * 1024 // ~12 max-size images
        return c
    }()

    /// Read-through: a cache hit performs **zero** disk I/O; a miss reads once and stores.
    /// Returns nil for missing/empty/unreadable files (same shape as a failed `Data(contentsOf:)`).
    package static func data(forPath path: String) -> Data? {
        let key = path as NSString
        if let hit = cache.object(forKey: key) { return hit as Data }
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)), !data.isEmpty else { return nil }
        cache.setObject(data as NSData, forKey: key, cost: data.count)
        return data
    }

    /// Test / memory-pressure helper: drop all entries.
    package static func removeAll() {
        cache.removeAllObjects()
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

    private static func attachmentsDirectory(projectURL: URL) -> URL {
        projectURL
            .appendingPathComponent(".pi", isDirectory: true)
            .appendingPathComponent("attachments", isDirectory: true)
    }

    /// Persist drafts under `<project>/.pi/attachments/` so that if the model
    /// tries `read` on a path (common coding-agent habit), the file actually exists.
    /// Returns absolute paths written successfully.
    @discardableResult
    static func saveToProjectAttachments(_ images: [DraftImage], projectURL: URL) -> [URL] {
        guard !images.isEmpty else { return [] }
        let dir = attachmentsDirectory(projectURL: projectURL)
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

    // MARK: - Background attachment writes (T12: keep disk I/O off the main thread)

    private static let attachmentWriteLock = NSLock()
    /// draft id → assigned destination (written or write in flight).
    /// Re-sending the same draft (queue restore, retry) reuses its original path,
    /// so the footnote text already embedded in the message stays valid.
    private static var attachmentURLsByDraft: [UUID: URL] = [:]
    /// draft ids whose write completed successfully (skip re-write).
    private static var attachmentWritesDone: Set<UUID> = []
    /// draft ids currently being written on the background queue.
    private static var attachmentWritesInFlight: Set<UUID> = []

    /// Destination paths for drafts — **pure path computation, zero disk I/O**, main-thread safe.
    /// The mapping is recorded up front so a re-send of the same draft reuses the path.
    static func attachmentURLs(for images: [DraftImage], projectURL: URL) -> [URL] {
        let dir = attachmentsDirectory(projectURL: projectURL)
        let stamp = ISO8601DateFormatter()
        stamp.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let stampText = stamp.string(from: Date()).replacingOccurrences(of: ":", with: "-")
        attachmentWriteLock.lock()
        defer { attachmentWriteLock.unlock() }
        return images.enumerated().map { idx, img in
            if let existing = attachmentURLsByDraft[img.id] { return existing }
            let ext = fileExtension(for: img.mimeType)
            // uuid suffix: distinct drafts can share stamp+idx on rapid double-send.
            let name = "\(stampText)-\(idx)-\(img.id.uuidString.prefix(8)).\(ext)"
            let url = dir.appendingPathComponent(name)
            attachmentURLsByDraft[img.id] = url
            return url
        }
    }

    /// Precompute paths synchronously and write bytes on a background queue.
    /// Returns the paths immediately (they do not depend on write completion).
    /// Each draft is written at most once: duplicate calls for an already-written or
    /// in-flight draft reuse its path and skip the write. `completion` runs on an
    /// unspecified queue with the successfully (re)written paths.
    @discardableResult
    static func saveToProjectAttachmentsAsync(
        _ images: [DraftImage],
        projectURL: URL,
        completion: @escaping ([URL]) -> Void = { _ in }
    ) -> [URL] {
        guard !images.isEmpty else { return [] }
        let urls = attachmentURLs(for: images, projectURL: projectURL)

        attachmentWriteLock.lock()
        let toWrite: [(id: UUID, data: Data, url: URL)] = images.compactMap { img in
            guard !attachmentWritesDone.contains(img.id),
                  !attachmentWritesInFlight.contains(img.id),
                  let url = attachmentURLsByDraft[img.id] else { return nil }
            attachmentWritesInFlight.insert(img.id)
            return (img.id, img.data, url)
        }
        attachmentWriteLock.unlock()

        guard !toWrite.isEmpty else {
            completion(urls)
            return urls
        }

        let dir = attachmentsDirectory(projectURL: projectURL)
        DispatchQueue.global(qos: .userInitiated).async {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            for entry in toWrite {
                var wrote = false
                do {
                    try entry.data.write(to: entry.url, options: .atomic)
                    wrote = true
                } catch {
                    // Mapping stays but is not marked done → a later re-send retries the write.
                }
                attachmentWriteLock.lock()
                attachmentWritesInFlight.remove(entry.id)
                // If the mapping was discarded while we were writing (permanent send failure),
                // the file is unwanted — delete it instead of leaking it.
                let stillWanted = attachmentURLsByDraft[entry.id] != nil
                if wrote && stillWanted { attachmentWritesDone.insert(entry.id) }
                attachmentWriteLock.unlock()
                if !stillWanted {
                    try? FileManager.default.removeItem(at: entry.url)
                }
            }
            completion(urls)
        }
        return urls
    }

    /// Permanent-send-failure cleanup: delete files **we** wrote for these paths and
    /// forget the draft→path mapping (a later re-send then gets a fresh path + write).
    /// Paths we never recorded are ignored, so arbitrary user paths in text are safe.
    static func discardAttachments(atPaths paths: [String]) {
        guard !paths.isEmpty else { return }
        attachmentWriteLock.lock()
        let doomed = attachmentURLsByDraft.filter { paths.contains($0.value.path) }
        for (id, _) in doomed {
            attachmentURLsByDraft.removeValue(forKey: id)
            attachmentWritesDone.remove(id)
        }
        attachmentWriteLock.unlock()
        let urls = Array(doomed.values)
        guard !urls.isEmpty else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            for url in urls { try? FileManager.default.removeItem(at: url) }
        }
    }

    /// Test helper: forget all draft→path state (does not delete files).
    static func resetAttachmentWriteState() {
        attachmentWriteLock.lock()
        attachmentURLsByDraft.removeAll()
        attachmentWritesDone.removeAll()
        attachmentWritesInFlight.removeAll()
        attachmentWriteLock.unlock()
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
    /// Finds the footnote block anywhere in the text — not only at the end — because
    /// the Vision fallback appends an OCR caption block after the note. Keeps the
    /// user's real prose (and any OCR block); safe no-op if no valid footer present.
    package static func stripAttachmentPathsForDisplay(_ text: String) -> String {
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        // Tolerate trailing blank lines when matching the footer.
        while lines.last?.trimmingCharacters(in: .whitespaces).isEmpty == true {
            lines.removeLast()
        }
        guard !lines.isEmpty else { return text }

        // Find the note line anywhere in the text (last occurrence wins),
        // not necessarily at the end (OCR block may follow).
        guard let noteIdx = lines.lastIndex(where: { line in
            let t = line.trimmingCharacters(in: .whitespaces)
            return t == attachmentDisplayNote
                || t.hasPrefix("(Images are also embedded multimodally")
        }) else { return text }

        // Walk backwards from the note over blank lines to the path header.
        var headerIdx = noteIdx - 1
        while headerIdx >= 0, lines[headerIdx].trimmingCharacters(in: .whitespaces).isEmpty {
            headerIdx -= 1
        }
        guard headerIdx >= 0 else { return text }
        let header = lines[headerIdx].trimmingCharacters(in: .whitespaces)

        let isSingle = header.hasPrefix("Attached image file: ")
        let isMulti = header == "Attached image files:"
        guard isSingle || isMulti else { return text }

        if isSingle {
            // Single: only blank lines allowed between header and note.
            let between = lines[(headerIdx + 1)..<noteIdx]
            guard between.allSatisfy({ $0.trimmingCharacters(in: .whitespaces).isEmpty }) else { return text }
        } else {
            // Multi: non-empty lines between header and note must be "- " paths, at least one.
            var idx = headerIdx + 1
            var pathCount = 0
            while idx < noteIdx {
                let t = lines[idx].trimmingCharacters(in: .whitespaces)
                if t.isEmpty { break }
                guard t.hasPrefix("- ") else { return text }
                pathCount += 1
                idx += 1
            }
            guard pathCount > 0 else { return text }
            // Paths may be followed only by blank lines up to the note.
            let afterPaths = lines[idx..<noteIdx]
            guard afterPaths.allSatisfy({ $0.trimmingCharacters(in: .whitespaces).isEmpty }) else { return text }
        }

        // Remove the whole block (header…note), plus one preceding blank line left by the appender.
        lines.removeSubrange(headerIdx...noteIdx)
        let blankBefore = headerIdx - 1
        if blankBefore >= 0, blankBefore < lines.count,
           lines[blankBefore].trimmingCharacters(in: .whitespaces).isEmpty {
            lines.remove(at: blankBefore)
        }

        // Image-only messages: the footer was the very first content; drop the
        // separator blank left in front of the trailing OCR caption block.
        if headerIdx == 0 {
            while lines.first?.trimmingCharacters(in: .whitespaces).isEmpty == true {
                lines.removeFirst()
            }
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
