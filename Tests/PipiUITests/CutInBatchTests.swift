import XCTest
@testable import PipiUI

/// Cut-in batch semantics: one「插队」click joins ALL queued messages into a single prompt,
/// and pending subagent followUp signals must not cut ahead of the joined cut-in prompt.
final class CutInBatchTests: XCTestCase {

    // MARK: - Queue batch pop

    /// Acceptance: N queued + cut-in → one joined prompt, queue emptied, flag reset.
    func testArmedCutInPopsAllAndResets() {
        var q = SessionMessageQueue()
        XCTAssertTrue(q.enqueue(text: "one"))
        XCTAssertTrue(q.enqueue(text: "two"))
        XCTAssertTrue(q.enqueue(text: "three"))
        q.armCutInJoin()
        XCTAssertTrue(q.cutInJoinArmed)

        let batch = q.popAllForCutIn(isStreaming: false, processAlive: true)
        XCTAssertEqual(batch?.map(\.text), ["one", "two", "three"])
        XCTAssertTrue(q.isEmpty)
        XCTAssertFalse(q.cutInJoinArmed, "armed flag must reset after batch pop")

        // Second drain finds nothing — no repeated sends.
        XCTAssertNil(q.popAllForCutIn(isStreaming: false, processAlive: true))
        XCTAssertNil(q.popForIdleDrain(isStreaming: false, processAlive: true))
    }

    /// Idempotent arming: rapid double clicks must not corrupt state.
    func testArmCutInJoinIsIdempotent() {
        var q = SessionMessageQueue()
        XCTAssertTrue(q.enqueue(text: "a"))
        q.armCutInJoin()
        q.armCutInJoin()
        let batch = q.popAllForCutIn(isStreaming: false, processAlive: true)
        XCTAssertEqual(batch?.count, 1)
        XCTAssertFalse(q.cutInJoinArmed)
    }

    /// Unarmed queue keeps the legacy single-head FIFO semantics (Stop / settle drain).
    func testUnarmedPopAllIsNilAndSingleDrainUnchanged() {
        var q = SessionMessageQueue()
        XCTAssertTrue(q.enqueue(text: "head"))
        XCTAssertTrue(q.enqueue(text: "tail"))
        XCTAssertNil(q.popAllForCutIn(isStreaming: false, processAlive: true))
        let head = q.popForIdleDrain(isStreaming: false, processAlive: true)
        XCTAssertEqual(head?.text, "head")
        XCTAssertEqual(q.items.first?.text, "tail")
    }

    /// Armed but still streaming (or dead process): keep the flag, pop nothing.
    func testArmedPopAllBlockedWhileStreamingOrDead() {
        var q = SessionMessageQueue()
        XCTAssertTrue(q.enqueue(text: "a"))
        q.armCutInJoin()
        XCTAssertNil(q.popAllForCutIn(isStreaming: true, processAlive: true))
        XCTAssertNil(q.popAllForCutIn(isStreaming: false, processAlive: false))
        XCTAssertTrue(q.cutInJoinArmed)
        XCTAssertEqual(q.count, 1)
    }

    /// Armed-but-empty consumes the flag without producing a prompt.
    func testArmedPopAllOnEmptyConsumesFlag() {
        var q = SessionMessageQueue()
        q.armCutInJoin()
        XCTAssertNil(q.popAllForCutIn(isStreaming: false, processAlive: true))
        XCTAssertFalse(q.cutInJoinArmed)
    }

    /// restoreAll (撤回编辑) disarms a pending cut-in join.
    func testRestoreAllDisarmsCutIn() {
        var q = SessionMessageQueue()
        XCTAssertTrue(q.enqueue(text: "a"))
        q.armCutInJoin()
        _ = q.restoreAll()
        XCTAssertFalse(q.cutInJoinArmed)
        XCTAssertTrue(q.isEmpty)
    }

    // MARK: - Join rules

    /// Join separator reuses joinTexts ("\\n\\n"); images merge in FIFO order.
    func testJoinedCutInTextAndImages() {
        let imgA = DraftImage(data: Data([1]), mimeType: "image/png", preview: NSImage(size: NSSize(width: 1, height: 1)))
        let imgB = DraftImage(data: Data([2]), mimeType: "image/png", preview: NSImage(size: NSSize(width: 1, height: 1)))
        let batch = [
            QueuedMessage(text: "first", images: [imgA]),
            QueuedMessage(text: "second", images: [imgB]),
        ]
        let joined = SessionMessageQueue.joinedCutIn(batch)
        XCTAssertEqual(joined.text, "first\n\nsecond")
        XCTAssertEqual(joined.images.map(\.data), [Data([1]), Data([2])])
        XCTAssertEqual(joined.searchGrantPolicy, .localHumanRecordPromptPaths)
    }

