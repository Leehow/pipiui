import SwiftUI

/// Pure projection + style + layout semantics for the left-edge user-prompt navigation rail.
///
/// Keeps node data independent of the mounted transcript window so long sessions
/// can show every user input without mounting history rows.
enum UserPromptNavigationRailModel {
    struct Node: Identifiable, Equatable, Sendable {
        let id: String
        let summary: String
    }

    /// Visual role driven by seek/live association (hover is layered in the view).
    enum StyleRole: Equatable, Sendable {
        case normal
        case current
    }

    /// Tick geometry/opacity. Color stays in the view so tests stay Color-free.
    struct TickStyle: Equatable, Sendable {
        var width: CGFloat
        var height: CGFloat
        /// 0...1 primary-foreground opacity for the tick itself.
        var opacity: Double
        /// Extra scale on hover for a clear but light affordance.
        var hoverBoost: Bool
    }

    /// Host request when the rail should bring `messageID` into its own viewport.
    struct ScrollRequest: Equatable, Sendable {
        var messageID: String
        /// Generation so SwiftUI onChange can fire even for the same id after rebuild.
        var generation: UInt64
    }

    /// Dense Claude-style track metrics derived from node count + available height.
    struct TrackLayout: Equatable, Sendable {
        /// Center-to-center slot height for each node (visual pitch + hit band).
        var nodePitch: CGFloat
        /// Top/bottom padding inside the scroll content.
        var contentVerticalPadding: CGFloat
        /// Total content height including vertical padding.
        var contentHeight: CGFloat
        /// Viewport height to apply (≤ maxRailHeight).
        var viewportHeight: CGFloat
        /// True when every node fits in the viewport at the chosen pitch.
        var fitsWithoutScroll: Bool
    }

    /// Bounded rail chrome — long node lists scroll inside this height only.
    static let maxRailHeight: CGFloat = 320
    static let tickHeight: CGFloat = 2
    static let normalTickWidth: CGFloat = 8
    static let currentTickWidth: CGFloat = 14
    static let hoveredTickWidth: CGFloat = 12
    /// Current + hover may grow two points beyond `currentTickWidth`.
    static let maxVisualTickWidth: CGFloat = currentTickWidth + 2

    /// Preferred dense pitch (Claude-style short track). Far tighter than a sparse ~38pt list.
    static let preferredNodePitch: CGFloat = 6
    /// Soft ceiling when few nodes — stay compact, never stretch toward message-row spacing.
    static let maxNodePitch: CGFloat = 8
    /// Hard floor before internal scrolling kicks in.
    static let minNodePitch: CGFloat = 4
    /// Fixed compact content inset (not part of per-node pitch).
    static let contentVerticalPadding: CGFloat = 2

    /// Legacy name kept for call sites that still mean "VStack spacing".
    /// Dense track uses pitch slots with zero inter-node spacing.
    static let nodeSpacing: CGFloat = 0

    /// Horizontal hit padding around each thin tick (vertical hit = full pitch slot).
    static let hitSlopHorizontal: CGFloat = 6
    /// Deprecated vertical slop: pitch slots own vertical hit. Kept as 0 so
    /// `minNodeHitHeight` reflects the real minimum slot.
    static let hitSlopVertical: CGFloat = 0

    /// Outer leading inset of the rail host from the chat column edge.
    static let hostLeadingInset: CGFloat = 4
    /// Outer top inset below title/chrome so the rail never covers navigation title.
    static let hostTopInset: CGFloat = 10

    /// Scrollbar/scroller chrome must never appear on this rail.
    static let showsScrollIndicators: Bool = false

    /// Max tooltip summary characters before ellipsis (plain text only).
    static let maxTooltipSummaryLength: Int = 72
    /// Tooltip horizontal gap from the tick column’s leading edge.
    static let tooltipLeadingGap: CGFloat = 4

