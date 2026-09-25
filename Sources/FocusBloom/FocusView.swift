import SwiftUI

struct FocusView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showTaskCreator = false
    @State private var newTaskName = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header

                HStack(alignment: .top, spacing: 18) {
                    timerCard
                        .frame(maxWidth: .infinity)
                    controlCard
                        .frame(width: 350)
                }

                if store.isSessionActive {
                    liveSignals
                } else {
                    trainingHint
                }

                AmbientSoundsCard()
            }
            .padding(.horizontal, 30)
            .padding(.top, 34)
            .padding(.bottom, 30)
        }
    }

    private var header: some View {
        HStack(alignment: .bottom) {
            SectionHeading(
                eyebrow: dayGreeting,
                title: store.isSessionActive ? activeTitle : "今天，练习一次完整的注意",
                subtitle: store.isSessionActive ? "计时只统计净专注时间，微休息不会占用本轮时长。" : "目标不是硬撑得更久，而是越来越了解自己的注意力。"
            )
            Spacer()
            HStack(spacing: 22) {
                MetricPill(symbol: "clock.fill", value: "\(store.todayMinutes) 分钟", label: "今日专注")
                MetricPill(symbol: "scope", value: "\(store.todayWanderCount) 次", label: "今日走神", tint: BloomTheme.coral)
                MetricPill(symbol: "flame.fill", value: "\(store.streakDays) 天", label: "连续记录", tint: BloomTheme.amber)
            }
        }
    }

    private var activeTitle: String {
        switch store.phase {
        case .microBreak: return "让大脑安静十秒"
        case .paused: return "暂停不是中断，是选择"
        default: return "把注意力放回眼前"
        }
    }

    private var dayGreeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 11 { return "早上好" }
        if hour < 14 { return "中午好" }
        if hour < 19 { return "下午好" }
        return "晚上好"
    }

    private var timerCard: some View {
        VStack(spacing: 26) {
            ZStack {
                Circle()
                    .stroke(BloomTheme.surface(0.055), lineWidth: 17)
                Circle()
                    .trim(from: 0, to: store.isSessionActive ? max(0.01, store.progress) : 1)
                    .stroke(
                        AngularGradient(
                            colors: [BloomTheme.mint, BloomTheme.mintBright, BloomTheme.blue, BloomTheme.mint],
                            center: .center
                        ),
                        style: StrokeStyle(lineWidth: 17, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .shadow(color: BloomTheme.mint.opacity(0.22), radius: 18)

                VStack(spacing: 8) {
                    Image(systemName: phaseSymbol)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(phaseTint)
                    Text(timerText)
                        .font(.system(size: 55, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(BloomTheme.primaryText)
                    Text(timerCaption)
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(BloomTheme.secondaryText)
                }
            }
            .frame(width: 285, height: 285)

            HStack(spacing: 12) {
                if store.phase == .idle {
                    Button {
                        store.startSession()
                    } label: {
                        Label("开始这一轮", systemImage: "play.fill")
                            .frame(minWidth: 135)
                    }
                    .buttonStyle(BloomPrimaryButtonStyle())
                } else if store.phase == .microBreak {
                    HStack(spacing: 12) {
                        Button {
                            store.skipMicroBreak()
                        } label: {
                            Label("提前继续", systemImage: "arrow.right")
                        }
                        .buttonStyle(BloomPrimaryButtonStyle())

                        Button {
                            store.showSessionEndDialog = true
                        } label: {
                            Label("结束", systemImage: "stop.fill")
                        }
                        .buttonStyle(BloomSecondaryButtonStyle())
                    }
                } else if store.phase == .focusing || store.phase == .paused {
                    Button {
                        store.togglePause()
                    } label: {
                        Label(store.phase == .paused ? "继续" : "暂停", systemImage: store.phase == .paused ? "play.fill" : "pause.fill")
                            .frame(minWidth: 95)
                    }
                    .buttonStyle(BloomPrimaryButtonStyle())

                    Button {
                        store.showSessionEndDialog = true
                    } label: {
                        Label("结束", systemImage: "stop.fill")
                    }
                    .buttonStyle(BloomSecondaryButtonStyle())
                }
            }

            HStack(spacing: 30) {
                timerMetric(symbol: "hourglass", title: "\(store.settings.selectedDurationMinutes) 分钟", caption: "本轮目标")
                Divider().frame(height: 31).overlay(BloomTheme.hairline)
                timerMetric(
                    symbol: "bell.badge",
                    title: "\(store.settings.reminderMinimumMinutes)–\(store.settings.reminderMaximumMinutes) 分钟",
                    caption: "随机提示"
                )
                if store.settings.showNextReminder && store.isSessionActive && store.phase != .microBreak {
                    Divider().frame(height: 31).overlay(BloomTheme.hairline)
                    timerMetric(symbol: "eye", title: store.nextReminderDescription, caption: "下次提示")
                }
            }
        }
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
        .background {
            ZStack {
                BloomTheme.panel
                RadialGradient(
                    colors: [BloomTheme.mint.opacity(0.08), .clear],
                    center: .center,
                    startRadius: 20,
                    endRadius: 300
                )
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(BloomTheme.hairline)
        }
    }

    private var phaseSymbol: String {
        switch store.phase {
        case .microBreak: return "sparkles"
        case .paused: return "pause.circle.fill"
        case .focusing: return "leaf.fill"
        default: return "circle.dotted"
        }
    }

    private var phaseTint: Color {
        switch store.phase {
        case .microBreak: return BloomTheme.blue
        case .paused: return BloomTheme.amber
        default: return BloomTheme.mint
        }
    }

    private var timerText: String {
        if store.phase == .microBreak {
            return "\(store.breakRemainingSeconds)"
        }
        if store.phase == .idle {
            return store.format(seconds: store.settings.selectedDurationMinutes * 60)
        }
        return store.format(seconds: store.remainingSeconds)
    }

    private var timerCaption: String {
        switch store.phase {
        case .microBreak: return "\(store.currentTaskDisplayName) · 闭眼 · 松肩 · 慢呼吸"
        case .paused: return "\(store.currentTaskDisplayName) · 已暂停"
        case .focusing: return "\(store.currentTaskDisplayName) · 净专注剩余"
        default: return "准备开始"
        }
    }

    private func timerMetric(symbol: String, title: String, caption: String) -> some View {
        HStack(spacing: 9) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BloomTheme.mint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(BloomTheme.primaryText)
                Text(caption)
                    .font(.system(size: 10))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
        }
    }

    private var controlCard: some View {
        VStack(alignment: .leading, spacing: 21) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(store.isSessionActive ? "本轮设置" : "设计这一轮")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(BloomTheme.primaryText)
                    Text(store.isSessionActive ? "开始后锁定，避免反复调整。" : "先选一个今天愿意完成的长度。")
                        .font(.system(size: 11))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
                Spacer()
                Image(systemName: "dial.medium")
                    .foregroundStyle(BloomTheme.mint)
            }

            VStack(alignment: .leading, spacing: 10) {
                controlLabel("本轮任务", value: store.currentTaskDisplayName)

                HStack(spacing: 8) {
                    Picker(
                        "",
                        selection: Binding<String?>(
                            get: { store.selectedTaskName },
                            set: { store.selectTask($0) }
                        )
                    ) {
                        Text("未分类").tag(String?.none)
                        ForEach(store.taskNames, id: \.self) { task in
                            Text(task).tag(String?.some(task))
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: .infinity)

                    Button {
                        withAnimation(.easeInOut(duration: 0.18)) {
                            showTaskCreator.toggle()
                        }
                    } label: {
                        Image(systemName: showTaskCreator ? "xmark" : "plus")
                            .font(.system(size: 11, weight: .bold))
                            .frame(width: 32, height: 32)
                    }
                    .buttonStyle(BloomSecondaryButtonStyle())
                    .help(showTaskCreator ? "取消新增任务" : "新增任务")
                }

                if showTaskCreator {
                    HStack(spacing: 8) {
                        TextField("例如：力扣、AI 学习", text: $newTaskName)
                            .textFieldStyle(.plain)
                            .font(.system(size: 11))
                            .padding(.horizontal, 11)
                            .frame(height: 36)
                            .background(BloomTheme.surface(0.055))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .onSubmit(commitNewTask)

                        Button("添加", action: commitNewTask)
                            .buttonStyle(BloomPrimaryButtonStyle())
                            .disabled(newTaskName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }

            Divider().overlay(BloomTheme.hairline)

            VStack(alignment: .leading, spacing: 10) {
                controlLabel("专注时长", value: "\(store.settings.selectedDurationMinutes) 分钟")
                HStack(spacing: 8) {
                    ForEach([30, 60, 90], id: \.self) { duration in
                        durationButton(duration)
                    }
                    HStack(spacing: 4) {
                        TextField(
                            "分钟",
                            value: $store.settings.selectedDurationMinutes,
                            format: .number
                        )
                        .textFieldStyle(.plain)
                        .multilineTextAlignment(.trailing)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .frame(width: 38)
                        Text("分")
                            .font(.system(size: 9))
                            .foregroundStyle(BloomTheme.secondaryText)
                        Stepper(
                            "",
                            value: $store.settings.selectedDurationMinutes,
                            in: 1...1_440,
                            step: 1
                        )
                        .labelsHidden()
                    }
                    .padding(.leading, 7)
                    .frame(height: 34)
                    .background(BloomTheme.surface(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .disabled(store.isSessionActive)
                }
            }

            Divider().overlay(BloomTheme.hairline)

            VStack(alignment: .leading, spacing: 12) {
                controlLabel(
                    "随机提示区间",
                    value: "\(store.settings.reminderMinimumMinutes)–\(store.settings.reminderMaximumMinutes) 分钟"
                )
                HStack(spacing: 10) {
                    minuteStepper(title: "最早", value: $store.settings.reminderMinimumMinutes, range: 1...60)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 11))
                        .foregroundStyle(BloomTheme.secondaryText)
                    minuteStepper(
                        title: "最晚",
                        value: $store.settings.reminderMaximumMinutes,
                        range: max(1, store.settings.reminderMinimumMinutes)...90
                    )
                }
            }

            Divider().overlay(BloomTheme.hairline)

            VStack(alignment: .leading, spacing: 10) {
                controlLabel("开始前精力", value: energyText(store.currentStartEnergy))
                HStack(spacing: 7) {
                    ForEach(1...5, id: \.self) { level in
                        Button {
                            store.setStartEnergy(level)
                        } label: {
                            Image(systemName: level <= store.currentStartEnergy ? "circle.fill" : "circle")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(level <= store.currentStartEnergy ? BloomTheme.amber : BloomTheme.secondaryText.opacity(0.45))
                                .frame(maxWidth: .infinity, minHeight: 30)
                                .background(BloomTheme.surface(0.04))
                                .clipShape(RoundedRectangle(cornerRadius: 9))
                        }
                        .buttonStyle(.plain)
                        .disabled(store.isSessionActive)
                    }
                }
            }

            HStack(spacing: 8) {
                Image(systemName: store.settings.autoPlayMusic ? store.settings.resolvedMusicService.symbol : "music.note")
                    .foregroundStyle(store.settings.autoPlayMusic ? BloomTheme.coral : BloomTheme.secondaryText)
                Text(store.settings.autoPlayMusic
                    ? (store.settings.resolvedMusicService == .appleMusic ? "结束后随机播放 Apple Music" : "结束后播放网易云音乐")
                    : "可在设置中开启结束音乐")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
            .padding(11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BloomTheme.surface(0.035))
            .clipShape(RoundedRectangle(cornerRadius: 11))
        }
        .bloomCard(padding: 20, strong: true)
        .disabled(store.isSessionActive)
    }

    private func durationButton(_ duration: Int) -> some View {
        Button {
            store.settings.selectedDurationMinutes = duration
        } label: {
            Text("\(duration)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .frame(maxWidth: .infinity)
                .frame(height: 34)
                .foregroundStyle(store.settings.selectedDurationMinutes == duration ? Color(hex: 0x0B1713) : BloomTheme.primaryText)
                .background(store.settings.selectedDurationMinutes == duration ? BloomTheme.mint : BloomTheme.surface(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(store.isSessionActive)
    }

    private func minuteStepper(title: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(BloomTheme.secondaryText)
            HStack(spacing: 3) {
                Text("\(value.wrappedValue)")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(BloomTheme.primaryText)
                    .frame(minWidth: 30, alignment: .leading)
                Text("分")
                    .font(.system(size: 10))
                    .foregroundStyle(BloomTheme.secondaryText)
                Stepper("", value: value, in: range)
                    .labelsHidden()
            }
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, minHeight: 52)
        .background(BloomTheme.surface(0.045))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func controlLabel(_ title: String, value: String) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(BloomTheme.secondaryText)
            Spacer()
            Text(value)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(BloomTheme.primaryText)
        }
    }

    private func energyText(_ value: Int) -> String {
        ["", "很低", "偏低", "一般", "不错", "充沛"][max(1, min(5, value))]
    }

    private func commitNewTask() {
        guard store.addTask(named: newTaskName) else { return }
        newTaskName = ""
        withAnimation(.easeInOut(duration: 0.18)) {
            showTaskCreator = false
        }
    }

    private var liveSignals: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 9) {
                Text("注意力掉线了？")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(BloomTheme.primaryText)
                Text("点一下即可，不评价自己。越诚实的数据，越能看清你的节律。")
                    .font(.system(size: 11))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
            Spacer()
            liveButton(
                title: "我走神了",
                subtitle: "\(store.currentEvents.filter { $0.kind == .mindWander }.count) 次",
                symbol: "scope",
                tint: BloomTheme.coral
            ) {
                store.recordMindWander()
            }
            liveButton(
                title: "我开始累了",
                subtitle: "\(store.currentEvents.filter { $0.kind == .fatigue }.count) 次",
                symbol: "battery.25",
                tint: BloomTheme.amber
            ) {
                store.recordFatigue()
            }
        }
        .bloomCard(padding: 18)
    }

    private func liveButton(
        title: String,
        subtitle: String,
        symbol: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(tint)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BloomTheme.primaryText)
                    Text(subtitle)
                        .font(.system(size: 9))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
            }
            .padding(.horizontal, 15)
            .frame(height: 48)
            .background(tint.opacity(0.09))
            .clipShape(RoundedRectangle(cornerRadius: 13))
            .overlay { RoundedRectangle(cornerRadius: 13).stroke(tint.opacity(0.2)) }
        }
        .buttonStyle(.plain)
        .disabled(store.phase == .microBreak)
    }

    private var trainingHint: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(BloomTheme.blue.opacity(0.12))
                Image(systemName: "figure.mind.and.body")
                    .font(.system(size: 21))
                    .foregroundStyle(BloomTheme.blue)
            }
            .frame(width: 50, height: 50)
            VStack(alignment: .leading, spacing: 5) {
                Text("今天的建议：先做 \(store.recommendedMinutes) 分钟")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(BloomTheme.primaryText)
                Text("建议来自最近的完成率、走神点和精力变化。连续三轮状态良好后，只增加 5 分钟。")
                    .font(.system(size: 11))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
            Spacer()
            Button("采用建议") {
                store.settings.selectedDurationMinutes = store.recommendedMinutes
            }
            .buttonStyle(BloomSecondaryButtonStyle())
        }
        .bloomCard(padding: 18)
    }
}

struct SessionEndDialog: View {
    let onContinue: () -> Void
    let onReview: () -> Void
    let onAbandon: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            HStack(alignment: .top, spacing: 14) {
                ZStack {
                    Circle()
                        .fill(BloomTheme.mint.opacity(0.13))
                    Image(systemName: "leaf.fill")
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(BloomTheme.mint)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 5) {
                    Text("如何结束这一轮？")
                        .font(.system(size: 21, weight: .bold, design: .rounded))
                        .foregroundStyle(BloomTheme.primaryText)
                    Text("你可以保留已经完成的部分，也可以把这次尝试当作没有发生。")
                        .font(.system(size: 11))
                        .foregroundStyle(BloomTheme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Button(action: onContinue) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(BloomTheme.secondaryText)
                        .frame(width: 28, height: 28)
                        .background(BloomTheme.surface(0.06))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .help("继续专注")
            }

            VStack(spacing: 10) {
                decisionButton(
                    title: "结束并记录",
                    detail: "进入复盘，保留已经完成的专注时间",
                    symbol: "checkmark.circle.fill",
                    tint: BloomTheme.mint,
                    action: onReview
                )

                decisionButton(
                    title: "放弃本轮",
                    detail: "不保存时间、走神、疲劳和微休息记录",
                    symbol: "trash.fill",
                    tint: BloomTheme.coral,
                    action: onAbandon
                )
            }

            Button("返回继续专注", action: onContinue)
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(BloomTheme.secondaryText)
        }
        .padding(23)
        .frame(width: 440)
        .background {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(.ultraThickMaterial)
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(BloomTheme.panelStrong)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(BloomTheme.hairline, lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(0.22), radius: 30, y: 12)
        .onExitCommand(perform: onContinue)
    }

    private func decisionButton(
        title: String,
        detail: String,
        symbol: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 38, height: 38)
                    .background(tint.opacity(0.12))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(BloomTheme.primaryText)
                    Text(detail)
                        .font(.system(size: 10))
                        .foregroundStyle(BloomTheme.secondaryText)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(tint.opacity(0.8))
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(tint.opacity(0.075))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(tint.opacity(0.20), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct AbandonSessionDialog: View {
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .fill(BloomTheme.coral.opacity(0.12))
                Image(systemName: "trash.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(BloomTheme.coral)
            }
            .frame(width: 48, height: 48)

            VStack(spacing: 6) {
                Text("放弃这轮专注？")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(BloomTheme.primaryText)
                Text("本轮时间和事件不会写入统计或历史记录。")
                    .font(.system(size: 11))
                    .foregroundStyle(BloomTheme.secondaryText)
                    .multilineTextAlignment(.center)
            }

            HStack(spacing: 10) {
                Button("返回复盘", action: onCancel)
                    .buttonStyle(BloomSecondaryButtonStyle())
                    .frame(maxWidth: .infinity)

                Button(action: onConfirm) {
                    Label("确认放弃", systemImage: "trash.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .frame(maxWidth: .infinity, minHeight: 42)
                        .background(BloomTheme.coral)
                        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(24)
        .frame(width: 390)
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(.ultraThickMaterial)
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(BloomTheme.panelStrong)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(BloomTheme.hairline, lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(0.22), radius: 28, y: 12)
        .onExitCommand(perform: onCancel)
    }
}

struct CompletionView: View {
    @EnvironmentObject private var store: AppStore
    @State private var focusRating = 4
    @State private var endEnergy = 3
    @State private var note = ""
    @State private var showAbandonConfirmation = false

    var body: some View {
        ZStack {
            BloomTheme.backgroundGradient.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("本轮完成")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(BloomTheme.primaryText)
                        Text("花一分钟复盘，注意力训练才会留下可比较的数据。")
                            .font(.system(size: 13))
                            .foregroundStyle(BloomTheme.secondaryText)
                        Label(store.currentTaskDisplayName, systemImage: "tag.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(
                                store.currentTaskDisplayName == "未分类"
                                    ? BloomTheme.secondaryText
                                    : BloomTheme.blue
                            )
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(
                                (
                                    store.currentTaskDisplayName == "未分类"
                                        ? BloomTheme.secondaryText
                                        : BloomTheme.blue
                                )
                                .opacity(0.09)
                            )
                            .clipShape(Capsule())
                    }
                    Spacer()
                    ZStack {
                        Circle().fill(BloomTheme.mint.opacity(0.14))
                        Image(systemName: "checkmark")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(BloomTheme.mint)
                    }
                    .frame(width: 54, height: 54)
                }

                HStack(spacing: 12) {
                    summaryBox(value: "\(store.focusedElapsedSeconds / 60)", label: "专注分钟", tint: BloomTheme.mint)
                    summaryBox(
                        value: "\(store.currentEvents.filter { $0.kind == .mindWander }.count)",
                        label: "走神次数",
                        tint: BloomTheme.coral
                    )
                    summaryBox(
                        value: "\(store.currentEvents.filter { $0.kind == .reminder }.count)",
                        label: "微休息",
                        tint: BloomTheme.blue
                    )
                }

                ratingRow(title: "整体专注程度", value: $focusRating, low: "很散", high: "很稳", tint: BloomTheme.mint)
                ratingRow(title: "结束时的精力", value: $endEnergy, low: "耗尽", high: "充沛", tint: BloomTheme.amber)

                VStack(alignment: .leading, spacing: 8) {
                    Text("一句话记录（可选）")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BloomTheme.secondaryText)
                    TextField("例如：30 分钟后开始费力，做题比看课更容易保持注意…", text: $note)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13))
                        .padding(13)
                        .background(BloomTheme.surface(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                if let musicMessage = store.musicMessage {
                    HStack(spacing: 9) {
                        Image(systemName: "music.note")
                            .foregroundStyle(BloomTheme.coral)
                        Text(musicMessage)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(BloomTheme.secondaryText)
                            .lineLimit(2)
                    }
                }

                HStack {
                    Text("记录感觉，不给今天的自己打分。")
                        .font(.system(size: 10))
                        .foregroundStyle(BloomTheme.secondaryText)
                    Spacer()
                    Button("放弃且不保存", role: .destructive) {
                        showAbandonConfirmation = true
                    }
                    .buttonStyle(BloomSecondaryButtonStyle())
                    Button("保存复盘") {
                        store.saveCompletion(focusRating: focusRating, endEnergy: endEnergy, note: note)
                    }
                    .buttonStyle(BloomPrimaryButtonStyle())
                }
            }
            .padding(30)
        }
        .frame(width: 610, height: 620)
        .overlay {
            if showAbandonConfirmation {
                ZStack {
                    Color.black
                        .opacity(0.30)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture {
                            showAbandonConfirmation = false
                        }

                    AbandonSessionDialog(
                        onCancel: {
                            showAbandonConfirmation = false
                        },
                        onConfirm: {
                            showAbandonConfirmation = false
                            store.abandonSession()
                        }
                    )
                    .transition(.scale(scale: 0.96).combined(with: .opacity))
                }
                .transition(.opacity)
                .zIndex(50)
            }
        }
        .animation(.easeOut(duration: 0.18), value: showAbandonConfirmation)
    }

    private func summaryBox(value: String, label: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(.system(size: 23, weight: .bold, design: .rounded))
                .foregroundStyle(tint)
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(BloomTheme.secondaryText)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.075))
        .clipShape(RoundedRectangle(cornerRadius: 13))
    }

    private func ratingRow(
        title: String,
        value: Binding<Int>,
        low: String,
        high: String,
        tint: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BloomTheme.primaryText)
            HStack(spacing: 8) {
                Text(low)
                    .font(.system(size: 9))
                    .foregroundStyle(BloomTheme.secondaryText)
                    .frame(width: 32, alignment: .leading)
                ForEach(1...5, id: \.self) { level in
                    Button {
                        value.wrappedValue = level
                    } label: {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(level <= value.wrappedValue ? tint : BloomTheme.surface(0.06))
                            .frame(maxWidth: .infinity, minHeight: 26)
                    }
                    .buttonStyle(.plain)
                }
                Text(high)
                    .font(.system(size: 9))
                    .foregroundStyle(BloomTheme.secondaryText)
                    .frame(width: 32, alignment: .trailing)
            }
        }
    }
}
