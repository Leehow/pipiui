import Foundation

enum LocalRemoteConnectionIndicator: Equatable {
    case off
    case starting
    case listening
    case failed

    static func resolve(
        enabled: Bool,
        url: URL?,
        status: String
    ) -> LocalRemoteConnectionIndicator {
        if url != nil {
            return .listening
        }
        if status.localizedCaseInsensitiveContains("失败") {
            return .failed
        }
        return enabled ? .starting : .off
    }
}

enum RemoteConnectionAccessibility {
    static let sidebarButtonLabel = "远程连接"
    static let sheetIdentifier = "PipiUI.RemoteConnectionSheet"
    static let localToggleLabel = "启用本地网页测试"
    static let lanToggleLabel = "启用局域网测试"
    static let copyAddressLabel = "复制本地测试地址"
    static let openBrowserLabel = "在浏览器打开本地测试地址"
    static let copyLANAddressLabel = "复制局域网测试地址"
    static let openLANBrowserLabel = "在浏览器打开局域网测试地址"
    static let unavailablePairingActionLabel = "生成二维码（需开启局域网测试或 Relay）"
    static let relayToggleLabel = "启用公网 Relay"
}

enum RemotePairingPayloadPolicy {
    static func validatedPayload(_ candidate: String?) -> String? {
        guard let candidate else { return nil }
        let payload = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !payload.isEmpty,
              payload.utf8.count <= 4_096,
              let components = URLComponents(string: payload),
              let url = components.url,
              let scheme = url.scheme?.lowercased(),
              let host = url.host,
              url.user == nil,
              url.password == nil,
              !isLoopbackHost(host) else {
            return nil
        }
        if scheme == "http" {
            guard LocalRemoteNetwork.isPrivateIPv4(host),
                  url.fragment == nil,
                  url.path == "/",
                  components.queryItems?.count == 1,
                  components.queryItems?.first?.name == "pair",
                  let secret = components.queryItems?.first?.value,
                  isHighEntropyPairingMaterial(secret) else {
                return nil
            }
        } else if scheme != "https" {
            return nil
        }
        return payload
    }

    static func isLoopbackURL(_ url: URL) -> Bool {
        guard let host = url.host else { return false }
        return isLoopbackHost(host)
    }

    private static func isLoopbackHost(_ rawHost: String) -> Bool {
        let host = rawHost
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            .lowercased()
        if host == "localhost" || host.hasSuffix(".localhost") || host == "::1" {
            return true
        }
        return host == "127"
            || host.hasPrefix("127.")
            || host == "2130706433"
    }

    private static func isHighEntropyPairingMaterial(_ value: String) -> Bool {
        guard (32...256).contains(value.utf8.count) else { return false }
        let permitted = CharacterSet(
            charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
        )
        return value.unicodeScalars.allSatisfy { permitted.contains($0) }
    }
}
