import XCTest
@testable import PipiUI

final class SessionMetadataProgressiveLoadPlanTests: XCTestCase {
    private func file(
        _ path: String,
        _ seconds: TimeInterval,
        archived: Bool = false,
        pinned: Bool = false
    ) -> SessionMetadataProgressiveLoadPlan.File {
        .init(
            path: path,
            modified: Date(timeIntervalSince1970: seconds),
            isArchived: archived,
            isPinned: pinned
        )
    }

    func testFirstBatchIncludesPinnedThenNewestActiveViewport() {
        let files = [
            file("old", 1), file("new", 5), file("pinned-old", 2, pinned: true),
            file("pinned-new", 4, pinned: true), file("archive", 99, archived: true),
            file("middle", 3),
        ]

        let batches = SessionMetadataProgressiveLoadPlan.batches(
            files: files,
            firstBatchMinimum: 2,
            backgroundBatchSize: 2
        )

        XCTAssertEqual(batches[0].map(\.path), ["pinned-new", "pinned-old", "new", "middle"])
        XCTAssertEqual(batches[1].map(\.path), ["archive", "old"])
    }

    func testRemainingBatchesCoverEveryFileOnce() {
        let files = (0..<17).map { file("s\($0)", TimeInterval($0)) }
        let batches = SessionMetadataProgressiveLoadPlan.batches(
            files: files,
            firstBatchMinimum: 5,
            backgroundBatchSize: 4
        )
        let paths = batches.flatMap { $0.map(\.path) }

        XCTAssertEqual(paths.count, files.count)
        XCTAssertEqual(Set(paths), Set(files.map(\.path)))
        XCTAssertEqual(Set(paths).count, paths.count)
        XCTAssertEqual(batches.map(\.count), [5, 4, 4, 4])
    }

    func testStaleGenerationCannotPublishOverNewGeneration() {
        XCTAssertFalse(SessionMetadataProgressiveLoadPlan.acceptsPublish(
            candidateGeneration: 7,
            currentGeneration: 8
        ))
        XCTAssertTrue(SessionMetadataProgressiveLoadPlan.acceptsPublish(
            candidateGeneration: 8,
            currentGeneration: 8
        ))
    }

    func testFinalOrderingRemainsModifiedDescendingRegardlessOfBatchPriority() {
        let files = [
            file("normal-old", 1),
            file("pinned", 2, pinned: true),
            file("normal-new", 3),
            file("archive-newest", 4, archived: true),
        ]
        let batches = SessionMetadataProgressiveLoadPlan.batches(
            files: files,
            firstBatchMinimum: 1,
            backgroundBatchSize: 1
        )
        let parsed = Dictionary(uniqueKeysWithValues: batches.flatMap { $0 }.map { ($0.path, $0) })
        let finalActive = parsed.values.filter { !$0.isArchived }.sorted {
            if $0.modified != $1.modified { return $0.modified > $1.modified }
            return $0.path < $1.path
        }
        let finalArchived = parsed.values.filter(\.isArchived).sorted { $0.modified > $1.modified }

        XCTAssertEqual(finalActive.map(\.path), ["normal-new", "pinned", "normal-old"])
        XCTAssertEqual(finalArchived.map(\.path), ["archive-newest"])
    }
}
