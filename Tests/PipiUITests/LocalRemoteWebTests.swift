import XCTest
import Network
@testable import PipiUI

final class LocalRemoteWebTests: XCTestCase {
    private func temporaryDirectory(_ prefix: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

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

    func testSelectionNeutralMutationChangesSessionStateWithoutChangingDesktopSelection() {
        let selection = RemoteDesktopSelectionState(
            projectPath: "/project/selected",
            sessionKey: "selected-session"
        )
        var openSessionKeys: [String] = []

        let inserted = RemoteSelectionNeutralMutation.perform(
            selection: { selection },
            mutation: {
                openSessionKeys.append("background-session")
                return openSessionKeys[0]
            }
        )

        XCTAssertEqual(inserted, "background-session")
        XCTAssertEqual(openSessionKeys, ["background-session"])
        XCTAssertEqual(selection.projectPath, "/project/selected")
        XCTAssertEqual(selection.sessionKey, "selected-session")
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

    func testChatSessionRemoteSubmissionRejectsUnavailableBeforeOptimisticMutation() {
        let session = ChatSession(
            id: "remote-test-session",
            projectURL: URL(fileURLWithPath: "/tmp/remote-test-project"),
            sessionPath: nil,
            blockedReason: "test-only"
        )
        defer { session.shutdown() }

        XCTAssertEqual(session.submitRemotePrompt("/new"), .rejectedBuiltin("new"))
        XCTAssertTrue(session.transcript.isEmpty)

        XCTAssertEqual(session.submitRemotePrompt("/extension_command go"), .unavailable)
        XCTAssertTrue(session.transcript.isEmpty)
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

    func testAllSearchGrantPoliciesSurviveQueueDrainAndRetry() {
        var queue = SessionMessageQueue()
        let policies: [PromptSearchGrantPolicy] = [
            .localHumanRecordPromptPaths,
            .appAuthoredPreserveLatestHumanGrant,
            .remoteClearGrant,
        ]
        for (index, policy) in policies.enumerated() {
            XCTAssertTrue(queue.enqueue(
                text: "message-\(index)",
                searchGrantPolicy: policy
            ))
        }
        for policy in policies {
            let popped = queue.popForIdleDrain(isStreaming: false, processAlive: true)
            XCTAssertEqual(popped?.searchGrantPolicy, policy)
            if let popped {
                queue.requeueFront(popped)
                XCTAssertEqual(
                    queue.popForIdleDrain(isStreaming: false, processAlive: true)?
                        .searchGrantPolicy,
                    policy
                )
            }
        }
    }

    func testSearchGrantPoliciesRecordPreserveAndRemoteClearUsingRealGrantFile() throws {
        let stateRoot = try temporaryDirectory("pipiui-remote-grant-state")
        let projectRoot = try temporaryDirectory("pipiui-remote-grant-project")
        let sessionKey = "remote-policy-session"
        let grantURL = SearchScopeExtension.grantFileURL(
            sessionKey: sessionKey,
            baseDirectory: stateRoot
        )

        try SearchScopeExtension.applyPromptPolicy(
            .localHumanRecordPromptPaths,
            prompt: "inspect /sensitive/path",
            sessionKey: sessionKey,
            projectRoot: projectRoot,
            baseDirectory: stateRoot
        )
        XCTAssertEqual(
            try SearchScopeExtension.readGrantFile(at: grantURL).paths,
            ["/sensitive/path"]
        )

        try SearchScopeExtension.applyPromptPolicy(
            .appAuthoredPreserveLatestHumanGrant,
            prompt: "app asks about /different/path",
            sessionKey: sessionKey,
            projectRoot: projectRoot,
            baseDirectory: stateRoot
        )
        XCTAssertEqual(
            try SearchScopeExtension.readGrantFile(at: grantURL).paths,
            ["/sensitive/path"],
            "app-authored text must preserve the last human grant"
        )

        try SearchScopeExtension.applyPromptPolicy(
            .remoteClearGrant,
            prompt: "remote asks about /sensitive/path",
            sessionKey: sessionKey,
            projectRoot: projectRoot,
            baseDirectory: stateRoot
        )
        XCTAssertTrue(
            try SearchScopeExtension.readGrantFile(at: grantURL).paths.isEmpty,
            "remote input must revoke the previous local human grant"
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

    func testLANPolicyRequiresExactHostOriginAndPairBeforeServingDocument() {
        let token = String(repeating: "a", count: 64)
        let pairingSecret = String(repeating: "p", count: 64)
        let accessMode = LocalRemoteAccessMode.trustedLAN(
            privateIPv4: "192.168.43.200",
            pairingSecret: pairingSecret
        )

        let missingPair = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/",
            headers: ["host": "192.168.43.200:4321"],
            body: Data()
        )
        let missingResponse = LocalRemoteRequestPolicy.authorizationError(
            for: missingPair,
            expectedToken: token,
            port: 4321,
            accessMode: accessMode
        )
        XCTAssertEqual(missingResponse?.status, 401)
        XCTAssertFalse(String(data: missingResponse?.body ?? Data(), encoding: .utf8)?.contains(token) ?? true)

        let wrongPair = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/?pair=\(String(repeating: "x", count: 64))",
            headers: ["host": "192.168.43.200:4321"],
            body: Data()
        )
        XCTAssertEqual(
            LocalRemoteRequestPolicy.authorizationError(
                for: wrongPair,
                expectedToken: token,
                port: 4321,
                accessMode: accessMode
            )?.status,
            401
        )

        let validDocument = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/?pair=\(pairingSecret)",
            headers: ["host": "192.168.43.200:4321"],
            body: Data()
        )
        XCTAssertNil(LocalRemoteRequestPolicy.authorizationError(
            for: validDocument,
            expectedToken: token,
            port: 4321,
            accessMode: accessMode
        ))

        let validLANAPI = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/api/index",
            headers: [
                "host": "192.168.43.200:4321",
                "origin": "http://192.168.43.200:4321",
                LocalRemoteWebPage.tokenHeader.lowercased(): token,
            ],
            body: Data()
        )
        XCTAssertNil(LocalRemoteRequestPolicy.authorizationError(
            for: validLANAPI,
            expectedToken: token,
            port: 4321,
            accessMode: accessMode
        ))

        let mismatchedOrigin = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/api/index",
            headers: [
                "host": "192.168.43.200:4321",
                "origin": "http://127.0.0.1:4321",
                LocalRemoteWebPage.tokenHeader.lowercased(): token,
            ],
            body: Data()
        )
        XCTAssertEqual(
            LocalRemoteRequestPolicy.authorizationError(
                for: mismatchedOrigin,
                expectedToken: token,
                port: 4321,
                accessMode: accessMode
            )?.status,
            403
        )

        let arbitraryHost = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/?pair=\(pairingSecret)",
            headers: ["host": "example.test:4321"],
            body: Data()
        )
        XCTAssertEqual(
            LocalRemoteRequestPolicy.authorizationError(
                for: arbitraryHost,
                expectedToken: token,
                port: 4321,
                accessMode: accessMode
            )?.status,
            400
        )
    }

    func testLANListenerConfigurationAndPrivateAddressSelection() {
        XCTAssertTrue(LocalRemoteAccessMode.loopbackOnly.isValid)
        XCTAssertTrue(
            LocalRemoteAccessMode.trustedLAN(
                privateIPv4: "192.168.1.5",
                pairingSecret: String(repeating: "p", count: 64)
            ).isValid
        )
        XCTAssertFalse(
            LocalRemoteAccessMode.trustedLAN(
                privateIPv4: "8.8.8.8",
                pairingSecret: String(repeating: "p", count: 64)
            ).isValid
        )
        XCTAssertFalse(
            LocalRemoteAccessMode.trustedLAN(
                privateIPv4: "192.168.1.5",
                pairingSecret: "too-short"
            ).isValid
        )
        XCTAssertEqual(
            LocalRemoteListenerConfiguration.requiredHost(for: .loopbackOnly),
            NWEndpoint.Host("127.0.0.1")
        )
        XCTAssertEqual(
            LocalRemoteListenerConfiguration.requiredHost(
                for: .trustedLAN(
                    privateIPv4: "192.168.1.5",
                    pairingSecret: String(repeating: "p", count: 64)
                )
            ),
            NWEndpoint.Host("0.0.0.0")
        )
        XCTAssertTrue(LocalRemoteNetwork.isPrivateIPv4("10.0.0.1"))
        XCTAssertTrue(LocalRemoteNetwork.isPrivateIPv4("172.31.255.254"))
        XCTAssertTrue(LocalRemoteNetwork.isPrivateIPv4("192.168.43.200"))
        XCTAssertTrue(LocalRemoteNetwork.isPrivateIPv4("169.254.2.3"))
        XCTAssertFalse(LocalRemoteNetwork.isPrivateIPv4("127.0.0.1"))
        XCTAssertFalse(LocalRemoteNetwork.isPrivateIPv4("8.8.8.8"))
        XCTAssertFalse(LocalRemoteNetwork.isPrivateIPv4("localhost"))
        XCTAssertEqual(
            LocalRemoteNetwork.preferredPrivateIPv4(from: [
                ("utun3", "10.2.0.4"),
                ("en0", "192.168.43.200"),
                ("en1", "169.254.2.3"),
            ]),
            "192.168.43.200"
        )
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

    func testTranscriptNormalizationExposesSafeProgressAndRedactsKnownPaths() {
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
                blocks: [
                    .thinking("secret chain of thought about /Users/alice"),
                    .toolCall(ToolCallBlock(
                        id: "tool-internal-id",
                        name: "Bash",
                        argsSummary: "Bash · ls /Users/alice/project",
                        payloadChars: 4096,
                        fileChangePayload: nil
                    )),
                    .text("stored under /Users/alice/other"),
                ]
            ),
        ]
        let messages = RemoteTranscriptNormalizer.normalizedMessages(
            items,
            projectPath: "/Users/alice/project",
            homeDirectory: "/Users/alice"
        )

        XCTAssertEqual(messages.map(\.id), ["m-0", "m-1-0", "m-1-1", "m-1-2"])
        XCTAssertEqual(messages[0].kind, .text)
        XCTAssertFalse(messages[0].text.contains("/Users/alice"))
        XCTAssertFalse(messages[0].text.contains("image.png"))
        XCTAssertEqual(messages[0].text, "inspect [local path]")

        // Thinking is exposed only as a content-free indicator.
        XCTAssertEqual(messages[1].kind, .thinking)
        XCTAssertEqual(messages[1].text, "")
        XCTAssertNil(messages[1].toolName)

        // Tool calls expose only the name and the redacted argument summary.
        XCTAssertEqual(messages[2].kind, .tool)
        XCTAssertEqual(messages[2].toolName, "Bash")
        XCTAssertEqual(messages[2].toolSummary, "Bash · ls [local path]")
        XCTAssertEqual(messages[2].text, "")

        XCTAssertEqual(messages[3].kind, .text)
        XCTAssertEqual(messages[3].text, "stored under [local path]")

        // No payload, thinking content, media path, or local path leaks anywhere.
        let encoded = try! JSONEncoder().encode(messages)
        let json = String(data: encoded, encoding: .utf8)!
        XCTAssertFalse(json.contains("/Users/alice"))
        XCTAssertFalse(json.contains("secret chain of thought"))
        XCTAssertFalse(json.contains("image.png"))
        XCTAssertFalse(json.contains("tool-internal-id"))
        XCTAssertFalse(json.contains("internal-user-id"))
        XCTAssertFalse(json.contains("internal-assistant-id"))
    }

    func testAssistantProgressEntriesKeepBlockOrderWithStableIDs() {
        let items = [
            ChatItem(
                id: "assistant",
                role: "assistant",
                blocks: [
                    .text("先看一下目录"),
                    .toolCall(ToolCallBlock(
                        id: "t1",
                        name: "Bash",
                        argsSummary: "Bash · ls -la"
                    )),
                    .thinking("..."),
                    .toolCall(ToolCallBlock(
                        id: "t2",
                        name: "read",
                        argsSummary: "Sources/App.swift"
                    )),
                    .text("完成"),
                ]
            ),
        ]
        let messages = RemoteTranscriptNormalizer.normalizedMessages(
            items,
            projectPath: "/project",
            homeDirectory: "/Users/test"
        )

        XCTAssertEqual(messages.map(\.kind), [.text, .tool, .thinking, .tool, .text])
        XCTAssertEqual(messages.map(\.id), ["m-0-0", "m-0-1", "m-0-2", "m-0-3", "m-0-4"])
        XCTAssertEqual(messages[1].toolName, "Bash")
        XCTAssertEqual(messages[1].toolSummary, "Bash · ls -la")
        XCTAssertEqual(messages[3].toolName, "read")
        XCTAssertEqual(messages[3].toolSummary, "Sources/App.swift")
        XCTAssertEqual(messages[4].text, "完成")
    }

    func testStreamingItemProducesProgressEntriesThroughSnapshotCache() {
        let cache = RemoteSnapshotCache()
        let streaming = ChatItem(
            id: "stream",
            role: "assistant",
            blocks: [
                .thinking("hidden reasoning"),
                .toolCall(ToolCallBlock(
                    id: "t1",
                    name: "Bash",
                    argsSummary: "Bash · ls /project"
                )),
                .text("partial answer"),
            ]
        )
        let input = RemoteSnapshotCacheInput(
            sessionID: "streaming-progress-session",
            title: "title",
            transcriptVersion: 1,
            finalizedItems: [ChatItem(id: "f1", role: "user", blocks: [.text("hi")])],
            streamingItem: streaming,
            isGenerating: true,
            projectPath: "/project",
            homeDirectory: "/Users/test"
        )

        guard case .response(let data, _) = cache.resolve(input, requestedRevision: nil) else {
            return XCTFail("streaming snapshot should be encoded")
        }
        let decoded = try! JSONDecoder().decode(RemoteSessionSnapshotDTO.self, from: data)
        let messages = decoded.snapshot.messages
        XCTAssertEqual(messages.map(\.id), ["m-0", "m-1-0", "m-1-1", "m-1-2"])
        XCTAssertEqual(messages.map(\.kind), [.text, .thinking, .tool, .text])
        XCTAssertEqual(messages[2].toolName, "Bash")
        XCTAssertEqual(messages[2].toolSummary, "Bash · ls [local path]")
        let json = String(data: data, encoding: .utf8)!
        XCTAssertFalse(json.contains("hidden reasoning"))
    }

    func testSnapshotCacheReturns304WithoutRenormalizingFinalizedTranscript() throws {
        let cache = RemoteSnapshotCache()
        let finalized = [
            ChatItem(id: "f1", role: "user", blocks: [.text("hello")]),
        ]
        let initial = RemoteSnapshotCacheInput(
            sessionID: "snapshot-session",
            title: "title",
            transcriptVersion: 1,
            finalizedItems: finalized,
            streamingItem: nil,
            projectPath: "/project",
            homeDirectory: "/Users/test"
        )

        guard case .response(let firstData, let firstRevision) = cache.resolve(
            initial,
            requestedRevision: nil
        ) else {
            return XCTFail("first snapshot should be encoded")
        }
        XCTAssertEqual(firstRevision, 1)
        XCTAssertFalse(firstData.isEmpty)
        XCTAssertEqual(cache.finalizedNormalizationCount, 1)
        XCTAssertEqual(cache.streamingNormalizationCount, 0)

        guard case .notModified(let unchangedRevision) = cache.resolve(
            initial,
            requestedRevision: firstRevision
        ) else {
            return XCTFail("unchanged poll should return 304 decision")
        }
        XCTAssertEqual(unchangedRevision, firstRevision)
        XCTAssertEqual(cache.finalizedNormalizationCount, 1)
        XCTAssertEqual(cache.streamingNormalizationCount, 0)

        let streaming = RemoteSnapshotCacheInput(
            sessionID: "snapshot-session",
            title: "title",
            transcriptVersion: 1,
            finalizedItems: finalized,
            streamingItem: ChatItem(
                id: "stream",
                role: "assistant",
                blocks: [.text("partial")]
            ),
            isGenerating: true,
            projectPath: "/project",
            homeDirectory: "/Users/test"
        )
        guard case .response(_, let streamingRevision) = cache.resolve(
            streaming,
            requestedRevision: firstRevision
        ) else {
            return XCTFail("streaming change should produce a new snapshot")
        }
        XCTAssertEqual(streamingRevision, 2)
        XCTAssertEqual(cache.finalizedNormalizationCount, 1)
        XCTAssertEqual(cache.streamingNormalizationCount, 1)

        let statusOnly = RemoteSnapshotCacheInput(
            sessionID: "snapshot-session",
            title: "title",
            transcriptVersion: 1,
            finalizedItems: finalized,
            streamingItem: streaming.streamingItem,
            isGenerating: true,
            isStopping: true,
            projectPath: "/project",
            homeDirectory: "/Users/test"
        )
        _ = cache.resolve(statusOnly, requestedRevision: streamingRevision)
        XCTAssertEqual(cache.finalizedNormalizationCount, 1)
        XCTAssertEqual(
            cache.streamingNormalizationCount,
            1,
            "status-only changes must reuse both finalized and streaming normalization"
        )
    }

    func testWebPageUsesSafeDOMAndDoesNotPutTokenInURL() throws {
        let token = String(repeating: "b", count: 64)
        let html = try XCTUnwrap(String(
            data: LocalRemoteWebPage.render(token: token, nonce: "nonce"),
            encoding: .utf8
        ))
        XCTAssertTrue(html.contains("textContent"))
        XCTAssertTrue(html.contains("replaceChildren"))
        for forbiddenAPI in ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"] {
            XCTAssertFalse(html.contains(forbiddenAPI))
        }
        XCTAssertFalse(html.contains("?\(token)"))
        XCTAssertFalse(html.contains("#\(token)"))
        XCTAssertTrue(html.contains(#""X-PipiUI-Remote-Token": token"#))
    }

    func testWebPageMarkdownRendererUsesSafeDOMAndWhitelistedLinks() throws {
        let html = try XCTUnwrap(String(
            data: LocalRemoteWebPage.render(
                token: String(repeating: "d", count: 64),
                nonce: "nonce"
            ),
            encoding: .utf8
        ))

        XCTAssertTrue(html.contains("function renderMarkdown(text)"))
        XCTAssertTrue(html.contains("function appendInline(parent, text, depth = 0)"))
        XCTAssertTrue(html.contains("bubble.append(renderMarkdown(message.text));"))
        XCTAssertTrue(html.contains(#"document.createElement("strong")"#))
        XCTAssertTrue(html.contains(#"document.createElement("em")"#))
        XCTAssertTrue(html.contains(#"document.createElement("del")"#))
        XCTAssertTrue(html.contains(#"document.createElement("pre")"#))
        XCTAssertTrue(html.contains(#"document.createElement("blockquote")"#))
        XCTAssertTrue(html.contains(#"document.createElement("ul")"#))
        XCTAssertTrue(html.contains(#"document.createElement("ol")"#))

        XCTAssertTrue(html.contains(#"url.startsWith("http://")"#))
        XCTAssertTrue(html.contains(#"url.startsWith("https://")"#))
        XCTAssertTrue(html.contains(#"link.setAttribute("href", url)"#))
        XCTAssertTrue(html.contains(#"link.setAttribute("target", "_blank")"#))
        XCTAssertTrue(html.contains(#"link.setAttribute("rel", "noopener noreferrer")"#))
        for forbiddenAPI in ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"] {
            XCTAssertFalse(html.contains(forbiddenAPI))
        }
        XCTAssertFalse(html.contains(#"<script src="#))
        XCTAssertFalse(html.contains(#"<link rel="stylesheet""#))
    }

    func testWebPageHasPersistentConnectionPillAndNeverLeaksTokenIntoURL() throws {
        let token = String(repeating: "c", count: 64)
        let html = try XCTUnwrap(String(
            data: LocalRemoteWebPage.render(token: token, nonce: "nonce"),
            encoding: .utf8
        ))
        XCTAssertTrue(html.contains(#"id="conn-pill""#))
        XCTAssertTrue(html.contains("已连接"))
        XCTAssertTrue(html.contains("连接中断，重试中…"))
        XCTAssertTrue(html.contains("navigator.onLine"))
        XCTAssertTrue(html.contains(#"addEventListener("offline""#))
        XCTAssertTrue(html.contains(#"addEventListener("online""#))
        // Token must never be interpolated into anything URL-shaped.
        XCTAssertFalse(html.contains("?\(token)"))
        XCTAssertFalse(html.contains("#\(token)"))
        XCTAssertFalse(html.contains("/\(token)"))
    }

    func testWebPageLocksAppShellToViewportWithIndependentScrollRegions() throws {
        let html = try XCTUnwrap(String(
            data: LocalRemoteWebPage.render(
                token: String(repeating: "e", count: 64),
                nonce: "nonce"
            ),
            encoding: .utf8
        ))
        // The document itself never scrolls; the shell is viewport-locked.
        XCTAssertTrue(html.contains("height: 100vh; height: 100dvh;"))
        XCTAssertTrue(html.contains("overflow: hidden"))
        XCTAssertTrue(html.contains("display: flex; flex-direction: column;"))
        // main fills the leftover space without calc()-based viewport math.
        XCTAssertTrue(html.contains("main { flex: 1; min-height: 0;"))
        XCTAssertFalse(html.contains("calc(100dvh -"))
        XCTAssertFalse(html.contains("calc(100vh -"))
        // Sidebar and transcript scroll independently; composer stays in flow.
        XCTAssertTrue(html.contains("aside { min-height: 0; overflow-y: auto;"))
        XCTAssertTrue(html.contains("#transcript { flex: 1; min-height: 0; overflow-y: auto;"))
        XCTAssertTrue(
            html.contains("flex: none; display: grid; gap: 8px;"),
            "composer must stay in normal flow at the column bottom"
        )
        XCTAssertFalse(html.contains("#transcript { flex: 1; overflow: auto;"))
        // Auto-scroll-to-bottom after each transcript render stays intact.
        XCTAssertTrue(html.contains("transcript.scrollTop = transcript.scrollHeight;"))
    }

    func testWebPageHasMobileListDetailFlowAndAccessibleBackControl() throws {
        let html = try XCTUnwrap(String(
            data: LocalRemoteWebPage.render(
                token: String(repeating: "b", count: 64),
                nonce: "nonce"
            ),
            encoding: .utf8
        ))
        XCTAssertTrue(html.contains(#"data-mobile-view="list""#))
        XCTAssertTrue(html.contains(#"main[data-mobile-view="list"] #session-pane"#))
        XCTAssertTrue(html.contains(#"main[data-mobile-view="detail"] #list-pane"#))
        XCTAssertTrue(html.contains(#"id="back-to-list""#))
        XCTAssertTrue(html.contains(#"aria-label="返回会话列表""#))
        XCTAssertTrue(html.contains(#"showDetail();"#))
        XCTAssertTrue(html.contains(#"showList();"#))
    }

    func testLocalRemoteSettingDefaultsOff() throws {
        let suiteName = "LocalRemoteWebTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        XCTAssertFalse(LocalRemoteSettings.isEnabled(defaults: defaults))
        LocalRemoteSettings.setEnabled(true, defaults: defaults)
        XCTAssertTrue(LocalRemoteSettings.isEnabled(defaults: defaults))
        XCTAssertFalse(LocalRemoteSettings.isLANEnabledForNewLaunch)
    }
}
