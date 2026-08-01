import SwiftUI

struct ModelRoleBadge: View {
    let role: ModelCapabilities.Role

    private var title: String {
        switch role {
        case .boss: return "适合编排"
        case .worker: return "适合执行"
        }
    }

    var body: some View {
        Text(title)
            .font(.caption2.weight(.medium))
            .foregroundStyle(Color.accentColor)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color.accentColor.opacity(0.12)))
    }
}
