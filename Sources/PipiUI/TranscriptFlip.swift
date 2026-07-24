import SwiftUI

/// Flips a view 180° (and mirrors X) so a newest-first LazyVStack reads as a
/// bottom-anchored chat transcript. Apply to the stack *and* each row so text
/// stays upright. Pattern used by Stream Chat / common SwiftUI inverted lists.
extension View {
    func transcriptFlip() -> some View {
        self
            .rotationEffect(.radians(.pi))
            .scaleEffect(x: -1, y: 1, anchor: .center)
    }
}
