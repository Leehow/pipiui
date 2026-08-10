import XCTest
@testable import PipiUI

/// Pure-logic seam A: user-authored prompt index consistency + append cost seams.
final class UserPromptIndexTests: XCTestCase {

    private func user(_ id: String, _ text: String) -> ChatItem {
        ChatItem(id: id, role: "user", blocks: [.text(text)])
    }

    private func assistant(_ id: String, _ text: String = "ok") -> ChatItem {
        ChatItem(id: id, role: "assistant", blocks: [.text(text)])
    }

    private func system(_ id: String, _ text: String = "note") -> ChatItem {
        ChatItem(id: id, role: "system", blocks: [.text(text)])
    }

    // MARK: - Append

    func testAppendUserPromptsBuildsOrderedEntriesAndIndices() {
        let index = UserPromptIndex()
        var transcript: [ChatItem] = [
            user("u1", "第一问"),
            assistant("a1"),
        ]
        index.applyTailAppend(transcript, from: 0)
        XCTAssertEqual(index.entries.map(\.messageID), ["u1"])
        XCTAssertEqual(index.transcriptIndex(for: "u1"), 0)

        let start = transcript.count
        transcript.append(user("u2", "第二问"))
        transcript.append(assistant("a2"))
        index.applyTailAppend(transcript, from: start)

        XCTAssertEqual(index.entries.map(\.messageID), ["u1", "u2"])
        XCTAssertEqual(index.entries.map(\.summary), ["第一问", "第二问"])
        XCTAssertEqual(index.transcriptIndex(for: "u1"), 0)
        XCTAssertEqual(index.transcriptIndex(for: "u2"), 2)
        XCTAssertNil(index.transcriptIndex(for: "a1"))
    }

    func testAppendSkipsNonUserAndRuntimeWorkerSignals() {
        let index = UserPromptIndex()
        let transcript: [ChatItem] = [
            user("u1", "real"),
            assistant("a1"),
            system("s1", "sys"),
            user("sig1", "[subagent-done] agentId=x"),
            user("sig2", "[worktree-merge-failed] merge failed"),
            user("u2", "after signal"),
        ]
        index.apply(transcript)

        XCTAssertEqual(index.messageIDs, ["u1", "u2"])
        XCTAssertEqual(index.transcriptIndex(for: "u1"), 0)
        XCTAssertEqual(index.transcriptIndex(for: "u2"), 5)
        XCTAssertNil(index.transcriptIndex(for: "sig1"))
        XCTAssertNil(index.transcriptIndex(for: "sig2"))
        XCTAssertNil(index.transcriptIndex(for: "a1"))
    }