    /// Full column width reserved for tick + horizontal hit padding (no clipping).
    /// `maxVisualTickWidth + 2 * hitSlopHorizontal` must fit inside this frame.
    static var railWidth: CGFloat {
        maxVisualTickWidth + hitSlopHorizontal * 2
    }

    /// Transcript leading gutter so rail hit-test never overlaps message content.
    /// Includes host leading inset + rail column + a small gap before bubbles.
    static var transcriptLeadingGutter: CGFloat {
        hostLeadingInset + railWidth + 6
    }

    /// Minimum per-node hit height (compressed pitch floor).
    static var minNodeHitHeight: CGFloat {
        minNodePitch
    }

    /// Project index entries → rail nodes (oldest → newest). No mounted-range input.
    static func nodes(from entries: [UserPromptIndex.Entry]) -> [Node] {
        entries.map { Node(id: $0.messageID, summary: $0.summary) }
    }

    /// Resolve which node should read as “current”.
    ///
    /// Priority: landed `currentUserPromptID` → in-flight `pendingUserPromptID` →
    /// when live/latest (not seeking), the last user node. Never scans transcript.
    static func resolvedCurrentMessageID(
        currentUserPromptID: String?,
        pendingUserPromptID: String?,
        isSeeking: Bool,
        entryMessageIDs: [String]
    ) -> String? {
        if let currentUserPromptID { return currentUserPromptID }
        if let pendingUserPromptID { return pendingUserPromptID }
        if !isSeeking {
            return entryMessageIDs.last
        }
        return nil
    }

    static func styleRole(nodeID: String, currentMessageID: String?) -> StyleRole {
        currentMessageID == nodeID ? .current : .normal
    }

    static func tickStyle(role: StyleRole, isHovered: Bool) -> TickStyle {
        switch role {
        case .current:
            return TickStyle(
                width: isHovered ? currentTickWidth + 2 : currentTickWidth,
                height: isHovered ? tickHeight + 1 : tickHeight,
                opacity: isHovered ? 0.95 : 0.88,
                hoverBoost: isHovered
            )
        case .normal:
            return TickStyle(
                width: isHovered ? hoveredTickWidth : normalTickWidth,
                height: tickHeight,
                // Resting ticks stay readable while clearly weaker than current.
                opacity: isHovered ? 0.72 : 0.42,
                hoverBoost: isHovered
            )
        }
    }

    /// Compact track layout: prefer a dense short strip; compress pitch to fit;
    /// only scroll when even `minNodePitch` overflows `availableHeight`.
    static func trackLayout(
        nodeCount: Int,
        availableHeight: CGFloat = maxRailHeight
    ) -> TrackLayout {
        let padding = contentVerticalPadding
        let boundedHeight = max(padding * 2 + minNodePitch, min(availableHeight, maxRailHeight))

        guard nodeCount > 0 else {
            return TrackLayout(
                nodePitch: preferredNodePitch,
                contentVerticalPadding: padding,
                contentHeight: padding * 2,
                viewportHeight: padding * 2,
                fitsWithoutScroll: true
            )
        }

        let usable = max(minNodePitch, boundedHeight - padding * 2)
        let count = CGFloat(nodeCount)

        // Ideal: preferred dense pitch packed from the top (short track when few nodes).
        let preferredContent = count * preferredNodePitch
        if preferredContent <= usable {
            let pitch = min(maxNodePitch, preferredNodePitch)
            let contentHeight = count * pitch + padding * 2
            return TrackLayout(
                nodePitch: pitch,
                contentVerticalPadding: padding,
                contentHeight: contentHeight,
                viewportHeight: contentHeight,
                fitsWithoutScroll: true
            )
        }

        // Compress evenly so the whole session fits without a scroller.
        let compressed = usable / count
        if compressed >= minNodePitch {
            let pitch = compressed
            let contentHeight = count * pitch + padding * 2
            return TrackLayout(
                nodePitch: pitch,
                contentVerticalPadding: padding,
                contentHeight: contentHeight,
                viewportHeight: min(contentHeight, boundedHeight),
                fitsWithoutScroll: true
            )
        }

        // Still overflowing at the floor → internal scroll, indicators stay hidden.
        let pitch = minNodePitch
        let contentHeight = count * pitch + padding * 2
        return TrackLayout(
            nodePitch: pitch,
            contentVerticalPadding: padding,
            contentHeight: contentHeight,
            viewportHeight: boundedHeight,
            fitsWithoutScroll: false
        )
    }

