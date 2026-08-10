import XCTest
@testable import PipiUI

/// Generated plan-runtime extension contract: tools, store-owned revision ack,
/// authenticated bridge delivery, and main-bridged-session packaging.
final class PlanRuntimeExtensionTests: XCTestCase {
    private func installedSource() throws -> String {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-plan-runtime-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(PlanRuntimeExtension.install(into: dir))
        XCTAssertTrue(path.hasSuffix(PlanRuntimeExtension.fileName))
        XCTAssertEqual(PlanRuntimeExtension.fileName, "pipiui-plan-runtime.ts")
        return try String(contentsOfFile: path, encoding: .utf8)
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    func testRegistersPublishAndTaskUpdateTools() throws {
        let source = try installedSource()
        XCTAssertTrue(source.contains("name: \"plan_publish\""))
        XCTAssertTrue(source.contains("name: \"plan_approve\""))
        XCTAssertTrue(source.contains("name: \"plan_cancel\""))
        XCTAssertTrue(source.contains("name: \"plan_task_update\""))
        XCTAssertTrue(source.contains("action: \"plan_event\""))
        XCTAssertTrue(source.contains("event: \"publish\""))
        XCTAssertTrue(source.contains("event: \"task_update\""))
        XCTAssertTrue(source.contains("event: \"approve\" | \"cancel\""))
        XCTAssertTrue(source.contains("Only then may execution begin"))
        XCTAssertTrue(source.contains("const SCHEMA_VERSION = 1;"))
        XCTAssertTrue(source.contains("const MAX_TASKS = 100;"))
    }

    func testUsesNaturalLanguageApprovalWordingAndChineseExamples() throws {
        let source = try installedSource()
        XCTAssertTrue(source.contains("use a concise invitation in the user's language"))
        XCTAssertTrue(source.contains("never require the user to type Execute, Adjust, Ignore, or any English token."))
        XCTAssertTrue(source.contains("For Chinese, say: 如果批准，请回复“批准”；如果需要调整计划或不执行，直接告诉我。"))
        XCTAssertTrue(source.contains("批准, 开始执行, or 执行计划 as Execute."))
        XCTAssertTrue(source.contains("调整 or 修改计划 with feedback as Adjust"))
        XCTAssertTrue(source.contains("忽略, 取消, or 不执行 as Ignore"))
        XCTAssertFalse(source.contains("after the user says Execute"))
        XCTAssertFalse(source.contains("after the user says Ignore"))
    }

    func testDoesNotSendClientRevisionAndRequiresIntegerRevisionAck() throws {
        let source = try installedSource()
        XCTAssertFalse(source.contains("revision must be a finite integer"))
        XCTAssertFalse(source.contains("revision must be >= 1"))
        XCTAssertFalse(source.contains("asRevision"))
        XCTAssertFalse(source.contains("revision: Type.Integer"))
        XCTAssertTrue(source.contains("Number.isInteger(revisionRaw)"))
        XCTAssertTrue(source.contains("body.ok === true && body.applied === true && revision != null"))
        XCTAssertTrue(source.contains("missing integer revision"))
        XCTAssertTrue(source.contains("if (!delivery.delivered || !delivery.applied || delivery.revision == null)"))
        XCTAssertTrue(source.contains("Plan publish failed:"))
        XCTAssertTrue(source.contains("Plan task update failed:"))
        XCTAssertTrue(source.contains("Published plan rev ${rev}"))
        XCTAssertTrue(source.contains("Updated task ${task.id} → ${task.state} (rev ${rev})"))
    }

    func testValidatesSchemaPlanAndTaskFields() throws {
        let source = try installedSource()
        XCTAssertTrue(source.contains("unsupported schemaVersion"))
        XCTAssertTrue(source.contains("plan must be an object"))
        XCTAssertTrue(source.contains("plan.tasks must be an array"))
        XCTAssertTrue(source.contains("plan.tasks exceeds max of ${MAX_TASKS}"))
        XCTAssertTrue(source.contains("duplicate task id"))
        XCTAssertTrue(source.contains("task must be an object"))
        // plan.id / planId mandatory
        XCTAssertTrue(source.contains("asNonEmptyString(obj.id, \"plan.id\")") || source.contains("plan.id"))
        XCTAssertTrue(source.contains("id: Type.String({ description: \"Stable unique plan id"))
        XCTAssertTrue(source.contains("planId: Type.String"))
        XCTAssertTrue(source.contains("asNonEmptyString(params.planId, \"planId\")"))
        // Explicit JSON null is rejected (omission OK; empty string clears detail/error).
        XCTAssertTrue(source.contains("if (value === null) return { error: `${field} must be a string when present` }"))
        XCTAssertTrue(source.contains("Empty string is preserved so the store can clear"))
        XCTAssertTrue(source.contains("\"pending\""))
        XCTAssertTrue(source.contains("\"running\""))
        XCTAssertTrue(source.contains("\"completed\""))
        XCTAssertTrue(source.contains("\"failed\""))
        XCTAssertTrue(source.contains("\"blocked\""))
        XCTAssertTrue(source.contains("\"skipped\""))
        XCTAssertTrue(source.contains("KNOWN_STATES"))
    }

    func testPostsAuthenticatedPlanEventAndSurfacesNonAppliedAsToolError() throws {
        let source = try installedSource()
        XCTAssertTrue(source.contains("process.env.PIPIUI_BRIDGE_PORT"))
        XCTAssertTrue(source.contains("process.env.PIPIUI_SESSION_KEY"))
        XCTAssertTrue(source.contains("sessionKey: KEY"))
        XCTAssertTrue(source.contains("http://127.0.0.1:${PORT}/rpc"))
        XCTAssertTrue(source.contains("method: \"POST\""))
        XCTAssertTrue(source.contains("missing PIPIUI_BRIDGE_PORT or PIPIUI_SESSION_KEY"))
        XCTAssertTrue(source.contains("async function postPlanEvent"))
        XCTAssertTrue(source.contains("applied: false"))
        XCTAssertTrue(source.contains("ok: false"))
    }

    func testInstalledIntoPiPluginPaths() throws {
        let root = repositoryRoot()
        let plugin = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiPlugin.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(plugin.contains("PlanRuntimeExtension.install(into: root)"))
        XCTAssertTrue(plugin.contains("planRuntimeExtension"))
        XCTAssertTrue(plugin.contains("(PlanRuntimeExtension.fileName, \\.planRuntimeExtension)"))
        XCTAssertTrue(plugin.contains("var planRuntimeExtension: String?"))
    }

    func testMountedOnlyForMainBridgedSessionAndNeverExportedToWorkers() throws {
        let root = repositoryRoot()
        let assembly = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PipiSpawnAssembly.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(assembly.contains("planRuntime"))
        XCTAssertTrue(assembly.contains("if f.isEnabled(.philosophy), let p = input.paths.planRuntime { args += [\"-e\", p] }"))
        XCTAssertTrue(assembly.contains("planRuntime: features.isEnabled(.philosophy) ? installed.planRuntimeExtension : nil"))
        XCTAssertFalse(assembly.contains("PIPIUI_PLAN_RUNTIME_EXT"))
        XCTAssertFalse(assembly.contains("PIPIUI_PLAN_EXT"))
        XCTAssertTrue(assembly.contains("Do not re-export"))

        let subagent = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/index.ts"),
            encoding: .utf8
        )
        XCTAssertFalse(subagent.contains("plan-runtime"))
        XCTAssertFalse(subagent.contains("plan_publish"))
        XCTAssertFalse(subagent.contains("PIPIUI_PLAN_"))
    }
}
