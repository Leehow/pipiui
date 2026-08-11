import XCTest
@testable import PipiUI

/// Session single-writer lease (protocol v1): mutual exclusion, expiry recovery,
/// heartbeat, release, force takeover, and cross-implementation compatibility
/// with the Electron host's on-disk format.
final class SessionLeaseTests: XCTestCase {
    private var tempDir: URL!
    private var sessionPath: String!
    private let sessionID = "11111111-2222-4333-8444-555555555555"
    private var clock: TestClock!

    /// Injectable clock; Electron's `now` option equivalent. Starts at
    /// 2026-08-01T00:00:00Z so cross-impl fixtures dated 2026-08-10 are "live".
    private final class TestClock {
        private var current = Date(timeIntervalSince1970: 1_785_542_400)
        func now() -> Date { current }
        func advance(_ interval: TimeInterval) { current = current.addingTimeInterval(interval) }
    }

    override func setUpWithError() throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("SessionLeaseTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        sessionPath = tempDir
            .appendingPathComponent("2026-08-10T12-00-00-000Z_\(sessionID).jsonl")
            .path
        // pi session header line (format: `{"type":"session","version":3,"id":"…",…}`).
        let header = "{\"type\":\"session\",\"version\":3,\"id\":\"\(sessionID)\",\"timestamp\":\"2026-08-10T12:00:00.000Z\",\"cwd\":\"\(tempDir.path)\"}\n"
        try Data(header.utf8).write(to: URL(fileURLWithPath: sessionPath))
        clock = TestClock()
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempDir)
    }

    private func makeManager(holder: String = SessionLease.swiftHolder) -> SessionLeaseManager {
        SessionLeaseManager(
            sessionId: sessionID,
            leasePath: SessionLeaseManager.leasePath(forSessionFile: sessionPath, sessionID: sessionID),
            holder: holder,
            pid: 4242,
            hostname: "testhost.local",
            heartbeatInterval: 1,
            ttl: 45,
            now: { [weak clock] in clock?.now() ?? Date() }
        )
    }

    private func readLeaseFile() -> SessionLeaseRecord? {
        let url = URL(fileURLWithPath: SessionLeaseManager.leasePath(forSessionFile: sessionPath, sessionID: sessionID))
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(SessionLeaseRecord.self, from: data)
    }

    // MARK: - Mutual exclusion

    func testAcquireIsExclusiveAndUsesProtocolFileName() throws {
        let a = makeManager()
        let statusA = a.acquire()
        XCTAssertTrue(statusA.writable)
        XCTAssertEqual(statusA.holder?.holder, SessionLease.swiftHolder)
        XCTAssertTrue(a.isOwned)

        // Lease file must be adjacent with the Electron-convention name.
        let leaseURL = tempDir.appendingPathComponent("\(sessionID).lease.json")
        XCTAssertTrue(FileManager.default.fileExists(atPath: leaseURL.path))

        // A second writer conflicts with the current holder record.
        let b = makeManager(holder: SessionLease.electronHolder)
        let statusB = b.acquire()
        XCTAssertFalse(statusB.writable)
        XCTAssertEqual(statusB.holder?.holder, SessionLease.swiftHolder)
        XCTAssertFalse(b.isOwned)
        XCTAssertEqual(statusB.holder?.instanceId, statusA.holder?.instanceId)

        // A release lets the other writer in.
        a.release()
        XCTAssertFalse(a.isOwned)
        let statusB2 = b.acquire()
        XCTAssertTrue(statusB2.writable)
        XCTAssertEqual(statusB2.holder?.holder, SessionLease.electronHolder)
    }

    func testExpiredLeaseIsRecoveredOnAcquire() throws {
        let a = makeManager()
        XCTAssertTrue(a.acquire().writable)
        // Advance past the 45s TTL without heartbeating (simulated crash).
        clock.advance(46)
        let b = makeManager(holder: SessionLease.electronHolder)
        let status = b.acquire()
        XCTAssertTrue(status.writable, "expired lease must be recoverable by any client")
        XCTAssertEqual(status.holder?.holder, SessionLease.electronHolder)
        // The old holder sees the new writer (its in-memory `owned` flag settles
        // on the next heartbeat — checked by testHeartbeatDetectsExternalTakeover).
        XCTAssertFalse(a.query().writable)
    }

    func testExpiredLeaseRemovedByQuery() throws {
        let a = makeManager()
        XCTAssertTrue(a.acquire().writable)
        clock.advance(46)
        let b = makeManager(holder: SessionLease.electronHolder)
        let status = b.query()
        XCTAssertTrue(status.writable, "query must treat an expired lease as free")
        XCTAssertFalse(FileManager.default.fileExists(atPath: a.leasePath))
    }

    // MARK: - Heartbeat

    func testHeartbeatRefreshesExpiryAndKeepsIdentity() throws {
        let a = makeManager()
        _ = a.acquire()
        let first = readLeaseFile()
        XCTAssertNotNil(first)
        XCTAssertEqual(first?.expiresAtDate, clock.now().addingTimeInterval(45))

        clock.advance(15)
        let status = a.heartbeat()
        XCTAssertTrue(status.writable)
        let second = readLeaseFile()
        XCTAssertNotNil(second)
        XCTAssertEqual(second?.heartbeatAtDate, clock.now())
        XCTAssertEqual(second?.expiresAtDate, clock.now().addingTimeInterval(45))
        XCTAssertEqual(second?.instanceId, first?.instanceId)
        XCTAssertEqual(second?.acquiredAt, first?.acquiredAt)
    }

    func testHeartbeatDetectsExternalTakeover() throws {
        let a = makeManager()
        _ = a.acquire()
        let b = makeManager(holder: SessionLease.electronHolder)
        _ = b.forceTakeover()
        let status = a.heartbeat()
        XCTAssertFalse(status.writable, "a heartbeat after takeover must fail")
        XCTAssertEqual(status.holder?.holder, SessionLease.electronHolder)
        XCTAssertFalse(a.isOwned)
    }

    // MARK: - Release / takeover

    func testReleaseOnlyRemovesOwnLease() throws {
        let a = makeManager()
        _ = a.acquire()
        let b = makeManager(holder: SessionLease.electronHolder)
        _ = b.acquire()
        // B does not own the lease; its release must not remove A's file.
        b.release()
        XCTAssertTrue(FileManager.default.fileExists(atPath: a.leasePath))
        XCTAssertTrue(a.query().writable)
        a.release()
        XCTAssertFalse(FileManager.default.fileExists(atPath: a.leasePath))
    }

    func testForceTakeoverReplacesHolder() throws {
        let a = makeManager()
        _ = a.acquire()
        let b = makeManager(holder: SessionLease.electronHolder)
        let status = b.forceTakeover()
        XCTAssertTrue(status.writable)
        XCTAssertEqual(status.holder?.holder, SessionLease.electronHolder)
        XCTAssertEqual(status.holder?.pid, 4242)
        // Old writer's in-memory `owned` settles on its next heartbeat; its
        // query immediately reflects the foreign lease.
        let conflict = a.query()
        XCTAssertFalse(conflict.writable)
        XCTAssertEqual(conflict.holder?.holder, SessionLease.electronHolder)
    }

    // MARK: - Cross-implementation format compatibility

    /// Fixture written exactly as the Electron `LeaseManager` writes it
    /// (`new Date().toISOString()` timestamps, extra unknown field for forward
    /// compat). The Swift reader must treat it as a live foreign lease.
    func testReadsElectronLeaseFixture() throws {
        let fixture = """
        {"protocolVersion":1,"holder":"pipiui-electron","pid":98765,"hostname":"macbook.local","instanceId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","acquiredAt":"2026-08-10T12:00:00.000Z","heartbeatAt":"2026-08-10T12:00:15.000Z","expiresAt":"2026-08-10T12:00:45.000Z","futureField":"ignored"}
        """
        let leaseURL = tempDir.appendingPathComponent("\(sessionID).lease.json")
        try Data(fixture.utf8).write(to: leaseURL)

        let b = makeManager()
        let status = b.query()
        XCTAssertFalse(status.writable)
        XCTAssertEqual(status.holder?.holder, "pipiui-electron")
        XCTAssertEqual(status.holder?.pid, 98765)
        XCTAssertEqual(status.holder?.protocolVersion, 1)

        // Acquire must fail while the Electron lease is live (clock starts 9 days
        // before the fixture, so advance to just before its TTL boundary).
        XCTAssertFalse(b.acquire().writable)
        clock.advance(9 * 86_400 + 12 * 3_600 + 44)
        XCTAssertFalse(b.acquire().writable, "lease still live one second before expiry")

        // After the Electron TTL expires, the Swift side recovers the lease.
        clock.advance(2)
        let recovered = b.acquire()
        XCTAssertTrue(recovered.writable)
        XCTAssertEqual(recovered.holder?.holder, SessionLease.swiftHolder)
        // The file now carries the Swift holder's record (Electron's is gone).
        XCTAssertEqual(readLeaseFile()?.holder, SessionLease.swiftHolder)
    }

    /// Fixture without fractional seconds (`…Z`) must still parse and expire.
    func testReadsElectronFixtureWithoutFractionalSeconds() throws {
        let fixture = """
        {"protocolVersion":1,"holder":"pipiui-electron","pid":123,"hostname":"macbook.local","instanceId":"bbbbbbbb-cccc-dddd-eeee-ffffffffffff","acquiredAt":"2026-08-10T12:00:00Z","heartbeatAt":"2026-08-10T12:00:15Z","expiresAt":"2026-08-10T12:00:45Z"}
        """
        let leaseURL = tempDir.appendingPathComponent("\(sessionID).lease.json")
        try Data(fixture.utf8).write(to: leaseURL)
        XCTAssertFalse(makeManager().acquire().writable)
        clock.advance(9 * 86_400 + 12 * 3_600 + 46)
        XCTAssertTrue(makeManager().acquire().writable)
    }

    /// The Swift-written file must carry the protocol v1 fields with Electron
    /// parsable timestamps (ISO-8601 with `Z`).
    func testSwiftWrittenRecordIsElectronParseable() throws {
        let a = makeManager()
        _ = a.acquire()
        guard let record = readLeaseFile() else {
            return XCTFail("lease file missing after acquire")
        }
        XCTAssertEqual(record.protocolVersion, SessionLease.protocolVersion)
        XCTAssertEqual(record.holder, SessionLease.swiftHolder)
        XCTAssertEqual(record.pid, 4242)
        XCTAssertEqual(record.hostname, "testhost.local")
        XCTAssertFalse(record.instanceId.isEmpty)
        XCTAssertNotNil(record.expiresAtDate)
        XCTAssertTrue(record.heartbeatAt.hasSuffix("Z"), "timestamps must be Z-suffixed for Date.parse")
        XCTAssertTrue(record.expiresAt.hasSuffix("Z"))
        // Electron compares with `Date.parse(record.expiresAt) <= now()`; our
        // stamps must parse with the Electron toolchain shape (fractional + Z).
        XCTAssertTrue(SessionLease.parseISO(record.expiresAt) != nil)
    }

    // MARK: - Session id / path resolution

    func testSessionIDParsedFromJSONLHeader() throws {
        XCTAssertEqual(SessionLeaseManager.sessionID(fromSessionFile: sessionPath), sessionID)
        XCTAssertEqual(
            SessionLeaseManager.leasePath(forSessionFile: sessionPath),
            tempDir.appendingPathComponent("\(sessionID).lease.json").path
        )
        // Missing / unreadable file → no id, no lease path.
        XCTAssertNil(SessionLeaseManager.sessionID(fromSessionFile: tempDir.appendingPathComponent("missing.jsonl").path))
        XCTAssertNil(SessionLeaseManager.leasePath(forSessionFile: tempDir.appendingPathComponent("missing.jsonl").path))
    }

    func testManagerConvenienceInitFromSessionFile() throws {
        guard let manager = SessionLeaseManager(sessionFile: sessionPath, now: { [weak clock] in clock?.now() ?? Date() }) else {
            return XCTFail("convenience init must resolve id from header")
        }
        XCTAssertEqual(manager.sessionId, sessionID)
        XCTAssertEqual(manager.leasePath, tempDir.appendingPathComponent("\(sessionID).lease.json").path)
        XCTAssertTrue(manager.acquire().writable)
        manager.release()
    }
}

private extension SessionLeaseRecord {
    var heartbeatAtDate: Date? { SessionLease.parseISO(heartbeatAt) }
}
