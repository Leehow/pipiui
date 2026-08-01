import Foundation

struct RemoteCommandResponse: Equatable, Sendable {
    let status: Int
    let contentType: String
    let headers: [String: String]
    let body: Data

    static func json(status: Int = 200, _ object: [String: Any]) -> RemoteCommandResponse {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        return RemoteCommandResponse(
            status: status,
            contentType: "application/json; charset=utf-8",
            headers: [:],
            body: data
        )
    }

    static func empty(status: Int) -> RemoteCommandResponse {
        RemoteCommandResponse(
            status: status,
            contentType: "application/json; charset=utf-8",
            headers: [:],
            body: Data()
        )
    }
}

struct RemoteCommandRequest: Equatable, Sendable {
    let command: RemoteRelayCommand
    let body: Data
    let deadline: Date?
}

/// Transport-neutral, main-thread command boundary shared by the local HTTP
/// adapter and the outbound Relay client.
final class RemoteHostController {
    private weak var store: AppStore?
    private let registry = RemoteObjectIDRegistry()
    private var idempotency = RemotePromptIdempotencyCache()
    private let snapshotCache = RemoteSnapshotCache()
    private var remoteDocuments: [String: (sessionID: String, url: URL)] = [:]

    init(store: AppStore) {
        self.store = store
    }

    func resetRuntimeState() {
        snapshotCache.removeAll()
    }

