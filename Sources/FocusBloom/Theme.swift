import AppKit
import SwiftUI

enum BloomTheme {
    static let background = Color.adaptive(light: 0xF3F7F5, dark: 0x0E1518)
    static let backgroundSoft = Color.adaptive(light: 0xE8F0EC, dark: 0x142025)
    static let sidebarBackground = Color.adaptive(light: 0xEAF1EE, dark: 0x0B1215)
    static let panel = Color.adaptive(
        light: 0xFFFFFF,
        dark: 0xFFFFFF,
        lightAlpha: 0.78,
        darkAlpha: 0.065
    )
    static let panelStrong = Color.adaptive(
        light: 0xFFFFFF,
        dark: 0xFFFFFF,
        lightAlpha: 0.96,
        darkAlpha: 0.095
    )
    static let mint = Color.adaptive(light: 0x219A71, dark: 0x78D7B2)
    static let mintBright = Color.adaptive(light: 0x56C59A, dark: 0xA5F1D1)
    static let coral = Color.adaptive(light: 0xD76144, dark: 0xFF9A79)
    static let amber = Color.adaptive(light: 0xB47A17, dark: 0xF4C978)
    static let blue = Color.adaptive(light: 0x347DC4, dark: 0x84B9FF)
    static let primaryText = Color.adaptive(light: 0x14211C, dark: 0xF1F6F3)
    static let secondaryText = Color.adaptive(light: 0x61716A, dark: 0x9CACA7)
    static let hairline = Color.adaptive(
        light: 0x14211C,
        dark: 0xFFFFFF,
        lightAlpha: 0.10,
        darkAlpha: 0.09
    )

    static let backgroundGradient = LinearGradient(
        colors: [
            background,
            Color.adaptive(light: 0xEDF4F0, dark: 0x101A1C),
            Color.adaptive(light: 0xF7F9F8, dark: 0x11191B)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static func surface(_ opacity: Double) -> Color {
        Color.adaptive(
            light: 0x14211C,
            dark: 0xFFFFFF,
            lightAlpha: min(0.16, opacity * 0.85),
            darkAlpha: opacity
        )
    }
}

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }

    static func adaptive(
        light: UInt,
        dark: UInt,
        lightAlpha: Double = 1,
        darkAlpha: Double = 1
    ) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let match = appearance.bestMatch(from: [.aqua, .darkAqua])
            let useDark = match == .darkAqua
            return NSColor(
                calibratedRed: Double(((useDark ? dark : light) >> 16) & 0xFF) / 255,
                green: Double(((useDark ? dark : light) >> 8) & 0xFF) / 255,
                blue: Double((useDark ? dark : light) & 0xFF) / 255,
                alpha: useDark ? darkAlpha : lightAlpha
            )
        })
    }
}

struct BloomCardModifier: ViewModifier {
    var padding: CGFloat = 20
    var strong = false

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(strong ? BloomTheme.panelStrong : BloomTheme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(BloomTheme.hairline, lineWidth: 1)
            }
    }
}

extension View {
    func bloomCard(padding: CGFloat = 20, strong: Bool = false) -> some View {
        modifier(BloomCardModifier(padding: padding, strong: strong))
    }
}

struct BloomPrimaryButtonStyle: ButtonStyle {
    var color = BloomTheme.mint

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color(hex: 0x0B1713))
            .padding(.horizontal, 20)
            .frame(minHeight: 46)
            .background(color.opacity(configuration.isPressed ? 0.78 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct BloomSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(BloomTheme.primaryText)
            .padding(.horizontal, 16)
            .frame(minHeight: 42)
            .background(BloomTheme.surface(configuration.isPressed ? 0.13 : 0.08))
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(BloomTheme.hairline, lineWidth: 1)
            }
    }
}

struct MetricPill: View {
    let symbol: String
    let value: String
    let label: String
    var tint = BloomTheme.mint

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(tint.opacity(0.12))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(value)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(BloomTheme.primaryText)
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
        }
    }
}

struct SectionHeading: View {
    let eyebrow: String
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(eyebrow.uppercased())
                .font(.system(size: 11, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(BloomTheme.mint)
            Text(title)
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(BloomTheme.primaryText)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
        }
    }
}
