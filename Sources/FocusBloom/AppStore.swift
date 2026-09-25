import AppKit
import Combine
import Foundation

@MainActor
final class AppStore: ObservableObject {
    @Published var selectedSection: AppSection = .focus
    @Published var settings: AppSettings
    @Published private(set) var sessions: [StudySession]

    @Published private(set) var phase: SessionPhase = .idle
    @Published private(set) var remainingSeconds = 0
    @Published private(set) var breakRemainingSeconds = 0
    @Published private(set) var focusedElapsedSeconds = 0
    @Published private(set) var currentEvents: [FocusEvent] = []
    @Published private(set) var currentStartEnergy = 4
    @Published var showCompletionSheet = false
    @Published var showSessionEndDialog = false
    @Published var musicMessage: String?
    @Published var toastMessage: String?
    @Published private(set) var isAmbientPlaying = false

    private var timer: Timer?
    private var focusEndDate: Date?
    private var microBreakEndDate: Date?
    private var nextReminderDate: Date?
    private var pausedRemaining: TimeInterval = 0
    private var plannedSeconds = 0
    private var draft: SessionDraft?
    private var pendingCompleted = false
    private var cancellables = Set<AnyCancellable>()
    private let ambientPlayer = AmbientPlayer()

    init() {
        let data = Persistence.load()
        settings = data.settings
        sessions = data.sessions.sorted(by: { $0.startedAt > $1.startedAt })

        $settings
            .dropFirst()
            .debounce(for: .milliseconds(250), scheduler: RunLoop.main)
            .sink { [weak self] _ in
                guard let self else { return }
                let normalized = self.normalizedSettings(self.settings)
                if normalized != self.settings {
                    self.settings = normalized
                } else {
                    self.persist()
                }
            }
            .store(in: &cancellables)

        // 音量不走上面的防抖，拖动滑块时要立刻听到变化。
        $settings
            .map(\.ambientLevels)
            .removeDuplicates()
            .sink { [weak self] levels in
                self?.ambientPlayer.setLevels(levels)
            }
            .store(in: &cancellables)

        normalizeSettings()
        startTimer()
    }

    deinit {
        timer?.invalidate()
    }

    var isSessionActive: Bool {
        phase == .focusing || phase == .paused || phase == .microBreak
    }

    var progress: Double {
        guard plannedSeconds > 0 else { return 0 }
        return min(1, max(0, Double(focusedElapsedSeconds) / Double(plannedSeconds)))
    }

    var nextReminderDescription: String {
        guard phase == .focusing, let nextReminderDate else { return "—" }
        let seconds = max(0, Int(nextReminderDate.timeIntervalSinceNow))
        return format(seconds: seconds)
    }

    var todaySessions: [StudySession] {
        let calendar = Calendar.current
        return sessions.filter { calendar.isDateInToday($0.startedAt) }
    }

    var todayMinutes: Int {
        todaySessions.reduce(0) { $0 + $1.focusedMinutes }
    }

    var todayWanderCount: Int {
        todaySessions.reduce(0) { $0 + $1.mindWanderCount }
    }

    var taskNames: [String] {
        settings.taskNames ?? []
    }

    var selectedTaskName: String? {
        let selected = settings.selectedTaskName?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let selected, !selected.isEmpty, taskNames.contains(selected) else { return nil }
        return selected
    }

    var currentTaskDisplayName: String {
        if let taskName = draft?.taskName ?? selectedTaskName {
            return taskName
        }
        return "未分类"
    }

    var taskSummaries: [TaskSummary] {
        let grouped = Dictionary(grouping: sessions) { $0.displayTaskName }
        return grouped.map { name, sessions in
            let focusTotal = sessions.reduce(0) { $0 + $1.focusRating }
            return TaskSummary(
                name: name,
                focusedMinutes: sessions.reduce(0) { $0 + $1.focusedMinutes },
                sessions: sessions.count,
                averageFocus: sessions.isEmpty ? 0 : Double(focusTotal) / Double(sessions.count)
            )
        }
        .sorted {
            if $0.focusedMinutes == $1.focusedMinutes {
                return $0.name.localizedStandardCompare($1.name) == .orderedAscending
            }
            return $0.focusedMinutes > $1.focusedMinutes
        }
    }

    var streakDays: Int {
        let activeDays = Set(sessions.map { Calendar.current.startOfDay(for: $0.startedAt) })
        var streak = 0
        var day = Calendar.current.startOfDay(for: Date())
        if !activeDays.contains(day) {
            day = Calendar.current.date(byAdding: .day, value: -1, to: day) ?? day
        }
        while activeDays.contains(day) {
            streak += 1
            day = Calendar.current.date(byAdding: .day, value: -1, to: day) ?? day
        }
        return streak
    }

