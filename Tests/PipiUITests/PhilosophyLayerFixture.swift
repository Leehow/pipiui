import Foundation
@testable import PipiUI

/// Shared access to the bundled philosophy layers for content-regression tests.
///
/// Always reads the snapshot inside the app bundle, never the user's installed copy under
/// Application Support — a test run must not depend on, or disturb, what pi has installed.
///
/// Bodies are whitespace-normalized so assertions pin *meaning* rather than line wrapping.
/// The old boss-prompt tests matched exact `"...\n  ..."` fragments, which meant re-flowing a
/// paragraph broke tests that were really about a rule still being present.
enum PhilosophyLayerFixture {
    struct MissingResource: Error, CustomStringConvertible {
        let detail: String
        var description: String { detail }
    }

    static func layers() throws -> [PhilosophySettings.Layer] {
        guard let bundled = PhilosophyPackage.bundledURL else {
            throw MissingResource(detail: "PiPhilosophy resource missing from the test bundle")
        }
        return PhilosophySettings.layers(
            layersURL: bundled.appendingPathComponent("layers"), userURL: nil)
    }

    static func layer(_ id: String) throws -> PhilosophySettings.Layer {
        guard let match = try layers().first(where: { $0.id == id }) else {
            throw MissingResource(detail: "no philosophy layer with id \(id)")
        }
        return match
    }

    static func normalizedBody(_ id: String) throws -> String {
        normalize(try layer(id).body)
    }

    /// Every layer body joined, for "this phrase must appear nowhere" assertions.
    static func allNormalizedBodies() throws -> String {
        try layers().map { normalize($0.body) }.joined(separator: " ")
    }

    static func normalize(_ text: String) -> String {
        text.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
