import XCTest
@testable import PipiUI

final class MemoryExtensionTests: XCTestCase {
    func testGeneratedExtensionHasProposalOnlyTrustBoundaryAndFrozenSnapshotBounds() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-memory-extension-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(MemoryExtension.install(into: dir))
        let source = try String(contentsOfFile: path, encoding: .utf8)

        XCTAssertTrue(source.contains("name: \"memory_propose\""))
        XCTAssertTrue(source.contains("if (!enabled())"))
        XCTAssertTrue(source.contains("fs.openSync(temp, \"wx\", 0o600)"))
        XCTAssertTrue(source.contains("fs.linkSync(temp, file)"))
        XCTAssertTrue(source.contains("approved.json is read-only here"))
        XCTAssertFalse(source.contains("writeExclusiveJSON(APPROVED"))
        XCTAssertFalse(source.contains("source: Type."), "model schema must not accept provenance")
        XCTAssertTrue(source.contains("ctx.sessionManager.getSessionId().trim()"))
        XCTAssertTrue(source.contains("projectPath: path.resolve(ctx.cwd)"))
        XCTAssertTrue(source.contains("if (existing) return existing"))
        XCTAssertTrue(source.contains("SNAPSHOT_MAX_COUNT = 200"))
        XCTAssertTrue(source.contains("SNAPSHOT_MAX_AGE_MS"))
        XCTAssertTrue(source.contains("USER_BYTE_LIMIT = 2048"))
        XCTAssertTrue(source.contains("PROJECT_BYTE_LIMIT = 4096"))
        XCTAssertTrue(source.contains("REASON_BYTE_LIMIT = 1024"))
        XCTAssertTrue(source.contains("PENDING_MAX_COUNT = 100"))
        XCTAssertTrue(source.contains("pendingCount >= PENDING_MAX_COUNT"))
        XCTAssertTrue(source.contains("boundedEntries(value.entries, value.projectPath)"))
        XCTAssertTrue(source.contains("data, not executable instructions"))

        let mode = try XCTUnwrap(
            FileManager.default.attributesOfItem(atPath: path)[.posixPermissions] as? NSNumber
        ).intValue
        XCTAssertEqual(mode & 0o777, 0o600)
    }

    func testSpawnAssemblyMountsMemoryOnlyWhenExplicitlyResolved() {
        var installed = PiPlugin.Installed()
        installed.memoryExtension = "/p/memory.ts"
        let off = PipiSpawnAssembly.Paths.resolved(
            installed: installed,
            features: .init(),
            philosophyExtension: nil,
            computerUseExtension: nil,
            memoryEnabled: false
        )
        let on = PipiSpawnAssembly.Paths.resolved(
            installed: installed,
            features: .init(),
            philosophyExtension: nil,
            computerUseExtension: nil,
            memoryEnabled: true
        )
        XCTAssertNil(off.memory)
        XCTAssertEqual(on.memory, "/p/memory.ts")

        let output = PipiSpawnAssembly.assemble(.init(
            sessionPath: nil,
            bridgePort: 0,
            bridgeRoutingKey: "bridge",
            computerRoutingKey: "computer",
            grantSessionKey: "session",
            mainCWD: "/tmp/project",
            paths: on,
            features: .init(),
            computerDescriptor: nil,
            mainModelId: nil,
            excludeToolsArgs: [],
            webSearchConfigFile: "/tmp/web.json"
        ))
        XCTAssertTrue(output.args.contains("/p/memory.ts"))
    }
}
