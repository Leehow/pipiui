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
        let router = ComposerSessionRouter()
        weak var releasedSession: ChatSession?
        var session: ChatSession? = makeSession("paste-routing-lifetime")

        releasedSession = session
        router.bind(to: session!)
        session = nil

        XCTAssertNil(releasedSession)
    }

    func testInstalledPersistentCallbacksDoNotRetainBoundSession() {
        let router = ComposerSessionRouter()
        let pasteCatcher = ComposerPasteCatcher()
        let slashKeyMonitor = ComposerSlashKeyMonitor()
        weak var releasedSession: ChatSession?
        var session: ChatSession? = makeSession("callback-routing-lifetime")

        releasedSession = session
        router.bind(to: session!)
        ComposerPersistentCallbackBinder.install(
            pasteCatcher: pasteCatcher,
            slashKeyMonitor: slashKeyMonitor,
            router: router
        )
        session = nil

        XCTAssertNil(releasedSession)
    }

    func testRebindingRoutesImagesOnlyToLatestSession() {
        let sessionA = makeSession("paste-routing-A")
        let sessionB = makeSession("paste-routing-B")
        let image = makeImage()
        let router = ComposerSessionRouter()

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
        let router = ComposerSessionRouter()

        router.bind(to: sessionA)
        router.bind(to: sessionB)
        router.routeLargeText(body)

        XCTAssertEqual(sessionA.draftText, "")
        XCTAssertEqual(sessionA.draftPastes, [:])
        XCTAssertEqual(sessionB.draftText, expectedMarker)
        XCTAssertEqual(sessionB.draftPastes, [1: body])
        XCTAssertEqual(sessionB.expandedDraftText(from: sessionB.draftText), body)
    }

    func testAsyncDropCompletionAfterRebindRoutesOnlyToLatestSession() {
        let sessionA = makeSession("drop-routing-A")
        let sessionB = makeSession("drop-routing-B")
        let image = makeImage()
        let router = ComposerSessionRouter()

        router.bind(to: sessionA)
        let delayedCompletion = { [router] in
            router.appendResults([.success(image)])
        }
        router.bind(to: sessionB)
        delayedCompletion()

        XCTAssertTrue(sessionA.draftImages.isEmpty)
        XCTAssertEqual(sessionB.draftImages.map(\.id), [image.id])
        XCTAssertNil(router.attachError)
    }

    func testInstalledPasteCallbacksAfterRebindRouteImageAndLargeTextOnlyToLatestSession() {
        let sessionA = makeSession("paste-callback-A")
        let sessionB = makeSession("paste-callback-B")
        let image = makeImage()
        let body = String(repeating: "p", count: 1001)
        let router = ComposerSessionRouter()
        let pasteCatcher = ComposerPasteCatcher()
        let slashKeyMonitor = ComposerSlashKeyMonitor()

        router.bind(to: sessionA)
        ComposerPersistentCallbackBinder.install(
            pasteCatcher: pasteCatcher,
            slashKeyMonitor: slashKeyMonitor,
            router: router
        )
        router.bind(to: sessionB)
        pasteCatcher.onPasteImages([image])
        pasteCatcher.onPasteLargeText(body)

        XCTAssertTrue(sessionA.draftImages.isEmpty)
        XCTAssertEqual(sessionA.draftText, "")
        XCTAssertEqual(sessionA.draftPastes, [:])
        XCTAssertEqual(sessionB.draftImages.map(\.id), [image.id])
        XCTAssertEqual(sessionB.expandedDraftText(from: sessionB.draftText), body)
    }

    func testSlashTabCompletionAfterRebindMutatesOnlyLatestSession() {
        let sessionA = makeSession("slash-tab-A")
        let sessionB = makeSession("slash-tab-B")
        let router = ComposerSessionRouter()
        sessionA.draftText = "/old"
        sessionB.draftText = "/name"

        router.bind(to: sessionA)
        router.bind(to: sessionB)
        router.refreshSlashPalette(disabledSkills: [])

        XCTAssertTrue(router.completeSelectedSlash())
        XCTAssertEqual(sessionA.draftText, "/old")
        XCTAssertEqual(sessionB.draftText, "/name ")
    }

    func testInstalledSlashTabCallbackAfterRebindUsesLatestSessionAndDeactivatesMonitor() {
        let sessionA = makeSession("slash-tab-callback-A")
        let sessionB = makeSession("slash-tab-callback-B")
        let router = ComposerSessionRouter()
        let pasteCatcher = ComposerPasteCatcher()
        let slashKeyMonitor = ComposerSlashKeyMonitor()
        sessionA.draftText = "/old"

        router.bind(to: sessionA)
        ComposerPersistentCallbackBinder.install(
            pasteCatcher: pasteCatcher,
            slashKeyMonitor: slashKeyMonitor,
            router: router
        )
        router.bind(to: sessionB)
        sessionB.draftText = "/name"
        router.refreshSlashPalette(disabledSkills: [])
        slashKeyMonitor.isActive = true
        slashKeyMonitor.onTab()

        XCTAssertEqual(sessionA.draftText, "/old")
        XCTAssertEqual(sessionB.draftText, "/name ")
        XCTAssertFalse(slashKeyMonitor.isActive)
    }

    func testBuiltinSlashReturnAfterRebindExecutesOnlyOnLatestSession() {
        let sessionA = makeSession("slash-builtin-A")
        let sessionB = makeSession("slash-builtin-B")
        let router = ComposerSessionRouter()
        var newACount = 0
        var newBCount = 0
        sessionA.onRequestNewSession = { newACount += 1 }
        sessionB.onRequestNewSession = { newBCount += 1 }
        sessionA.draftText = "/new"
        sessionB.draftText = "/new"

        router.bind(to: sessionA)
        router.bind(to: sessionB)
        router.refreshSlashPalette(disabledSkills: [])

        XCTAssertTrue(router.executeSelectedSlash())
        XCTAssertEqual(newACount, 0)
        XCTAssertEqual(newBCount, 1)
        XCTAssertEqual(sessionA.draftText, "/new")
        XCTAssertEqual(sessionB.draftText, "")
    }

    func testServerSlashReturnAfterRebindQueuesOnlyOnLatestSession() {
        let sessionA = makeSession("slash-server-A")
        let sessionB = makeSession("slash-server-B")
        let command = SlashCommand(
            name: "fix-tests",
            description: "Fix tests",
            source: .prompt,
            argumentHint: nil
        )
        let router = ComposerSessionRouter()
        sessionA.draftText = "/fix-tests-old"
        sessionB.draftText = "/fix-tests"
        sessionB.availableCommands = [command]
        sessionB.processAlive = true
        sessionB.isStreaming = true

        router.bind(to: sessionA)
        router.bind(to: sessionB)
        router.refreshSlashPalette(disabledSkills: [])

        XCTAssertTrue(router.executeSelectedSlash())
        XCTAssertEqual(sessionA.draftText, "/fix-tests-old")
        XCTAssertTrue(sessionA.messageQueue.isEmpty)
        XCTAssertEqual(sessionB.draftText, "")
        XCTAssertEqual(sessionB.messageQueue.map(\.text), ["/fix-tests"])
    }

    func testInstalledSlashReturnCallbackAfterRebindHandlesOnceOnLatestSession() {
        let sessionA = makeSession("slash-return-callback-A")
        let sessionB = makeSession("slash-return-callback-B")
        let command = SlashCommand(
            name: "fix-tests",
            description: "Fix tests",
            source: .prompt,
            argumentHint: nil
        )
        let router = ComposerSessionRouter()
        let pasteCatcher = ComposerPasteCatcher()
        let slashKeyMonitor = ComposerSlashKeyMonitor()
        sessionA.draftText = "/old"
        sessionB.availableCommands = [command]
        sessionB.processAlive = true
        sessionB.isStreaming = true

        router.bind(to: sessionA)
        ComposerPersistentCallbackBinder.install(
            pasteCatcher: pasteCatcher,
            slashKeyMonitor: slashKeyMonitor,
            router: router
        )
        router.bind(to: sessionB)
        sessionB.draftText = "/fix-tests"
        router.refreshSlashPalette(disabledSkills: [])
        slashKeyMonitor.isActive = true

        XCTAssertTrue(slashKeyMonitor.onReturn())
        XCTAssertFalse(slashKeyMonitor.isActive)
        XCTAssertEqual(sessionA.draftText, "/old")
        XCTAssertTrue(sessionA.messageQueue.isEmpty)
        XCTAssertEqual(sessionB.messageQueue.map(\.text), ["/fix-tests"])
        XCTAssertFalse(router.send())
        XCTAssertEqual(sessionB.messageQueue.map(\.text), ["/fix-tests"])
    }

    func testNormalSendAfterRebindQueuesOnlyLatestSessionDraft() {
        let sessionA = makeSession("send-routing-A")
        let sessionB = makeSession("send-routing-B")
        let router = ComposerSessionRouter()
        sessionA.draftText = "message A"
        sessionB.draftText = "message B"
        sessionB.processAlive = true
        sessionB.isStreaming = true

        router.bind(to: sessionA)
        let staleAction = { [router] in router.send() }
        router.bind(to: sessionB)

        XCTAssertTrue(staleAction())
        XCTAssertEqual(sessionA.draftText, "message A")
        XCTAssertTrue(sessionA.messageQueue.isEmpty)
        XCTAssertEqual(sessionB.draftText, "")
        XCTAssertEqual(sessionB.messageQueue.map(\.text), ["message B"])
    }

    func testClearAttachErrorDismissesCurrentError() {
        let session = makeSession("attach-error-clear")
        let router = ComposerSessionRouter()
        router.bind(to: session)
        router.appendResults([.failure(.corrupt)])

        XCTAssertEqual(router.attachError, ImageAttachment.LoadError.corrupt.localizedDescription)

        router.clearAttachError()

        XCTAssertNil(router.attachError)
    }
}
