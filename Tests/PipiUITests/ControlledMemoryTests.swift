import XCTest
@testable import PipiUI

final class ControlledMemoryTests: XCTestCase {
    private func temporaryRoot() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-memory-tests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func source(project: String = "/tmp/project") -> ControlledMemorySource {
        ControlledMemorySource(
            sessionID: "session-1",
            projectPath: project,
            proposedAt: Date(timeIntervalSince1970: 1_700_000_000),
            toolCallID: "tool-1"
        )
    }

    private func proposal(
        id: String = "proposal-1",
        operation: ControlledMemoryOperation = .add,
        scope: ControlledMemoryScope = .user,
        content: String? = "likes concise answers",
        targetID: String? = nil,
        project: String = "/tmp/project"
    ) -> ControlledMemoryProposal {
        ControlledMemoryProposal(
            version: 1,
            id: id,
            operation: operation,
            scope: scope,
            projectPath: scope == .project ? project : nil,
            content: content,
            targetID: targetID,
            reason: "user stated it",
            source: source(project: project)
        )
    }

    private func writeProposal(_ proposal: ControlledMemoryProposal, root: URL) throws {
        let dir = root.appendingPathComponent("pending", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try container.encode(formatter.string(from: date))
        }
        try encoder.encode(proposal).write(
            to: dir.appendingPathComponent(proposal.id).appendingPathExtension("json"),
            options: .atomic
        )
    }

