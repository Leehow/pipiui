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
    static let copyAddressLabel = "复制本地测试地址"
    static let openBrowserLabel = "在浏览器打开本地测试地址"
    static let unavailablePairingActionLabel = "生成二维码（需要 Relay）"
}

enum RemotePairingPayloadPolicy {
    static func validatedPayload(_ candidate: String?) -> String? {
        guard let candidate else { return nil }
        let payload = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !payload.isEmpty,
              payload.utf8.count <= 4_096,
              let url = URL(string: payload),
              url.scheme?.lowercased() == "https",
              let host = url.host,
              !isLoopbackHost(host) else {
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
}