    func handle(
        _ request: RemoteCommandRequest,
        respond: @escaping (RemoteCommandResponse) -> Void
    ) {
        guard request.body.count <= RemoteRelayLimits.maximumRequestBodyBytes else {
            respond(.json(status: 413, ["error": "request body exceeds limit"]))
            return
        }
        if let deadline = request.deadline, deadline <= Date() {
            respond(.json(status: 408, ["error": "request deadline expired"]))
            return
        }
        guard RemoteCommandSchema.validate(command: request.command, body: request.body) else {
            respond(.json(status: 422, ["error": "invalid command schema"]))
            return
        }
        guard let store else {
            respond(.json(status: 503, ["error": "app state unavailable"]))
            return
        }

        switch request.command {
        case .index:
            respond(encode(indexDTO(store: store)))

        case .sessionCreate:
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

        case .sessionOpen:
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

        case .snapshot:
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
                respond(RemoteCommandResponse(
                    status: 200,
                    contentType: "application/json; charset=utf-8",
                    headers: [:],
                    body: data
                ))
            }

        case .promptSend:
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

        case .generationStop:
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

        case .modelsGet:
            guard let sessionID = stringField("sessionID", in: request.body),
                  let session = liveSession(for: sessionID, store: store) else {
                respond(.json([
                    "main": NSNull(),
                    "available": [],
                    "subagents": subagentModelsDTO()
                ]))
                return
            }
            let projectPath = session.projectURL.path
            let main: Any = session.model.map { model in
                [
                    "id": model.id,
                    "name": sanitizedRemoteText(model.name, projectPath: projectPath),
                    "thinkingLevel": sanitizedRemoteText(session.thinkingLevel, projectPath: projectPath)
                ]
            } ?? NSNull()
            let available = session.availableModels.map { model in
                [
                    "id": model.id,
                    "name": sanitizedRemoteText(model.name, projectPath: projectPath)
                ]
            }
            respond(.json(["main": main, "available": available, "subagents": subagentModelsDTO()]))

        case .modelSet:
            guard let body = decodeObject(request.body),
                  let sessionID = body["sessionID"] as? String,
                  let modelID = body["modelId"] as? String,
                  let session = liveSession(for: sessionID, store: store) else {
                respond(.json(status: 409, ["error": "session is not open"]))
                return
            }
            guard let model = session.availableModels.first(where: { $0.id == modelID }) else {
                respond(.json(status: 422, ["error": "unknown modelId"]))
                return
            }
            session.setModel(model)
            respond(.json(status: 202, ["accepted": true]))

        case .subagentModelSet:
            guard let body = decodeObject(request.body),
                  let agent = body["agent"] as? String,
                  let model = body["model"] as? String,
                  AgentCatalog.load().contains(where: { $0.name == agent }) else {
                respond(.json(status: 422, ["error": "unknown subagent"]))
                return
            }
            let thinking = body["thinking"] as? String
            SubagentModelSettings.setOverride(model, thinking: thinking, for: agent)
            respond(.json(status: 202, ["accepted": true]))

        case .agentsList:
            guard let sessionID = stringField("sessionID", in: request.body),
                  let session = liveSession(for: sessionID, store: store) else {
                respond(.json(status: 409, ["error": "session is not open"]))
                return
            }
            respond(.json(["agents": agentsDTO(session.subagents.agents, projectPath: session.projectURL.path)]))

        case .agentsDetail:
            guard let body = decodeObject(request.body),
                  let sessionID = body["sessionID"] as? String,
                  let agentID = body["agentID"] as? String,
                  let session = liveSession(for: sessionID, store: store),
                  let agent = session.subagents.agents.first(where: { $0.id == agentID }) else {
                respond(.json(status: 404, ["error": "subagent not found"]))
                return
            }
            var detail = agentDTO(agent, projectPath: session.projectURL.path)
            let log = agent.log.map { "[\($0.kind)] \($0.name): \($0.text)" }.joined(separator: "\n")
            let tail = String(log.suffix(4_000))
            detail["log"] = sanitizedDocumentText(tail, projectPath: session.projectURL.path)
            detail["truncated"] = log.count > tail.count
            respond(.json(detail))

        case .panelState:
            guard let sessionID = stringField("sessionID", in: request.body),
                  let session = liveSession(for: sessionID, store: store) else {
                respond(.json(status: 409, ["error": "session is not open"]))
                return
            }
            let web: Any = session.webView.urlString.isEmpty ? NSNull() : [
                "url": sanitizedDocumentText(session.webView.urlString, projectPath: session.projectURL.path),
                "title": sanitizedRemoteText(session.webView.title, projectPath: session.projectURL.path),
                "isLoading": session.webView.isLoading
            ]
            respond(.json(["web": web, "documents": documentsDTO(session: session, sessionID: sessionID)]))

        case .documentGet:
            guard let body = decodeObject(request.body),
                  let sessionID = body["sessionID"] as? String,
                  let documentID = body["documentID"] as? String,
                  let session = liveSession(for: sessionID, store: store),
                  let record = remoteDocuments[documentID], record.sessionID == sessionID else {
                respond(.json(status: 404, ["error": "document not found"]))
                return
            }
            let kind = remoteDocumentKind(record.url)
            let name = sanitizedRemoteText(record.url.lastPathComponent, projectPath: session.projectURL.path)
            guard kind == "text" else {
                respond(.json(["name": name, "kind": kind, "content": NSNull(), "note": "此文件不能远程预览内容"]))
                return
            }
            guard let data = try? Data(contentsOf: record.url, options: [.mappedIfSafe]) else {
                respond(.json(status: 404, ["error": "document unavailable"]))
                return
            }
            let prefix = data.prefix(64 * 1024)
            let content = sanitizedDocumentText(String(decoding: prefix, as: UTF8.self), projectPath: session.projectURL.path)
            respond(.json(["name": name, "kind": kind, "content": content, "truncated": data.count > prefix.count]))

        }
    }

    private func agentDTO(_ agent: SubagentInfo, projectPath: String) -> [String: Any] {
        [
            "agentID": agent.id,
            "name": sanitizedRemoteText(agent.name, projectPath: projectPath),
            "title": sanitizedRemoteText(agent.displayTitle, projectPath: projectPath),
            "task": sanitizedDocumentText(String(agent.task.prefix(200)), projectPath: projectPath),
            "state": agent.state.rawValue,
            "model": sanitizedRemoteText(agent.model ?? "", projectPath: projectPath),
            "cost": agent.cost,
            "turns": agent.turns,
            "activity": sanitizedRemoteText(agent.activity, projectPath: projectPath)
        ]
    }

    private func agentsDTO(_ agents: [SubagentInfo], projectPath: String) -> [[String: Any]] {
        agents.map { agentDTO($0, projectPath: projectPath) }
    }

    private func remoteDocumentKind(_ url: URL) -> String {
        switch DocumentDetector.kind(for: url) {
        case .some(.markdown), .some(.plain): return "text"
        case .some(.pdf): return "pdf"
        case nil: return "other"
        }
    }

    private func documentsDTO(session: ChatSession, sessionID: String) -> [[String: Any]] {
        guard let url = session.documents.currentURL else { return [] }
        let id = UUID().uuidString.lowercased()
        remoteDocuments[id] = (sessionID, url)
        let size = ((try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?.intValue ?? 0
        return [[
            "id": id,
            "name": sanitizedRemoteText(url.lastPathComponent, projectPath: session.projectURL.path),
            "kind": remoteDocumentKind(url),
            "size": size
        ]]
    }

    private func sanitizedDocumentText(_ value: String, projectPath: String) -> String {
        RemoteTranscriptNormalizer.redactKnownLocalPaths(
            value,
            projectPath: projectPath,
            homeDirectory: FileManager.default.homeDirectoryForCurrentUser.path
        )
    }

    private func subagentModelsDTO() -> [[String: String]] {
        let overrides = SubagentModelSettings.allSettings()
        return AgentCatalog.load().map { agent in
            let override = overrides[agent.name]
            return [
                "agent": sanitizedRemoteText(agent.name, projectPath: ""),
                "model": override?.model ?? "",
                "thinking": override?.thinking ?? ""
            ]
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

    private func encode<T: Encodable>(_ value: T, status: Int = 200) -> RemoteCommandResponse {
        guard let data = try? JSONEncoder().encode(value) else {
            return .json(status: 500, ["error": "response encoding failed"])
        }
        return RemoteCommandResponse(
            status: status,
            contentType: "application/json; charset=utf-8",
            headers: [:],
            body: data
        )
    }
}
