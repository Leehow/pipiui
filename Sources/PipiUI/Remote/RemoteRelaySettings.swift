import Foundation

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

    static let defaultWebSocketURL = URL(string: "wss://pipi.aichattrpg.com/host/ws")!
    static let defaultPublicURL = URL(string: "https://pipi.aichattrpg.com/")!

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
        let urls = validatedURLPair(
            webSocketURL: storedWebSocketURL,
            publicURL: storedPublicURL
        ) ?? (defaultWebSocketURL, defaultPublicURL)
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
              components.path == "/host/ws" else {
            return nil
        }
        return components.url
    }

    static func validatedPublicURL(_ value: String?) -> URL? {
        guard let value,
              let components = URLComponents(string: value),
              components.scheme?.lowercased() == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil else {
            return nil
        }
        return components.url
    }

    static func validatedURLPair(
        webSocketURL: URL?,
        publicURL: URL?
    ) -> (URL, URL)? {
        guard let webSocketURL,
              let publicURL,
              let webSocketHost = webSocketURL.host?.lowercased(),
              let publicHost = publicURL.host?.lowercased(),
              webSocketHost == publicHost,
              validatedWebSocketURL(webSocketURL.absoluteString) != nil,
              validatedPublicURL(publicURL.absoluteString) != nil else {
            return nil
        }
        return (webSocketURL, publicURL)
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
