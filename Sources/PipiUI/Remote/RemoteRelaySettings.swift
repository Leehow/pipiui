import Foundation
import Darwin

struct RemoteRelayConfiguration: Equatable, Sendable {
    var enabled: Bool
    var webSocketURL: URL
    var publicURL: URL
    var deviceID: String
    var displayName: String
}

enum RemoteRelaySettings {
    private static let enabledKey = "pipiui.remoteRelay.enabled"
    private static let webSocketURLKey = "pipiui.remoteRelay.webSocketURL"
    private static let publicURLKey = "pipiui.remoteRelay.publicURL"
    private static let deviceIDKey = "pipiui.remoteRelay.deviceID"
    private static let displayNameKey = "pipiui.remoteRelay.displayName"

    static let defaultWebSocketURL = URL(
        string: "wss://signal.aichattrpg.com/tunnel/ws"
    )!
    static let defaultPublicURL = URL(string: "https://pipi.aichattrpg.com/")!

    static func isLegacyConfiguration(_ configuration: RemoteRelayConfiguration) -> Bool {
        configuration.webSocketURL.path != "/tunnel/ws"
    }

    static func needsLegacyMigration(
        _ configuration: RemoteRelayConfiguration,
        hasLegacyCredentials: Bool
    ) -> Bool {
        // Old Keychain entries are inert legacy data. They are neither read by
        // the capability tunnel nor a reason to interrupt the accountless flow.
        _ = hasLegacyCredentials
        return isLegacyConfiguration(configuration)
    }

    static func migratedFromLegacy(
        _ configuration: RemoteRelayConfiguration
    ) -> RemoteRelayConfiguration {
        var value = configuration
        value.webSocketURL = defaultWebSocketURL
        value.publicURL = defaultPublicURL
        return value
    }

    static func load(defaults: UserDefaults = .standard) -> RemoteRelayConfiguration {
        let storedDeviceID = defaults.string(forKey: deviceIDKey)
        let deviceID = storedDeviceID.flatMap(UUID.init(uuidString:))?.uuidString.lowercased()
            ?? UUID().uuidString.lowercased()
        if storedDeviceID == nil {
            defaults.set(deviceID, forKey: deviceIDKey)
        }
        let storedWebSocketURL = validatedWebSocketURL(
            defaults.string(forKey: webSocketURLKey)
        )
        let storedPublicURL = validatedPublicURL(
            defaults.string(forKey: publicURLKey)
        )
        let storedURLs = validatedURLPair(
            webSocketURL: storedWebSocketURL,
            publicURL: storedPublicURL
        ) ?? (defaultWebSocketURL, defaultPublicURL)
        let urls: (URL, URL)
        if storedURLs.0.path == "/tunnel/ws" {
            urls = storedURLs
        } else {
            // `/device/ws` and `/host/ws` are legacy implementation details.
            // Migrate before a caller can start a client; no confirmation,
            // credential lookup, or blocking migration UI is involved.
            urls = (defaultWebSocketURL, defaultPublicURL)
            defaults.set(defaultWebSocketURL.absoluteString, forKey: webSocketURLKey)
            defaults.set(defaultPublicURL.absoluteString, forKey: publicURLKey)
        }
        return RemoteRelayConfiguration(
            enabled: defaults.bool(forKey: enabledKey),
            webSocketURL: urls.0,
            publicURL: urls.1,
            deviceID: deviceID,
            displayName: String(
                (defaults.string(forKey: displayNameKey) ?? Host.current().localizedName ?? "Mac")
                    .prefix(80)
            )
        )
    }

    static func save(_ configuration: RemoteRelayConfiguration, defaults: UserDefaults = .standard) {
        defaults.set(configuration.enabled, forKey: enabledKey)
        defaults.set(configuration.webSocketURL.absoluteString, forKey: webSocketURLKey)
        defaults.set(configuration.publicURL.absoluteString, forKey: publicURLKey)
        defaults.set(configuration.deviceID, forKey: deviceIDKey)
        defaults.set(String(configuration.displayName.prefix(80)), forKey: displayNameKey)
    }

    static func validatedWebSocketURL(_ value: String?) -> URL? {
        guard let value,
              let components = URLComponents(string: value),
              components.scheme?.lowercased() == "wss",
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.fragment == nil,
              ["/tunnel/ws", "/trystero/ws", "/device/ws", "/host/ws"]
                .contains(components.path),
              let url = components.url,
              canonicalSecurityHostname(url) != nil else {
            return nil
        }
        return url
    }