    @MainActor
    func testDefaultOffRoundTripAndPrivatePermissions() throws {
        let root = temporaryRoot()
        let store = ControlledMemoryStore(rootURL: root)
        XCTAssertFalse(store.isEnabled)
        XCTAssertTrue(store.entries.isEmpty)

        try store.setEnabled(true)
        store.refresh()
        XCTAssertTrue(store.isEnabled)
        let rootMode = try XCTUnwrap(
            FileManager.default.attributesOfItem(atPath: root.path)[.posixPermissions] as? NSNumber
        ).intValue
        let settingsMode = try XCTUnwrap(
            FileManager.default.attributesOfItem(atPath: root.appendingPathComponent("settings.json").path)[.posixPermissions] as? NSNumber
        ).intValue
        XCTAssertEqual(rootMode & 0o777, 0o700)
        XCTAssertEqual(settingsMode & 0o777, 0o600)

        let snapshot = root.appendingPathComponent("snapshots/old.json")
        try Data("{}".utf8).write(to: snapshot)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: snapshot.path)
        try store.repairStoragePermissions()
        let repairedMode = try XCTUnwrap(
            FileManager.default.attributesOfItem(atPath: snapshot.path)[.posixPermissions] as? NSNumber
        ).intValue
        XCTAssertEqual(repairedMode & 0o777, 0o600)
    }

    @MainActor
    func testSchemaMismatchFailsClosed() throws {
        let root = temporaryRoot()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data(#"{"version":99,"enabled":true}"#.utf8)
            .write(to: root.appendingPathComponent("settings.json"))
        let store = ControlledMemoryStore(rootURL: root)
        XCTAssertFalse(store.isEnabled)
        XCTAssertNotNil(store.lastError)
    }

    @MainActor
    func testLegacyApprovedEnvelopeWithoutProcessedLedgerStillLoads() throws {
        let root = temporaryRoot()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data(#"{"version":1,"entries":[]}"#.utf8)
            .write(to: root.appendingPathComponent("approved.json"))
        let store = ControlledMemoryStore(rootURL: root)
        XCTAssertTrue(store.entries.isEmpty)
        XCTAssertNil(store.lastError)
    }

    func testUTF8CapsAreAggregatePerScopeAndProject() throws {
        let user = ControlledMemoryEntry(
            id: "u", scope: .user, projectPath: nil,
            content: String(repeating: "你", count: 683), // 2049 UTF-8 bytes
            source: source(), createdAt: Date(), updatedAt: Date()
        )
        XCTAssertThrowsError(try ControlledMemoryStore.validateCaps([user]))

        let eachProject = ControlledMemoryEntry(
            id: "p", scope: .project, projectPath: "/tmp/a",
            content: String(repeating: "x", count: 4096),
            source: source(project: "/tmp/a"), createdAt: Date(), updatedAt: Date()
        )
        var other = eachProject
        other.id = "p2"
        other.projectPath = "/tmp/b"
        XCTAssertNoThrow(try ControlledMemoryStore.validateCaps([eachProject, other]))
    }

    @MainActor
    func testAddReplaceRemoveDiffApprovalAndReject() throws {
        let root = temporaryRoot()
        let store = ControlledMemoryStore(rootURL: root)
        let add = proposal()
        try writeProposal(add, root: root)
        store.refresh()
        XCTAssertEqual(store.proposals.first?.source.proposedAt, add.source.proposedAt)
        XCTAssertEqual(try store.diff(for: add), .init(before: nil, after: add.content))
        try store.approve(add)
        let entry = try XCTUnwrap(store.entries.first)
        XCTAssertEqual(entry.source.sessionID, "session-1")

        let replace = proposal(
            id: "proposal-2", operation: .replace,
            content: "prefers exact evidence", targetID: entry.id
        )
        try writeProposal(replace, root: root)
        store.refresh()
        XCTAssertEqual(
            try store.diff(for: replace),
            .init(before: "likes concise answers", after: "prefers exact evidence")
        )
        try store.approve(replace)
        XCTAssertEqual(store.entries.first?.content, "prefers exact evidence")

        let remove = proposal(
            id: "proposal-3", operation: .remove,
            content: nil, targetID: entry.id
        )
        try writeProposal(remove, root: root)
        store.refresh()
        XCTAssertEqual(
            try store.diff(for: remove),
            .init(before: "prefers exact evidence", after: nil)
        )
        try store.reject(remove)
        XCTAssertEqual(store.entries.count, 1, "reject must never mutate approved.json")
        XCTAssertTrue(store.proposals.isEmpty)
    }

    @MainActor
    func testProjectUsageFiltersByNormalizedProjectPath() throws {
        let root = temporaryRoot()
        let store = ControlledMemoryStore(rootURL: root)
        let first = proposal(id: "a", scope: .project, content: "abc", project: "/tmp/a/../a")
        try writeProposal(first, root: root)
        store.refresh(); try store.approve(first)
        XCTAssertEqual(store.usage(scope: .project, projectPath: "/tmp/a").used, 3)
        XCTAssertEqual(store.usage(scope: .project, projectPath: "/tmp/b").used, 0)
    }

    @MainActor
    func testProcessedLedgerMakesAddReplaceAndRemoveRetriesIdempotent() throws {
        let root = temporaryRoot()
        let store = ControlledMemoryStore(rootURL: root)
        let add = proposal(id: "add-once")
        try writeProposal(add, root: root)
        store.refresh(); try store.approve(add)
        let entryID = try XCTUnwrap(store.entries.first?.id)

        // Simulate a crash after approved.json committed but before pending unlink.
        try writeProposal(add, root: root)
        store.refresh(); try store.approve(add)
        XCTAssertEqual(store.entries.count, 1)

        let replace = proposal(
            id: "replace-once", operation: .replace,
            content: "replacement", targetID: entryID
        )
        try writeProposal(replace, root: root)
        store.refresh(); try store.approve(replace)
        try writeProposal(replace, root: root)
        store.refresh(); try store.approve(replace)
        XCTAssertEqual(store.entries.map(\.content), ["replacement"])

        let remove = proposal(
            id: "remove-once", operation: .remove,
            content: nil, targetID: entryID
        )
        try writeProposal(remove, root: root)
        store.refresh(); try store.approve(remove)
        try writeProposal(remove, root: root)
        store.refresh()
        XCTAssertNoThrow(try store.approve(remove), "retry must clean pending without resolving removed target")
        XCTAssertTrue(store.entries.isEmpty)
    }

    func testFrozenSnapshotPolicyReusesSameSessionAndNewSessionGetsFreshValue() {
        XCTAssertEqual(ControlledMemorySnapshotPolicy.frozen(existing: "old", approvedNow: "new"), "old")
        XCTAssertEqual(ControlledMemorySnapshotPolicy.frozen(existing: nil, approvedNow: "new"), "new")
    }
}