    /// Rail / navigation index must keep only real human prompts in order, with plain
    /// summaries — not heartbeats, merge/verify notices, git snapshots, skill policy, etc.
    func testIndexKeepsOnlyNavigationEligibleHumanPromptsInOrderWithSummaries() {
        let annotated = ImageAttachment.messageWithAttachmentPaths(
            text: "带图提问",
            paths: [URL(fileURLWithPath: "/tmp/photo.png")]
        )
        let imageOnly = ChatItem(
            id: "u-img",
            role: "user",
            blocks: [.image(ImageBlock(id: "i", data: Data([9]), mimeType: "image/png"))]
        )
        let transcript: [ChatItem] = [
            user("u1", "第一问：修导航"),
            assistant("a1"),
            user("hb", "[subagent-heartbeat] outstanding=1 vanished=0"),
            user("done", "[subagent-done] agentId=w1 name=worker ok=true"),
            user("stall", "[subagent-stalled] agentId=w1 idle=120s"),
            user("nudge", "[subagent-interrupted-reminder] agentId=w2 state=interrupted title=t idle=90s nudge=1/2"),
            user("merge", "[worktree-merge-failed] agentId=w1 name=worker branch=x"),
            user("verify", "[post-merge-verify-failed] agentId=w1 name=worker branch=x"),
            user("git", "## Git (Pipi UI)\nbranch: main\ndirty: no"),
            user("skill", "[PipiUI session skill policy: superpowers:using-superpowers bootstrap for pi\nopt-in only.]"),
            user("internal", "[PipiUI internal — session title] generate title"),
            user("redeliver", "(re-delivery #1: the previous [subagent-done] below was not confirmed)"),
            assistant("a-mid"),
            user("u2", annotated),
            assistant("a2"),
            imageOnly,
            user("u3", "第三问收尾"),
        ]

        let index = UserPromptIndex()
        index.apply(transcript)

        XCTAssertEqual(index.messageIDs, ["u1", "u2", "u-img", "u3"])
        XCTAssertEqual(
            index.entries.map(\.summary),
            ["第一问：修导航", "带图提问", "", "第三问收尾"]
        )
        XCTAssertEqual(index.transcriptIndex(for: "u1"), 0)
        XCTAssertEqual(index.transcriptIndex(for: "u2"), 13)
        XCTAssertEqual(index.transcriptIndex(for: "u-img"), 15)
        XCTAssertEqual(index.transcriptIndex(for: "u3"), 16)

        for noiseID in ["hb", "done", "stall", "nudge", "merge", "verify", "git", "skill", "internal", "redeliver", "a1"] {
            XCTAssertNil(index.transcriptIndex(for: noiseID), noiseID)
        }

        // Tail-append of another injection must not grow the rail; a real prompt must.
        var live = transcript
        let startNoise = live.count
        live.append(user("hb2", "[subagent-heartbeat] outstanding=2 vanished=0"))
        index.applyTailAppend(live, from: startNoise)
        XCTAssertEqual(index.messageIDs, ["u1", "u2", "u-img", "u3"])

        let startHuman = live.count
        live.append(user("u4", "追加人类输入"))
        index.applyTailAppend(live, from: startHuman)
        XCTAssertEqual(index.messageIDs, ["u1", "u2", "u-img", "u3", "u4"])
        XCTAssertEqual(index.entries.last?.summary, "追加人类输入")
        XCTAssertEqual(index.transcriptIndex(for: "u4"), live.count - 1)
    }

    func testTailAppendFastPathKeepsPriorEntriesStable() {
        let index = UserPromptIndex()
        var transcript: [ChatItem] = [
            user("u1", "alpha"),
            assistant("a1"),
            user("u2", "beta"),
        ]
        index.applyTailAppend(transcript, from: 0)
        let before = index.entries
        let appendCountBefore = index.appendFastPathCount

        let start = transcript.count
        transcript.append(assistant("a2"))
        transcript.append(user("u3", "gamma"))
        index.applyTailAppend(transcript, from: start)

        XCTAssertEqual(index.appendFastPathCount, appendCountBefore + 1)
        XCTAssertEqual(index.entries.prefix(2).map(\.messageID), before.map(\.messageID))
        XCTAssertEqual(index.entries.prefix(2).map(\.summary), before.map(\.summary))
        XCTAssertEqual(index.messageIDs, ["u1", "u2", "u3"])
        XCTAssertEqual(index.transcriptIndex(for: "u3"), 4)
    }

