import XCTest
@testable import PipiUI

final class LocalRemoteWebTests: XCTestCase {
    func testOpaqueRegistryNeverUsesLocalPathsAsIDs() {
        let registry = RemoteObjectIDRegistry()
        let projectPath = "/Users/private-name/secret-project"
        let sessionPath = "\(projectPath)/session.jsonl"

        let projectID = registry.projectID(forPath: projectPath)
        let sessionID = registry.sessionID(for: .historical(
            projectPath: projectPath,
            sessionPath: sessionPath
        ))

        XCTAssertTrue(projectID.hasPrefix("p_"))
        XCTAssertTrue(sessionID.hasPrefix("s_"))
        XCTAssertFalse(projectID.contains(projectPath))
        XCTAssertFalse(sessionID.contains(projectPath))
        XCTAssertFalse(sessionID.contains("session.jsonl"))
        XCTAssertEqual(registry.projectPath(forID: projectID), projectPath)
        XCTAssertEqual(
            registry.sessionLocator(forID: sessionID),
            .historical(projectPath: projectPath, sessionPath: sessionPath)
        )
        XCTAssertNotEqual(projectID, sessionID)
    }

    func testBackgroundSelectionInvariantDetectsEitherDesktopMutation() {
        let snapshot = RemoteDesktopSelectionState(
            projectPath: "/project/selected",
            sessionKey: "selected-session"
        )
        XCTAssertTrue(snapshot.matches(
            projectPath: "/project/selected",
            sessionKey: "selected-session"
        ))
        XCTAssertFalse(snapshot.matches(
            projectPath: "/project/other",
            sessionKey: "selected-session"
        ))
        XCTAssertFalse(snapshot.matches(
            projectPath: "/project/selected",
            sessionKey: "other-session"
        ))
    }

    func testRemoteBuiltinSlashCommandsAreRejectedButUnknownCommandsPass() {
        for builtin in BuiltinCommands.all {
            XCTAssertEqual(
                RemotePromptPolicy.rejectedBuiltinName(in: "/\(builtin.name) argument"),
                builtin.name
            )
        }
        XCTAssertNil(RemotePromptPolicy.rejectedBuiltinName(in: "/subagent do work"))
        XCTAssertNil(RemotePromptPolicy.rejectedBuiltinName(in: "explain /new"))
    }

    func testChatSessionRemoteSubmissionSeamRejectsBuiltinAndAcceptsUnknownSlash() {
        let session = ChatSession(
            id: "remote-test-session",
            projectURL: URL(fileURLWithPath: "/tmp/remote-test-project"),
            sessionPath: nil,
            blockedReason: "test-only"
        )
        defer { session.shutdown() }

        XCTAssertEqual(session.submitRemotePrompt("/new"), .rejectedBuiltin("new"))
        XCTAssertTrue(session.transcript.isEmpty)

        XCTAssertEqual(session.submitRemotePrompt("/extension_command go"), .accepted)
        XCTAssertEqual(session.transcript.count, 1)
        XCTAssertEqual(session.transcript.first?.role, "user")
    }

    func testRemoteStopCannotStickIdleSessionInStoppingState() {
        let session = ChatSession(
            id: "remote-stop-test-session",
            projectURL: URL(fileURLWithPath: "/tmp/remote-stop-test-project"),
            sessionPath: nil,
            blockedReason: "test-only"
        )
        defer { session.shutdown() }

        XCTAssertFalse(session.abortRemoteGeneration())
        XCTAssertFalse(session.isStopping)
        session.isStreaming = true
        XCTAssertTrue(session.abortRemoteGeneration())
        XCTAssertTrue(session.isStopping)
    }

    func testIdempotencyCacheIsBoundedAndExpires() {
        var cache = RemotePromptIdempotencyCache(capacity: 2, lifetime: 10)
        let start = Date(timeIntervalSince1970: 100)
        cache.insert("one", now: start)
        cache.insert("two", now: start)
        XCTAssertTrue(cache.contains("one", now: start))
        cache.insert("three", now: start)
        XCTAssertFalse(cache.contains("one", now: start))
        XCTAssertTrue(cache.contains("two", now: start))
        XCTAssertFalse(cache.contains("two", now: start.addingTimeInterval(11)))
    }

    func testRemoteAuthorizationPolicySurvivesQueueDrainAndRetry() {
        var queue = SessionMessageQueue()
        XCTAssertTrue(queue.enqueue(
            text: "remote",
            recordsSearchScopeGrant: false
        ))
        let popped = queue.popForIdleDrain(isStreaming: false, processAlive: true)
        XCTAssertEqual(popped?.text, "remote")
        XCTAssertEqual(popped?.recordsSearchScopeGrant, false)
        if let popped {
            queue.requeueFront(popped)
        }
        XCTAssertEqual(
            queue.popForIdleDrain(isStreaming: false, processAlive: true)?
                .recordsSearchScopeGrant,
            false
        )
    }

