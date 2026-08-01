import XCTest
@testable import PipiUI

final class ComposerPDFIngestionRoutingTests: XCTestCase {
    func testDelayedPDFDropUsesCapturedSourceSessionAndProject() {
        let projectA = URL(fileURLWithPath: "/tmp/pdf-drop-project-A")
        let projectB = URL(fileURLWithPath: "/tmp/pdf-drop-project-B")
        let sessionA = makeSession("pdf-drop-A", projectURL: projectA)
        let sessionB = makeSession("pdf-drop-B", projectURL: projectB)
        let sourceURL = URL(fileURLWithPath: "/tmp/delayed-drop.PDF")
        let router = ComposerSessionRouter()

        router.bind(to: sessionA)
        let capturedTarget = router.makePDFIngestionTarget(for: sessionA)
        // This mirrors a file provider that completes only after the visible
        // composer has switched from A to B.
        router.bind(to: sessionB)

        let executorStarted = expectation(description: "captured PDF executor starts")
        router.ingestPDFs(
            [sourceURL],
            target: capturedTarget,
            executor: { source, project, _ in
                XCTAssertEqual(source, sourceURL)
                XCTAssertEqual(project, projectA, "PDF must keep A's project root")
                executorStarted.fulfill()
                return self.makeBundle(sourceURL: source, projectURL: project)
            }
        )

        wait(for: [executorStarted], timeout: 1)
        waitUntil { sessionA.draftText.contains("[本地 PDF 已解析]") }

        XCTAssertTrue(sessionA.draftText.contains(projectA.path))
        XCTAssertFalse(sessionA.draftText.contains(projectB.path))
        XCTAssertTrue(sessionB.draftText.isEmpty, "late PDF completion must not retarget to B")
        XCTAssertNil(router.pdfIngestionStatus, "B owns no A-originating status")
        XCTAssertNil(router.pdfIngestionError, "B owns no A-originating error")
    }

    func testPendingPDFPreventsModeLeakAndCompletionRejectsProgrammaticModeChange() {
        let projectA = URL(fileURLWithPath: "/tmp/pdf-mode-project-A")
        let sessionA = makeSession("pdf-mode-A", projectURL: projectA)
        let sourceURL = URL(fileURLWithPath: "/tmp/mode-change.pdf")
        let router = ComposerSessionRouter()
        let releaseExecutor = DispatchSemaphore(value: 0)
        let executorStarted = expectation(description: "executor waits")

        router.bind(to: sessionA)
        let target = router.makePDFIngestionTarget(for: sessionA)
        router.ingestPDFs(
            [sourceURL],
            target: target,
            executor: { source, project, progress in
                progress(.init(phase: .extracting, completedPages: 1, totalPages: 1))
                executorStarted.fulfill()
                releaseExecutor.wait()
                return self.makeBundle(sourceURL: source, projectURL: project)
            }
        )

        wait(for: [executorStarted], timeout: 1)
        XCTAssertTrue(router.isPDFIngestionPending(for: sessionA))
        XCTAssertFalse(router.canSend)

        // The UI disables its mode controls while pending. This direct mutation
        // models a future/programmatic bypass and verifies the completion guard.
        sessionA.composerMode = .generateImage
        releaseExecutor.signal()
        waitUntil { !router.isPDFIngestionPending(for: sessionA) }

        XCTAssertFalse(sessionA.draftText.contains("[本地 PDF 已解析]"))
        XCTAssertTrue(router.pdfIngestionError?.contains("未添加引用") == true)
    }