    static func validatedPublicURL(_ value: String?) -> URL? {
        guard let value,
              let components = URLComponents(string: value),
              components.scheme?.lowercased() == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              let url = components.url,
              canonicalSecurityHostname(url) != nil else {
            return nil
        }
        return url
    }

    static func validatedURLPair(
        webSocketURL: URL?,
        publicURL: URL?
    ) -> (URL, URL)? {
        guard let webSocketURL,
              let publicURL,
              let webSocketHost = canonicalSecurityHostname(webSocketURL),
              let publicHost = canonicalSecurityHostname(publicURL),
              validatedWebSocketURL(webSocketURL.absoluteString) != nil,
              validatedPublicURL(publicURL.absoluteString) != nil else {
            return nil
        }
        if ["/tunnel/ws", "/trystero/ws", "/device/ws"]
            .contains(webSocketURL.path) {
            guard webSocketHost != publicHost else { return nil }
        } else {
            guard webSocketHost == publicHost else { return nil }
        }
        return (webSocketURL, publicURL)
    }

    static func canonicalSecurityHostname(_ url: URL) -> String? {
        guard let rawHost = url.host, !rawHost.isEmpty else { return nil }
        let host = rawHost.lowercased()

        // A terminal DNS root dot is an alternate spelling of the same
        // resolver identity, not an independent signaling hostname.
        guard !host.hasSuffix(".") else { return nil }

        if host.contains(":") {
            var address = in6_addr()
            guard host.withCString({
                inet_pton(AF_INET6, $0, &address)
            }) == 1 else {
                return nil
            }
            var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
            guard inet_ntop(
                AF_INET6,
                &address,
                &buffer,
                socklen_t(INET6_ADDRSTRLEN)
            ) != nil else {
                return nil
            }
            return String(cString: buffer)
        }

        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        let decimalParts = parts.allSatisfy { part in
            !part.isEmpty && part.utf8.allSatisfy { byte in
                byte >= 48 && byte <= 57
            }
        }
        if parts.count == 4 && decimalParts {
            var canonical: [String] = []
            for part in parts {
                guard (part.count == 1 || part.first != "0"),
                      let octet = UInt8(part) else {
                    return nil
                }
                canonical.append(String(octet))
            }
            return canonical.joined(separator: ".")
        }

        // Foundation intentionally leaves historical IPv4 spellings textual.
        // Reject anything composed entirely of decimal or 0x-prefixed numeric
        // labels so integer, abbreviated, octal-like, and hexadecimal forms
        // can never fall through and be treated as DNS names.
        let looksLikeLegacyIPv4 = !parts.isEmpty && parts.allSatisfy { part in
            guard !part.isEmpty else { return false }
            let lower = part.lowercased()
            if lower.hasPrefix("0x") {
                let digits = lower.dropFirst(2)
                return !digits.isEmpty && digits.allSatisfy(\.isHexDigit)
            }
            return part.utf8.allSatisfy { byte in
                byte >= 48 && byte <= 57
            }
        }
        guard !looksLikeLegacyIPv4 else { return nil }

        // URL.host supplies Foundation's ASCII/IDNA serialization.
        return host
    }

    private static func authorityHostname(_ url: URL) -> String? {
        guard let host = canonicalSecurityHostname(url) else { return nil }
        return host.contains(":") ? "[\(host)]" : host
    }

    private static func canonicalPort(_ port: Int?, for scheme: String) -> String {
        guard let port else { return "" }
        if (["https", "wss"].contains(scheme) && port == 443)
            || (["http", "ws"].contains(scheme) && port == 80) {
            return ""
        }
        return ":\(port)"
    }

    static func originString(_ url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(),
              let host = authorityHostname(url) else {
            return nil
        }
        return "\(scheme)://\(host)\(canonicalPort(components.port, for: scheme))"
    }

    static func signalingAudience(_ webSocketURL: URL) -> String? {
        guard let components = URLComponents(
            url: webSocketURL,
            resolvingAgainstBaseURL: false
        ),
              let scheme = components.scheme?.lowercased(),
              let host = authorityHostname(webSocketURL),
              let audienceScheme = ["wss": "https", "ws": "http"][scheme] else {
            return nil
        }
        return "\(audienceScheme)://\(host)" +
            canonicalPort(components.port, for: audienceScheme)
    }

    static func validatedURLPair(
        webSocketURL: String,
        publicURL: String
    ) -> (URL, URL)? {
        validatedURLPair(
            webSocketURL: validatedWebSocketURL(webSocketURL),
            publicURL: validatedPublicURL(publicURL)
        )
    }
}