    var attentionCapacityMinutes: Int {
        let recent = Array(sessions.prefix(12))
        guard !recent.isEmpty else { return 30 }
        let spans = recent.map { session -> Int in
            if let firstLapse = session.firstLapseMinute {
                return max(10, firstLapse)
            }
            if session.focusRating >= 4 {
                return max(10, session.focusedMinutes)
            }
            return max(10, min(session.focusedMinutes, Int(Double(session.focusedMinutes) * 0.75)))
        }.sorted()
        return min(120, spans[spans.count / 2])
    }

    var recommendedMinutes: Int {
        guard sessions.count >= 3 else { return 30 }
        let recent = Array(sessions.prefix(3))
        let successful = recent.allSatisfy {
            $0.completed && $0.focusRating >= 4 && $0.endEnergy >= 2 && $0.mindWanderCount <= 1
        }
        let base = attentionCapacityMinutes
        return min(120, max(20, successful ? base + 5 : base))
    }

    var weeklySummaries: [DaySummary] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        return (0..<7).reversed().compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            let daySessions = sessions.filter { calendar.isDate($0.startedAt, inSameDayAs: date) }
            return DaySummary(
                date: date,
                minutes: daySessions.reduce(0) { $0 + $1.focusedMinutes },
                sessions: daySessions.count,
                wanderCount: daySessions.reduce(0) { $0 + $1.mindWanderCount }
            )
        }
    }

    func startSession(minutes: Int? = nil) {
        guard !isSessionActive else { return }
        normalizeSettings()
        let duration = minutes ?? settings.selectedDurationMinutes
        settings.selectedDurationMinutes = duration

        draft = SessionDraft(
            plannedMinutes: duration,
            taskName: selectedTaskName,
            startEnergy: currentStartEnergy
        )
        currentEvents = []
        plannedSeconds = duration * 60
        remainingSeconds = plannedSeconds
        focusedElapsedSeconds = 0
        pausedRemaining = TimeInterval(plannedSeconds)
        focusEndDate = Date().addingTimeInterval(TimeInterval(plannedSeconds))
        microBreakEndDate = nil
        phase = .focusing
        pendingCompleted = false
        scheduleNextReminder()
        if settings.resolvedAmbientFollowsFocus {
            playAmbient()
        }
        toast("开始这一轮。先只做好眼前的一小段。")
    }

    func togglePause() {
        switch phase {
        case .focusing:
            pausedRemaining = max(0, focusEndDate?.timeIntervalSinceNow ?? Double(remainingSeconds))
            focusEndDate = nil
            nextReminderDate = nil
            appendEvent(.pause)
            phase = .paused
            if settings.resolvedAmbientFollowsFocus {
                stopAmbient()
            }
        case .paused:
            focusEndDate = Date().addingTimeInterval(pausedRemaining)
            appendEvent(.resume)
            phase = .focusing
            scheduleNextReminder()
            if settings.resolvedAmbientFollowsFocus {
                playAmbient()
            }
        default:
            break
        }
    }

    func stopSessionEarly() {
        guard isSessionActive else { return }
        finishSession(completed: false)
    }

    func abandonSession() {
        guard isSessionActive || phase == .completed || draft != nil else { return }

        focusEndDate = nil
        microBreakEndDate = nil
        nextReminderDate = nil
        pausedRemaining = 0
        plannedSeconds = 0
        remainingSeconds = 0
        breakRemainingSeconds = 0
        focusedElapsedSeconds = 0
        currentEvents = []
        draft = nil
        pendingCompleted = false
        phase = .idle
        showSessionEndDialog = false
        showCompletionSheet = false
        musicMessage = nil
        if settings.resolvedAmbientFollowsFocus {
            stopAmbient()
        }
        toast("这轮已放弃，不会计入任何专注数据。")
    }

    func recordMindWander() {
        guard phase == .focusing || phase == .paused else { return }
        appendEvent(.mindWander)
        toast("记下了。发现走神，本身就是注意力回来了。")
    }

    func recordFatigue() {
        guard phase == .focusing || phase == .paused else { return }
        appendEvent(.fatigue)
        toast("已记录疲劳信号。必要时提前结束比硬撑更有价值。")
    }

    func skipMicroBreak() {
        guard phase == .microBreak else { return }
        resumeAfterMicroBreak()
    }

    func saveCompletion(focusRating: Int, endEnergy: Int, note: String) {
        guard var draft else { return }
        draft.focusRating = focusRating
        draft.endEnergy = endEnergy
        draft.note = note

        let session = StudySession(
            startedAt: draft.startedAt,
            endedAt: Date(),
            taskName: draft.taskName,
            plannedMinutes: draft.plannedMinutes,
            focusedSeconds: focusedElapsedSeconds,
            reminderMinimumMinutes: settings.reminderMinimumMinutes,
            reminderMaximumMinutes: settings.reminderMaximumMinutes,
            microBreakSeconds: settings.microBreakSeconds,
            events: currentEvents,
            startEnergy: draft.startEnergy,
            endEnergy: draft.endEnergy,
            focusRating: draft.focusRating,
            completed: pendingCompleted,
            note: draft.note
        )

        sessions.insert(session, at: 0)
        self.draft = nil
        phase = .idle
        showCompletionSheet = false
        persist()
        toast("这一轮已存入你的专注档案。")
    }

    func setStartEnergy(_ value: Int) {
        currentStartEnergy = value
        draft?.startEnergy = value
    }

    func selectTask(_ name: String?) {
        guard !isSessionActive else { return }
        guard let name else {
            settings.selectedTaskName = nil
            return
        }

        let trimmed = normalizedTaskName(name)
        settings.selectedTaskName = taskNames.contains(trimmed) ? trimmed : nil
    }

    @discardableResult
    func addTask(named name: String) -> Bool {
        guard !isSessionActive else { return false }
        let trimmed = normalizedTaskName(name)
        guard !trimmed.isEmpty else { return false }

        var tasks = taskNames
        if let existing = tasks.first(where: {
            $0.compare(trimmed, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
        }) {
            settings.selectedTaskName = existing
            toast("已选择任务“\(existing)”。")
            return true
        }

        tasks.append(trimmed)
        settings.taskNames = tasks
        settings.selectedTaskName = trimmed
        toast("已新增并选择任务“\(trimmed)”。")
        return true
    }

    func removeTask(named name: String) {
        var tasks = taskNames
        tasks.removeAll { $0 == name }
        settings.taskNames = tasks
        if settings.selectedTaskName == name {
            settings.selectedTaskName = nil
        }
        toast("已从任务列表移除“\(name)”，历史记录仍保留。")
    }

    func taskSessionCount(named name: String) -> Int {
        sessions.filter { $0.displayTaskName == name }.count
    }

    func playSound(named name: String) {
        let resolvedName = name == "随机"
            ? AppSettings.sounds.randomElement() ?? "Glass"
            : name
        if let sound = NSSound(named: NSSound.Name(resolvedName)) {
            sound.stop()
            sound.play()
        } else {
            NSSound.beep()
        }
    }

    func toggleAppearance() {
        settings.appearanceMode = settings.resolvedAppearanceMode == .dark ? .light : .dark
    }

    func testMusic() {
        let service = settings.resolvedMusicService
        musicMessage = "正在连接“\(service.rawValue)”…"
        MusicController.playRandom(service: service, source: settings.musicSource, playlistName: settings.playlistName) { [weak self] result in
            switch result {
            case .success(let track):
                self?.musicMessage = "正在播放：\(track)"
            case .failure(let error):
                self?.musicMessage = "播放失败：\(error.localizedDescription)"
            }
        }
    }

    func isAmbientSelected(_ sound: AmbientSound) -> Bool {
        settings.selectedAmbientSounds.contains(sound)
    }

    func toggleAmbientSound(_ sound: AmbientSound) {
        var selected = settings.selectedAmbientSounds
        if let index = selected.firstIndex(of: sound) {
            selected.remove(at: index)
            settings.ambientSounds = selected.map(\.rawValue)
            if selected.isEmpty {
                stopAmbient()
            }
        } else {
            selected.append(sound)
            settings.ambientSounds = selected.map(\.rawValue)
            // 点一下就能试听，不用再去按播放。
            playAmbient()
        }
    }

    func setAmbientVolume(_ volume: Double, for sound: AmbientSound) {
        var volumes = settings.ambientVolumes ?? [:]
        volumes[sound.rawValue] = volume
        settings.ambientVolumes = volumes
    }

    func toggleAmbientPlayback() {
        if isAmbientPlaying {
            stopAmbient()
            return
        }
        if settings.selectedAmbientSounds.isEmpty {
            settings.ambientSounds = [AmbientSound.rain.rawValue]
        }
        playAmbient()
    }

    func exportCSV() {
        toast(Persistence.exportCSV(sessions: sessions) ? "CSV 已导出。" : "没有导出文件。")
    }

    func clearHistory() {
        sessions = []
        persist()
        toast("专注记录已清空。")
    }

    func removeSession(_ session: StudySession) {
        sessions.removeAll { $0.id == session.id }
        persist()
    }

    func format(seconds: Int) -> String {
        let safe = max(0, seconds)
        return String(format: "%02d:%02d", safe / 60, safe % 60)
    }

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        timer?.tolerance = 0.08
    }

    private func tick() {
        let now = Date()
        switch phase {
        case .focusing:
            let remaining = max(0, focusEndDate?.timeIntervalSince(now) ?? pausedRemaining)
            remainingSeconds = Int(ceil(remaining))
            focusedElapsedSeconds = max(0, plannedSeconds - remainingSeconds)

            if remaining <= 0 {
                finishSession(completed: true)
            } else if let reminder = nextReminderDate, now >= reminder {
                beginMicroBreak()
            }
        case .microBreak:
            let remaining = max(0, microBreakEndDate?.timeIntervalSince(now) ?? 0)
            breakRemainingSeconds = Int(ceil(remaining))
            if remaining <= 0 {
                resumeAfterMicroBreak()
            }
        default:
            break
        }
    }

    private func beginMicroBreak() {
        pausedRemaining = max(0, focusEndDate?.timeIntervalSinceNow ?? Double(remainingSeconds))
        focusEndDate = nil
        nextReminderDate = nil
        breakRemainingSeconds = settings.microBreakSeconds
        microBreakEndDate = Date().addingTimeInterval(TimeInterval(settings.microBreakSeconds))
        appendEvent(.reminder)
        phase = .microBreak
        playSound(named: settings.reminderSound)
    }

    private func resumeAfterMicroBreak() {
        microBreakEndDate = nil
        breakRemainingSeconds = 0
        focusEndDate = Date().addingTimeInterval(pausedRemaining)
        phase = .focusing
        scheduleNextReminder()
    }

    private func finishSession(completed: Bool) {
        if phase == .focusing {
            let remaining = max(0, focusEndDate?.timeIntervalSinceNow ?? 0)
            remainingSeconds = Int(ceil(remaining))
            focusedElapsedSeconds = max(0, plannedSeconds - remainingSeconds)
        }

        pendingCompleted = completed
        focusEndDate = nil
        nextReminderDate = nil
        microBreakEndDate = nil
        phase = .completed
        showSessionEndDialog = false
        playSound(named: settings.completionSound)
        showCompletionSheet = true

        // 结束音乐要接上时也停掉环境音，免得两者叠在一起。
        if settings.resolvedAmbientFollowsFocus || settings.autoPlayMusic {
            stopAmbient()
        }

        if settings.autoPlayMusic {
            testMusic()
        }
    }

    private func playAmbient() {
        guard !settings.selectedAmbientSounds.isEmpty else { return }
        isAmbientPlaying = ambientPlayer.play()
        if !isAmbientPlaying {
            toast("环境音无法播放，请检查声音输出设备。")
        }
    }

    private func stopAmbient() {
        guard isAmbientPlaying else { return }
        ambientPlayer.stop()
        isAmbientPlaying = false
    }

    private func scheduleNextReminder() {
        let minimum = max(1, settings.reminderMinimumMinutes * 60)
        let maximum = max(minimum, settings.reminderMaximumMinutes * 60)
        let interval = Int.random(in: minimum...maximum)
        guard interval < max(0, Int(pausedRemaining)) else {
            nextReminderDate = nil
            return
        }
        nextReminderDate = Date().addingTimeInterval(TimeInterval(interval))
    }

    private func appendEvent(_ kind: FocusEventKind) {
        let event = FocusEvent(date: Date(), elapsedSeconds: focusedElapsedSeconds, kind: kind)
        currentEvents.append(event)
        draft?.events = currentEvents
    }

    private func normalizeSettings() {
        let normalized = normalizedSettings(settings)
        if normalized != settings {
            settings = normalized
        }
    }

    private func normalizedSettings(_ value: AppSettings) -> AppSettings {
        var result = value
        result.reminderMinimumMinutes = max(1, min(60, result.reminderMinimumMinutes))
        result.reminderMaximumMinutes = max(result.reminderMinimumMinutes, min(90, result.reminderMaximumMinutes))
        result.microBreakSeconds = max(5, min(60, result.microBreakSeconds))
        result.selectedDurationMinutes = max(1, min(1_440, result.selectedDurationMinutes))

        var uniqueTasks: [String] = []
        for task in result.taskNames ?? [] {
            let normalized = normalizedTaskName(task)
            guard !normalized.isEmpty else { continue }
            if !uniqueTasks.contains(where: {
                $0.compare(normalized, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
            }) {
                uniqueTasks.append(normalized)
            }
        }
        result.taskNames = uniqueTasks
        if let selected = result.selectedTaskName {
            let normalizedSelected = normalizedTaskName(selected)
            result.selectedTaskName = uniqueTasks.contains(normalizedSelected) ? normalizedSelected : nil
        }
        return result
    }

    private func normalizedTaskName(_ name: String) -> String {
        String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
    }

    private func persist() {
        Persistence.save(settings: settings, sessions: sessions)
    }

    private func toast(_ message: String) {
        toastMessage = message
        let expected = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            if self?.toastMessage == expected {
                self?.toastMessage = nil
            }
        }
    }
}
