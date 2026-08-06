import SwiftUI
import WebKit

struct WebViewPanel: View {
    @ObservedObject var store: WebViewStore
    var onClose: () -> Void
    @State private var addressText = ""

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            WebViewRepresentable(webView: store.webView)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onAppear { addressText = store.urlString }
        .onChange(of: store.urlString) { _, new in
            addressText = new
        }
    }

    private var toolbar: some View {
        HStack(spacing: 8) {
            Button { store.webView.goBack() } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.plain)
            .disabled(!store.webView.canGoBack)

            Button { store.webView.goForward() } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.plain)
            .disabled(!store.webView.canGoForward)

            Button {
                if store.isLoading {
                    store.webView.stopLoading()
                } else {
                    store.webView.reload()
                }
            } label: {
                Image(systemName: store.isLoading ? "xmark" : "arrow.clockwise")
            }
            .buttonStyle(.plain)

            TextField("输入网址，如 localhost:3000", text: $addressText)
                .textFieldStyle(.plain)
                .font(.callout)
                .onSubmit { store.navigate(addressText) }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    Capsule().fill(Color.primary.opacity(0.06))
                )

            if store.isLoading {
                ProgressView().controlSize(.small)
            }

            if store.browserActivity != .idle {
                HStack(spacing: 4) {
                    ProgressView().controlSize(.mini)
                    Text(store.browserActivity.label)
                        .font(.caption2)
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Capsule().fill(Color.primary.opacity(0.06)))
                .accessibilityLabel("浏览器\(store.browserActivity.label)")
                .allowsHitTesting(false)
            }

            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("关闭浏览器面板")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }
}

private struct WebViewRepresentable: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
