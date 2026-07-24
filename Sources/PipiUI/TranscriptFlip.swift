import SwiftUI

/// Vertically flips a view so a newest-first LazyVStack reads as a bottom-anchored
/// chat. Apply to the `ScrollView` *and* each row (row flip cancels the container
/// flip so text stays upright). Prefer `scaleEffect(y: -1)` over `rotationEffect`:
/// rotating a tall stack around its center does not invert the visible clip.
extension View {
    func transcriptFlip() -> some View {
        self.scaleEffect(x: 1, y: -1, anchor: .center)
    }
}
