import Foundation

enum AppSection: String, CaseIterable, Identifiable {
    case focus = "专注"
    case insights = "洞察"
    case history = "记录"
    case settings = "设置"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .focus: return "timer"
        case .insights: return "chart.xyaxis.line"
        case .history: return "clock.arrow.circlepath"
        case .settings: return "slider.horizontal.3"
        }
    }
}

enum SessionPhase: Equatable {
    case idle
    case focusing
    case paused
    case microBreak
    case completed
}

enum FocusEventKind: String, Codable {
    case reminder
    case mindWander
    case fatigue
    case pause
    case resume
}

struct FocusEvent: Codable, Identifiable, Hashable {
    var id = UUID()
    var date: Date
    var elapsedSeconds: Int
    var kind: FocusEventKind
}

struct StudySession: Codable, Identifiable, Hashable {
    var id = UUID()
    var startedAt: Date
    var endedAt: Date
    // Optional keeps sessions created before task tracking fully decodable.
    var taskName: String?
    var plannedMinutes: Int
    var focusedSeconds: Int
    var reminderMinimumMinutes: Int
    var reminderMaximumMinutes: Int
    var microBreakSeconds: Int
    var events: [FocusEvent]
    var startEnergy: Int
    var endEnergy: Int
    var focusRating: Int
    var completed: Bool
    var note: String

    var mindWanderCount: Int {
        events.filter { $0.kind == .mindWander }.count
    }

    var fatigueCount: Int {
        events.filter { $0.kind == .fatigue }.count
    }

    var reminderCount: Int {
        events.filter { $0.kind == .reminder }.count
    }

    var focusedMinutes: Int {
        Int((Double(focusedSeconds) / 60.0).rounded())
    }

    var completionRatio: Double {
        guard plannedMinutes > 0 else { return 0 }
        return min(1, Double(focusedSeconds) / Double(plannedMinutes * 60))
    }

    var firstLapseMinute: Int? {
        events.first(where: { $0.kind == .mindWander }).map { max(1, $0.elapsedSeconds / 60) }
    }

    var displayTaskName: String {
        let trimmed = taskName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "未分类" : trimmed
    }
}

enum MusicSource: String, Codable, CaseIterable, Identifiable {
    case library = "整个资料库"
    case playlist = "指定播放列表"

    var id: String { rawValue }
}

enum MusicService: String, Codable, CaseIterable, Identifiable {
    case appleMusic = "Apple Music"
    case netEase = "网易云音乐"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .appleMusic: return "music.note"
        case .netEase: return "cloud.fill"
        }
    }
}

enum AmbientSound: String, CaseIterable, Identifiable {
    case rain
    case waves
    case stream
    case wind
    case fire
    case birds
    case crickets
    case brownNoise

    var id: String { rawValue }

    var title: String {
        switch self {
        case .rain: return "雨声"
        case .waves: return "海浪"
        case .stream: return "溪流"
        case .wind: return "风声"
        case .fire: return "篝火"
        case .birds: return "鸟鸣"
        case .crickets: return "虫鸣"
        case .brownNoise: return "棕噪音"
        }
    }

    var detail: String {
        switch self {
        case .rain: return "雨落在树叶上"
        case .waves: return "沙滩上的浪花"
        case .stream: return "林间的小溪"
        case .wind: return "松林里的风"
        case .fire: return "壁炉里的柴火"
        case .birds: return "清晨湖边的鸟鸣"
        case .crickets: return "夏夜花园的蟋蟀"
        case .brownNoise: return "低沉平稳的底噪"
        }
    }

    /// 除棕噪音外都是内置的真实录音（Resources/Ambient），棕噪音在本机实时生成。
    var isRecording: Bool {
        self != .brownNoise
    }

    var symbol: String {
        switch self {
        case .rain: return "cloud.rain.fill"
        case .waves: return "water.waves"
        case .stream: return "drop.fill"
        case .wind: return "wind"
        case .fire: return "flame.fill"
        case .birds: return "bird.fill"
        case .crickets: return "moon.stars.fill"
        case .brownNoise: return "waveform"
        }
    }
}

