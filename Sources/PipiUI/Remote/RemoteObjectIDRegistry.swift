import Foundation

enum RemoteSessionLocator: Hashable {
    case historical(projectPath: String, sessionPath: String)
    case open(projectPath: String, openKey: String)
}

struct RemoteDesktopSelectionState: Equatable {
    let projectPath: String?
    let sessionKey: String?

    func matches(projectPath: String?, sessionKey: String?) -> Bool {
        self.projectPath == projectPath && self.sessionKey == sessionKey
    }
}

/// Runtime-only opaque identifiers for the local test host.
///
/// These values are identifiers, not authorization capabilities. They are never
/// accepted without the separate per-launch HTTP token. Stable/persistent remote
/// identifiers are intentionally deferred until a real server protocol exists.
final class RemoteObjectIDRegistry {
    private var projectIDsByPath: [String: String] = [:]
    private var projectPathsByID: [String: String] = [:]
    private var sessionIDsByLocator: [RemoteSessionLocator: String] = [:]
    private var sessionLocatorsByID: [String: RemoteSessionLocator] = [:]

    func projectID(forPath path: String) -> String {
        if let existing = projectIDsByPath[path] { return existing }
        let id = makeID(prefix: "p")
        projectIDsByPath[path] = id
        projectPathsByID[id] = path
        return id
    }

    func projectPath(forID id: String) -> String? {
        projectPathsByID[id]
    }

    func sessionID(for locator: RemoteSessionLocator) -> String {
        if let existing = sessionIDsByLocator[locator] { return existing }
        let id = makeID(prefix: "s")
        sessionIDsByLocator[locator] = id
        sessionLocatorsByID[id] = locator
        return id
    }

    func sessionLocator(forID id: String) -> RemoteSessionLocator? {
        sessionLocatorsByID[id]
    }

    func existingSessionID(for locator: RemoteSessionLocator) -> String? {
        sessionIDsByLocator[locator]
    }

    private func makeID(prefix: String) -> String {
        "\(prefix)_\(BridgeCapabilityToken.generate(byteCount: 18))"
    }
}

struct RemotePromptIdempotencyCache {
    private struct Entry {
        let insertedAt: Date
    }

    private let capacity: Int
    private let lifetime: TimeInterval
    private var entries: [String: Entry] = [:]
    private var insertionOrder: [String] = []

    init(capacity: Int = 256, lifetime: TimeInterval = 30 * 60) {
        self.capacity = max(1, capacity)
        self.lifetime = max(1, lifetime)
    }

    mutating func contains(_ key: String, now: Date = Date()) -> Bool {
        prune(now: now)
        return entries[key] != nil
    }

    mutating func insert(_ key: String, now: Date = Date()) {
        prune(now: now)
        guard entries[key] == nil else { return }
        entries[key] = Entry(insertedAt: now)
        insertionOrder.append(key)
        while entries.count > capacity, let oldest = insertionOrder.first {
            insertionOrder.removeFirst()
            entries.removeValue(forKey: oldest)
        }
    }

    private mutating func prune(now: Date) {
        while let first = insertionOrder.first,
              let entry = entries[first],
              now.timeIntervalSince(entry.insertedAt) > lifetime {
            insertionOrder.removeFirst()
            entries.removeValue(forKey: first)
        }
    }
}
