import XCTest
@testable import PipiUI

final class SessionPinLogicTests: XCTestCase {
    private func meta(_ path: String, name: String = "s", modified: Date = .distantPast) -> SessionMeta {
        SessionMeta(path: path, name: name, modified: modified)
    }

    func testActiveMetasExcludesPinned() {
        let a = meta("/a.jsonl")
        let b = meta("/b.jsonl")
        let out = SessionPinLogic.activeMetas(from: [a, b], excludingPinned: ["/a.jsonl"])
        XCTAssertEqual(out.map(\.path), ["/b.jsonl"])
    }

    func testActiveMetasUnchangedWhenPinSetEmpty() {
        let a = meta("/a.jsonl")
        XCTAssertEqual(SessionPinLogic.activeMetas(from: [a], excludingPinned: []).map(\.path), ["/a.jsonl"])
    }

    func testPinnedMetasCollectsAcrossProjectsAndSorts() {
        let older = Date(timeIntervalSince1970: 1)
        let newer = Date(timeIntervalSince1970: 2)
        let byProject: [String: [SessionMeta]] = [
            "/p1": [meta("/p1/s1.jsonl", name: "one", modified: older)],
            "/p2": [meta("/p2/s2.jsonl", name: "two", modified: newer)],
        ]
        let pinned: Set<String> = ["/p1/s1.jsonl", "/p2/s2.jsonl"]
        let out = SessionPinLogic.pinnedMetas(
            sessionsByProject: byProject,
            pinned: pinned,
            sortBy: { $0.modified > $1.modified }
        )
        XCTAssertEqual(out.map(\.path), ["/p2/s2.jsonl", "/p1/s1.jsonl"])
    }

    func testPinnedMetasSkipsUnknownPaths() {
        let byProject = ["/p1": [meta("/p1/s1.jsonl")]]
        let out = SessionPinLogic.pinnedMetas(
            sessionsByProject: byProject,
            pinned: ["/missing.jsonl", "/p1/s1.jsonl"],
            sortBy: { _, _ in false }
        )
        XCTAssertEqual(out.map(\.path), ["/p1/s1.jsonl"])
    }

    func testProjectPathResolvesViaSessionDirectory() {
        let projects = [
            URL(fileURLWithPath: "/Users/me/proj-a"),
            URL(fileURLWithPath: "/Users/me/proj-b"),
        ]
        let sessionPath = AppStore.sessionDirectory(forCwd: "/Users/me/proj-b")
            .appendingPathComponent("abc.jsonl").path
        let resolved = SessionPinLogic.projectPath(
            forSessionPath: sessionPath,
            projects: projects,
            sessionDirectory: AppStore.sessionDirectory(forCwd:)
        )
        XCTAssertEqual(resolved, "/Users/me/proj-b")
    }

    func testProjectPathNilWhenNoMatch() {
        let resolved = SessionPinLogic.projectPath(
            forSessionPath: "/other/x.jsonl",
            projects: [URL(fileURLWithPath: "/Users/me/proj-a")],
            sessionDirectory: AppStore.sessionDirectory(forCwd:)
        )
        XCTAssertNil(resolved)
    }
}
