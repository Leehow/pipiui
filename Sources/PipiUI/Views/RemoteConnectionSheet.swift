import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

struct RemoteConnectionSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    /// Reserved for a future Relay/provider handshake. When nil, the sheet may
    /// use only the separately validated, explicitly enabled LAN pairing URL;
    /// it must never derive a phone QR payload from the loopback URL.
    let pairingPayload: String?
    @State private var relayWebSocketURL = ""
    @State private var relayPublicURL = ""
    @State private var relayDisplayName = ""
    @State private var relayMessage = ""

    init(pairingPayload: String? = nil) {
        self.pairingPayload = pairingPayload
    }

    private var indicator: LocalRemoteConnectionIndicator {
        .resolve(
            enabled: store.localRemoteEnabled,
            url: store.localRemoteURL,
            status: store.localRemoteStatus
        )
    }

    private var validatedPairingPayload: String? {
        let candidate = pairingPayload ?? store.remotePairingPayload
        if let p2p = P2PPairingPayloadPolicy.validatedPayload(
            candidate,
            expectedOrigin: store.remoteRelayConfiguration.publicURL
        ) {
            return p2p
        }
        return RemotePairingPayloadPolicy.validatedPayload(
            store.localRemoteLANURL?.absoluteString
        )
    }

    private var isLANPairingPayload: Bool {
        guard let validatedPairingPayload,
              let url = URL(string: validatedPairingPayload) else { return false }
        return url.scheme?.lowercased() == "http"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                relaySection
                localTestSection
#if DEBUG
                peerViabilitySection
#endif
                pairingSection
                footer
            }
            .padding(22)
        }
        .frame(width: 560)
        .frame(maxHeight: 760)
        .accessibilityIdentifier(RemoteConnectionAccessibility.sheetIdentifier)
        .onAppear {
            relayWebSocketURL = store.remoteRelayConfiguration.webSocketURL.absoluteString
            relayPublicURL = store.remoteRelayConfiguration.publicURL.absoluteString
            relayDisplayName = store.remoteRelayConfiguration.displayName
            store.refreshRemoteLegacyMigrationStatus()
        }
    }

    private var relaySection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("远程服务器隧道")
                            .font(.headline)
                        Text("浏览器与 Mac 通过一次性能力链接接入服务器隧道；服务器仅转发有界命令帧，不保存账号、设备或会话数据。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle(
                        "",
                        isOn: Binding(
                            get: { store.remoteRelayConfiguration.enabled },
                            set: { store.setRemoteRelayEnabled($0) }
                        )
                    )
                    .labelsHidden()
                    .accessibilityLabel(RemoteConnectionAccessibility.relayToggleLabel)
                }

                HStack(spacing: 8) {
                    Circle()
                        .fill(relayIndicatorColor)
                        .frame(width: 8, height: 8)
                    Text("隧道 WSS：\(store.remoteRelayState.displayText)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                HStack(spacing: 8) {
                    Circle()
                        .fill(peerIndicatorColor)
                        .frame(width: 8, height: 8)
                    Text("浏览器：\(store.remotePeerProductionState.displayText)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }

                TextField("wss://…/tunnel/ws", text: $relayWebSocketURL)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Relay WSS 地址")
                TextField("https://…/", text: $relayPublicURL)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Relay 公网配对地址")
                TextField("设备显示名称", text: $relayDisplayName)
                    .textFieldStyle(.roundedBorder)

                HStack {
                    Button("保存地址") {
                        relayMessage = store.updateRemoteRelayConfiguration(
                            webSocketURL: relayWebSocketURL,
                            publicURL: relayPublicURL,
                            displayName: relayDisplayName
                        ) ? "地址已保存" : "地址无效（产品界面仅接受独立主机的 /tunnel/ws）"
                    }
                    Button("复制网页地址") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(relayPublicURL, forType: .string)
                    }
                    Button("浏览器打开") {
                        if let url = RemoteRelaySettings.validatedPublicURL(relayPublicURL) {
                            NSWorkspace.shared.open(url)
                        }
                    }
                    Spacer()
                }

                if !relayMessage.isEmpty {
                    Text(relayMessage)
                        .font(.caption)
                        .foregroundStyle(
                            relayMessage.contains("无效") || relayMessage.contains("失败")
                                ? Color.orange : .secondary
                        )
                }
                Text("无需账号、验证码、设备注册、手工配对码或长期 token；命令不会降级到 HTTP API。")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(4)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.title2)
                .foregroundStyle(indicatorColor)
                .frame(width: 30, height: 30)
                .background(indicatorColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("远程连接")
                    .font(.title2.weight(.semibold))
                Text("默认仅限本机；也可临时开启受信任局域网测试，或使用 Relay 配对。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }

    private var localTestSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("本机网页测试")
                            .font(.headline)
                        Text("独立服务默认仅监听 127.0.0.1 的随机端口。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle(
                        "",
                        isOn: Binding(
                            get: { store.localRemoteEnabled },
                            set: { store.setLocalRemoteEnabled($0) }
                        )
                    )
                    .labelsHidden()
                    .accessibilityLabel(RemoteConnectionAccessibility.localToggleLabel)
                }

                HStack(spacing: 8) {
                    Circle()
                        .fill(indicatorColor)
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text(store.localRemoteStatus)
                        .font(.caption)
                        .foregroundStyle(indicator == .failed ? Color.orange : .secondary)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("本地网页测试状态")
                .accessibilityValue(store.localRemoteStatus)

                HStack(spacing: 8) {
                    Text(store.localRemoteURL?.absoluteString ?? "启用后显示本机测试地址")
                        .font(.caption.monospaced())
                        .foregroundStyle(store.localRemoteURL == nil ? .tertiary : .secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        copyLocalAddress()
                    } label: {
                        Label("复制地址", systemImage: "doc.on.doc")
                    }
                    .disabled(store.localRemoteURL == nil)
                    .accessibilityLabel(RemoteConnectionAccessibility.copyAddressLabel)

                    Button {
                        openLocalAddress()
                    } label: {
                        Label("浏览器打开", systemImage: "safari")
                    }
                    .disabled(store.localRemoteURL == nil)
                    .accessibilityLabel(RemoteConnectionAccessibility.openBrowserLabel)
                }

                Divider()

                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("局域网测试")
                            .font(.headline)
                        Text("每次启动均为关闭；只在受信任网络临时开启。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle(
                        "",
                        isOn: Binding(
                            get: { store.localRemoteLANEnabled },
                            set: { store.setLocalRemoteLANEnabled($0) }
                        )
                    )
                    .labelsHidden()
                    .disabled(!store.localRemoteEnabled)
                    .accessibilityLabel(RemoteConnectionAccessibility.lanToggleLabel)
                }

                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(store.localRemoteLANEnabled ? .orange : .secondary)
                        .accessibilityHidden(true)
                    Text(store.localRemoteLANStatus)
                        .font(.caption)
                        .foregroundStyle(
                            store.localRemoteLANStatus.contains("失败")
                                || store.localRemoteLANStatus.contains("未找到")
                                ? Color.orange
                                : .secondary
                        )
                    Spacer(minLength: 0)
                }

                HStack(spacing: 8) {
                    Text(store.localRemoteLANURL?.absoluteString ?? "开启后生成带短期配对密钥的局域网地址")
                        .font(.caption.monospaced())
                        .foregroundStyle(store.localRemoteLANURL == nil ? .tertiary : .secondary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        copyLANAddress()
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .disabled(store.localRemoteLANURL == nil)
                    .accessibilityLabel(RemoteConnectionAccessibility.copyLANAddressLabel)

                    Button {
                        openLANAddress()
                    } label: {
                        Image(systemName: "safari")
                    }
                    .disabled(store.localRemoteLANURL == nil)
                    .accessibilityLabel(RemoteConnectionAccessibility.openLANBrowserLabel)
                }
            }
            .padding(4)
        }
    }

    private var pairingSection: some View {
        GroupBox {
            HStack(alignment: .top, spacing: 16) {
                Group {
                    if let validatedPairingPayload {
                        RemoteQRCodeView(payload: validatedPairingPayload)
                    } else {
                        qrPlaceholder
                    }
                }
                .frame(width: 128, height: 128)

                VStack(alignment: .leading, spacing: 9) {
                        Text(isLANPairingPayload ? "手机配对二维码" : "一次性配对链接")
                        .font(.headline)
                    if validatedPairingPayload != nil, isLANPairingPayload {
                        Label {
                            Text("仅限受信任局域网测试。二维码包含本次临时配对密钥；关闭局域网测试后即失效。")
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    } else if validatedPairingPayload != nil {
                        Text("这是只可使用一次的配对链接；密钥只存在于 URL fragment，不会进入初始请求或普通访问日志。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let expiresAt = store.remotePairingExpiresAt {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                let seconds = max(
                                    0,
                                    Int(ceil(expiresAt.timeIntervalSince(context.date)))
                                )
                                Text("剩余 \(seconds / 60):\(String(format: "%02d", seconds % 60))")
                                    .font(.caption.monospacedDigit().weight(.semibold))
                                    .foregroundStyle(seconds <= 30 ? Color.orange : .secondary)
                            }
                        }
                        if let pairID = store.remotePairingPairID,
                           let fingerprint = store.remotePairingFingerprint {
                            Text("Link \(pairID.prefix(8))… · 密钥指纹 \(fingerprint.prefix(12))…")
                                .font(.caption2.monospaced())
                                .foregroundStyle(.tertiary)
                        }
                        HStack {
                            Button("复制配对链接") {
                                copyPairingLink()
                            }
                            .accessibilityLabel(
                                RemoteConnectionAccessibility.copyPairingLinkLabel
                            )
                            Button("在浏览器打开配对链接") {
                                openPairingLink()
                            }
                            .accessibilityLabel(
                                RemoteConnectionAccessibility.openPairingLinkLabel
                            )
                        }
                        Button("取消配对", role: .destructive) {
                            store.cancelRemotePairing()
                        }
                    } else {
                        Label {
                            Text("生成后直接复制链接即可；无需账号、验证码或手动输入配对码，二维码仅作为可选分享图。")
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)

                        Button("生成一次性配对链接") {
                            store.beginRemotePairing()
                        }
                        .disabled(
                            !store.remoteRelayConfiguration.enabled
                                || store.remoteRelayConfiguration.webSocketURL.path
                                    != "/tunnel/ws"
                        )

                        Text("链接不包含长期凭据；二维码仅是同一链接的可选分享图。")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    if !store.remotePairingMessage.isEmpty {
                        Text(store.remotePairingMessage)
                            .font(.caption2)
                            .foregroundStyle(
                                store.remotePairingMessage.contains("失败")
                                    ? Color.orange
                                    : Color.secondary
                            )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(4)
        }
    }

    private var peerViabilitySection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("实验：WKWebView WebRTC host")
                            .font(.headline)
                        Text("仅验证本机 Chrome ↔ App 内 WKWebView 的 DataChannel echo。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle(
                        "",
                        isOn: Binding(
                            get: { store.remotePeerTestEnabled },
                            set: { store.setRemotePeerTestEnabled($0) }
                        )
                    )
                    .labelsHidden()
                    .accessibilityLabel("启用 WKWebView WebRTC 可行性测试")
                }

                HStack(spacing: 8) {
                    Circle()
                        .fill(
                            store.remotePeerTestEchoVerified
                                ? Color.green
                                : store.remotePeerTestStatus.contains("失败")
                                    ? Color.orange
                                    : Color.secondary
                        )
                        .frame(width: 8, height: 8)
                    Text(store.remotePeerTestStatus)
                        .font(.caption)
                        .foregroundStyle(
                            store.remotePeerTestStatus.contains("失败")
                                ? Color.orange
                                : .secondary
                        )
                    Spacer()
                }

                HStack(spacing: 8) {
                    Text(
                        store.remotePeerTestURL?.absoluteString
                            ?? "启用后显示仅限 127.0.0.1 的 Chrome 测试页"
                    )
                    .font(.caption.monospaced())
                    .foregroundStyle(
                        store.remotePeerTestURL == nil ? .tertiary : .secondary
                    )
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        copyPeerTestAddress()
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .disabled(store.remotePeerTestURL == nil)
                    .accessibilityLabel("复制 WKWebView WebRTC 测试地址")

                    Button {
                        openPeerTestAddress()
                    } label: {
                        Label("Chrome 测试", systemImage: "globe")
                    }
                    .disabled(store.remotePeerTestURL == nil)
                    .accessibilityLabel("浏览器打开 WKWebView WebRTC 测试")
                }

                Text("这不是公网 P2P、远程登录或设备配对；隐藏、睡眠与长时间后台存活也尚未验收。")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(4)
        }
    }

    private var peerIndicatorColor: Color {
        switch store.remotePeerProductionState {
        case .connected:
            return .green
        case .negotiating:
            return .yellow
        case .failed:
            return .orange
        case .disabled, .ready, .closed:
            return .secondary
        }
    }

    private var qrPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.secondary.opacity(0.08))
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.secondary.opacity(0.18), style: StrokeStyle(dash: [5, 4]))
            Image(systemName: "qrcode")
                .font(.system(size: 44))
                .foregroundStyle(.tertiary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("配对链接分享图尚不可用")
    }

    private var footer: some View {
        HStack {
            Text("局域网模式为临时测试功能，不等同于公网 Relay 或 E2EE。")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Button("关闭") {
                dismiss()
            }
            .keyboardShortcut(.cancelAction)
        }
    }

    private var indicatorColor: Color {
        switch indicator {
        case .off:
            return .secondary
        case .starting:
            return .accentColor
        case .listening:
            return .green
        case .failed:
            return .orange
        }
    }

    private var relayIndicatorColor: Color {
        switch store.remoteRelayState {
        case .disabled:
            return .secondary
        case .connecting, .retrying:
            return .accentColor
        case .connected:
            return .green
        case .authenticationFailed, .invalidConfiguration, .protocolMismatch:
            return .orange
        }
    }

    private func copyLocalAddress() {
        guard let value = store.localRemoteURL?.absoluteString else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private func openLocalAddress() {
        guard let url = store.localRemoteURL else { return }
        NSWorkspace.shared.open(url)
    }

    private func copyLANAddress() {
        guard let value = store.localRemoteLANURL?.absoluteString else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private func openLANAddress() {
        guard let url = store.localRemoteLANURL else { return }
        NSWorkspace.shared.open(url)
    }

    private func copyPairingLink() {
        guard let value = validatedPairingPayload, !isLANPairingPayload else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private func openPairingLink() {
        guard let value = validatedPairingPayload,
              !isLANPairingPayload,
              let url = URL(string: value) else { return }
        NSWorkspace.shared.open(url)
    }

    private func copyPeerTestAddress() {
        guard let value = store.remotePeerTestURL?.absoluteString else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private func openPeerTestAddress() {
        guard let url = store.remotePeerTestURL else { return }
        if let chrome = NSWorkspace.shared.urlForApplication(
            withBundleIdentifier: "com.google.Chrome"
        ) {
            NSWorkspace.shared.open(
                [url],
                withApplicationAt: chrome,
                configuration: NSWorkspace.OpenConfiguration()
            )
        } else {
            NSWorkspace.shared.open(url)
        }
    }
}

struct RemoteQRCodeView: View {
    let payload: String
    private static let context = CIContext(options: [.useSoftwareRenderer: false])

    var body: some View {
        Group {
            if let image = Self.makeImage(payload: payload) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
            } else {
                Image(systemName: "qrcode")
                    .font(.system(size: 44))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(8)
        .background(.white, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("配对链接分享图")
    }

    static func makeImage(payload: String) -> NSImage? {
        guard !payload.isEmpty, let data = payload.data(using: .utf8) else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = data
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(
            by: CGAffineTransform(scaleX: 10, y: 10)
        ) else {
            return nil
        }
        guard let cgImage = context.createCGImage(output, from: output.extent) else {
            return nil
        }
        return NSImage(cgImage: cgImage, size: NSSize(width: output.extent.width, height: output.extent.height))
    }
}
