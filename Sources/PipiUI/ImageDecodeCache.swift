import AppKit
import Foundation

/// Process-wide decoded `NSImage` cache to avoid re-decoding the same bytes on view rebuilds
/// (e.g. warm/cold session switches that recreate `ImageThumbnailView`).
final class ImageDecodeCache {
    static let shared = ImageDecodeCache()

    private let cache: NSCache<NSString, NSImage> = {
        let c = NSCache<NSString, NSImage>()
        c.countLimit = 200
        return c
    }()

    private init() {}

    /// Returns a decoded image for `data`, reusing a cached instance when the fingerprint hits.
    /// Empty or undecodable data yields `nil` (same as bare `NSImage(data:)` failure).
    func image(for data: Data) -> NSImage? {
        guard !data.isEmpty else { return nil }
        let key = fingerprintKey(for: data)
        if let hit = cache.object(forKey: key) {
            return hit
        }
        guard let image = NSImage(data: data) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }

    /// Cheap stable-enough key: byte count + hash of prefix/suffix (avoids hashing full payload).
    private func fingerprintKey(for data: Data) -> NSString {
        let count = data.count
        let sample = min(64, count)
        var hasher = Hasher()
        hasher.combine(count)
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress, count > 0 else { return }
            hasher.combine(bytes: UnsafeRawBufferPointer(start: base, count: sample))
            if count > sample {
                let suffixCount = min(64, count)
                hasher.combine(
                    bytes: UnsafeRawBufferPointer(start: base.advanced(by: count - suffixCount), count: suffixCount)
                )
            }
        }
        return "\(count)-\(hasher.finalize())" as NSString
    }

    /// Test / memory-pressure helper: drop all entries.
    func removeAllObjects() {
        cache.removeAllObjects()
    }
}
