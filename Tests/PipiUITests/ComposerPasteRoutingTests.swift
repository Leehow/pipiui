import XCTest
import AppKit
@testable import PipiUI

final class ComposerPasteRoutingTests: XCTestCase {
    private func makeSession(_ id: String) -> ChatSession {
        ChatSession(
            id: id,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test-only"
        )
    }

    private func makeImage() -> DraftImage {
        DraftImage(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            data: Data([0x89, 0x50, 0x4E, 0x47]),
            mimeType: "image/png",
            preview: NSImage(size: NSSize(width: 1, height: 1))
        )
    }

    func testInsertMarkerAppendsWhenNoApplicationIsRunning() {
        XCTAssertNil(NSApp)

        var draftText = "before"
        let marker = "[paste #1 1001 chars]"

        ComposerPasteInsertion.insertMarker(marker, draftText: &draftText)

        XCTAssertEqual(draftText, "before[paste #1 1001 chars]")
    }

    func testBindingDoesNotRetainSession() {
        let router = ComposerPasteRouter()
        weak var releasedSession: ChatSession?
        var session: ChatSession? = makeSession("paste-routing-lifetime")

        releasedSession = session
        router.bind(to: session!)
        session = nil

        XCTAssertNil(releasedSession)
    }

    func testRebindingRoutesImagesOnlyToLatestSession() {
        let sessionA = makeSession("paste-routing-A")
        let sessionB = makeSession("paste-routing-B")
        let image = makeImage()
        let router = ComposerPasteRouter()

        router.bind(to: sessionA)
        router.bind(to: sessionB)
        router.route(images: [image])

        XCTAssertTrue(sessionA.draftImages.isEmpty)
        XCTAssertEqual(sessionB.draftImages.map(\.id), [image.id])
    }

    func testRebindingRoutesLargePasteMarkerAndBodyOnlyToLatestSession() {
        let sessionA = makeSession("paste-routing-A")
        let sessionB = makeSession("paste-routing-B")
        let body = String(repeating: "x", count: 1001)
        let expectedMarker = DraftPasteCollapse.makeMarker(
            id: 1,
            lineCount: 1,
            charCount: body.count
        )
        let router = ComposerPasteRouter()

        router.bind(to: sessionA)
        router.bind(to: sessionB)
        router.routeLargeText(body)

        XCTAssertEqual(sessionA.draftText, "")
        XCTAssertEqual(sessionA.draftPastes, [:])
        XCTAssertEqual(sessionB.draftText, expectedMarker)
        XCTAssertEqual(sessionB.draftPastes, [1: body])
        XCTAssertEqual(sessionB.expandedDraftText(from: sessionB.draftText), body)
    }
}
