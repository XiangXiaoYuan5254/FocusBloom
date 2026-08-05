import AppKit
import SwiftUI

final class FocusBloomAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldHandleReopen(
        _ sender: NSApplication,
        hasVisibleWindows flag: Bool
    ) -> Bool {
        guard let mainWindow = sender.windows.first(where: {
            $0.identifier == FloatingTimerWindow.mainWindowIdentifier
        }) else {
            // Let SwiftUI recreate the main WindowGroup if it was fully closed.
            return true
        }

        if mainWindow.isMiniaturized {
            mainWindow.deminiaturize(nil)
        }
        mainWindow.makeKeyAndOrderFront(nil)
        sender.activate(ignoringOtherApps: true)
        return false
    }
}

@main
struct FocusBloomApp: App {
    @NSApplicationDelegateAdaptor(FocusBloomAppDelegate.self) private var appDelegate
    @StateObject private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .frame(minWidth: 1080, minHeight: 720)
                .preferredColorScheme(store.settings.resolvedAppearanceMode == .light ? .light : .dark)
        }
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unifiedCompact(showsTitle: false))
        .defaultSize(width: 1180, height: 790)

        Window("专注芽倒计时", id: FloatingTimerWindow.id) {
            FloatingTimerView()
                .environmentObject(store)
                .preferredColorScheme(store.settings.resolvedAppearanceMode == .light ? .light : .dark)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultSize(width: 264, height: 116)

        MenuBarExtra {
            MenuBarView()
                .environmentObject(store)
        } label: {
            Image(systemName: store.isSessionActive ? "leaf.fill" : "leaf")
        }
        .menuBarExtraStyle(.window)
    }
}

struct ContentView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow
    @State private var isMainWindowMiniaturized = false

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .environmentObject(store)
                .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 225)
        } detail: {
            ZStack(alignment: .top) {
                BloomTheme.backgroundGradient.ignoresSafeArea()
                detailView

                if let message = store.toastMessage {
                    HStack(spacing: 9) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(BloomTheme.mint)
                        Text(message)
                            .font(.system(size: 13, weight: .medium))
                    }
                    .foregroundStyle(BloomTheme.primaryText)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(.ultraThinMaterial)
                    .clipShape(Capsule())
                    .overlay { Capsule().stroke(BloomTheme.hairline) }
                    .padding(.top, 12)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(20)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .overlay {
            if store.showSessionEndDialog {
                ZStack {
                    Color.black
                        .opacity(0.28)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture {
                            store.showSessionEndDialog = false
                        }

                    SessionEndDialog(
                        onContinue: {
                            store.showSessionEndDialog = false
                        },
                        onReview: {
                            store.showSessionEndDialog = false
                            store.stopSessionEarly()
                        },
                        onAbandon: {
                            store.showSessionEndDialog = false
                            store.abandonSession()
                        }
                    )
                    .transition(.scale(scale: 0.96).combined(with: .opacity))
                }
                .transition(.opacity)
                .zIndex(50)
            }
        }
        .background {
            MainWindowObserver { miniaturized in
                isMainWindowMiniaturized = miniaturized
                updateFloatingTimerVisibility(for: miniaturized)
            }
        }
        .sheet(isPresented: $store.showCompletionSheet) {
            CompletionView()
                .environmentObject(store)
                .interactiveDismissDisabled()
        }
        .animation(.easeInOut(duration: 0.22), value: store.toastMessage)
        .animation(.easeOut(duration: 0.18), value: store.showSessionEndDialog)
        .onChange(of: store.isSessionActive) {
            updateFloatingTimerVisibility()
        }
        .onChange(of: store.settings.resolvedFloatingTimerOnMinimize) {
            updateFloatingTimerVisibility()
        }
        .onChange(of: store.settings.resolvedFloatingSignalButtons) {
            updateFloatingTimerVisibility()
        }
        .onDisappear {
            dismissWindow(id: FloatingTimerWindow.id)
        }
    }

    private func updateFloatingTimerVisibility(for miniaturized: Bool? = nil) {
        let mainWindowIsMiniaturized = miniaturized ?? isMainWindowMiniaturized
        if mainWindowIsMiniaturized,
           store.isSessionActive,
           (
               store.settings.resolvedFloatingTimerOnMinimize
               || store.settings.resolvedFloatingSignalButtons
           ) {
            openWindow(id: FloatingTimerWindow.id)
        } else {
            dismissWindow(id: FloatingTimerWindow.id)
        }
    }

    @ViewBuilder
    private var detailView: some View {
        switch store.selectedSection {
        case .focus:
            FocusView()
        case .insights:
            InsightsView()
        case .history:
            HistoryView()
        case .settings:
            SettingsView()
        }
    }
}

