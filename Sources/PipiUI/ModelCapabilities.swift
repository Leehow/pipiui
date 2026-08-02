import Foundation

/// Bundled, probe-derived model role recommendations. Missing registry entries deliberately
/// remain unknown, so they never produce a positive or negative UI signal.
enum ModelCapabilities {
    enum Role: String, Codable {
        case boss
        case worker
    }

    struct Registry: Decodable {
        let models: [String: Entry]

        static let empty = Registry(models: [:])

        static func load(bundle: Bundle = PipiResourceBundle.shared) -> Registry {
            guard let url = bundle.url(forResource: "ModelCapabilities", withExtension: "json"),
                  let data = try? Data(contentsOf: url),
                  let registry = try? JSONDecoder().decode(Registry.self, from: data)
            else {
                return .empty
            }
            return registry
        }
    }

    struct Entry: Decodable {
        let recommendedRoles: [Role]?
        let parallelToolCalls: Probe?
        let tasksBatch: Probe?

        private enum CodingKeys: String, CodingKey {
            case recommendedRoles = "recommended_roles"
            case parallelToolCalls = "parallel_tool_calls"
            case tasksBatch = "tasks_batch"
        }

        var isUnavailable: Bool {
            parallelToolCalls?.status == "unavailable" || tasksBatch?.status == "unavailable"
        }
    }

    struct Probe: Decodable {
        let status: String?
    }

    static let shared = Registry.load()

    static func isRecommended(
        _ role: Role,
        for modelID: String,
        registry: Registry = shared
    ) -> Bool {
        guard let entry = registry.models[modelID], !entry.isUnavailable else {
            return false
        }
        return entry.recommendedRoles?.contains(role) == true
    }
}
