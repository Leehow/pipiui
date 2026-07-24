import Foundation

/// Runs the bundled `pi-auth-helper.mjs` against the locally installed pi SDK.
enum PiAuthHelper {
    struct LoginProvider: Identifiable, Equatable, Hashable {
        let id: String
        let name: String
        let authTypes: [String]
        let loginLabel: String?
    }

    enum HelperError: Error, LocalizedError {
        case helperMissing
        case nodeMissing
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .helperMissing: return "未找到 pi-auth-helper.mjs"
            case .nodeMissing: return "未找到 node，无法执行登录辅助脚本"
            case .failed(let msg): return msg
            }
        }
    }

    static func helperURL() -> URL? {
        if let url = Bundle.module.url(
            forResource: "pi-auth-helper",
            withExtension: "mjs",
            subdirectory: "Resources"
        ) {
            return url
        }
        return Bundle.module.url(forResource: "pi-auth-helper", withExtension: "mjs")
    }

    static func findNode() -> String? {
        let fm = FileManager.default
        var candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
        ]
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates += path.split(separator: ":").map { String($0) + "/node" }
        }
        if let direct = candidates.first(where: { fm.isExecutableFile(atPath: $0) }) {
            return direct
        }
        // nvm: pick latest node binary under versions
        let nvmRoot = NSHomeDirectory() + "/.nvm/versions/node"
        if let vers = try? fm.contentsOfDirectory(atPath: nvmRoot) {
            for v in vers.sorted().reversed() {
                let p = nvmRoot + "/" + v + "/bin/node"
                if fm.isExecutableFile(atPath: p) { return p }
            }
        }
        return nil
    }

    static func listProviders() async throws -> [LoginProvider] {
        let json = try await run(arguments: ["list-providers"])
        guard let providers = json["providers"] as? [[String: Any]] else {
            throw HelperError.failed("无效的 providers 响应")
        }
        return providers.compactMap { row in
            guard let id = row["id"] as? String, let name = row["name"] as? String else { return nil }
            let types = (row["authTypes"] as? [String]) ?? []
            return LoginProvider(
                id: id,
                name: name,
                authTypes: types,
                loginLabel: row["loginLabel"] as? String
            )
        }
    }

    static func listModels() async throws -> [ModelInfo] {
        let json = try await run(arguments: ["list-models"])
        guard let models = json["models"] as? [[String: Any]] else {
            throw HelperError.failed("无效的 models 响应")
        }
        return models.compactMap { row in
            guard let provider = row["provider"] as? String, let id = row["id"] as? String else { return nil }
            let name = (row["name"] as? String) ?? id
            let ctx = row["contextWindow"] as? Int
            return ModelInfo(provider: provider, modelId: id, name: name, contextWindow: ctx)
        }
    }

    static func login(providerId: String, authType: String, apiKey: String? = nil) async throws {
        var args = ["login", providerId, authType]
        if let apiKey, !apiKey.isEmpty { args.append(apiKey) }
        _ = try await run(arguments: args, timeout: 300)
    }

    static func logout(providerId: String) async throws {
        _ = try await run(arguments: ["logout", providerId])
    }

    // MARK: - Process

    private static func run(arguments: [String], timeout: TimeInterval = 60) async throws -> [String: Any] {
        guard let helper = helperURL() else { throw HelperError.helperMissing }
        guard let node = findNode() else { throw HelperError.nodeMissing }

        return try await withCheckedThrowingContinuation { cont in
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: node)
            proc.arguments = [helper.path] + arguments
            var env = ProcessInfo.processInfo.environment
            let extra = [
                (PiProcess.findPiExecutable() as NSString?)?.deletingLastPathComponent,
                "/opt/homebrew/bin", "/usr/local/bin",
            ].compactMap { $0 }
            env["PATH"] = (extra + [env["PATH"] ?? ""]).joined(separator: ":")
            proc.environment = env

            let out = Pipe()
            let err = Pipe()
            proc.standardOutput = out
            proc.standardError = err

            let timeoutItem = DispatchWorkItem {
                if proc.isRunning { proc.terminate() }
            }

            proc.terminationHandler = { p in
                timeoutItem.cancel()
                let data = out.fileHandleForReading.readDataToEndOfFile()
                let errData = err.fileHandleForReading.readDataToEndOfFile()
                let text = String(data: data, encoding: .utf8) ?? ""
                let errText = String(data: errData, encoding: .utf8) ?? ""

                // Last JSON line with ok is the result; earlier lines may be events.
                let lines = text.split(whereSeparator: \.isNewline).map(String.init)
                var last: [String: Any]?
                for line in lines {
                    if let d = line.data(using: .utf8),
                       let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                        last = obj
                    }
                }
                if let last, let ok = last["ok"] as? Bool {
                    if ok {
                        cont.resume(returning: last)
                    } else {
                        let msg = (last["error"] as? String) ?? errText.trimmingCharacters(in: .whitespacesAndNewlines)
                        cont.resume(throwing: HelperError.failed(msg.isEmpty ? "login helper failed" : msg))
                    }
                    return
                }
                if p.terminationStatus == 0, let last {
                    cont.resume(returning: last)
                    return
                }
                let fallback = errText.trimmingCharacters(in: .whitespacesAndNewlines)
                cont.resume(throwing: HelperError.failed(fallback.isEmpty ? "helper exited \(p.terminationStatus)" : fallback))
            }

            do {
                try proc.run()
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timeoutItem)
            } catch {
                timeoutItem.cancel()
                cont.resume(throwing: HelperError.failed(error.localizedDescription))
            }
        }
    }
}
