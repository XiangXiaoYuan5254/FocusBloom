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
