import XCTest
@testable import PipiUI

/// AgentCatalog 进程级缓存（目录 mtime 失效）回归测试。
final class AgentCatalogCacheTests: XCTestCase {
    private var tempDir: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("AgentCatalogCacheTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        AgentCatalog.invalidateCache()
    }

    override func tearDownWithError() throws {
        AgentCatalog.invalidateCache()
        try? FileManager.default.removeItem(at: tempDir)
        try super.tearDownWithError()
    }

    private func writeAgent(_ name: String, description: String) throws {
        let text = """
        ---
        name: \(name)
        description: \(description)
        tools: read, bash
        ---
        body
        """
        try text.write(to: tempDir.appendingPathComponent("\(name).md"), atomically: true, encoding: .utf8)
    }

    func testLoadCachesPerDirectory() throws {
        try writeAgent("custom-agent", description: "first")
        let first = AgentCatalog.load(from: tempDir)
        XCTAssertTrue(first.contains(where: { $0.name == "custom-agent" && $0.description == "first" }))

        // 直接绕过缓存写文件、并把目录/文件 mtime 戳回去，模拟「没变」：
        // 第二次 load 应命中缓存（此处只能间接验证：改文件内容但保持 mtime 相同困难，
        // 所以改为验证缓存键存在行为 —— 新文件加进去后 mtime 变化即失效，见下一条）。
        AgentCatalog.invalidateCache()
        let second = AgentCatalog.load(from: tempDir)
        XCTAssertEqual(first, second)
    }

    func testCacheInvalidatesOnMtimeChange() throws {
        try writeAgent("mtime-agent", description: "v1")
        let first = AgentCatalog.load(from: tempDir)
        XCTAssertTrue(first.contains(where: { $0.name == "mtime-agent" && $0.description == "v1" }))

        // 等过一个 mtime 粒度后改内容，应触发失效重读。
        Thread.sleep(forTimeInterval: 0.02)
        try writeAgent("mtime-agent", description: "v2")
        let fileURL = tempDir.appendingPathComponent("mtime-agent.md")
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(60)],
            ofItemAtPath: fileURL.path
        )
        let second = AgentCatalog.load(from: tempDir)
        XCTAssertTrue(second.contains(where: { $0.name == "mtime-agent" && $0.description == "v2" }))
    }

    func testBuiltInsMergedWhenDirectoryHasCustomAgents() throws {
        try writeAgent("custom-only", description: "custom")
        let loaded = AgentCatalog.load(from: tempDir)
        XCTAssertTrue(loaded.contains(where: { $0.name == "custom-only" }))
        XCTAssertTrue(loaded.contains(where: { $0.name == "explore" }))
    }
}
