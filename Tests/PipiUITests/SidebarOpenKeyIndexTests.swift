import XCTest
@testable import PipiUI

/// Pure snapshot/dedup seam for the sidebar hot path: `SidebarOpenKeyIndex` is
/// built once per body and turns each row's open-key resolution from a linear
/// scan over `store.openSessions` into a dictionary lookup. These tests pin the
/// lookup semantics (sessionFile wins over resume, resume fallback, nil for
/// unknown) without touching SwiftUI or AppStore.
final class SidebarOpenKeyIndexTests: XCTestCase {
    private func makeSession(id: String, file: String?) -> ChatSession {
        let session = ChatSession(
            id: id,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "sidebar-index-test"
        )
        session.sessionFile = file
        return session
    }

    private func meta(path: String) -> SessionMeta {
        SessionMeta(path: path, name: "n", modified: Date(timeIntervalSince1970: 0))
    }

    func testEmptyOpenSessionsYieldsNil() {
        let index = SidebarOpenKeyIndex(openSessions: [:])
        XCTAssertNil(index.openKey(forPath: "/none"))
        XCTAssertNil(index.openKey(for: meta(path: "/none")))
    }

    func testSessionFileMatchResolvesToItsKey() {
        let live = makeSession(id: "new:abc", file: "/p/s.jsonl")
        let index = SidebarOpenKeyIndex(openSessions: ["new:abc": live])
        XCTAssertEqual(index.openKey(forPath: "/p/s.jsonl"), "new:abc")
        XCTAssertEqual(index.openKey(for: meta(path: "/p/s.jsonl")), "new:abc")
    }

    func testResumeFallbackWhenNoLiveSessionFileCoversPath() {
        // A resumed session has no sessionFile here; its key is resume:<path>.
        let resume = makeSession(id: "resume:/p/s.jsonl", file: nil)
        let index = SidebarOpenKeyIndex(openSessions: ["resume:/p/s.jsonl": resume])
        XCTAssertEqual(index.openKey(forPath: "/p/s.jsonl"), "resume:/p/s.jsonl")
    }

    func testSessionFileWinsOverResumeKey() {
        // Both a live new:* (with the file) and a resume:<path> back the same
        // path; the live sessionFile match must win, mirroring the legacy
        // `openSessions.first { … sessionFile == meta.path }` priority.
        let live = makeSession(id: "new:abc", file: "/p/s.jsonl")
        let resume = makeSession(id: "resume:/p/s.jsonl", file: nil)
        let index = SidebarOpenKeyIndex(openSessions: [
            "new:abc": live,
            "resume:/p/s.jsonl": resume,
        ])
        XCTAssertEqual(index.openKey(forPath: "/p/s.jsonl"), "new:abc")
    }

    func testEmptyAndNilSessionFilesAreIgnored() {
        let blank = makeSession(id: "new:x", file: "")
        let index = SidebarOpenKeyIndex(openSessions: ["new:x": blank])
        XCTAssertNil(index.openKey(forPath: ""))
    }

    func testManyPathsResolveInConstantLookupTime() {
        // Smoke test: a non-trivial open-session set still resolves arbitrary
        // paths through the dictionary (no scanning, no misses leaking through).
        var open: [String: ChatSession] = [:]
        for i in 0..<200 {
            open["new:\(i)"] = makeSession(id: "new:\(i)", file: "/p/s\(i).jsonl")
        }
        let index = SidebarOpenKeyIndex(openSessions: open)
        XCTAssertEqual(index.openKey(forPath: "/p/s0.jsonl"), "new:0")
        XCTAssertEqual(index.openKey(forPath: "/p/s199.jsonl"), "new:199")
        XCTAssertNil(index.openKey(forPath: "/p/missing.jsonl"))
    }
}
