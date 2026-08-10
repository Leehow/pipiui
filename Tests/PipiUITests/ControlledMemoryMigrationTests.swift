import XCTest
@testable import PipiUI

final class ControlledMemoryMigrationTests: XCTestCase {
    private let fileManager = FileManager.default
    private var root: URL!

    override func setUpWithError() throws {
        root = fileManager.temporaryDirectory.appendingPathComponent("pipiui-memory-migration-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { [root, fileManager] in
            if let root { try? fileManager.removeItem(at: root) }
        }
    }

    private var legacy: URL { root.appendingPathComponent("legacy", isDirectory: true) }
    private var migration: URL { root.appendingPathComponent("migration", isDirectory: true) }

    private func write(_ value: String, to url: URL) throws {
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try value.write(to: url, atomically: true, encoding: .utf8)
    }

    private func writeLegacyStore(enabled: Bool = true) throws {
        try write(
            """
            {"version":1,"enabled":\(enabled ? "true" : "false")}
            """,
            to: legacy.appendingPathComponent("settings.json")
        )
        try write(
            """
            {"version":1,"entries":[
              {"id":"one","scope":"user","content":"Remember the verified project convention","source":{"sessionID":"s1","projectPath":"/project","proposedAt":"2026-08-10T00:00:00Z"},"createdAt":"2026-08-10T00:00:00Z","updatedAt":"2026-08-10T00:00:00Z"},
              {"id":"two","scope":"project","projectPath":"/project","content":"Use narrow edits","source":{"sessionID":"s2","projectPath":"/project","proposedAt":"2026-08-10T00:00:00Z"},"createdAt":"2026-08-10T00:00:00Z","updatedAt":"2026-08-10T00:00:00Z"}
            ],"processedProposalIDs":[]}
            """,
            to: legacy.appendingPathComponent("approved.json")
        )
    }

    func testSuccessBacksUpHashesStagesAndOnlyThenMarksCompletedAndDisablesLegacy() throws {
        try writeLegacyStore()
        let state = try ControlledMemoryMigration.prepare(legacyRoot: legacy, root: migration)
        XCTAssertEqual(state.phase, .prepared)
        XCTAssertEqual(state.count, 2)
        XCTAssertTrue(fileManager.fileExists(atPath: state.backupPath))
        XCTAssertTrue(fileManager.fileExists(atPath: state.importPath))
        XCTAssertEqual(
            try ControlledMemoryMigration.prepare(legacyRoot: legacy, root: migration),
            state,
            "retry before a receipt must reuse the same immutable import"
        )
        let receipt = ControlledMemoryMigration.Receipt(
            version: ControlledMemoryMigration.version,
            migrationID: state.migrationID,
            count: state.count,
            contentHash: state.contentHash,
            success: true
        )
        let receiptData = try JSONEncoder().encode(receipt)
        try receiptData.write(to: URL(fileURLWithPath: state.receiptPath), options: .atomic)

        let completed = try XCTUnwrap(ControlledMemoryMigration.reconcileReceipt(legacyRoot: legacy, root: migration))
        XCTAssertEqual(completed.phase, .completed)
        XCTAssertTrue(fileManager.fileExists(atPath: legacy.appendingPathComponent("approved.json").path), "migration never deletes old data")
        let settings = try JSONSerialization.jsonObject(with: Data(contentsOf: legacy.appendingPathComponent("settings.json"))) as? [String: Any]
        XCTAssertEqual(settings?["enabled"] as? Bool, false)
        XCTAssertNil(ControlledMemoryMigration.launchConfiguration(root: migration), "completed imports must not re-submit")
    }