/// 播放器需要的目标音量（已按听感曲线换算），和设置里的原始滑块值分开，方便去重。
struct AmbientLevels: Equatable {
    var master: Float
    var sounds: [AmbientSound: Float]
}

enum AppearanceMode: String, Codable {
    case dark
    case light
}

struct AppSettings: Codable, Equatable {
    var selectedDurationMinutes = 50
    var reminderMinimumMinutes = 3
    var reminderMaximumMinutes = 5
    var microBreakSeconds = 10
    var reminderSound = "Glass"
    var completionSound = "Hero"
    var showNextReminder = false
    var autoPlayMusic = false
    // Optional keeps settings files created before music service selection decodable.
    var musicService: MusicService? = .appleMusic
    var musicSource: MusicSource = .library
    var playlistName = ""
    // Optional keeps settings files created by version 1 fully decodable.
    var appearanceMode: AppearanceMode? = .dark
    // Optional keeps settings files created before the floating timer fully decodable.
    var floatingTimerOnMinimize: Bool? = true
    // Optional keeps older settings files decodable; the compact timer stays the default.
    var floatingSignalButtons: Bool? = false
    // Optional fields keep settings created before task tracking fully decodable.
    var taskNames: [String]? = []
    var selectedTaskName: String?
    // Optional fields keep settings created before ambient sounds fully decodable.
    // Sounds are stored by raw value so a renamed case can never break decoding of the whole file.
    var ambientSounds: [String]? = []
    var ambientVolumes: [String: Double]? = [:]
    var ambientMasterVolume: Double? = 0.7
    var ambientFollowsFocus: Bool? = true

    static let sounds = ["Glass", "Ping", "Pop", "Tink", "Submarine", "Purr", "Morse"]
    static let reminderSoundOptions = ["随机"] + sounds
    static let completionSoundOptions = sounds + ["Hero"]

    var resolvedAppearanceMode: AppearanceMode {
        appearanceMode ?? .dark
    }

    var resolvedFloatingTimerOnMinimize: Bool {
        floatingTimerOnMinimize ?? true
    }

    var resolvedFloatingSignalButtons: Bool {
        floatingSignalButtons ?? false
    }

    var resolvedMusicService: MusicService {
        musicService ?? .appleMusic
    }

    var selectedAmbientSounds: [AmbientSound] {
        (ambientSounds ?? []).compactMap(AmbientSound.init(rawValue:))
    }

    var resolvedAmbientMasterVolume: Double {
        ambientMasterVolume ?? 0.7
    }

    var resolvedAmbientFollowsFocus: Bool {
        ambientFollowsFocus ?? true
    }

    func ambientVolume(for sound: AmbientSound) -> Double {
        ambientVolumes?[sound.rawValue] ?? 0.7
    }

    var ambientLevels: AmbientLevels {
        let selected = Set(selectedAmbientSounds)
        var sounds: [AmbientSound: Float] = [:]
        for sound in AmbientSound.allCases {
            let volume = selected.contains(sound) ? ambientVolume(for: sound) : 0
            sounds[sound] = Float(volume * volume)
        }
        let master = resolvedAmbientMasterVolume
        return AmbientLevels(master: Float(master * master), sounds: sounds)
    }
}

struct PersistedData: Codable {
    var settings: AppSettings
    var sessions: [StudySession]
}

struct DaySummary: Identifiable {
    var date: Date
    var minutes: Int
    var sessions: Int
    var wanderCount: Int

    var id: Date { date }
}

struct SessionDraft {
    var startedAt = Date()
    var plannedMinutes: Int
    var taskName: String?
    var events: [FocusEvent] = []
    var startEnergy = 4
    var endEnergy = 3
    var focusRating = 4
    var note = ""
}

struct TaskSummary: Identifiable {
    var name: String
    var focusedMinutes: Int
    var sessions: Int
    var averageFocus: Double

    var id: String { name }
}
