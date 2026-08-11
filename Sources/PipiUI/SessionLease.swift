import Foundation
import Darwin

/// Session single-writer lease — protocol v1.
///
/// Semantics and on-disk format are compatible with the Electron host
/// (`Electron/packages/pi-backend/src/lease.ts`) and the design doc
/// `docs/plans/2026-08-10-session-lease-protocol.md`: a session JSONL has exactly
/// one active writer across PipiUI implementations; every writer must hold the
/// adjacent `<sessionId>.lease.json` (exclusive create), refresh it every 15s,
/// and expire 45s after the last refresh. A client that cannot acquire the lease
/// may read history but must not start or send work to a `pi` process.
enum SessionLease {
    static let protocolVersion = 1
    static let defaultHeartbeatInterval: TimeInterval = 15
    static let defaultTTL: TimeInterval = 45
    /// Stable implementation identifiers (protocol initial values).
    static let swiftHolder = "pipiui-swift"
    static let electronHolder = "pipiui-electron"

    /// Canonical stamp: `yyyy-MM-dd'T'HH:mm:ss.SSSZ` (same shape as
    /// `new Date().toISOString()` on the Electron side).
    static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    /// Lenient ISO-8601 parse: accepts both `…T12:00:15.000Z` (Electron output)
    /// and `…T12:00:15Z` (fractional seconds omitted).
    static func parseISO(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }
}

/// On-disk lease record. Field names and values mirror `LeaseRecord` in the
/// Electron implementation; unknown fields are ignored on decode (protocol
/// requires future readers to ignore unknown fields).
struct SessionLeaseRecord: Codable, Equatable {
    var protocolVersion: Int
    var holder: String
    var pid: Int
    var hostname: String
    var instanceId: String
    var acquiredAt: String
    var heartbeatAt: String
    var expiresAt: String

    var expiresAtDate: Date? { SessionLease.parseISO(expiresAt) }
}

struct SessionLeaseStatus: Equatable {
    let sessionId: String
    let writable: Bool
    let holder: SessionLeaseRecord?
}

/// UI-facing conflict description ("由 X 运行中 · 只读").
struct SessionLeaseConflict: Equatable {
    let holder: String
    let pid: Int
    let hostname: String

    init(record: SessionLeaseRecord) {
        holder = record.holder
        pid = record.pid
        hostname = record.hostname
    }
}

/// Coordinates a single JSONL writer shared by the Swift and Electron hosts.
/// File layout is fixed: `…/<session-file-dir>/<sessionId>.lease.json`.
final class SessionLeaseManager {
    let sessionId: String
    let leasePath: String

    private let holder: String
    private let pid: Int
    private let host: String
    private let heartbeatInterval: TimeInterval
    private let ttl: TimeInterval
    private let now: () -> Date
    private let instanceId = UUID().uuidString

    private let lock = NSLock()
    private var owned = false
    private var heartbeatTimer: DispatchSourceTimer?
    private let timerQueue = DispatchQueue(label: "pipiui.session-lease.heartbeat")

    /// Invoked (synchronously, on the calling queue) when a heartbeat discovers
    /// the lease was removed or taken over by someone else. Consumers should hop
    /// to their own queue before touching UI state.
    var onOwnershipLost: ((SessionLeaseStatus) -> Void)?

    init(sessionId: String,
         leasePath: String,
         holder: String = SessionLease.swiftHolder,
         pid: Int = Int(getpid()),
         hostname: String = ProcessInfo.processInfo.hostName,
         heartbeatInterval: TimeInterval = SessionLease.defaultHeartbeatInterval,
         ttl: TimeInterval = SessionLease.defaultTTL,
         now: @escaping () -> Date = Date.init) {
        self.sessionId = sessionId
        self.leasePath = leasePath
        self.holder = holder
        self.pid = pid
        self.host = hostname
        self.heartbeatInterval = heartbeatInterval
        self.ttl = ttl
        self.now = now
        SessionLeaseManager.registerExitRelease(path: leasePath, instanceId: instanceId)
    }

    /// Resolves the session header id from the JSONL first line (Electron uses
    /// the same header when indexing) and points the lease at the adjacent
    /// `<sessionId>.lease.json`. Returns nil when the id cannot be determined.
    convenience init?(sessionFile: String,
                      holder: String = SessionLease.swiftHolder,
                      heartbeatInterval: TimeInterval = SessionLease.defaultHeartbeatInterval,
                      ttl: TimeInterval = SessionLease.defaultTTL,
                      now: @escaping () -> Date = Date.init) {
        guard let id = SessionLeaseManager.sessionID(fromSessionFile: sessionFile) else { return nil }
        self.init(sessionId: id,
                  leasePath: SessionLeaseManager.leasePath(forSessionFile: sessionFile, sessionID: id),
                  holder: holder,
                  heartbeatInterval: heartbeatInterval,
                  ttl: ttl,
                  now: now)
    }

    deinit {
        lock.lock()
        stopHeartbeatLocked()
        let wasOwned = owned
        owned = false
        lock.unlock()
        SessionLeaseManager.unregisterExitRelease(path: leasePath, instanceId: instanceId)
        if wasOwned { removeIfOwned() }
    }

