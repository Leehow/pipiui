import XCTest
@testable import PipiUI

/// Deterministic (no sleep, no UI) tests locking in the Subagent detail-log
/// scrolling contract: a lazy, windowed container with a hard mount ceiling and a
/// lightweight plain-text fast path. Mirrors the source-inspection style of
/// `SubagentPanelSplitLayoutTests` — the pure windowing math lives in
/// `SubagentLogRenderWindowTests`; these tests guard the view wiring.
final class SubagentPanelLogWindowTests: XCTestCase {
    private func source(_ relative: String) throws -> String {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let url = repositoryRoot.appendingPathComponent(relative)
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// Extracts the `AgentDetailView` source range (struct … matching closing
    /// brace at column 0). `AgentLogRow` follows it, so we cut at its declaration.
    private func agentDetailViewSource(_ full: String) throws -> Substring {
        let structStart = try XCTUnwrap(full.range(of: "private struct AgentDetailView: View"))
        let nextStruct = try XCTUnwrap(
            full.range(of: "private struct AgentLogRow", range: structStart.upperBound..<full.endIndex)
        )
        return full[structStart.lowerBound..<nextStruct.lowerBound]
    }

    // MARK: - Goal 1 + 2: lazy, windowed container with a hard mount ceiling

    func testDetailLogUsesLazyContainerNotEagerVStack() throws {
        let full = try source("Sources/PipiUI/Views/SubagentPanel.swift")
        let detail = try agentDetailViewSource(full)

        // The detail log container is lazy: only on-screen rows (+ SwiftUI
        // overscan) mount, so mounted rows ⊆ windowed rows ≤ maxRenderedItems.
        XCTAssertTrue(detail.contains("LazyVStack"), "detail log must use a LazyVStack")
        // The old eager-stack rationale is gone.
        XCTAssertFalse(detail.contains("Eager stack"), "eager-stack comment must be removed")
        XCTAssertFalse(
            detail.contains("≤ 400 rows"),
            "the eager ≤400-rows rationale must be removed"
        )
    }

    func testDetailLogWindowUsesHysteresisAnchor() throws {
        let full = try source("Sources/PipiUI/Views/SubagentPanel.swift")
        let detail = try agentDetailViewSource(full)

        // The window is derived from the pure hysteresis anchor, so equal inputs
        // never re-window (dedup) and the window only slides past a threshold.
        XCTAssertTrue(detail.contains("stableAnchorPage"))
        XCTAssertTrue(detail.contains("SubagentLogRenderWindow.maxRenderedItems"))
        // Pinned live mode still anchors at the newest page (follows appends).
        XCTAssertTrue(detail.contains("latestPage(itemCount: agent.log.count)"))
    }

    func testDetailLogKeepsStableIdsAndScrollPositionAnchor() throws {
        let full = try source("Sources/PipiUI/Views/SubagentPanel.swift")
        let detail = try agentDetailViewSource(full)

        // Stable per-segment ids are what `.scrollPosition` re-anchors to as rows
        // enter/leave the lazy viewport.
        XCTAssertTrue(detail.contains(".scrollPosition(id: $scrollTopID, anchor: .top)"))
        XCTAssertTrue(detail.contains("segmentRowID(segment)"))
        XCTAssertTrue(detail.contains(".equatable()"))
    }

    // MARK: - Goal 4: copy/select, follow-bottom, off-bottom, preload, header

    func testDetailLogPreservesSelectionFollowAndOffBottomContract() throws {
        let full = try source("Sources/PipiUI/Views/SubagentPanel.swift")
        let detail = try agentDetailViewSource(full)

        // Selection is still native (the rich path) / `.textSelection(.enabled)`
        // (the lightweight path) — both present.
        XCTAssertTrue(detail.contains("textSelection(.enabled)"))
        // Auto-follow bottom anchor + tracker survive the lazy container.
        XCTAssertTrue(detail.contains("StickToBottomTracker"))
        XCTAssertTrue(detail.contains("logAnchorID"))
        // Off-bottom: a jump-to-latest affordance exists and only renders unpinned.
        XCTAssertTrue(detail.contains("pinToBottom"))
        XCTAssertTrue(detail.contains("jumpToLatest(proxy)"))
        // Preload/overscan + status header remain.
        XCTAssertTrue(detail.contains("metricsHeader"))
    }

    // MARK: - Goal 3: lightweight plain-text fast path; rich text only when needed

    func testAgentLogRowRoutesPlainTextToLightweightText() throws {
        let full = try source("Sources/PipiUI/Views/SubagentPanel.swift")
        let rowStart = try XCTUnwrap(full.range(of: "private struct AgentLogRow"))
        let rowEndRange = try XCTUnwrap(
            full.range(of: "\n}\n", range: rowStart.upperBound..<full.endIndex)
        )
        let row = full[rowStart.lowerBound..<rowEndRange.upperBound]

        // A plain-text branch exists and uses a selectable SwiftUI `Text` (no
        // NSTextView/MarkdownTextView on the common realtime-log row).
        XCTAssertTrue(row.contains("logTextNeedsRichRendering"), "must classify before rendering")
        XCTAssertTrue(row.contains("else {"), "plain-text branch must exist")
        XCTAssertTrue(row.contains("Text(item.text)"), "plain text must use lightweight Text")
        // Rich text still goes through MarkdownTextView for structured content.
        XCTAssertTrue(row.contains("MarkdownTextView("))
    }

    func testMarkdownViewExposesDeterministicRichTextClassifier() throws {
        let md = try source("Sources/PipiUI/Views/MarkdownView.swift")
        XCTAssertTrue(md.contains("static func logTextNeedsRichRendering"))

        // The classifier is deterministic and pure: plain prose → false,
        // any markdown structure → true.
        XCTAssertFalse(MarkdownTextView.logTextNeedsRichRendering(""))
        XCTAssertFalse(MarkdownTextView.logTextNeedsRichRendering("正在编译项目…"))
        XCTAssertFalse(MarkdownTextView.logTextNeedsRichRendering("done in 3.14s, no changes."))
        // Inline markdown.
        XCTAssertTrue(MarkdownTextView.logTextNeedsRichRendering("use `swift build` here"))
        XCTAssertTrue(MarkdownTextView.logTextNeedsRichRendering("this is **important**"))
        // Block-level markdown.
        XCTAssertTrue(MarkdownTextView.logTextNeedsRichRendering("# Heading\nbody"))
        XCTAssertTrue(MarkdownTextView.logTextNeedsRichRendering("- one\n- two"))
        XCTAssertTrue(MarkdownTextView.logTextNeedsRichRendering("```\ncode\n```"))
        XCTAssertTrue(MarkdownTextView.logTextNeedsRichRendering("1. first\n2. second"))
    }

    // MARK: - Goal 5: the mount ceiling is the testable window ceiling

    func testMountedRowsBoundedByWindowCeiling() {
        // A lazy container can only mount items the data window exposes, so the
        // window's hard ceiling is also the mounted-rows hard ceiling. Proved
        // across log lengths far larger than any screen could show.
        let ceiling = SubagentLogRenderWindow.maxRenderedItems
        for count in [0, 1, 100, 399, 400, 401, 800, 5_000, 50_000] {
            for page in -2...((count / 100) + 4) {
                let window = SubagentLogRenderWindow.resolve(itemCount: count, topVisiblePage: page)
                XCTAssertLessThanOrEqual(
                    window.renderedCount, ceiling,
                    "count=\(count) page=\(page): \(window.renderedCount) > \(ceiling)"
                )
            }
        }
    }

    // MARK: - Regression: lifted expand-state ownership (survives lazy unmount)

    func testExpandStateOwnedOutsideLazyRowKeyedByStableItemID() throws {
        let full = try source("Sources/PipiUI/Views/SubagentPanel.swift")

        // AgentLogRow no longer owns expand @State (would be discarded on unmount).
        let rowStart = try XCTUnwrap(full.range(of: "private struct AgentLogRow"))
        let rowEndRange = try XCTUnwrap(
            full.range(of: "\n}\n", range: rowStart.upperBound..<full.endIndex)
        )
        let row = full[rowStart.lowerBound..<rowEndRange.upperBound]
        XCTAssertFalse(row.contains("@State private var expanded"), "row must not own expand @State")
        XCTAssertTrue(row.contains("var isExpanded: Bool"), "row must receive expansion as an input")
        XCTAssertTrue(row.contains("var onToggleExpand: () -> Void"))

        // The long-lived owner is AgentDetailView, keyed by the stable item id —
        // so scrolling a row out and back preserves its expansion.
        let detailStart = try XCTUnwrap(full.range(of: "private struct AgentDetailView: View"))
        let detailEnd = try XCTUnwrap(
            full.range(of: "private struct AgentLogRow", range: detailStart.upperBound..<full.endIndex)
        )
        let detail = full[detailStart.lowerBound..<detailEnd.lowerBound]
        XCTAssertTrue(detail.contains("@State private var expandedLogItemIDs: Set<Int>"))
        XCTAssertTrue(
            detail.contains("expandedLogItemIDs.contains(item.id)"),
            "expansion must be keyed by the stable item id (not row position)"
        )
        XCTAssertTrue(detail.contains("func toggleLogItemExpanded"))
        // The lifted state feeds both standalone segments and expanded tool groups.
        let occurrences = detail.components(separatedBy: "expandedLogItemIDs.contains(item.id)").count - 1
        XCTAssertGreaterThanOrEqual(occurrences, 2, "segmentRow and toolGroup must both bind expansion")
    }

    func testAgentSwitchResetsExpandStateNoCrossContamination() throws {
        let full = try source("Sources/PipiUI/Views/SubagentPanel.swift")
        // AgentDetailView is remounted on agent switch via `.id(agent.id)`, so its
        // @State (incl. expandedLogItemIDs) is destroyed and re-created per agent —
        // one agent's expansion can never leak into another, even though item ids
        // are plain Ints that may overlap across agents.
        let callStart = try XCTUnwrap(full.range(of: "AgentDetailView(agent:"))
        let idRange = try XCTUnwrap(
            full.range(of: ".id(agent.id)", range: callStart.upperBound..<full.endIndex)
        )
        XCTAssertLessThan(callStart.upperBound, idRange.lowerBound,
                          "AgentDetailView must be keyed by .id(agent.id) so @State resets on switch")
        // The lifted set is declared inside AgentDetailView (per-agent), not at the
        // panel level (which would survive an agent switch and leak).
        let panelStart = try XCTUnwrap(full.range(of: "struct SubagentPanel: View"))
        let detailStart = try XCTUnwrap(full.range(of: "private struct AgentDetailView: View"))
        let panelRegion = full[panelStart.lowerBound..<detailStart.lowerBound]
        XCTAssertFalse(
            panelRegion.contains("expandedLogItemIDs"),
            "expand state must live in the per-agent detail, not the shared panel"
        )
    }

    func testAgentLogRowEqualityIncludesExpansionAndFontSize() throws {
        let full = try source("Sources/PipiUI/Views/SubagentPanel.swift")
        let eqStart = try XCTUnwrap(
            full.range(of: "static func == (lhs: AgentLogRow, rhs: AgentLogRow)")
        )
        let eqEndRange = try XCTUnwrap(
            full.range(of: "\n    }\n", range: eqStart.upperBound..<full.endIndex)
        )
        let eq = full[eqStart.lowerBound..<eqEndRange.upperBound]
        // Every render input must drive equality so `.equatable()` re-renders on
        // real changes and skips truly-unchanged rows.
        XCTAssertTrue(eq.contains("lhs.item == rhs.item"))
        XCTAssertTrue(eq.contains("lhs.base == rhs.base"))
        XCTAssertTrue(eq.contains("lhs.isExpanded == rhs.isExpanded"),
                      "expanded must be in equality (it is now a render input)")
        XCTAssertTrue(eq.contains("lhs.fontSize == rhs.fontSize"),
                      "fontSize must be in equality so a font change re-renders")
    }

    func testPlainTextAndMarkdownShareOneFontSizeConstant() throws {
        let full = try source("Sources/PipiUI/Views/SubagentPanel.swift")
        let rowStart = try XCTUnwrap(full.range(of: "private struct AgentLogRow"))
        let rowEndRange = try XCTUnwrap(
            full.range(of: "\n}\n", range: rowStart.upperBound..<full.endIndex)
        )
        let row = full[rowStart.lowerBound..<rowEndRange.upperBound]
        // Lightweight text derives its size from the shared project constant, not a
        // hard-coded `.callout` (~13pt) that jumped next to MarkdownTextView (~15pt).
        XCTAssertTrue(row.contains(".font(.system(size: fontSize))"))
        XCTAssertTrue(row.contains("var fontSize: CGFloat = ChatTypography.defaultFontSize"))
        XCTAssertFalse(row.contains(".font(.callout)"), "must drop the mismatched .callout magic size")

        // Runtime: MarkdownTextView's body font and the lightweight Text's default
        // both derive from the single ChatTypography.defaultFontSize constant, so
        // adjacent plain/rich rows render at the same point size.
        XCTAssertEqual(ChatTypography.defaultFontSize, 15)
        let typography = ChatTypography.make(fontSize: ChatTypography.defaultFontSize)
        XCTAssertEqual(typography.fontSize, ChatTypography.defaultFontSize)
        // MarkdownTextView body = systemFont(ofSize: fontSize); lightweight Text =
        // .system(size: fontSize). Same point size at the same constant.
        XCTAssertEqual(typography.bodyNSFont.pointSize, ChatTypography.defaultFontSize, accuracy: 0.001)
    }
}
