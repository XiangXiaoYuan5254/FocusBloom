import SwiftUI

struct AmbientSoundsCard: View {
    @EnvironmentObject private var store: AppStore

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 4)

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(AmbientSound.allCases) { sound in
                    tile(for: sound)
                }
            }
        }
        .bloomCard(padding: 18)
    }

    private var header: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(BloomTheme.mint.opacity(0.12))
                Image(systemName: "waveform")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(BloomTheme.mint)
                    .symbolEffect(.variableColor.iterative, isActive: store.isAmbientPlaying)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 4) {
                Text("环境音")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(BloomTheme.primaryText)
                Text(statusText)
                    .font(.system(size: 11))
                    .foregroundStyle(BloomTheme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            Spacer(minLength: 12)

            Toggle(
                "随专注播放",
                isOn: Binding(
                    get: { store.settings.resolvedAmbientFollowsFocus },
                    set: { store.settings.ambientFollowsFocus = $0 }
                )
            )
            .toggleStyle(.switch)
            .controlSize(.small)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(BloomTheme.secondaryText)
            .help("开始专注时自动播放，暂停、结束或放弃时自动停下")

            HStack(spacing: 6) {
                Image(systemName: "speaker.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(BloomTheme.secondaryText)
                Slider(
                    value: Binding(
                        get: { store.settings.resolvedAmbientMasterVolume },
                        set: { store.settings.ambientMasterVolume = $0 }
                    ),
                    in: 0...1
                )
                .controlSize(.small)
                .frame(width: 92)
                Image(systemName: "speaker.wave.2.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
            .help("环境音总音量")

            Button {
                store.toggleAmbientPlayback()
            } label: {
                Label(store.isAmbientPlaying ? "暂停" : "播放", systemImage: store.isAmbientPlaying ? "pause.fill" : "play.fill")
                    .frame(minWidth: 62)
            }
            .buttonStyle(BloomSecondaryButtonStyle())
        }
    }

    private var statusText: String {
        let selected = store.settings.selectedAmbientSounds
        guard !selected.isEmpty else {
            return "点选下面的声音即可试听，可以叠加多种一起放。"
        }
        let names = selected.map(\.title).joined(separator: " + ")
        return store.isAmbientPlaying ? "正在播放：\(names)" : "已选：\(names)"
    }

    private func tile(for sound: AmbientSound) -> some View {
        let selected = store.isAmbientSelected(sound)
        let tint = sound.tint

        return VStack(alignment: .leading, spacing: 10) {
            Button {
                store.toggleAmbientSound(sound)
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: sound.symbol)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(selected ? tint : BloomTheme.secondaryText)
                        .frame(width: 30, height: 30)
                        .background((selected ? tint : BloomTheme.secondaryText).opacity(selected ? 0.16 : 0.08))
                        .clipShape(Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(sound.title)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(BloomTheme.primaryText)
                        Text(sound.detail)
                            .font(.system(size: 9))
                            .foregroundStyle(BloomTheme.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if selected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(tint)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(selected ? "移出混音" : "加入混音")

            Slider(
                value: Binding(
                    get: { store.settings.ambientVolume(for: sound) },
                    set: { store.setAmbientVolume($0, for: sound) }
                ),
                in: 0...1
            )
            .controlSize(.mini)
            .tint(tint)
            .disabled(!selected)
            .opacity(selected ? 1 : 0.35)
        }
        .padding(12)
        .background(selected ? tint.opacity(0.09) : BloomTheme.surface(0.035))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(selected ? tint.opacity(0.35) : BloomTheme.hairline)
        }
        .animation(.easeOut(duration: 0.15), value: selected)
    }
}

private extension AmbientSound {
    var tint: Color {
        switch self {
        case .rain, .waves: return BloomTheme.blue
        case .stream, .wind, .birds: return BloomTheme.mint
        case .fire: return BloomTheme.coral
        case .crickets, .brownNoise: return BloomTheme.amber
        }
    }
}