    /// Policy: last human-authored message in the batch wins (local or remote).
    func testJoinedCutInPolicyLastHumanAuthored() {
        let batch = [
            QueuedMessage(text: "h", searchGrantPolicy: .localHumanRecordPromptPaths),
            QueuedMessage(text: "app", searchGrantPolicy: .appAuthoredPreserveLatestHumanGrant),
            QueuedMessage(text: "r", searchGrantPolicy: .remoteClearGrant),
            QueuedMessage(text: "app2", searchGrantPolicy: .appAuthoredPreserveLatestHumanGrant),
        ]
        XCTAssertEqual(
            SessionMessageQueue.joinedCutIn(batch).searchGrantPolicy,
            .remoteClearGrant,
            "the last human-authored item (remote) must set the joined policy"
        )
        let localLast = [
            QueuedMessage(text: "r", searchGrantPolicy: .remoteClearGrant),
            QueuedMessage(text: "h", searchGrantPolicy: .localHumanRecordPromptPaths),
        ]
        XCTAssertEqual(
            SessionMessageQueue.joinedCutIn(localLast).searchGrantPolicy,
            .localHumanRecordPromptPaths
        )
    }

    /// Purely app-authored batch falls back to preserve-latest-human-grant.
    func testJoinedCutInPolicyAppAuthoredFallback() {
        let batch = [
            QueuedMessage(text: "app", searchGrantPolicy: .appAuthoredPreserveLatestHumanGrant),
            QueuedMessage(text: "app2", searchGrantPolicy: .appAuthoredPreserveLatestHumanGrant),
        ]
        XCTAssertEqual(
            SessionMessageQueue.joinedCutIn(batch).searchGrantPolicy,
            .appAuthoredPreserveLatestHumanGrant
        )
    }

    // MARK: - Extension hold (source invariants, same harness as SubagentContinuityTests)

    private func subagentSource() throws -> String {
        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        return try String(contentsOf: bundled.appendingPathComponent("subagent/index.ts"), encoding: .utf8)
    }

    /// The hold marker file is keyed by PIPIUI_SESSION_KEY (= Swift bridgeRoutingKey) and
    /// bounded by a staleness timeout so a crashed App can never wedge automatic signals.
    func testExtensionDefinesCutInHoldWithTimeoutFallback() throws {
        let s = try subagentSource()
        XCTAssertTrue(s.contains("const PIPIUI_CUTIN_HOLD_MS = 15_000;"))
        XCTAssertTrue(s.contains(#"path.join(os.tmpdir(), `pipiui-cutin-${PIPIUI_SESSION}.json`)"#))
        XCTAssertTrue(s.contains("function cutInHoldActive(): boolean"))
        XCTAssertTrue(s.contains("function releaseCutInHold(): void"))
        XCTAssertTrue(s.contains("async function awaitCutInHoldRelease(): Promise<void>"))
        XCTAssertTrue(s.contains("return Date.now() - raw.at < PIPIUI_CUTIN_HOLD_MS;"))
    }

    /// Every automatic followUp delivery (done / stall / heartbeat / watchdog resend) goes
    /// through trySendUserMessage, which must await the hold before hitting pi.
    func testTrySendUserMessageAwaitsCutInHold() throws {
        let s = try subagentSource()
        XCTAssertTrue(s.contains(
            "async function trySendUserMessage(pi: ExtensionAPI, text: string): Promise<boolean> {"
        ))
        let idx = try XCTUnwrap(s.range(of: "async function trySendUserMessage"))
        let body = s[idx.lowerBound...]
        let awaitIdx = try XCTUnwrap(body.range(of: "await awaitCutInHoldRelease();"))
        let sendIdx = try XCTUnwrap(body.range(of: "pi.sendUserMessage(text"))
        XCTAssertTrue(awaitIdx.lowerBound < sendIdx.lowerBound,
                      "hold must be awaited before any sendUserMessage")
    }

    /// Early release: a real user message (interactive/rpc, not an extension followUp)
    /// entering a turn means the cut-in prompt already won the race.
    func testInputEventReleasesHoldForNonExtensionSources() throws {
        let s = try subagentSource()
        XCTAssertTrue(s.contains(#"pi.on("input", (event) => {"#))
        XCTAssertTrue(s.contains(#"if (event.source !== "extension") releaseCutInHold();"#))
    }
}