    /// Proves append only walks the new suffix — not O(N) over the prior transcript —
    /// and does not touch existing entry source text / summaries.
    func testAppendFastPathOnlyScansNewSuffixNotPriorTranscript() {
        let index = UserPromptIndex()
        var transcript: [ChatItem] = []
        for i in 0..<40 {
            transcript.append(user("u\(i)", "prompt-\(i)-\(String(repeating: "x", count: 64))"))
            transcript.append(assistant("a\(i)"))
        }
        index.applyTailAppend(transcript, from: 0)
        XCTAssertEqual(index.entries.count, 40)
        XCTAssertEqual(index.lastAppendSuffixScanCount, 80)
        XCTAssertEqual(index.lastAppendExistingEntryTouchCount, 0)

        let suffixScannedBefore = index.totalAppendSuffixSlotsScanned
        let existingTouchesBefore = index.totalAppendExistingEntryTouches
        let reconcileBefore = index.reconcileCount
        let fastBefore = index.appendFastPathCount

        let start = transcript.count
        transcript.append(user("u_new", "brand new"))
        transcript.append(assistant("a_new"))
        index.applyTailAppend(transcript, from: start)

        XCTAssertEqual(index.appendFastPathCount, fastBefore + 1)
        XCTAssertEqual(index.reconcileCount, reconcileBefore, "pure append must not reconcile")
        XCTAssertEqual(index.lastAppendSuffixScanCount, 2, "only the two new slots")
        XCTAssertEqual(index.lastAppendExistingEntryTouchCount, 0)
        XCTAssertEqual(index.totalAppendSuffixSlotsScanned, suffixScannedBefore + 2)
        XCTAssertEqual(index.totalAppendExistingEntryTouches, existingTouchesBefore)
        XCTAssertEqual(index.messageIDs.last, "u_new")
        XCTAssertEqual(index.entries.last?.summary, "brand new")
        // Prior summaries untouched.
        XCTAssertEqual(index.entries[0].summary, "prompt-0-\(String(repeating: "x", count: 64))")
    }

    func testAppendFastPathFallsBackToReconcileWhenWatermarkMismatches() {
        let index = UserPromptIndex()
        index.apply([user("u1", "a"), assistant("a1")])
        let reconcileBefore = index.reconcileCount

        // Claim a bogus start that does not match syncedCount → reconcile.
        let transcript = [user("u1", "a"), assistant("a1"), user("u2", "b")]
        index.applyTailAppend(transcript, from: 0)
        XCTAssertGreaterThan(index.reconcileCount, reconcileBefore)
        XCTAssertEqual(index.messageIDs, ["u1", "u2"])
    }

    // MARK: - Fingerprint (no long-term full-text retain)

    func testFingerprintIsStableAndChangesWithContent() {
        let a = UserPromptIndex.fingerprint("hello world")
        let b = UserPromptIndex.fingerprint("hello world")
        let c = UserPromptIndex.fingerprint("hello world!")
        XCTAssertEqual(a, b)
        XCTAssertNotEqual(a, c)
        // Fingerprint is a compact UInt64, not a text copy.
        XCTAssertEqual(MemoryLayout.size(ofValue: a), 8)
    }