    func testHTTPParserAcceptsBoundedRequestAndRejectsBodyLimit() {
        let good = Data(
            "POST /api/send HTTP/1.1\r\nHost: 127.0.0.1:1234\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}"
                .utf8
        )
        guard case .complete(let request) = LocalRemoteHTTPRequestParser.parse(good) else {
            return XCTFail("expected complete request")
        }
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/api/send")
        XCTAssertEqual(request.body, Data("{}".utf8))

        let tooLarge = Data(
            "POST /api/send HTTP/1.1\r\nHost: 127.0.0.1:1234\r\nContent-Length: \(LocalRemoteRequestLimits.maximumBodyBytes + 1)\r\n\r\n"
                .utf8
        )
        guard case .invalid(let status, _) = LocalRemoteHTTPRequestParser.parse(tooLarge) else {
            return XCTFail("expected rejection")
        }
        XCTAssertEqual(status, 413)
    }

    func testHTTPPolicyRequiresTokenAndSameOrigin() {
        let token = String(repeating: "a", count: 64)
        let base = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/api/index",
            headers: ["host": "127.0.0.1:1234"],
            body: Data()
        )
        XCTAssertEqual(
            LocalRemoteRequestPolicy.authorizationError(
                for: base,
                expectedToken: token,
                port: 1234
            )?.status,
            401
        )

        let wrongOrigin = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/api/index",
            headers: [
                "host": "127.0.0.1:1234",
                "origin": "https://example.com",
                LocalRemoteWebPage.tokenHeader.lowercased(): token,
            ],
            body: Data()
        )
        XCTAssertEqual(
            LocalRemoteRequestPolicy.authorizationError(
                for: wrongOrigin,
                expectedToken: token,
                port: 1234
            )?.status,
            403
        )

        let valid = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/api/index",
            headers: [
                "host": "127.0.0.1:1234",
                "origin": "http://127.0.0.1:1234",
                LocalRemoteWebPage.tokenHeader.lowercased(): token,
            ],
            body: Data()
        )
        XCTAssertNil(LocalRemoteRequestPolicy.authorizationError(
            for: valid,
            expectedToken: token,
            port: 1234
        ))
    }

    func testOnlyDocumentedRoutesAndMethodsAreAccepted() {
        let unknown = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/api/unknown",
            headers: [:],
            body: Data()
        )
        XCTAssertEqual(LocalRemoteRoutes.rejection(for: unknown)?.status, 404)

        let wrongMethod = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/api/send",
            headers: [:],
            body: Data()
        )
        XCTAssertEqual(LocalRemoteRoutes.rejection(for: wrongMethod)?.status, 405)

        let valid = LocalRemoteHTTPRequest(
            method: "POST",
            path: "/api/send",
            headers: [:],
            body: Data()
        )
        XCTAssertNil(LocalRemoteRoutes.rejection(for: valid))
    }

    func testTranscriptNormalizationIsTextOnlyAndRedactsKnownPaths() {
        let items = [
            ChatItem(
                id: "internal-user-id",
                role: "user",
                blocks: [
                    .text("inspect /Users/alice/project/file.swift"),
                    .image(ImageBlock(
                        id: "image-id",
                        data: Data([1, 2, 3]),
                        mimeType: "image/png",
                        path: "/Users/alice/project/image.png"
                    )),
                ]
            ),
            ChatItem(
                id: "internal-assistant-id",
                role: "assistant",
                blocks: [.text("stored under /Users/alice/other")]
            ),
        ]
        let messages = RemoteTranscriptNormalizer.normalizedMessages(
            items,
            projectPath: "/Users/alice/project",
            homeDirectory: "/Users/alice"
        )

        XCTAssertEqual(messages.map(\.id), ["m-0", "m-1"])
        XCTAssertFalse(messages[0].text.contains("/Users/alice"))
        XCTAssertFalse(messages[0].text.contains("image.png"))
        XCTAssertEqual(messages[0].text, "inspect [local path]")
        XCTAssertEqual(messages[1].text, "stored under [local path]")
    }

    func testWebPageUsesSafeDOMAndDoesNotPutTokenInURL() throws {
        let token = String(repeating: "b", count: 64)
        let html = try XCTUnwrap(String(
            data: LocalRemoteWebPage.render(token: token, nonce: "nonce"),
            encoding: .utf8
        ))
        XCTAssertTrue(html.contains("textContent"))
        XCTAssertTrue(html.contains("replaceChildren"))
        XCTAssertFalse(html.contains("innerHTML"))
        XCTAssertFalse(html.contains("?\(token)"))
        XCTAssertFalse(html.contains("#\(token)"))
        XCTAssertTrue(html.contains(#""X-PipiUI-Remote-Token": token"#))
    }

    func testLocalRemoteSettingDefaultsOff() throws {
        let suiteName = "LocalRemoteWebTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        XCTAssertFalse(LocalRemoteSettings.isEnabled(defaults: defaults))
        LocalRemoteSettings.setEnabled(true, defaults: defaults)
        XCTAssertTrue(LocalRemoteSettings.isEnabled(defaults: defaults))
    }
}
