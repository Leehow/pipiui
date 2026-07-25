import XCTest
@testable import PipiUI

final class DraftPasteCollapseTests: XCTestCase {

    // MARK: - Threshold

    func testSmallTextIsNotLarge() {
        let text = String(repeating: "a", count: 1000)
        XCTAssertFalse(DraftPasteCollapse.isLargePaste(text))
    }

    func testOver1000CharsIsLarge() {
        let text = String(repeating: "a", count: 1001)
        XCTAssertTrue(DraftPasteCollapse.isLargePaste(text))
    }

    func testElevenLinesIsLargeEvenIfShort() {
        let text = (0..<11).map { "\($0)" }.joined(separator: "\n")
        XCTAssertTrue(DraftPasteCollapse.isLargePaste(text))
    }

    func testTenLinesUnderCharLimitIsNotLarge() {
        let text = (0..<10).map { "\($0)" }.joined(separator: "\n")
        XCTAssertFalse(DraftPasteCollapse.isLargePaste(text))
    }

    // MARK: - Marker format

    func testMarkerUsesLinesWhenOverTenLines() {
        let marker = DraftPasteCollapse.makeMarker(id: 1, lineCount: 50, charCount: 200)
        XCTAssertEqual(marker, "[paste #1 +50 lines]")
    }

    func testMarkerUsesCharsWhenNotOverTenLines() {
        let marker = DraftPasteCollapse.makeMarker(id: 2, lineCount: 1, charCount: 1500)
        XCTAssertEqual(marker, "[paste #2 1500 chars]")
    }

    // MARK: - Expand

    func testExpandReplacesSingleMarker() {
        let body = String(repeating: "x", count: 1200)
        let marker = DraftPasteCollapse.makeMarker(id: 1, lineCount: 1, charCount: body.count)
        let draft = "prefix \(marker) suffix"
        let expanded = DraftPasteCollapse.expandPasteMarkers(text: draft, pastes: [1: body])
        XCTAssertEqual(expanded, "prefix \(body) suffix")
    }

    func testExpandMultipleMarkers() {
        let a = "AAAA"
        let b = "BBBB"
        let m1 = DraftPasteCollapse.makeMarker(id: 1, lineCount: 1, charCount: a.count)
        let m2 = DraftPasteCollapse.makeMarker(id: 2, lineCount: 20, charCount: b.count)
        let draft = "\(m1) and \(m2)"
        let expanded = DraftPasteCollapse.expandPasteMarkers(text: draft, pastes: [1: a, 2: b])
        XCTAssertEqual(expanded, "AAAA and BBBB")
    }

    func testExpandLeavesTextUnchangedWithoutMarkers() {
        let text = "hello world"
        let expanded = DraftPasteCollapse.expandPasteMarkers(text: text, pastes: [1: "secret"])
        XCTAssertEqual(expanded, text)
    }

    func testExpandLeavesUnknownMarkerLiteral() {
        let draft = "[paste #9 +3 lines]"
        let expanded = DraftPasteCollapse.expandPasteMarkers(text: draft, pastes: [1: "nope"])
        XCTAssertEqual(expanded, draft)
    }

    // MARK: - Prune

    func testPruneRemovesOrphans() {
        let m1 = DraftPasteCollapse.makeMarker(id: 1, lineCount: 1, charCount: 1001)
        let pastes = [1: "a", 2: "b"]
        let pruned = DraftPasteCollapse.pruneOrphanPastes(text: "keep \(m1)", pastes: pastes)
        XCTAssertEqual(pruned.keys.sorted(), [1])
        XCTAssertEqual(pruned[1], "a")
    }

    func testPruneKeepsAllPresent() {
        let m1 = DraftPasteCollapse.makeMarker(id: 1, lineCount: 1, charCount: 1001)
        let m2 = DraftPasteCollapse.makeMarker(id: 2, lineCount: 20, charCount: 10)
        let pastes = [1: "a", 2: "b"]
        let pruned = DraftPasteCollapse.pruneOrphanPastes(text: "\(m1)\n\(m2)", pastes: pastes)
        XCTAssertEqual(Set(pruned.keys), [1, 2])
    }
}
