import SwiftUI

struct SettingsSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var models: [ModelInfo] = []
    @State private var credentials: [PiAuthStore.CredentialInfo] = []
    @State private var hiddenIds: Set<String> = ModelVisibility.hiddenModelIds()
    @State private var isLoading = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var pendingDeleteProvider: String?
    @State private var showAddSheet = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    modelSettingsSection
                }
                .padding(20)
            }
            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }
        }
        .frame(width: 480, height: 520)
        .task { await reload() }
        .sheet(isPresented: $showAddSheet) {
            AddModelSheet {
                Task { await reload(restartSessions: true) }
            }
            .environmentObject(store)
        }
        .confirmationDialog(
            "删除凭据？",
            isPresented: Binding(
                get: { pendingDeleteProvider != nil },
                set: { if !$0 { pendingDeleteProvider = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let provider = pendingDeleteProvider {
                Button("删除 \(provider)", role: .destructive) {
                    Task { await deleteProvider(provider) }
                }
            }
            Button("取消", role: .cancel) { pendingDeleteProvider = nil }
        } message: {
            Text("将从 ~/.pi/agent/auth.json 移除该 provider 的凭据（与 pi /logout 相同）。环境变量与 models.json 不受影响。该 provider 下所有模型会从列表消失。")
        }
    }

    private var header: some View {
        HStack {
            Text("设置")
                .font(.headline)
            Spacer()
            Button("完成") { dismiss() }
                .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    private var modelSettingsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("模型设置")
                    .font(.title3.weight(.semibold))
                Spacer()
                Button {
                    showAddSheet = true
                } label: {
                    Label("添加模型", systemImage: "plus")
                }
                .disabled(isLoading)
            }

            Text("勾选控制底栏模型菜单是否显示；删除会移除该 provider 的 Pi 凭据。")
                .font(.caption)
                .foregroundStyle(.secondary)

            if isLoading && models.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 24)
            } else if models.isEmpty {
                Text("暂无已配置凭据的模型。点击「添加模型」登录或写入 API key。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 12)
            } else {
                ForEach(groupedProviders, id: \.self) { provider in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(provider)
                                .font(.subheadline.weight(.semibold))
                            if let cred = credentials.first(where: { $0.providerId == provider }) {
                                Text(cred.type == "oauth" ? "账号" : "API key")
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(Color.primary.opacity(0.08)))
                            }
                            Spacer()
                            Button(role: .destructive) {
                                pendingDeleteProvider = provider
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .help("删除该 provider 凭据")
                        }
                        ForEach(models.filter { $0.provider == provider }) { model in
                            Toggle(isOn: visibilityBinding(for: model.id)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(model.name)
                                        .font(.callout)
                                    Text(model.id)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .toggleStyle(.checkbox)
                        }
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
                }
            }
        }
    }

    private var groupedProviders: [String] {
        var seen: Set<String> = []
        var result: [String] = []
        for m in models where !seen.contains(m.provider) {
            seen.insert(m.provider)
            result.append(m.provider)
        }
        return result
    }

    private func visibilityBinding(for modelId: String) -> Binding<Bool> {
        Binding(
            get: { !hiddenIds.contains(modelId) },
            set: { visible in
                ModelVisibility.setHidden(!visible, modelId: modelId)
                hiddenIds = ModelVisibility.hiddenModelIds()
                store.modelVisibilityRevision &+= 1
            }
        )
    }

    @MainActor
    private func reload(restartSessions: Bool = false) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        credentials = PiAuthStore.list()
        hiddenIds = ModelVisibility.hiddenModelIds()

        if restartSessions {
            store.restartAllOpenSessions()
        }

        // After auth changes, open sessions restart asynchronously — prefer helper.
        // Otherwise reuse an already-loaded session list for snappier UI.
        do {
            if !restartSessions,
               let live = store.currentSession?.availableModels, !live.isEmpty {
                models = live
            } else if !restartSessions,
                      let any = store.openSessions.values.first(where: { !$0.availableModels.isEmpty }) {
                models = any.availableModels
            } else {
                models = try await PiAuthHelper.listModels()
            }
        } catch {
            if let live = store.currentSession?.availableModels, !live.isEmpty {
                models = live
            } else {
                models = []
                if credentials.isEmpty {
                    errorMessage = error.localizedDescription
                } else {
                    statusMessage = "已读取凭据，但未能枚举模型：\(error.localizedDescription)"
                }
            }
        }
        if restartSessions {
            statusMessage = "已更新，相关会话已刷新"
        }
    }

    @MainActor
    private func deleteProvider(_ providerId: String) async {
        pendingDeleteProvider = nil
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            // Prefer helper logout (refreshes pi runtime side-effects); fall back to file delete.
            do {
                try await PiAuthHelper.logout(providerId: providerId)
            } catch {
                try PiAuthStore.delete(providerId: providerId)
            }
            // Drop visibility prefs for gone models.
            for m in models where m.provider == providerId {
                ModelVisibility.setHidden(false, modelId: m.id)
            }
            hiddenIds = ModelVisibility.hiddenModelIds()
            store.modelVisibilityRevision &+= 1
            await reload(restartSessions: true)
            statusMessage = "已删除 \(providerId) 的凭据"
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Add model

struct AddModelSheet: View {
    var onFinished: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var authType: String = "api_key" // oauth | api_key
    @State private var providers: [PiAuthHelper.LoginProvider] = []
    @State private var selectedProviderId: String?
    @State private var apiKey: String = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?

    private var filteredProviders: [PiAuthHelper.LoginProvider] {
        providers.filter { $0.authTypes.contains(authType) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("添加模型")
                .font(.headline)

            Picker("认证方式", selection: $authType) {
                Text("API key").tag("api_key")
                Text("账号登录").tag("oauth")
            }
            .pickerStyle(.segmented)
            .onChange(of: authType) { _, _ in
                if let id = selectedProviderId,
                   !filteredProviders.contains(where: { $0.id == id }) {
                    selectedProviderId = filteredProviders.first?.id
                }
            }

            if providers.isEmpty && errorMessage == nil {
                ProgressView("加载 provider 列表…")
            } else {
                Picker("Provider", selection: Binding(
                    get: { selectedProviderId ?? "" },
                    set: { selectedProviderId = $0.isEmpty ? nil : $0 }
                )) {
                    ForEach(filteredProviders) { p in
                        Text(p.name).tag(p.id)
                    }
                }

                if authType == "api_key" {
                    SecureField("API key", text: $apiKey)
                        .textFieldStyle(.roundedBorder)
                } else {
                    Text("将打开浏览器完成授权（与 pi /login 相同）。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack {
                Spacer()
                Button("取消") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(isWorking)
                Button(authType == "oauth" ? "登录" : "保存") {
                    Task { await submit() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isWorking || selectedProviderId == nil || (authType == "api_key" && apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            }
        }
        .padding(20)
        .frame(width: 420)
        .task { await loadProviders() }
    }

    @MainActor
    private func loadProviders() async {
        errorMessage = nil
        do {
            providers = try await PiAuthHelper.listProviders()
            selectedProviderId = filteredProviders.first?.id
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func submit() async {
        guard let providerId = selectedProviderId else { return }
        isWorking = true
        errorMessage = nil
        statusMessage = authType == "oauth" ? "等待浏览器授权…" : "保存中…"
        defer { isWorking = false }
        do {
            if authType == "api_key" {
                // Prefer SDK login (provider-specific prompts); fall back to direct write.
                do {
                    try await PiAuthHelper.login(providerId: providerId, authType: "api_key", apiKey: apiKey)
                } catch {
                    try PiAuthStore.setAPIKey(providerId: providerId, key: apiKey)
                }
            } else {
                try await PiAuthHelper.login(providerId: providerId, authType: "oauth")
            }
            statusMessage = "已保存"
            onFinished()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            statusMessage = nil
        }
    }
}