    var isOwned: Bool {
        lock.lock()
        defer { lock.unlock() }
        return owned
    }

    // MARK: - Operations (semantics mirror lease.ts)

    func acquire() -> SessionLeaseStatus {
        lock.lock()
        let (status, notify) = acquireLocked(attempt: 0)
        lock.unlock()
        notify?(status)
        return status
    }

    func query() -> SessionLeaseStatus {
        lock.lock()
        defer { lock.unlock() }
        return queryLocked()
    }

    func heartbeat() -> SessionLeaseStatus {
        lock.lock()
        let (status, notify) = heartbeatLocked()
        lock.unlock()
        notify?(status)
        return status
    }

    func release() {
        removeIfOwned()
    }

    /// User-explicit takeover: invalidates the current lease, then performs
    /// exclusive acquisition. Destructive to the old writer's authority.
    func forceTakeover() -> SessionLeaseStatus {
        lock.lock()
        defer { lock.unlock() }
        stopHeartbeatLocked()
        owned = false
        removeFile(leasePath)
        return acquireLocked(attempt: 0).status
    }

    /// Removes the lease file when it is expired. Returns true when removed.
    func expire() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let current = read(), expired(current) else { return false }
        removeFile(leasePath)
        return true
    }

    // MARK: - Locked implementations

    private func acquireLocked(attempt: Int) -> (status: SessionLeaseStatus, notify: ((SessionLeaseStatus) -> Void)?) {
        if owned {
            return heartbeatLocked()
        }
        let dir = (leasePath as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let record = record()
        if exclusiveCreate(record) {
            owned = true
            startHeartbeatLocked()
            return (SessionLeaseStatus(sessionId: sessionId, writable: true, holder: record), nil)
        }
        guard let current = read() else {
            // The file vanished between the failed create and the read; retry.
            guard attempt < 3 else {
                return (SessionLeaseStatus(sessionId: sessionId, writable: false, holder: nil), nil)
            }
            return acquireLocked(attempt: attempt + 1)
        }
        if expired(current) {
            removeFile(leasePath)
            guard attempt < 3 else {
                return (SessionLeaseStatus(sessionId: sessionId, writable: false, holder: current), nil)
            }
            return acquireLocked(attempt: attempt + 1)
        }
        return (SessionLeaseStatus(sessionId: sessionId, writable: false, holder: current), nil)
    }

    private func queryLocked() -> SessionLeaseStatus {
        guard let current = read() else {
            return SessionLeaseStatus(sessionId: sessionId, writable: true, holder: nil)
        }
        if expired(current) {
            removeFile(leasePath)
            return SessionLeaseStatus(sessionId: sessionId, writable: true, holder: nil)
        }
        if same(current) {
            return SessionLeaseStatus(sessionId: sessionId, writable: true, holder: current)
        }
        return SessionLeaseStatus(sessionId: sessionId, writable: false, holder: current)
    }

    private func heartbeatLocked() -> (status: SessionLeaseStatus, notify: ((SessionLeaseStatus) -> Void)?) {
        guard owned else {
            return (queryLocked(), nil)
        }
        guard let current = read(), same(current) else {
            owned = false
            stopHeartbeatLocked()
            let status = queryLocked()
            let notify = onOwnershipLost
            return (status, notify)
        }
        let nowDate = now()
        let next = SessionLeaseRecord(
            protocolVersion: current.protocolVersion,
            holder: current.holder,
            pid: current.pid,
            hostname: current.hostname,
            instanceId: current.instanceId,
            acquiredAt: current.acquiredAt,
            heartbeatAt: SessionLease.isoString(nowDate),
            expiresAt: SessionLease.isoString(nowDate.addingTimeInterval(ttl))
        )
        if atomicReplace(next) {
            return (SessionLeaseStatus(sessionId: sessionId, writable: true, holder: next), nil)
        }
        owned = false
        stopHeartbeatLocked()
        let status = queryLocked()
        return (status, onOwnershipLost)
    }

    /// Best-effort removal of the lease file, only when it still carries this
    /// manager's `instanceId`. Used by `release()` and `deinit`.
    private func removeIfOwned() {
        lock.lock()
        defer { lock.unlock() }
        stopHeartbeatLocked()
        guard owned, let current = read(), same(current) else {
            owned = false
            return
        }
        owned = false
        removeFile(leasePath)
    }

    // MARK: - File primitives

    private func record() -> SessionLeaseRecord {
        let nowDate = now()
        let stamp = SessionLease.isoString(nowDate)
        return SessionLeaseRecord(
            protocolVersion: SessionLease.protocolVersion,
            holder: holder,
            pid: pid,
            hostname: host,
            instanceId: instanceId,
            acquiredAt: stamp,
            heartbeatAt: stamp,
            expiresAt: SessionLease.isoString(nowDate.addingTimeInterval(ttl))
        )
    }

    /// Reads and decodes the lease; an undecodable file carries no authority and
    /// is removed so recovery stays possible.
    private func read() -> SessionLeaseRecord? {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: leasePath)) else { return nil }
        do {
            return try JSONDecoder().decode(SessionLeaseRecord.self, from: data)
        } catch {
            removeFile(leasePath)
            return nil
        }
    }

    private func expired(_ record: SessionLeaseRecord) -> Bool {
        guard let date = record.expiresAtDate else { return true }
        return date <= now()
    }

    private func same(_ record: SessionLeaseRecord) -> Bool {
        record.instanceId == instanceId
    }

    /// Exclusive create — the `wx` equivalent (O_CREAT | O_EXCL). Returns false
    /// when the file already exists.
    private func exclusiveCreate(_ record: SessionLeaseRecord) -> Bool {
        guard let data = encode(record) else { return false }
        let fd = open(leasePath, O_WRONLY | O_CREAT | O_EXCL, 0o644)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        return data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
            guard let base = raw.baseAddress, !raw.isEmpty else { return false }
            var written = 0
            while written < raw.count {
                let n = write(fd, base.advanced(by: written), raw.count - written)
                if n <= 0 { return false }
                written += n
            }
            return true
        }
    }

    /// Atomic replace for heartbeats: write a temporary sibling, then rename
    /// over the lease (mirrors the Electron tmp + rename).
    private func atomicReplace(_ record: SessionLeaseRecord) -> Bool {
        guard let data = encode(record) else { return false }
        let temporary = "\(leasePath).\(instanceId).tmp"
        do {
            try data.write(to: URL(fileURLWithPath: temporary), options: .atomic)
        } catch {
            removeFile(temporary)
            return false
        }
        guard rename(temporary, leasePath) == 0 else {
            removeFile(temporary)
            return false
        }
        return true
    }

    private func encode(_ record: SessionLeaseRecord) -> Data? {
        try? JSONEncoder().encode(record)
    }

    private func removeFile(_ path: String) {
        _ = Darwin.unlink(path)
    }

    // MARK: - Heartbeat timer

    private func startHeartbeatLocked() {
        guard heartbeatTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: timerQueue)
        timer.schedule(deadline: .now() + heartbeatInterval, repeating: heartbeatInterval)
        timer.setEventHandler { [weak self] in
            _ = self?.heartbeat()
        }
        heartbeatTimer = timer
        timer.resume()
    }

    private func stopHeartbeatLocked() {
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
    }

    // MARK: - Session id / lease path resolution

    /// Reads the session header `id` from the JSONL first line (pi writes
    /// `{"type":"session","version":3,"id":"<uuid>",…}` there).
    static func sessionID(fromSessionFile sessionFile: String) -> String? {
        guard let handle = FileHandle(forReadingAtPath: sessionFile) else { return nil }
        defer { try? handle.close() }
        var line = Data()
        while true {
            let chunk: Data?
            do {
                chunk = try handle.read(upToCount: 8192)
            } catch {
                return nil
            }
            guard let chunk, !chunk.isEmpty else { break }
            line.append(chunk)
            if let newline = line.firstIndex(of: 0x0A) {
                line = Data(line[..<newline])
                break
            }
            if line.count > 64 * 1024 { return nil }
        }
        guard !line.isEmpty,
              let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              let id = object["id"] as? String,
              !id.isEmpty else { return nil }
        return id
    }

    /// Electron layout: `join(dirname(sessionPath), "<sessionId>.lease.json")`.
    static func leasePath(forSessionFile sessionFile: String, sessionID: String) -> String {
        let dir = (sessionFile as NSString).deletingLastPathComponent
        return (dir as NSString).appendingPathComponent("\(sessionID).lease.json")
    }

    static func leasePath(forSessionFile sessionFile: String) -> String? {
        guard let id = sessionID(fromSessionFile: sessionFile) else { return nil }
        return leasePath(forSessionFile: sessionFile, sessionID: id)
    }

    // MARK: - Best-effort release at process exit (mirrors `process.once("exit")`)

    private static let exitLock = NSLock()
    private static var exitEntries: [(path: String, instanceId: String)] = []
    private static var atexitRegistered = false

    static func registerExitRelease(path: String, instanceId: String) {
        exitLock.lock()
        if !atexitRegistered {
            atexit { SessionLeaseManager.releaseAllAtExit() }
            atexitRegistered = true
        }
        exitEntries.removeAll { $0.path == path && $0.instanceId == instanceId }
        exitEntries.append((path, instanceId))
        exitLock.unlock()
    }

    static func unregisterExitRelease(path: String, instanceId: String) {
        exitLock.lock()
        exitEntries.removeAll { $0.path == path && $0.instanceId == instanceId }
        exitLock.unlock()
    }

    private static func releaseAllAtExit() {
        exitLock.lock()
        let entries = exitEntries
        exitLock.unlock()
        for entry in entries {
            autoreleasepool {
                guard let data = try? Data(contentsOf: URL(fileURLWithPath: entry.path)),
                      let record = try? JSONDecoder().decode(SessionLeaseRecord.self, from: data),
                      record.instanceId == entry.instanceId else { return }
                _ = Darwin.unlink(entry.path)
            }
        }
    }
}