    /// Plain-text hover label for a node (no markdown). Empty summaries fall back
    /// to an ordinal so the floating tooltip is never blank.
    static func hoverSummaryText(summary: String, index: Int, total: Int) -> String {
        let trimmed = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        let raw: String
        if trimmed.isEmpty {
            raw = "用户输入 \(index + 1)/\(total)"
        } else {
            raw = trimmed
        }
        guard raw.count > maxTooltipSummaryLength else { return raw }
        let end = raw.index(raw.startIndex, offsetBy: maxTooltipSummaryLength)
        return String(raw[..<end]) + "…"
    }

    /// Whether the rail should emit a scroll-into-view request for `currentMessageID`.
    ///
    /// When `previousVisibleIDs` is nil (unknown / first layout), always request so
    /// a live long session lands on the latest current. When known, only request
    /// if current is outside the currently visible rail node set.
    static func scrollRequestIfNeeded(
        currentMessageID: String?,
        previousVisibleIDs: Set<String>?,
        lastRequestedID: String? = nil,
        allowsScroll: Bool = true,
        generation: UInt64
    ) -> ScrollRequest? {
        guard allowsScroll,
              let currentMessageID,
              currentMessageID != lastRequestedID else { return nil }
        if let previousVisibleIDs, previousVisibleIDs.contains(currentMessageID) {
            return nil
        }
        return ScrollRequest(messageID: currentMessageID, generation: generation)
    }
}

// MARK: - View

/// Shared rail coordinate space so tick hover Y maps into the tooltip host.
private let userPromptNavigationRailCoordinateSpace = "pipiui.userPromptNavRail"

/// Frames emitted only by the overflowing rail. Keeping this out of the fit path
/// avoids mounting any scroll infrastructure for the ordinary compact rail.
private struct UserPromptRailTickFrameKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]

    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

/// Claude-style thin tick rail: one node per real user prompt, plain-text hover summary.
struct UserPromptNavigationRail: View {
    let entries: [UserPromptIndex.Entry]
    let currentMessageID: String?
    let onSelect: (String) -> Void

    @State private var scrollGeneration: UInt64 = 0
    @State private var pendingScrollID: String?
    @State private var visibleIDs: Set<String>?
    @State private var lastRequestedScrollID: String?
    /// Lifted hover so the floating summary draws outside the scroll clip.
    @State private var hover: RailHoverState?

    private var nodes: [UserPromptNavigationRailModel.Node] {
        UserPromptNavigationRailModel.nodes(from: entries)
    }

    private var layout: UserPromptNavigationRailModel.TrackLayout {
        UserPromptNavigationRailModel.trackLayout(nodeCount: nodes.count)
    }

    var body: some View {
        if nodes.isEmpty {
            EmptyView()
        } else {
            let layout = self.layout
            ZStack(alignment: .topLeading) {
                if layout.fitsWithoutScroll {
                    railNodes(layout)
                } else {
                    overflowingRail(layout)
                }

                // Floating summary sits beside the rail column, outside any scroll clip.
                if let hover {
                    UserPromptNavigationRailTooltip(text: hover.text)
                        .offset(
                            x: UserPromptNavigationRailModel.railWidth
                                + UserPromptNavigationRailModel.tooltipLeadingGap,
                            y: hover.midY - 12
                        )
                        .transition(.opacity)
                        .allowsHitTesting(false)
                }
            }
            .coordinateSpace(name: userPromptNavigationRailCoordinateSpace)
            .frame(
                width: UserPromptNavigationRailModel.railWidth,
                height: layout.viewportHeight,
                alignment: .topLeading
            )
            .accessibilityElement(children: .contain)
            .accessibilityLabel("用户输入导航")
            .onChange(of: entries.count) { _, _ in
                if let hover, !nodes.contains(where: { $0.id == hover.id }) {
                    self.hover = nil
                }
            }
        }
    }

