import Foundation

/// Hot-swap contract for the Computer Use authorization toggle, kept outside
/// `AppStore` so the exact production decision path is unit-testable.
///
/// The toggle must only affect Computer Use itself:
/// - enabling persists + publishes state and re-arms global authorization and
///   input monitoring;
/// - disabling persists + publishes state, cancels in-flight desktop work
///   (desktop scoped) and shuts down input monitoring.
///
/// It never restarts sessions, never shuts down/replaces a `ChatSession` and
/// never aborts a session turn. The red 急停 button keeps its forced semantics
/// through `ComputerCoordinator.emergencyStop()` and is intentionally not
/// reachable from this policy.
struct ComputerUseTogglePolicy {
    var isEnabled: () -> Bool
    var isEmergencyStopped: () -> Bool
    /// Current in-memory published state (the AppStore `computerUseEnabled`).
    var currentPublished: () -> Bool
    var persist: (Bool) -> Void
    var publish: (Bool) -> Void
    /// Re-arms global authorization + input monitoring (enable branch).
    var onEnable: () -> Void
    /// Desktop-scoped cancel/release + input-monitoring shutdown (disable
    /// branch). Must never invoke the coordinator's `onEmergencyStop`.
    var onDisable: () -> Void

    func set(_ enabled: Bool) {
        let persisted = isEnabled()
        if enabled, persisted, isEmergencyStopped() {
            onEnable()
            publish(true)
            return
        }
        guard enabled != persisted else {
            // Repair an in-memory observation mismatch without touching pi.
            if currentPublished() != persisted {
                publish(persisted)
            }
            return
        }

        persist(enabled)
        publish(enabled)
        if enabled {
            onEnable()
        } else {
            onDisable()
        }
    }
}
