import Foundation

/// Coalesces the high-frequency size proposals SwiftUI fires during a live
/// window resize.
///
/// Without throttling, every intermediate resize frame runs the full layout
/// pipeline — root re-frame + `.scaleEffect` + transcript column rebuild +
/// one `GeometryReader` + `NSViewRepresentable` overlay per text node — which
/// saturates the main thread. That cost is amplified while a streaming session
/// is also rewriting its rows every ~50ms: two sources competing for the same
/// thread is why resizing a *running* session feels far worse than resizing an
/// idle one.
///
/// Pure and free of `Date()` calls so the decision is unit-testable: callers
/// pass in the timestamps. The canonical cooldown is ~60fps (16.67ms); a live
/// resize that fires frames faster than that drops the extras and only lets
/// through roughly one frame per refresh.
///
/// Callers that drop a frame must still remember the latest seen size and flush
/// it on `NSWindow.didEndLiveResizeNotification`, so the window lands on its
/// exact final size rather than the last value that slipped inside the window.
public enum ResizeThrottle {
    /// ~60fps. Picked so a dragged window still tracks the cursor smoothly — the
    /// eye cannot resolve higher — while collapsing the resize storm to a rate
    /// the main thread can keep up with alongside streaming work.
    public static let defaultCooldown: TimeInterval = 1.0 / 60.0

    /// Returns `true` when enough time has elapsed since the last propagated
    /// frame that this frame should be let through.
    ///
    /// - Parameters:
    ///   - now: Current time. Caller-supplied so tests can drive the clock.
    ///   - lastEmittedAt: Time of the last frame that was let through, or `nil`
    ///     if nothing has been emitted yet (the first frame always passes).
    ///   - cooldown: Minimum interval between emitted frames. Defaults to
    ///     `defaultCooldown` (~60fps).
    /// - Returns: `true` if this frame should propagate to downstream layout.
    public static func shouldEmit(
        now: Date,
        lastEmittedAt: Date?,
        cooldown: TimeInterval = defaultCooldown
    ) -> Bool {
        guard let lastEmittedAt else { return true }
        return now.timeIntervalSince(lastEmittedAt) >= cooldown
    }
}
