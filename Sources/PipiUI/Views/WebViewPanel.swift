import SwiftUI
import WebKit

/// 右侧内置浏览器面板：多 tab（每个 tab 独立 WKWebView），地址栏 / 前进后退
/// 作用于选中 tab；pi 的 browser 工具同样驱动选中 tab。
struct WebViewPanel: View {
    @ObservedObject var store: WebTabsStore
    @State private var addressText = ""

    var body: some View {
        VStack(spacing: 0) {
            tabStrip
            Divider()
            toolbar
            Divider()
            // 切 tab 时重建宿主，避免一个 representable 反复搬移多个 WKWebView。
            WebViewRepresentable(webView: store.active.webView)
                .id(store.selectedTabID ?? "")
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onAppear { addressText = store.active.urlString }
        .onChange(of: store.active.urlString) { _, new in
            addressText = new
        }
        .onChange(of: store.selectedTabID) { _, _ in
            addressText = store.active.urlString
        }
    }

    // MARK: - Tab strip

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(store.tabs) { tab in
                    PanelTabChip(
                        icon: "globe",
                        title: store.displayTitle(for: tab),
                        isSelected: tab.id == store.selectedTabID,
                        onSelect: { store.select(id: tab.id) },
                        onClose: { store.closeTab(id: tab.id) }
                    )
                }
                Button {
                    store.addTab()
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                        .help("新建标签页")
                }
                .buttonStyle(HoverButtonStyle())
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: 8) {
            Button { store.active.webView.goBack() } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.plain)
            .disabled(!store.active.webView.canGoBack)

            Button { store.active.webView.goForward() } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.plain)
            .disabled(!store.active.webView.canGoForward)

            Button {
                if store.active.isLoading {
                    store.active.webView.stopLoading()
                } else {
                    store.active.webView.reload()
                }
            } label: {
                Image(systemName: store.active.isLoading ? "xmark" : "arrow.clockwise")
            }
            .buttonStyle(.plain)

            TextField("输入网址，如 localhost:3000", text: $addressText)
                .textFieldStyle(.plain)
                .font(.callout)
                .onSubmit { store.active.navigate(addressText) }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    Capsule().fill(Color.primary.opacity(0.06))
                )

            if store.active.isLoading {
                ProgressView().controlSize(.small)
            }

            if store.active.browserActivity != .idle {
                HStack(spacing: 4) {
                    ProgressView().controlSize(.mini)
                    Text(store.active.browserActivity.label)
                        .font(.caption2)
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Capsule().fill(Color.primary.opacity(0.06)))
                .accessibilityLabel("浏览器\(store.active.browserActivity.label)")
                .allowsHitTesting(false)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }
}

/// 面板顶部的小 tab：图标 + 标题 + 关闭按钮，浏览器 / 文档面板共用。
struct PanelTabChip: View {
    var icon: String
    var title: String
    var isSelected: Bool
    var onSelect: () -> Void
    var onClose: () -> Void

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
            Text(title)
                .font(.caption)
                .lineLimit(1)
                .frame(maxWidth: 120)
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 7, weight: .bold))
                    .frame(width: 12, height: 12)
                    .contentShape(Rectangle())
                    .help("关闭标签页")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule().fill(isSelected ? Color.accentColor.opacity(0.15) : Color.primary.opacity(0.05))
        )
        .foregroundStyle(isSelected ? Color.primary : Color.secondary)
        .contentShape(Capsule())
        .onTapGesture(perform: onSelect)
        .help(title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct WebViewRepresentable: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