    func testCompletedMarkerRecoversLegacyFlagAfterCrashWindow() throws {
        try writeLegacyStore()
        let state = try ControlledMemoryMigration.prepare(legacyRoot: legacy, root: migration)
        let receipt = ControlledMemoryMigration.Receipt(
            version: ControlledMemoryMigration.version,
            migrationID: state.migrationID,
            count: state.count,
            contentHash: state.contentHash,
            success: true
        )
        try JSONEncoder().encode(receipt).write(to: URL(fileURLWithPath: state.receiptPath), options: .atomic)
        XCTAssertEqual(
            ControlledMemoryMigration.reconcileReceipt(legacyRoot: legacy, root: migration)?.phase,
            .completed
        )

        // Simulate the old crash window: a completed marker persisted before
        // the legacy settings write. Reconcile must repair it on the next run.
        try write(#"{"version":1,"enabled":true}"#, to: legacy.appendingPathComponent("settings.json"))
        let recovered = try XCTUnwrap(ControlledMemoryMigration.reconcileReceipt(legacyRoot: legacy, root: migration))
        XCTAssertEqual(recovered.phase, .completed)
        let settings = try JSONSerialization.jsonObject(with: Data(contentsOf: legacy.appendingPathComponent("settings.json"))) as? [String: Any]
        XCTAssertEqual(settings?["enabled"] as? Bool, false)
        XCTAssertTrue(fileManager.fileExists(atPath: legacy.appendingPathComponent("approved.json").path))
    }

    func testUTF8ByteOrderedLegacyIDsMatchPackageHashVector() throws {
        try write(#"""
        {"version":1,"entries":[
          {"id":"é","scope":"user","content":"accent"},
          {"id":"z","scope":"user","content":"zed"},
          {"id":"😀","scope":"project","projectPath":"/项目","content":"emoji"},
          {"id":"a","scope":"project","projectPath":"/项目","content":"ascii"}
        ]}
        """#, to: legacy.appendingPathComponent("approved.json"))
        let state = try ControlledMemoryMigration.prepare(legacyRoot: legacy, root: migration)
        XCTAssertEqual(state.contentHash, "7fe47a928adb93e3d2b1c7dc834b5e012110218558bc116426c45e8e623398c6")
        let lines = try String(contentsOfFile: state.importPath, encoding: .utf8)
            .split(separator: "\n")
            .dropFirst()
        let ids = try lines.map { line -> String in
            let object = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
            return try XCTUnwrap(object?["id"] as? String)
        }
        XCTAssertEqual(ids, ["a", "z", "é", "😀"])
    }

    func testFailedReceiptKeepsLegacyDataEnabledAndNoCompletedMarker() throws {
        try writeLegacyStore()
        let state = try ControlledMemoryMigration.prepare(legacyRoot: legacy, root: migration)
        let receipt = ControlledMemoryMigration.Receipt(
            version: ControlledMemoryMigration.version,
            migrationID: state.migrationID,
            count: state.count,
            contentHash: state.contentHash,
            success: false,
            detail: "readback failed"
        )
        try JSONEncoder().encode(receipt).write(to: URL(fileURLWithPath: state.receiptPath), options: .atomic)

        let failed = try XCTUnwrap(ControlledMemoryMigration.reconcileReceipt(legacyRoot: legacy, root: migration))
        XCTAssertEqual(failed.phase, .failed)
        XCTAssertEqual(failed.lastError, "readback failed")
        XCTAssertTrue(fileManager.fileExists(atPath: legacy.appendingPathComponent("approved.json").path))
        let settings = try JSONSerialization.jsonObject(with: Data(contentsOf: legacy.appendingPathComponent("settings.json"))) as? [String: Any]
        XCTAssertEqual(settings?["enabled"] as? Bool, true)
        XCTAssertNil(ControlledMemoryMigration.launchConfiguration(root: migration))
        let retry = try ControlledMemoryMigration.prepare(legacyRoot: legacy, root: migration)
        XCTAssertEqual(retry.migrationID, state.migrationID, "retry must resume the same import instead of duplicating it")
        XCTAssertEqual(retry.phase, .prepared)
    }
}