struct SidebarView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ZStack {
            BloomTheme.sidebarBackground.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 11) {
                    ZStack {
                        Circle().fill(BloomTheme.mint.opacity(0.16))
                        Image(systemName: "leaf.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(BloomTheme.mint)
                    }
                    .frame(width: 38, height: 38)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("专注芽")
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                            .foregroundStyle(BloomTheme.primaryText)
                        Text("FocusBloom")
                            .font(.system(size: 9, weight: .semibold))
                            .tracking(1)
                            .foregroundStyle(BloomTheme.secondaryText)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 24)
                .padding(.bottom, 30)

                VStack(spacing: 7) {
                    ForEach(AppSection.allCases) { item in
                        Button {
                            store.selectedSection = item
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: item.symbol)
                                    .font(.system(size: 14, weight: .semibold))
                                    .frame(width: 20)
                                Text(item.rawValue)
                                    .font(.system(size: 14, weight: .semibold))
                                Spacer()
                                if item == .focus && store.isSessionActive {
                                    Circle()
                                        .fill(BloomTheme.coral)
                                        .frame(width: 7, height: 7)
                                }
                            }
                            .foregroundStyle(store.selectedSection == item ? BloomTheme.primaryText : BloomTheme.secondaryText)
                            .padding(.horizontal, 13)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .background(store.selectedSection == item ? BloomTheme.surface(0.09) : .clear)
                            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                            .contentShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)

                Spacer()

                Button {
                    store.toggleAppearance()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: store.settings.resolvedAppearanceMode == .dark ? "sun.max.fill" : "moon.stars.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(store.settings.resolvedAppearanceMode == .dark ? BloomTheme.amber : BloomTheme.blue)
                            .frame(width: 27, height: 27)
                            .background(
                                (store.settings.resolvedAppearanceMode == .dark ? BloomTheme.amber : BloomTheme.blue)
                                    .opacity(0.11)
                            )
                            .clipShape(Circle())
                        Text(store.settings.resolvedAppearanceMode == .dark ? "切换到日间模式" : "切换到夜间模式")
                            .font(.system(size: 11, weight: .semibold))
                        Spacer()
                    }
                    .foregroundStyle(BloomTheme.secondaryText)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                    .background(BloomTheme.surface(0.04))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.bottom, 4)

                VStack(alignment: .leading, spacing: 14) {
                    Text("今天")
                        .font(.system(size: 10, weight: .bold))
                        .tracking(1.2)
                        .foregroundStyle(BloomTheme.secondaryText)
                    HStack {
                        sidebarMetric(value: "\(store.todayMinutes)", unit: "分钟")
                        Spacer()
                        sidebarMetric(value: "\(store.todaySessions.count)", unit: "轮")
                    }
                    Divider().overlay(BloomTheme.hairline)
                    HStack(spacing: 8) {
                        Image(systemName: "flame.fill")
                            .foregroundStyle(BloomTheme.amber)
                        Text(store.streakDays == 0 ? "从今天开始" : "连续 \(store.streakDays) 天")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(BloomTheme.secondaryText)
                    }
                }
                .padding(16)
                .background(BloomTheme.surface(0.045))
                .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                .padding(14)
            }
        }
    }

    private func sidebarMetric(value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(BloomTheme.primaryText)
            Text(unit)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(BloomTheme.secondaryText)
        }
    }
}

struct MenuBarView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: store.phase == .microBreak ? "sparkles" : "leaf.fill")
                    .foregroundStyle(BloomTheme.mint)
                Text(store.phase == .microBreak ? "微休息" : store.isSessionActive ? "专注中" : "专注芽")
                    .font(.headline)
                Spacer()
            }

            if store.isSessionActive {
                Text(store.phase == .microBreak
                     ? "\(store.breakRemainingSeconds) 秒后继续"
                     : store.format(seconds: store.remainingSeconds))
                    .font(.system(size: 30, weight: .bold, design: .rounded))

                HStack {
                    if store.phase == .focusing || store.phase == .paused {
                        Button(store.phase == .paused ? "继续" : "暂停") {
                            store.togglePause()
                        }
                        Button("我走神了") {
                            store.recordMindWander()
                        }
                    } else if store.phase == .microBreak {
                        Button("现在继续") {
                            store.skipMicroBreak()
                        }
                    }
                }
            } else {
                Text("准备好时，开始一轮安静的专注。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("开始 \(store.settings.selectedDurationMinutes) 分钟") {
                    store.startSession()
                }
            }
        }
        .padding(16)
        .frame(width: 270)
    }
}
