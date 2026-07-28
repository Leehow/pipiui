import Foundation

enum LocalRemoteHostState: Equatable {
    case starting
    case listening(URL)
    case failed(String)
    case stopped
}

/// Main-thread facade over AppStore/ChatSession. The socket layer never reads or
/// mutates UI/session state directly.
final class RemoteHostService {
    private weak var store: AppStore?
    private let token = BridgeCapabilityToken.generate()
    private let nonce = BridgeCapabilityToken.generate(byteCount: 18)
    private let registry = RemoteObjectIDRegistry()
    private var idempotency = RemotePromptIdempotencyCache()
    private let snapshotCache = RemoteSnapshotCache()
    private var server: LocalRemoteHTTPServer?
    private let stateChanged: (LocalRemoteHostState) -> Void
    private var port: UInt16 = 0

    init?(store: AppStore, stateChanged: @escaping (LocalRemoteHostState) -> Void) {
        self.store = store
        self.stateChanged = stateChanged
        stateChanged(.starting)
        guard let server = LocalRemoteHTTPServer(
            handler: { [weak self] request, respond in
                DispatchQueue.main.async {
                    self?.handle(request, respond: respond)
                }
            },
            onReady: { [weak self] port in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.port = port
                    let url = URL(string: "http://127.0.0.1:\(port)/")!
                    self.stateChanged(.listening(url))
                }
            },
            onFailure: { [weak self] message in
                DispatchQueue.main.async {
                    self?.stateChanged(.failed(message))
                }
            }
        ) else {
            stateChanged(.failed("无法创建 loopback listener"))
            return nil
        }
        self.server = server
    }

    func stop() {
        server?.stop()
        server = nil
        port = 0
        snapshotCache.removeAll()
        stateChanged(.stopped)
    }

    private func handle(
        _ request: LocalRemoteHTTPRequest,
        respond: @escaping (LocalRemoteHTTPResponse) -> Void
    ) {
        guard port != 0 else {
            respond(.json(status: 503, ["error": "listener is not ready"]))
            return
        }
        if let error = LocalRemoteRequestPolicy.authorizationError(
            for: request,
            expectedToken: token,
            port: port
        ) {
            respond(error)
            return
        }
        if let routeRejection = LocalRemoteRoutes.rejection(for: request) {
            respond(routeRejection)
            return
        }
        guard let store else {
            respond(.json(status: 503, ["error": "app state unavailable"]))
            return
        }

        switch (request.method, request.path) {
        case ("GET", "/"):
            let csp = [
                "default-src 'none'",
                "script-src 'nonce-\(nonce)'",
                "style-src 'nonce-\(nonce)'",
                "connect-src 'self'",
                "img-src 'none'",
                "font-src 'none'",
                "object-src 'none'",
                "base-uri 'none'",
                "frame-ancestors 'none'",
                "form-action 'none'",
            ].joined(separator: "; ")
            respond(LocalRemoteHTTPResponse(
                status: 200,
                contentType: "text/html; charset=utf-8",
                headers: [
                    "Content-Security-Policy": csp,
                    "Referrer-Policy": "no-referrer",
                    "X-Frame-Options": "DENY",
                ],
                body: LocalRemoteWebPage.render(token: token, nonce: nonce)
            ))

        case ("GET", "/api/index"):
            respond(encode(indexDTO(store: store)))

        case ("POST", "/api/sessions"):
            guard let body = decodeObject(request.body),
                  let projectID = body["projectID"] as? String,
                  let projectPath = registry.projectPath(forID: projectID),
                  let project = store.projects.first(where: { $0.path == projectPath }) else {
                respond(.json(status: 422, ["error": "unknown projectID"]))
                return
            }
            let (key, _) = store.createSessionInBackground(project: project)
            let sessionID = registry.sessionID(
                for: .open(projectPath: project.path, openKey: key)
            )
            respond(.json(status: 201, ["sessionID": sessionID]))

        case ("POST", "/api/sessions/open"):
            guard let sessionID = stringField("sessionID", in: request.body),
                  let locator = registry.sessionLocator(forID: sessionID) else {
                respond(.json(status: 422, ["error": "unknown sessionID"]))
                return
            }
            switch locator {
            case .open(_, let openKey):
                guard store.openSessions[openKey] != nil else {
                    respond(.json(status: 404, ["error": "session is no longer open"]))
                    return
                }
                respond(.json(["sessionID": sessionID, "opened": true]))
            case .historical(let projectPath, let sessionPath):
                guard let project = store.projects.first(where: { $0.path == projectPath }),
                      let meta = (store.sessionsByProject[projectPath] ?? [])
                        .first(where: { $0.path == sessionPath }) else {
                    respond(.json(status: 404, ["error": "historical session unavailable"]))
                    return
                }
                store.openSessionInBackground(meta, project: project)
                // Do not hold the HTTP connection while a large JSONL transcript
                // parses. The page polls snapshot until the background open lands.
                respond(.json(status: 202, ["sessionID": sessionID, "opened": false]))
            }

        case ("POST", "/api/snapshot"):
            guard let body = decodeObject(request.body),
                  let sessionID = body["sessionID"] as? String,
                  let session = liveSession(for: sessionID, store: store) else {
                respond(.json(status: 409, ["error": "session is not open"]))
                return
            }
            let requestedRevision = (body["revision"] as? NSNumber)?.uint64Value
            switch snapshotCache.resolve(
                RemoteSnapshotCacheInput(sessionID: sessionID, session: session),
                requestedRevision: requestedRevision
            ) {
            case .notModified:
                respond(.empty(status: 304))
            case .response(let data, _):
                respond(LocalRemoteHTTPResponse(
                    status: 200,
                    contentType: "application/json; charset=utf-8",
                    headers: [:],
                    body: data
                ))
            }

        case ("POST", "/api/send"):
            guard let body = decodeObject(request.body),
                  let sessionID = body["sessionID"] as? String,
                  let text = body["text"] as? String,
                  let commandID = body["commandID"] as? String,
                  UUID(uuidString: commandID) != nil else {
                respond(.json(status: 422, ["error": "sessionID, text and UUID commandID required"]))
                return
            }
            guard text.utf8.count <= 64 * 1024 else {
                respond(.json(status: 413, ["error": "prompt exceeds 64 KiB"]))
                return
            }
            guard let session = liveSession(for: sessionID, store: store) else {
                respond(.json(status: 409, ["error": "session is not open"]))
                return
            }
            let cacheKey = "\(sessionID):\(commandID.lowercased())"
            if idempotency.contains(cacheKey) {
                respond(.json(["accepted": true, "duplicate": true]))
                return
            }
            switch session.submitRemotePrompt(text) {
            case .accepted:
                idempotency.insert(cacheKey)
                respond(.json(status: 202, ["accepted": true, "duplicate": false]))
            case .empty:
                respond(.json(status: 422, ["error": "prompt is empty"]))
            case .rejectedBuiltin(let name):
                respond(.json(
                    status: 403,
                    ["error": "local builtin slash command is unavailable remotely", "command": name]
                ))
            case .unavailable:
                respond(.json(status: 409, ["error": "session process is unavailable"]))
            }

        case ("POST", "/api/stop"):
            guard let sessionID = stringField("sessionID", in: request.body),
                  let session = liveSession(for: sessionID, store: store) else {
                respond(.json(status: 409, ["error": "session is not open"]))
                return
            }
            guard session.abortRemoteGeneration() else {
                respond(.json(status: 409, ["error": "session is not generating"]))
                return
            }
            respond(.json(status: 202, ["accepted": true]))

        default:
            respond(.json(status: 404, ["error": "route not found"]))
        }
    }

    private func indexDTO(store: AppStore) -> RemoteIndexDTO {
        var projects: [RemoteProjectDTO] = []
        var sessions: [RemoteSessionSummaryDTO] = []
        var emittedSessionIDs: Set<String> = []

        for project in store.orderedProjects {
            let projectID = registry.projectID(forPath: project.path)
            projects.append(RemoteProjectDTO(
                id: projectID,
                name: sanitizedRemoteText(
                    store.projectDisplayName(for: project),
                    projectPath: project.path
                )
            ))
            for meta in store.sessionsByProject[project.path] ?? [] {
                let historicalLocator = RemoteSessionLocator.historical(
                    projectPath: project.path,
                    sessionPath: meta.path
                )
                let liveEntry = store.openSessions.first { $0.value.sessionFile == meta.path }
                let locator: RemoteSessionLocator
                if let liveEntry,
                   registry.existingSessionID(for: .open(
                    projectPath: project.path,
                    openKey: liveEntry.key
                   )) != nil {
                    // Preserve the runtime ID handed out when a remotely-created
                    // new session later acquires its on-disk session file.
                    locator = .open(projectPath: project.path, openKey: liveEntry.key)
                } else {
                    locator = historicalLocator
                }
                let sessionID = registry.sessionID(for: locator)
                emittedSessionIDs.insert(sessionID)
                let live = liveEntry?.value
                sessions.append(RemoteSessionSummaryDTO(
                    id: sessionID,
                    projectID: projectID,
                    title: sanitizedRemoteText(meta.name, projectPath: project.path),
                    isOpen: live != nil,
                    isGenerating: live?.isStreaming ?? false
                ))
            }
        }

        for (openKey, session) in store.openSessions {
            let projectID = registry.projectID(forPath: session.projectURL.path)
            let locator: RemoteSessionLocator
            let openLocator = RemoteSessionLocator.open(
                projectPath: session.projectURL.path,
                openKey: openKey
            )
            if registry.existingSessionID(for: openLocator) != nil {
                locator = openLocator
            } else if let sessionFile = session.sessionFile {
                locator = .historical(
                    projectPath: session.projectURL.path,
                    sessionPath: sessionFile
                )
            } else {
                locator = openLocator
            }
            let sessionID = registry.sessionID(for: locator)
            guard emittedSessionIDs.insert(sessionID).inserted else { continue }
            sessions.append(RemoteSessionSummaryDTO(
                id: sessionID,
                projectID: projectID,
                title: sanitizedRemoteText(
                    session.displayTitle,
                    projectPath: session.projectURL.path
                ),
                isOpen: true,
                isGenerating: session.isStreaming
            ))
        }
        return RemoteIndexDTO(projects: projects, sessions: sessions)
    }

    private func liveSession(for sessionID: String, store: AppStore) -> ChatSession? {
        guard let locator = registry.sessionLocator(forID: sessionID) else { return nil }
        switch locator {
        case .open(_, let openKey):
            return store.openSessions[openKey]
        case .historical(_, let path):
            return store.openSessions["resume:\(path)"]
                ?? store.openSessions.values.first { $0.sessionFile == path }
        }
    }

    private func sanitizedRemoteText(_ value: String, projectPath: String) -> String {
        RemoteTranscriptNormalizer.redactKnownLocalPaths(
            RemoteTranscriptNormalizer.sanitizedTitle(value),
            projectPath: projectPath,
            homeDirectory: FileManager.default.homeDirectoryForCurrentUser.path
        )
    }

    private func decodeObject(_ data: Data) -> [String: Any]? {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any] else { return nil }
        return dictionary
    }

    private func stringField(_ field: String, in data: Data) -> String? {
        decodeObject(data)?[field] as? String
    }

    private func encode<T: Encodable>(_ value: T, status: Int = 200) -> LocalRemoteHTTPResponse {
        guard let data = try? JSONEncoder().encode(value) else {
            return .json(status: 500, ["error": "response encoding failed"])
        }
        return LocalRemoteHTTPResponse(
            status: status,
            contentType: "application/json; charset=utf-8",
            headers: [:],
            body: data
        )
    }
}
