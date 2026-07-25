import XCTest
import PipiUI
import Foundation

final class EnvFileStoreTests: XCTestCase {

    private var tmpDir: URL!
    private var envURL: URL!
    private var store: EnvFileStore!

    override func setUpWithError() throws {
        tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("EnvFileStoreTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        envURL = tmpDir.appendingPathComponent(".env")
        store = EnvFileStore(fileURL: envURL)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tmpDir)
    }

    // MARK: helpers

    private func write(_ text: String) throws {
        try text.write(to: envURL, atomically: true, encoding: .utf8)
    }

    private var fileText: String {
        (try? String(contentsOf: envURL, encoding: .utf8)) ?? ""
    }

    private func posixPerms() -> Int? {
        (try? FileManager.default.attributesOfItem(atPath: envURL.path))?[.posixPermissions] as? Int
    }

    // MARK: - parsing

    func testParsesCommentsBlanksAndQuotedValues() throws {
        try write("""
        # top comment

        FOO=bar
        BAZ="hello world"
        QUOTED_SINGLE='single value'
        EMPTY=
        INLINE_SPACES = spaced
        """)

        XCTAssertEqual(store.value(forKey: "FOO"), "bar")
        XCTAssertEqual(store.value(forKey: "BAZ"), "hello world")
        XCTAssertEqual(store.value(forKey: "QUOTED_SINGLE"), "single value")
        XCTAssertEqual(store.value(forKey: "EMPTY"), "")
        XCTAssertEqual(store.value(forKey: "INLINE_SPACES"), "spaced")
        XCTAssertNil(store.value(forKey: "MISSING"))
        XCTAssertEqual(store.all().count, 5)
    }

    func testIsConfigured() throws {
        try write("A=1\nB=\n")
        XCTAssertTrue(store.isConfigured(forKey: "A"))
        XCTAssertFalse(store.isConfigured(forKey: "B"))
        XCTAssertFalse(store.isConfigured(forKey: "C"))
    }

    func testMissingFileReadsEmpty() {
        XCTAssertEqual(store.all(), [:])
        XCTAssertNil(store.value(forKey: "X"))
    }

    // MARK: - round-trip preserves comments/order

    func testSetPreservesCommentsAndOrder() throws {
        try write("""
        # provider keys
        ANTHROPIC_API_KEY=old
        # xai below
        XAI_API_KEY=xai-old

        """)

        try store.setSync("new-secret", forKey: "ANTHROPIC_API_KEY")

        XCTAssertEqual(fileText, """
        # provider keys
        ANTHROPIC_API_KEY=new-secret
        # xai below
        XAI_API_KEY=xai-old

        """)
    }

    func testSetNewKeyAppendsAtEnd() throws {
        try write("# c\nA=1\n")
        try store.setSync("2", forKey: "B")
        XCTAssertEqual(fileText, "# c\nA=1\nB=2\n")
    }

    func testSetValueWithSpacesGetsQuoted() throws {
        try write("A=1\n")
        try store.setSync("has space", forKey: "A")
        XCTAssertEqual(fileText, "A=\"has space\"\n")
        XCTAssertEqual(EnvFileStore(fileURL: envURL).value(forKey: "A"), "has space")
    }

    func testRemoveKeepsOtherLines() throws {
        try write("# head\nA=1\nB=2\n")
        XCTAssertTrue(try store.removeSync(forKey: "A"))
        XCTAssertEqual(fileText, "# head\nB=2\n")
        XCTAssertNil(store.value(forKey: "A"))
    }

    func testRemoveMissingKeyReturnsFalseAndKeepsFile() throws {
        try write("A=1\n")
        XCTAssertFalse(try store.removeSync(forKey: "NOPE"))
        XCTAssertEqual(fileText, "A=1\n")
    }

    // MARK: - permissions

    func testNewFileCreatedWith0600() throws {
        try store.setSync("v", forKey: "K")
        XCTAssertEqual(posixPerms(), 0o600)
    }

    func testExistingLooseFileCorrectedTo0600() throws {
        try write("K=v\n")
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: envURL.path)
        XCTAssertEqual(posixPerms(), 0o644)
        try store.setSync("v2", forKey: "K")
        XCTAssertEqual(posixPerms(), 0o600)
        XCTAssertEqual(store.value(forKey: "K"), "v2")
    }

    // MARK: - mtime invalidation

    func testExternalEditIsPickedUp() throws {
        try write("A=1\n")
        XCTAssertEqual(store.value(forKey: "A"), "1") // populate cache
        // ensure mtime advances
        Thread.sleep(forTimeInterval: 0.02)
        try write("A=2\n")
        XCTAssertEqual(store.value(forKey: "A"), "2")
    }

    func testExternalDeleteIsPickedUp() throws {
        try write("A=1\n")
        XCTAssertEqual(store.value(forKey: "A"), "1")
        Thread.sleep(forTimeInterval: 0.02)
        try FileManager.default.removeItem(at: envURL)
        XCTAssertNil(store.value(forKey: "A"))
    }

    // MARK: - concurrency

    func testConcurrentWritesDoNotLoseKeys() throws {
        try write("# base\n")
        let n = 40
        DispatchQueue.concurrentPerform(iterations: n) { i in
            try? store.setSync("v\(i)", forKey: "KEY_\(i)")
        }
        let fresh = EnvFileStore(fileURL: envURL)
        for i in 0..<n {
            XCTAssertEqual(fresh.value(forKey: "KEY_\(i)"), "v\(i)", "lost KEY_\(i)")
        }
    }

    func testConcurrentSetAndRemove() throws {
        try write((0..<20).map { "K\($0)=x" }.joined(separator: "\n") + "\n")
        DispatchQueue.concurrentPerform(iterations: 20) { i in
            if i % 2 == 0 {
                try? store.setSync("y", forKey: "K\(i)")
            } else {
                try? store.removeSync(forKey: "K\(i)")
            }
        }
        let fresh = EnvFileStore(fileURL: envURL)
        for i in 0..<20 {
            if i % 2 == 0 {
                XCTAssertEqual(fresh.value(forKey: "K\(i)"), "y")
            } else {
                XCTAssertNil(fresh.value(forKey: "K\(i)"))
            }
        }
    }

    // MARK: - async API

    func testAsyncSetCompletionOnMain() throws {
        let exp = expectation(description: "set completion")
        store.set("v", forKey: "AK") { result in
            XCTAssertTrue(Thread.isMainThread)
            if case .failure(let e) = result { XCTFail("unexpected error: \(e)") }
            exp.fulfill()
        }
        waitForExpectations(timeout: 5)
        XCTAssertEqual(EnvFileStore(fileURL: envURL).value(forKey: "AK"), "v")
    }

    func testAsyncRemoveCompletion() throws {
        try write("RK=1\n")
        let exp = expectation(description: "remove completion")
        store.remove(forKey: "RK") { result in
            XCTAssertTrue(Thread.isMainThread)
            if case .success(let removed) = result {
                XCTAssertTrue(removed)
            } else {
                XCTFail("unexpected failure")
            }
            exp.fulfill()
        }
        waitForExpectations(timeout: 5)
        XCTAssertFalse(fileText.contains("RK="))
    }
}