    func testSourceKeysNotRetainedAsFullTextParallelStorage() throws {
        // Structural guard: index must not keep a [String] parallel source-text cache
        // or a full-history canUseAppendFastPath scan.
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // UserPromptIndexTests.swift
            .deletingLastPathComponent() // PipiUITests
            .deletingLastPathComponent() // Tests
        let sourceURL = root.appendingPathComponent("Sources/PipiUI/UserPromptIndex.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)
        XCTAssertFalse(source.contains("sourceKeys"), "must not retain full-text sourceKeys")
        XCTAssertFalse(source.contains("canUseAppendFastPath"), "must not full-scan prefix for append")
        XCTAssertTrue(source.contains("sourceFingerprints"), "must use short fingerprints")
        XCTAssertTrue(source.contains("lastAppendSuffixScanCount"))
        XCTAssertTrue(source.contains("lastAppendExistingEntryTouchCount"))
        XCTAssertTrue(source.contains("applyTailAppend"))
    }

    // MARK: - Mid content replace

    func testMidContentReplaceUpdatesSummaryAndKeepsID() {
        let index = UserPromptIndex()
        var transcript: [ChatItem] = [
            user("u1", "old prompt"),
            assistant("a1"),
            user("u2", "second"),
        ]
        index.apply(transcript)
        XCTAssertEqual(index.entries[0].summary, "old prompt")

        transcript[0] = user("u1", "new prompt text")
        index.apply(transcript)

        XCTAssertEqual(index.messageIDs, ["u1", "u2"])
        XCTAssertEqual(index.entries[0].summary, "new prompt text")
        XCTAssertEqual(index.transcriptIndex(for: "u1"), 0)
        XCTAssertEqual(index.transcriptIndex(for: "u2"), 2)
    }

    // MARK: - Delete / full replace

    func testDeleteUserPromptDropsEntryAndClearsDanglingID() {
        let index = UserPromptIndex()
        var transcript: [ChatItem] = [
            user("u1", "keep"),
            assistant("a1"),
            user("u2", "drop me"),
            assistant("a2"),
            user("u3", "tail"),
        ]
        index.apply(transcript)
        XCTAssertEqual(index.messageIDs, ["u1", "u2", "u3"])

        // Remove u2 and its assistant reply.
        transcript.removeSubrange(2...3)
        index.apply(transcript)

        XCTAssertEqual(index.messageIDs, ["u1", "u3"])
        XCTAssertEqual(index.transcriptIndex(for: "u1"), 0)
        XCTAssertEqual(index.transcriptIndex(for: "u3"), 2)
        XCTAssertNil(index.transcriptIndex(for: "u2"))
    }

    func testFullReplaceRebuildsWithoutDuplicatesOrDanglingIDs() {
        let index = UserPromptIndex()
        index.apply([
            user("old1", "A"),
            assistant("oa1"),
            user("old2", "B"),
        ])
        XCTAssertEqual(index.messageIDs, ["old1", "old2"])

        index.apply([
            user("new1", "X"),
            assistant("na1"),
            user("new2", "Y"),
            assistant("na2"),
        ])

        XCTAssertEqual(index.messageIDs, ["new1", "new2"])
        XCTAssertEqual(index.entries.map(\.summary), ["X", "Y"])
        XCTAssertEqual(index.transcriptIndex(for: "new1"), 0)
        XCTAssertEqual(index.transcriptIndex(for: "new2"), 2)
        XCTAssertNil(index.transcriptIndex(for: "old1"))
        XCTAssertNil(index.transcriptIndex(for: "old2"))
    }

    func testEmptyReplaceClearsIndex() {
        let index = UserPromptIndex()
        index.apply([user("u1", "gone")])
        index.apply([])
        XCTAssertTrue(index.entries.isEmpty)
        XCTAssertNil(index.transcriptIndex(for: "u1"))
    }

    func testDuplicateIDsFirstWinsNoDuplicates() {
        let index = UserPromptIndex()
        index.apply([
            user("dup", "first"),
            assistant("a1"),
            user("dup", "second copy"),
            user("u2", "ok"),
        ])
        XCTAssertEqual(index.messageIDs, ["dup", "u2"])
        XCTAssertEqual(index.entries[0].summary, "first")
        XCTAssertEqual(index.transcriptIndex(for: "dup"), 0)
    }

    // MARK: - Summary normalization

    func testSummaryCollapsesWhitespaceAndTruncatesWithoutRenderingMarkdown() {
        let multiline = user("u1", "  hello\n\n  **world**\t  tail  ")
        XCTAssertEqual(
            UserPromptIndex.summary(for: multiline),
            "hello **world** tail"
        )

        let long = String(repeating: "a", count: UserPromptIndex.maxSummaryLength + 20)
        let truncated = UserPromptIndex.summarize(long)
        XCTAssertEqual(truncated.count, UserPromptIndex.maxSummaryLength + 1) // + ellipsis
        XCTAssertTrue(truncated.hasSuffix("…"))
        XCTAssertEqual(
            String(truncated.dropLast()),
            String(repeating: "a", count: UserPromptIndex.maxSummaryLength)
        )
    }

    func testSummaryStripsAttachmentFootnotesViaCopyableText() {
        let annotated = ImageAttachment.messageWithAttachmentPaths(
            text: "see image",
            paths: [URL(fileURLWithPath: "/tmp/secret.png")]
        )
        let item = user("u1", annotated)
        XCTAssertEqual(UserPromptIndex.summary(for: item), "see image")
    }

    // MARK: - ChatSession classification + integration

    func testTailAppendStartClassificationIsO1AndCorrect() {
        let a = user("a", "1")
        let b = assistant("b")
        let c = user("c", "2")
        let old = [a, b, c]
        let appended = old + [assistant("d"), user("e", "3")]
        XCTAssertEqual(ChatSession.userPromptTailAppendStart(from: old, to: appended), 3)
        XCTAssertEqual(ChatSession.userPromptTailAppendStart(from: [], to: old), 0)

        // Same length (in-place replace) → not append.
        var replaced = old
        replaced[0] = user("a", "changed")
        XCTAssertNil(ChatSession.userPromptTailAppendStart(from: old, to: replaced))

        // Shrink → not append.
        XCTAssertNil(ChatSession.userPromptTailAppendStart(from: old, to: Array(old.prefix(2))))

        // Full rebuild with different endpoints → not append.
        let rebuilt = [user("x", "X"), assistant("y")]
        XCTAssertNil(ChatSession.userPromptTailAppendStart(from: old, to: rebuilt + [user("z", "Z")]))
    }

    func testChatSessionTranscriptWritesUpdateIndex() {
        let session = ChatSession(
            id: "test-user-prompt-index",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test"
        )

        session.transcript = [
            user("u1", "from session"),
            assistant("a1"),
        ]
        XCTAssertEqual(session.userPromptIndex.messageIDs, ["u1"])
        XCTAssertEqual(session.userPromptIndex.transcriptIndex(for: "u1"), 0)
        // Empty → non-empty is classified as tail append from 0.
        XCTAssertGreaterThanOrEqual(session.userPromptIndex.appendFastPathCount, 1)

        let fastBefore = session.userPromptIndex.appendFastPathCount
        let reconcileBefore = session.userPromptIndex.reconcileCount
        let suffixBefore = session.userPromptIndex.totalAppendSuffixSlotsScanned

        session.transcript.append(user("u2", "appended"))
        XCTAssertEqual(session.userPromptIndex.messageIDs, ["u1", "u2"])
        XCTAssertEqual(session.userPromptIndex.transcriptIndex(for: "u2"), 2)
        XCTAssertEqual(session.userPromptIndex.appendFastPathCount, fastBefore + 1)
        XCTAssertEqual(session.userPromptIndex.reconcileCount, reconcileBefore)
        XCTAssertEqual(session.userPromptIndex.lastAppendSuffixScanCount, 1)
        XCTAssertEqual(session.userPromptIndex.lastAppendExistingEntryTouchCount, 0)
        XCTAssertEqual(session.userPromptIndex.totalAppendSuffixSlotsScanned, suffixBefore + 1)

        let reconcileBeforeReplace = session.userPromptIndex.reconcileCount
        session.transcript = [user("only", "replaced")]
        XCTAssertEqual(session.userPromptIndex.messageIDs, ["only"])
        XCTAssertNil(session.userPromptIndex.transcriptIndex(for: "u1"))
        // Structural replace must reconcile (not pretend to be a suffix append).
        XCTAssertGreaterThan(session.userPromptIndex.reconcileCount, reconcileBeforeReplace)
    }

    func testChatSessionInPlaceEditReconcilesSummary() {
        let session = ChatSession(
            id: "test-user-prompt-index-edit",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test"
        )
        session.transcript = [
            user("u1", "old"),
            assistant("a1"),
            user("u2", "keep"),
        ]
        let reconcileBefore = session.userPromptIndex.reconcileCount
        session.transcript[0] = user("u1", "new text")
        XCTAssertEqual(session.userPromptIndex.entries.map(\.summary), ["new text", "keep"])
        XCTAssertGreaterThan(session.userPromptIndex.reconcileCount, reconcileBefore)
    }

    /// Regression: restoring multi-turn history via `initialTranscript` must leave
    /// `userPromptIndex` populated before any later transcript write. If init never
    /// seeds the index, ChatDetailView’s rail sees empty entries → EmptyView.
    func testChatSessionInitWithInitialTranscriptSeedsUserPromptIndexWithoutFurtherWrites() {
        let items = [
            user("u1", "恢复第一问"),
            assistant("a1", "答一"),
            user("u2", "恢复第二问"),
            assistant("a2", "答二"),
            user("u3", "恢复第三问"),
        ]
        let session = ChatSession(
            id: "test-user-prompt-index-init-seed",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test",
            initialTranscript: InitialTranscriptBuild(
                items: items,
                toolRuns: [:],
                itemCounter: items.count,
                skipNextAssistantIngest: false
            )
        )

        // No subsequent transcript mutation — index must already match history.
        XCTAssertEqual(session.transcript.map(\.id), items.map(\.id))
        XCTAssertEqual(session.userPromptIndex.messageIDs, ["u1", "u2", "u3"])
        XCTAssertEqual(
            session.userPromptIndex.entries.map(\.summary),
            ["恢复第一问", "恢复第二问", "恢复第三问"]
        )
        XCTAssertEqual(session.userPromptIndex.transcriptIndex(for: "u1"), 0)
        XCTAssertEqual(session.userPromptIndex.transcriptIndex(for: "u2"), 2)
        XCTAssertEqual(session.userPromptIndex.transcriptIndex(for: "u3"), 4)
        XCTAssertNil(session.userPromptIndex.transcriptIndex(for: "a1"))
        XCTAssertEqual(session.userPromptIndex.syncedCount, items.count)
        // Exactly one init seed path: either didSet tail-append from empty, or an
        // explicit reconcile when observers did not run — never both (no double scan).
        let seededByFastPath = session.userPromptIndex.appendFastPathCount == 1
            && session.userPromptIndex.reconcileCount == 0
        let seededByReconcile = session.userPromptIndex.reconcileCount == 1
            && session.userPromptIndex.appendFastPathCount == 0
        XCTAssertTrue(
            seededByFastPath || seededByReconcile,
            "expected single init seed, fast=\(session.userPromptIndex.appendFastPathCount) reconcile=\(session.userPromptIndex.reconcileCount)"
        )

        // Tail-append fast path must still work after the init seed.
        let reconcileBefore = session.userPromptIndex.reconcileCount
        let fastBefore = session.userPromptIndex.appendFastPathCount
        session.transcript.append(assistant("a3"))
        session.transcript.append(user("u4", "继续"))
        XCTAssertEqual(session.userPromptIndex.messageIDs, ["u1", "u2", "u3", "u4"])
        XCTAssertEqual(session.userPromptIndex.entries.map(\.summary).last, "继续")
        XCTAssertEqual(session.userPromptIndex.transcriptIndex(for: "u4"), 6)
        XCTAssertEqual(session.userPromptIndex.reconcileCount, reconcileBefore)
        XCTAssertEqual(session.userPromptIndex.appendFastPathCount, fastBefore + 2)
    }

    func testChatSessionInitWithoutHistoryLeavesUserPromptIndexEmpty() {
        let session = ChatSession(
            id: "test-user-prompt-index-init-empty",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test"
        )
        XCTAssertTrue(session.transcript.isEmpty)
        XCTAssertTrue(session.userPromptIndex.entries.isEmpty)
        XCTAssertEqual(session.userPromptIndex.syncedCount, 0)
    }

    func testChatSessionInitWithEmptyInitialTranscriptLeavesIndexEmpty() {
        let session = ChatSession(
            id: "test-user-prompt-index-init-empty-build",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test",
            initialTranscript: InitialTranscriptBuild(
                items: [],
                toolRuns: [:],
                itemCounter: 0,
                skipNextAssistantIngest: false
            )
        )
        XCTAssertTrue(session.transcript.isEmpty)
        XCTAssertTrue(session.userPromptIndex.entries.isEmpty)
        XCTAssertEqual(session.userPromptIndex.syncedCount, 0)
    }
}
