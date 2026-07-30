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
        RemotePairingPayloadPolicy.validatedPayload(
            pairingPayload ?? store.localRemoteLANURL?.absoluteString
        )
    }

    private var isLANPairingPayload: Bool {
        guard let validatedPairingPayload,
              let url = URL(string: validatedPairingPayload) else { return false }
        return url.scheme?.lowercased() == "http"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            localTestSection
            pairingSection
            footer
        }
        .padding(22)
        .frame(width: 480)
        .accessibilityIdentifier(RemoteConnectionAccessibility.sheetIdentifier)
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
                    Text("手机配对二维码")
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
                        Text("二维码只包含 Relay 提供的短期一次性配对载荷。完成配对后应立即失效。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Label {
                            Text("开启“局域网测试”后可扫码；若无可用私有 IPv4 地址则不会生成二维码。")
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)

                        Button(RemoteConnectionAccessibility.unavailablePairingActionLabel) {}
                            .disabled(true)
                            .accessibilityLabel(
                                RemoteConnectionAccessibility.unavailablePairingActionLabel
                            )

                        Text("此处不会生成假 token，也不会把长期凭据编码进二维码。")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(4)
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
        .accessibilityLabel("手机配对二维码尚不可用")
    }

    private var footer: some View {
        HStack {
            Text("局域网模式为临时测试功能，不替代账号、Relay 或 E2EE。")
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
        .accessibilityLabel("一次性远程配对二维码")
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