    @ViewBuilder
    private func railNodes(_ layout: UserPromptNavigationRailModel.TrackLayout) -> some View {
        VStack(alignment: .leading, spacing: UserPromptNavigationRailModel.nodeSpacing) {
            ForEach(Array(nodes.enumerated()), id: \.element.id) { index, node in
                UserPromptNavigationRailTick(
                    node: node,
                    index: index,
                    total: nodes.count,
                    pitch: layout.nodePitch,
                    isCurrent: UserPromptNavigationRailModel.styleRole(
                        nodeID: node.id,
                        currentMessageID: currentMessageID
                    ) == .current,
                    onSelect: onSelect,
                    onHoverChange: { hovering, midYInRail in
                        handleHover(
                            hovering: hovering,
                            node: node,
                            index: index,
                            total: nodes.count,
                            midYInRail: midYInRail
                        )
                    }
                )
                .id(node.id)
            }
        }
        .padding(.vertical, layout.contentVerticalPadding)
        .frame(width: UserPromptNavigationRailModel.railWidth, alignment: .leading)
    }

    private func overflowingRail(_ layout: UserPromptNavigationRailModel.TrackLayout) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                railNodes(layout)
                    .background {
                        GeometryReader { geo in
                            Color.clear.preference(
                                key: UserPromptRailTickFrameKey.self,
                                value: ["content": geo.frame(in: .named(userPromptNavigationRailCoordinateSpace))]
                            )
                        }
                    }
            }
            .scrollIndicators(.hidden)
            .frame(width: UserPromptNavigationRailModel.railWidth)
            .frame(height: layout.viewportHeight, alignment: .top)
            .onAppear {
                visibleIDs = nil
                scheduleScrollToCurrent(force: true)
            }
            .onChange(of: currentMessageID) { _, _ in
                scheduleScrollToCurrent(force: false)
            }
            .onChange(of: entries.count) { _, _ in
                // A new current may only scroll if it is outside the measured viewport.
                scheduleScrollToCurrent(force: false)
            }
            .onChange(of: pendingScrollID) { _, id in
                guard let id else { return }
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    proxy.scrollTo(id, anchor: .center)
                }
                pendingScrollID = nil
            }
        }
        .onPreferenceChange(UserPromptRailTickFrameKey.self) { frames in
            // With fixed pitch and a stable VStack, derive the visible ids from the
            // content offset without lazy/recycling tracking areas.
            let contentOffset = frames["content"]?.minY ?? 0
            visibleIDs = Set(nodes.enumerated().compactMap { index, node in
                let minY = contentOffset + layout.contentVerticalPadding + CGFloat(index) * layout.nodePitch
                let maxY = minY + layout.nodePitch
                return maxY > 0 && minY < layout.viewportHeight ? node.id : nil
            })
        }
    }

    private func handleHover(
        hovering: Bool,
        node: UserPromptNavigationRailModel.Node,
        index: Int,
        total: Int,
        midYInRail: CGFloat?
    ) {
        if hovering {
            hover = RailHoverState(
                id: node.id,
                text: UserPromptNavigationRailModel.hoverSummaryText(
                    summary: node.summary,
                    index: index,
                    total: total
                ),
                midY: midYInRail ?? 0
            )
        } else if hover?.id == node.id {
            hover = nil
        }
    }

    private func scheduleScrollToCurrent(force: Bool) {
        guard let currentMessageID,
              nodes.contains(where: { $0.id == currentMessageID }) else { return }
        scrollGeneration &+= 1
        let request = UserPromptNavigationRailModel.scrollRequestIfNeeded(
            currentMessageID: currentMessageID,
            previousVisibleIDs: force ? nil : visibleIDs,
            lastRequestedID: lastRequestedScrollID,
            allowsScroll: !layout.fitsWithoutScroll,
            generation: scrollGeneration
        )
        guard let request else { return }
        lastRequestedScrollID = request.messageID
        pendingScrollID = request.messageID
    }
}

