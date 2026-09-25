import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showClearConfirmation = false
    @State private var newManagedTaskName = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                SectionHeading(
                    eyebrow: "Preferences",
                    title: "让工具适应你",
                    subtitle: "这些是每一轮开始时使用的默认值，开始后不会改变当前轮次。"
                )

                HStack(alignment: .top, spacing: 16) {
                    VStack(spacing: 16) {
                        reminderSettings
                        musicSettings
                    }
                    .frame(maxWidth: .infinity)

                    VStack(spacing: 16) {
                        sessionSettings
                        taskSettings
                        dataSettings
                        philosophyCard
                    }
                    .frame(width: 370)
                }
            }
            .padding(.horizontal, 30)
            .padding(.top, 34)
            .padding(.bottom, 34)
        }
        .alert("清空全部专注记录？", isPresented: $showClearConfirmation) {
            Button("取消", role: .cancel) {}
            Button("永久清空", role: .destructive) {
                store.clearHistory()
            }
        } message: {
            Text("此操作无法撤销。建议先导出 CSV 备份。")
        }
    }

    private var reminderSettings: some View {
        settingsCard(title: "随机提示", subtitle: "控制微休息出现的节律", symbol: "bell.badge.fill") {
            settingRow(title: "最早响起", detail: "每次提示后重新随机") {
                Stepper(
                    "\(store.settings.reminderMinimumMinutes) 分钟",
                    value: $store.settings.reminderMinimumMinutes,
                    in: 1...60
                )
                .frame(width: 150)
            }

            settingRow(title: "最晚响起", detail: "必须晚于或等于最早时间") {
                Stepper(
                    "\(store.settings.reminderMaximumMinutes) 分钟",
                    value: $store.settings.reminderMaximumMinutes,
                    in: max(1, store.settings.reminderMinimumMinutes)...90
                )
                .frame(width: 150)
            }

            settingRow(title: "微休息长度", detail: "建议闭眼、松肩，不碰手机") {
                Stepper(
                    "\(store.settings.microBreakSeconds) 秒",
                    value: $store.settings.microBreakSeconds,
                    in: 5...60,
                    step: 1
                )
                .frame(width: 150)
            }

            settingRow(title: "提示音", detail: "短促但不刺耳") {
                HStack {
                    Picker("", selection: $store.settings.reminderSound) {
                        ForEach(AppSettings.reminderSoundOptions, id: \.self) { option in
                            if option == "随机" {
                                Label("随机", systemImage: "shuffle")
                            } else {
                                Text(option)
                            }
                        }
                    }
                    .labelsHidden()
                    .frame(width: 110)
                    Button {
                        store.playSound(named: store.settings.reminderSound)
                    } label: {
                        Image(systemName: "speaker.wave.2.fill")
                    }
                    .buttonStyle(.borderless)
                }
            }

            Toggle("显示下一次提示的倒计时", isOn: $store.settings.showNextReminder)
                .toggleStyle(.switch)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(BloomTheme.primaryText)
        }
    }

    private var sessionSettings: some View {
        settingsCard(title: "专注轮次", subtitle: "默认时长与结束反馈", symbol: "timer") {
            settingRow(title: "默认时长", detail: "仍可在专注页快速选择") {
                HStack(spacing: 5) {
                    TextField(
                        "分钟",
                        value: $store.settings.selectedDurationMinutes,
                        format: .number
                    )
                    .textFieldStyle(.roundedBorder)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 62)
                    Text("分钟")
                        .font(.system(size: 10))
                        .foregroundStyle(BloomTheme.secondaryText)
                    Stepper(
                        "",
                        value: $store.settings.selectedDurationMinutes,
                        in: 1...1_440,
                        step: 1
                    )
                    .labelsHidden()
                }
                .frame(width: 170)
            }

            settingRow(title: "结束提示音", detail: "音乐开始前的完成信号") {
                HStack {
                    Picker("", selection: $store.settings.completionSound) {
                        ForEach(AppSettings.completionSoundOptions, id: \.self) { Text($0) }
                    }
                    .labelsHidden()
                    .frame(width: 110)
                    Button {
                        store.playSound(named: store.settings.completionSound)
                    } label: {
                        Image(systemName: "speaker.wave.2.fill")
                    }
                    .buttonStyle(.borderless)
                }
            }

            Divider().overlay(BloomTheme.hairline)

            Toggle(
                isOn: Binding(
                    get: { store.settings.resolvedFloatingTimerOnMinimize },
                    set: { store.settings.floatingTimerOnMinimize = $0 }
                )
            ) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("最小化时悬浮倒计时")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(BloomTheme.primaryText)
                    Text("仅在计时中显示；可拖动，恢复主窗口后自动隐藏")
                        .font(.system(size: 9))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
            }
            .toggleStyle(.switch)

            Toggle(
                isOn: Binding(
                    get: { store.settings.resolvedFloatingSignalButtons },
                    set: { store.settings.floatingSignalButtons = $0 }
                )
            ) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("最小化时悬浮状态按钮")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(BloomTheme.primaryText)
                    Text("可单独显示“我走神了”和“我开始累了”，无需倒计时")
                        .font(.system(size: 9))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
            }
            .toggleStyle(.switch)
        }
    }

    private var musicSettings: some View {
        let service = store.settings.resolvedMusicService
        return settingsCard(title: "结束音乐", subtitle: "一轮结束后，用音乐切换状态", symbol: service.symbol) {
            Toggle(service == .appleMusic ? "结束后自动随机播放" : "结束后自动播放当前队列", isOn: $store.settings.autoPlayMusic)
                .toggleStyle(.switch)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BloomTheme.primaryText)

            if store.settings.autoPlayMusic {
                settingRow(title: "音乐服务", detail: "选择专注结束时控制的播放器") {
                    Picker("", selection: Binding<MusicService>(
                        get: { store.settings.resolvedMusicService },
                        set: { store.settings.musicService = $0 }
                    )) {
                        ForEach(MusicService.allCases) { option in
                            Label(option.rawValue, systemImage: option.symbol).tag(option)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 145)
                }

                if service == .appleMusic {
                settingRow(title: "歌曲范围", detail: "从资料库或指定列表中随机") {
                    Picker("", selection: $store.settings.musicSource) {
                        ForEach(MusicSource.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .labelsHidden()
                    .frame(width: 145)
                }

                if store.settings.musicSource == .playlist {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("播放列表名称")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(BloomTheme.primaryText)
                        TextField("与“音乐”App 中的名称完全一致", text: $store.settings.playlistName)
                            .textFieldStyle(.plain)
                            .padding(11)
                            .background(BloomTheme.surface(0.055))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                } else {
                    Text("网易云音乐会在后台打开客户端并播放当前队列，已在播放时不会被打断。需要在系统设置中允许辅助功能控制，重新打包后要重新授权。")
                        .font(.system(size: 10))
                        .foregroundStyle(BloomTheme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(service == .appleMusic ? "首次测试会出现系统授权" : "首次使用需开启辅助功能权限")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(BloomTheme.primaryText)
                        Text(service == .appleMusic ? "请选择“允许”专注芽控制“音乐”。" : "请在系统设置中允许专注芽控制网易云音乐。")
                            .font(.system(size: 9))
                            .foregroundStyle(BloomTheme.secondaryText)
                    }
                    Spacer()
                    Button(service == .appleMusic ? "测试随机播放" : "测试播放") {
                        store.testMusic()
                    }
                    .buttonStyle(BloomSecondaryButtonStyle())
                    .disabled(service == .appleMusic && store.settings.musicSource == .playlist && store.settings.playlistName.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                if let message = store.musicMessage {
                    Text(message)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(message.contains("失败") ? BloomTheme.coral : BloomTheme.mint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var taskSettings: some View {
        settingsCard(title: "任务管理", subtitle: "用于每轮选择与分类统计", symbol: "tag.fill") {
            HStack(spacing: 8) {
                TextField("新增任务名称", text: $newManagedTaskName)
                    .textFieldStyle(.plain)
                    .font(.system(size: 11))
                    .padding(.horizontal, 11)
                    .frame(height: 36)
                    .background(BloomTheme.surface(0.055))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .onSubmit(addManagedTask)

                Button {
                    addManagedTask()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .bold))
                }
                .buttonStyle(BloomSecondaryButtonStyle())
                .disabled(
                    store.isSessionActive
                    || newManagedTaskName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
            }
            .disabled(store.isSessionActive)

            if store.taskNames.isEmpty {
                HStack(spacing: 9) {
                    Image(systemName: "tag")
                        .foregroundStyle(BloomTheme.secondaryText)
                    Text("还没有自定义任务，可在这里或专注页新增。")
                        .font(.system(size: 10))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
            } else {
                VStack(spacing: 8) {
                    ForEach(store.taskNames, id: \.self) { task in
                        HStack(spacing: 9) {
                            Image(systemName: "tag.fill")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(BloomTheme.mint)
                            Text(task)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(BloomTheme.primaryText)
                                .lineLimit(1)
                            if store.selectedTaskName == task {
                                Text("当前")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundStyle(BloomTheme.mint)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(BloomTheme.mint.opacity(0.10))
                                    .clipShape(Capsule())
                            }
                            Spacer()
                            Text("\(store.taskSessionCount(named: task)) 轮")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(BloomTheme.secondaryText)
                            Button {
                                store.removeTask(named: task)
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(BloomTheme.secondaryText)
                                    .frame(width: 24, height: 24)
                                    .background(BloomTheme.surface(0.05))
                                    .clipShape(Circle())
                            }
                            .buttonStyle(.plain)
                            .help("从任务列表移除；历史记录仍保留")
                        }
                        .padding(.horizontal, 10)
                        .frame(minHeight: 38)
                        .background(BloomTheme.surface(0.035))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }

            Text("移除任务不会删除已经归档的专注记录和统计。")
                .font(.system(size: 9))
                .foregroundStyle(BloomTheme.secondaryText.opacity(0.82))
        }
    }

    private var dataSettings: some View {
        settingsCard(title: "数据", subtitle: "全部记录只保存在这台 Mac", symbol: "internaldrive.fill") {
            Button {
                store.exportCSV()
            } label: {
                HStack {
                    Label("导出全部记录", systemImage: "square.and.arrow.up")
                    Spacer()
                    Text("CSV")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
            }
            .buttonStyle(BloomSecondaryButtonStyle())

            Button(role: .destructive) {
                showClearConfirmation = true
            } label: {
                HStack {
                    Label("清空专注记录", systemImage: "trash")
                    Spacer()
                }
                .foregroundStyle(BloomTheme.coral)
            }
            .buttonStyle(BloomSecondaryButtonStyle())
            .disabled(store.sessions.isEmpty)
        }
    }

    private var philosophyCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "quote.opening")
                .foregroundStyle(BloomTheme.mint)
            Text("训练注意力，不是逼自己忽略疲劳；是更早发现疲劳、更准确地选择继续或休息。")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(BloomTheme.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            Text("专注芽 · 本地优先 · 无账号")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(BloomTheme.secondaryText)
        }
        .bloomCard(padding: 18, strong: true)
    }

    private func settingsCard<Content: View>(
        title: String,
        subtitle: String,
        symbol: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 17) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(BloomTheme.primaryText)
                    Text(subtitle)
                        .font(.system(size: 10))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
                Spacer()
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(BloomTheme.mint)
            }
            Divider().overlay(BloomTheme.hairline)
            content()
        }
        .bloomCard(padding: 19)
    }

    private func settingRow<Accessory: View>(
        title: String,
        detail: String,
        @ViewBuilder accessory: () -> Accessory
    ) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BloomTheme.primaryText)
                Text(detail)
                    .font(.system(size: 9))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
            Spacer()
            accessory()
        }
    }

    private func addManagedTask() {
        guard store.addTask(named: newManagedTaskName) else { return }
        newManagedTaskName = ""
    }
}
