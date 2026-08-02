import XCTest
@testable import PipiUI

final class ModelCapabilitiesTests: XCTestCase {
    func testBossRecommendationShowsOnlyForRecommendedAvailableModel() throws {
        let registry = try registry(from: """
        {
          "models": {
            "provider/boss": {
              "recommended_roles": ["boss"],
              "parallel_tool_calls": { "status": "completed" },
              "tasks_batch": { "status": "completed" }
            },
            "provider/unavailable": {
              "recommended_roles": ["boss"],
              "parallel_tool_calls": { "status": "unavailable" }
            }
          }
        }
        """)

        XCTAssertTrue(ModelCapabilities.isRecommended(.boss, for: "provider/boss", registry: registry))
        XCTAssertFalse(ModelCapabilities.isRecommended(.boss, for: "provider/missing", registry: registry))
        XCTAssertFalse(ModelCapabilities.isRecommended(.boss, for: "provider/unavailable", registry: registry))
    }

    func testBundledRegistryLoadsBossRecommendation() {
        XCTAssertTrue(ModelCapabilities.isRecommended(.boss, for: "xai/grok-4.5"))
    }

    func testWorkerRecommendationRequiresWorkerRole() throws {
        let registry = try registry(from: """
        {
          "models": {
            "provider/worker": { "recommended_roles": ["worker"] },
            "provider/boss": { "recommended_roles": ["boss"] }
          }
        }
        """)

        XCTAssertTrue(ModelCapabilities.isRecommended(.worker, for: "provider/worker", registry: registry))
        XCTAssertFalse(ModelCapabilities.isRecommended(.worker, for: "provider/boss", registry: registry))
    }

    private func registry(from json: String) throws -> ModelCapabilities.Registry {
        try JSONDecoder().decode(ModelCapabilities.Registry.self, from: Data(json.utf8))
    }
}