// MARK: - Hover + tooltip

private struct RailHoverState: Equatable {
    var id: String
    var text: String
    var midY: CGFloat
}

private struct UserPromptNavigationRailTooltip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(.primary)
            .lineLimit(3)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(.thickMaterial)
                    .shadow(color: Color.black.opacity(0.14), radius: 5, y: 1)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            }
            .fixedSize(horizontal: true, vertical: true)
            .accessibilityHidden(true)
    }
}

// MARK: - Tick

private struct UserPromptNavigationRailTick: View {
    let node: UserPromptNavigationRailModel.Node
    let index: Int
    let total: Int
    let pitch: CGFloat
    let isCurrent: Bool
    let onSelect: (String) -> Void
    /// `(hovering, midYInRailCoordinateSpace)` — Y is nil on hover-exit.
    let onHoverChange: (Bool, CGFloat?) -> Void

    @State private var isHovered = false

    private var role: UserPromptNavigationRailModel.StyleRole {
        isCurrent ? .current : .normal
    }

    private var style: UserPromptNavigationRailModel.TickStyle {
        UserPromptNavigationRailModel.tickStyle(role: role, isHovered: isHovered)
    }

    var body: some View {
        Button {
            onSelect(node.id)
        } label: {
            // Leading-aligned short tick; current is longer / darker.
            // Full pitch slot is the hit target so dense rows stay easy to click.
            HStack(spacing: 0) {
                Capsule(style: .continuous)
                    .fill(Color.primary.opacity(style.opacity))
                    .frame(width: style.width, height: style.height)
                    .shadow(
                        color: style.hoverBoost ? Color.primary.opacity(0.18) : .clear,
                        radius: style.hoverBoost ? 2 : 0,
                        y: 0
                    )
                Spacer(minLength: 0)
            }
            .padding(.horizontal, UserPromptNavigationRailModel.hitSlopHorizontal)
            .frame(
                width: UserPromptNavigationRailModel.railWidth,
                height: pitch,
                alignment: .leading
            )
            .contentShape(Rectangle())
            .background {
                if isHovered || isCurrent {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(Color.primary.opacity(isCurrent ? 0.06 : 0.05))
                }
            }
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.12), value: isHovered)
        .animation(.easeInOut(duration: 0.12), value: isCurrent)
        .background {
            GeometryReader { geo in
                Color.clear
                    .onChange(of: isHovered) { _, hovering in
                        if hovering {
                            let frame = geo.frame(
                                in: .named(userPromptNavigationRailCoordinateSpace)
                            )
                            onHoverChange(true, frame.midY)
                        } else {
                            onHoverChange(false, nil)
                        }
                    }
            }
        }
        .onHover { hovering in
            isHovered = hovering
            // Immediate clear on exit (do not wait for geometry onChange).
            if !hovering {
                onHoverChange(false, nil)
            }
        }
        .pointingHandCursor()
        .accessibilityLabel(accessibilityLabelText)
        .accessibilityHint("跳转到该条用户输入")
        .accessibilityAddTraits(isCurrent ? [.isButton, .isSelected] : .isButton)
        .accessibilityValue(node.summary)
    }

    private var accessibilityLabelText: String {
        if isCurrent {
            return "当前用户输入 \(index + 1)/\(total)"
        }
        return "用户输入 \(index + 1)/\(total)"
    }
}
