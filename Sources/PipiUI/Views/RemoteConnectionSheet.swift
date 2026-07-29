import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

struct RemoteConnectionSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    /// Reserved for a future Relay/provider handshake. The local caller passes
    /// nil and must never derive a phone QR payload from the loopback URL.
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
        RemotePairingPayloadPolicy.validatedPayload(pairingPayload)
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
                Text("先用本机网页验证项目与会话流程；手机配对将在 Relay 接入后提供。")
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
                        Text("独立服务仅监听 127.0.0.1 的随机端口，默认关闭。")
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
                    if validatedPairingPayload != nil {
                        Text("二维码只包含 Relay 提供的短期一次性配对载荷。完成配对后应立即失效。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Label {
                            Text("本机测试地址不能用于手机扫码。127.0.0.1 在手机上指向手机自身，不会连接到这台 Mac。")
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
            Text("当前仅提供本机测试；不包含 LAN、账号、Relay 或 E2EE。")
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
