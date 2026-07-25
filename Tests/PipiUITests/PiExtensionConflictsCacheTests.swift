import XCTest
@testable import PipiUI

final class PiExtensionConflictsCacheTests: XCTestCase {
    private var tempRoot: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        tempRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ext-cache-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
        PiExtensionConflicts.clearCache()
    }

    override func tearDownWithError() throws {
        PiExtensionConflicts.clearCache()
        try? FileManager.default.removeItem(at: tempRoot)
        tempRoot = nil
        try super.tearDownWithError()
    }

    func testDetectCachesStableProjectAndInvalidatesWhenExtensionRemoved() throws {
        let extDir = tempRoot.appendingPathComponent(".pi/extensions/collide", isDirectory: true)
        try FileManager.default.createDirectory(at: extDir, withIntermediateDirectories: true)
        let index = extDir.appendingPathComponent("index.js")
        try #"""
        export default function (pi) {
          pi.registerTool({ name: "subagent", description: "x", execute: async () => {} })
        }
        """#.write(to: index, atomically: true, encoding: .utf8)

        let first = PiExtensionConflicts.detect(projectDir: tempRoot)
        XCTAssertTrue(
            first.contains(where: { $0.entryPath == index.path }),
            "expected project collision on first scan"
        )

        let second = PiExtensionConflicts.detect(projectDir: tempRoot)
        XCTAssertEqual(second, first, "unchanged mtime should reuse cached conflicts")

        try FileManager.default.removeItem(at: index)
        // Directory mtime changes on unlink; also bump explicitly for APFS edge cases.
        let extensionsRoot = tempRoot.appendingPathComponent(".pi/extensions")
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(2)],
            ofItemAtPath: extensionsRoot.path
        )

        let third = PiExtensionConflicts.detect(projectDir: tempRoot)
        XCTAssertFalse(
            third.contains(where: { $0.entryPath == index.path }),
            "mtime change must invalidate cache and drop removed collision"
        )
    }

    func testDisableClearsCacheSoRescanSeesOverride() throws {
        let base = tempRoot.appendingPathComponent("agent", isDirectory: true)
        let extDir = base.appendingPathComponent("extensions/collide", isDirectory: true)
        try FileManager.default.createDirectory(at: extDir, withIntermediateDirectories: true)
        let index = extDir.appendingPathComponent("index.js")
        try #"""
        export default function (pi) {
          pi.registerTool({ name: 'subagent', description: 'x', execute: async () => {} })
        }
        """#.write(to: index, atomically: true, encoding: .utf8)

        let found = PiExtensionConflicts.scan(baseDir: base, scopeLabel: "test")
        XCTAssertEqual(found.count, 1)
        let conflict = try XCTUnwrap(found.first)

        // Prime detect cache with a project that has no local collisions; disable must not leave stale rows.
        _ = PiExtensionConflicts.detect(projectDir: tempRoot)
        try PiExtensionConflicts.disable(conflict)

        let after = PiExtensionConflicts.scan(baseDir: base, scopeLabel: "test")
        XCTAssertTrue(after.isEmpty, "disable should force-exclude the entry for scan")
    }

    func testCachedReturnsNilBeforeDetectAndHitAfter() throws {
        XCTAssertNil(
            PiExtensionConflicts.cached(projectDir: tempRoot),
            "cold cache must report miss so caller can go async"
        )
        let detected = PiExtensionConflicts.detect(projectDir: tempRoot)
        let hit = PiExtensionConflicts.cached(projectDir: tempRoot)
        XCTAssertEqual(hit, detected, "stamp-unchanged cache hit should return detected result")
    }

    func testDetectAsyncDeliversResultOnMainThread() throws {
        let expected = PiExtensionConflicts.detect(projectDir: tempRoot)
        PiExtensionConflicts.clearCache()

        let exp = expectation(description: "async detect")
        PiExtensionConflicts.detectAsync(projectDir: tempRoot) { result in
            XCTAssertTrue(Thread.isMainThread, "completion must be delivered on main thread")
            XCTAssertEqual(result, expected)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 10)
    }
}