    func testPDFFailureStatusAndErrorStayWithCapturedSessionAfterRebind() {
        let projectA = URL(fileURLWithPath: "/tmp/pdf-error-project-A")
        let projectB = URL(fileURLWithPath: "/tmp/pdf-error-project-B")
        let sessionA = makeSession("pdf-error-A", projectURL: projectA)
        let sessionB = makeSession("pdf-error-B", projectURL: projectB)
        let sourceURL = URL(fileURLWithPath: "/tmp/error.pdf")
        let router = ComposerSessionRouter()
        let releaseExecutor = DispatchSemaphore(value: 0)
        let executorStarted = expectation(description: "failing executor waits")

        router.bind(to: sessionA)
        let target = router.makePDFIngestionTarget(for: sessionA)
        router.ingestPDFs(
            [sourceURL],
            target: target,
            executor: { _, project, progress in
                XCTAssertEqual(project, projectA)
                progress(.init(phase: .extracting, completedPages: 0, totalPages: 1))
                executorStarted.fulfill()
                releaseExecutor.wait()
                throw TestFailure.intentional
            }
        )

        wait(for: [executorStarted], timeout: 1)
        router.bind(to: sessionB)
        XCTAssertNil(router.pdfIngestionStatus)
        XCTAssertNil(router.pdfIngestionError)
        XCTAssertFalse(router.isPDFIngestionPending(for: sessionB))
        XCTAssertTrue(router.isPDFIngestionPending(for: sessionA))

        releaseExecutor.signal()
        waitUntil { !router.isPDFIngestionPending(for: sessionA) }

        XCTAssertTrue(sessionB.draftText.isEmpty)
        XCTAssertNil(router.pdfIngestionError, "B must not flash A's PDF error")
        router.bind(to: sessionA)
        XCTAssertTrue(router.pdfIngestionError?.contains("intentional PDF failure") == true)
    }

    func testReleasedSourceSessionDuringPDFIngestionIsDiscardedInsteadOfRetargeted() {
        let projectA = URL(fileURLWithPath: "/tmp/pdf-released-project-A")
        let projectB = URL(fileURLWithPath: "/tmp/pdf-released-project-B")
        let sessionB = makeSession("pdf-released-B", projectURL: projectB)
        let router = ComposerSessionRouter()
        var sessionA: ChatSession? = makeSession("pdf-released-A", projectURL: projectA)
        weak var releasedSession: ChatSession?
        releasedSession = sessionA
        let sourceURL = URL(fileURLWithPath: "/tmp/released.pdf")
        let executorStarted = expectation(description: "executor waits before source release")
        let releaseExecutor = DispatchSemaphore(value: 0)

        let target = router.makePDFIngestionTarget(for: sessionA!)
        router.bind(to: sessionA!)
        router.ingestPDFs(
            [sourceURL],
            target: target,
            executor: { source, project, _ in
                executorStarted.fulfill()
                releaseExecutor.wait()
                return self.makeBundle(sourceURL: source, projectURL: project)
            }
        )

        wait(for: [executorStarted], timeout: 1)
        router.bind(to: sessionB)
        sessionA = nil
        XCTAssertNil(releasedSession)
        XCTAssertNil(target.session)

        releaseExecutor.signal()
        let completionQueueDrained = expectation(description: "PDF completion drains on main queue")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            completionQueueDrained.fulfill()
        }
        wait(for: [completionQueueDrained], timeout: 1)

        XCTAssertTrue(sessionB.draftText.isEmpty)
        XCTAssertNil(router.pdfIngestionStatus)
        XCTAssertNil(router.pdfIngestionError)
    }

    private func makeSession(_ id: String, projectURL: URL) -> ChatSession {
        ChatSession(
            id: id,
            projectURL: projectURL,
            sessionPath: nil,
            blockedReason: "test-only"
        )
    }

    private func makeBundle(
        sourceURL: URL,
        projectURL: URL
    ) -> NativePDFIngestion.SourceBundle {
        let directoryURL = projectURL
            .appendingPathComponent(".pi/pdf-sources/test-hash", isDirectory: true)
        return NativePDFIngestion.SourceBundle(
            selectedSourceURL: sourceURL,
            immutablePDFURL: directoryURL.appendingPathComponent(
                NativePDFIngestion.immutablePDFFileName
            ),
            directoryURL: directoryURL,
            manifestURL: directoryURL.appendingPathComponent("manifest.json"),
            documentURL: directoryURL.appendingPathComponent("document.md"),
            pagesDirectoryURL: directoryURL.appendingPathComponent("pages", isDirectory: true),
            contentSHA256: "test-hash",
            pages: [],
            reusedCache: false
        )
    }

    private func waitUntil(
        _ condition: @escaping () -> Bool,
        timeout: TimeInterval = 1
    ) {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition(), Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        XCTAssertTrue(condition(), "condition did not settle before timeout")
    }

    private enum TestFailure: LocalizedError {
        case intentional

        var errorDescription: String? { "intentional PDF failure" }
    }
}
