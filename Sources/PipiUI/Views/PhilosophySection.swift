import SwiftUI

/// Settings → 通用 → 哲学.
///
/// Small on purpose: the philosophy itself lives in the `pipi-philosophy` pi package, and this
/// panel is only a GUI over `~/.pi/agent/philosophy.json`. The same switches are reachable from
/// a terminal with `/philosophy`.
struct PhilosophySection: View {
    @ObservedObject var store: AppStore

    @State private var catalog: [PhilosophySettings.Layer] = []
    @State private var enabled = PhilosophySettings.isEnabled()
    @State private var registration = PhilosophyPackage.registration()
    @State private var statusMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if PhilosophyPackage.extensionPath == nil {
                Text("哲学包未安装（应用资源缺失）。重新打包 App 可修复。")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else {
                ForEach(catalog) { layer in
                    layerRow(layer)
                }
                registrationRow
            }
            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear(perform: reload)
        .onChange(of: store.philosophyRevision) { _, _ in reload() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: enabledBinding) {
                Label("哲学", systemImage: "brain")
            }
            .help("常驻工作哲学：判断准则、编排方式、并发方式。装在 pi 里，不在本 App 里。")
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var subtitle: String {
        guard enabled else { return "关闭后不再注入任何一层。" }
        let tokens = PhilosophySettings.estimatedActiveTokens()
        return "每轮常驻，约 \(tokens >= 1000 ? String(format: "%.1fk", Double(tokens) / 1000) : "\(tokens)") tokens。改动在新一轮生效。"
    }

    @ViewBuilder
    private func layerRow(_ layer: PhilosophySettings.Layer) -> some View {
        // A layer whose dependency is off cannot reach the model, so its own switch is inert.
        let blockedBy = layer.requires.filter { requiredID in
            !PhilosophySettings.isLayerEnabled(requiredID)
        }
        let blockedName = blockedBy.compactMap { id in
            catalog.first(where: { $0.id == id })?.name
        }.joined(separator: "、")

        VStack(alignment: .leading, spacing: 2) {
            Toggle(isOn: layerBinding(layer)) {
                HStack(spacing: 6) {
                    Text(layer.name)
                    if layer.isUserProvided {
                        Text("自定义")
                            .font(.caption2)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Color.secondary.opacity(0.15), in: Capsule())
                    }
                    Text("~\(layer.estimatedTokens)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .disabled(!enabled || !blockedBy.isEmpty)
            if !layer.summary.isEmpty {
                Text(blockedName.isEmpty ? layer.summary : "\(layer.summary)（依赖「\(blockedName)」）")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.leading, layer.requires.isEmpty ? 0 : 18)
        .opacity(enabled ? 1 : 0.5)
    }

    @ViewBuilder
    private var registrationRow: some View {
        HStack(spacing: 8) {
            switch registration {
            case .registered:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                Text("已装进 pi —— 终端裸跑 `pi` 和派出去的 worker 也生效")
                    .font(.caption)
                Spacer()
                Button("移除") { setRegistered(false) }
                    .font(.caption)
            case .notRegistered:
                Image(systemName: "exclamationmark.circle").foregroundStyle(.orange)
                Text("仅本 App 生效；装进 pi 后终端裸跑也能用")
                    .font(.caption)
                Spacer()
                Button("装进 pi") { setRegistered(true) }
                    .font(.caption)
            case .unreadable(let detail):
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text("~/.pi/agent/settings.json \(detail)，已跳过注册（不会覆盖你的配置）")
                    .font(.caption)
                    .foregroundStyle(.orange)
                Spacer()
            }
        }
        .padding(.top, 2)
    }

    // MARK: - Actions

    private var enabledBinding: Binding<Bool> {
        Binding(
            get: { enabled },
            set: { newValue in
                PhilosophySettings.setEnabled(newValue)
                enabled = newValue
                statusMessage = nil
                store.philosophyRevision &+= 1
            }
        )
    }

    private func layerBinding(_ layer: PhilosophySettings.Layer) -> Binding<Bool> {
        Binding(
            get: { PhilosophySettings.isLayerEnabled(layer.id) },
            set: { newValue in
                PhilosophySettings.setLayerEnabled(newValue, id: layer.id)
                statusMessage = nil
                store.philosophyRevision &+= 1
            }
        )
    }

    private func setRegistered(_ shouldRegister: Bool) {
        do {
            if shouldRegister {
                try PhilosophyPackage.register()
                PhilosophyPackage.setAutoRegisterEnabled(true)
                statusMessage = "已写入 ~/.pi/agent/settings.json。新开的 pi 会话生效。"
            } else {
                try PhilosophyPackage.unregister()
                PhilosophyPackage.setAutoRegisterEnabled(false)
                statusMessage = "已从 pi 的包列表移除；本 App 的会话仍会加载它。"
            }
        } catch {
            statusMessage = error.localizedDescription
        }
        registration = PhilosophyPackage.registration()
        store.philosophyRevision &+= 1
    }

    private func reload() {
        catalog = PhilosophySettings.layers()
        enabled = PhilosophySettings.isEnabled()
        registration = PhilosophyPackage.registration()
    }
}
