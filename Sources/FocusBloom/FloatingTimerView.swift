import AppKit
import SwiftUI

enum FloatingTimerWindow {
    static let id = "floating-timer"
    static let mainWindowIdentifier = NSUserInterfaceItemIdentifier("focus-bloom-main-window")
}

enum MainWindowRestorer {
    private static weak var registeredWindow: NSWindow?

    static func register(_ window: NSWindow) {
        registeredWindow = window
        window.identifier = FloatingTimerWindow.mainWindowIdentifier
    }

    @discardableResult
    static func restore(in application: NSApplication = NSApp) -> Bool {
        guard let mainWindow = resolveMainWindow(in: application) else {
            return false
        }

        register(mainWindow)
        application.unhide(nil)

        if mainWindow.isMiniaturized {
            mainWindow.deminiaturize(nil)
        }

        application.activate(ignoringOtherApps: true)
        mainWindow.makeKeyAndOrderFront(nil)
        mainWindow.orderFrontRegardless()
        NSRunningApplication.current.activate(options: [.activateAllWindows])
        return true
    }

    private static func resolveMainWindow(in application: NSApplication) -> NSWindow? {
        if let registeredWindow {
            return registeredWindow
        }

        return application.windows.first(where: { window in
            if window.identifier == FloatingTimerWindow.mainWindowIdentifier {
                return true
            }

            return window.level == .normal
                && !window.isExcludedFromWindowsMenu
                && window.canBecomeMain
        })
    }
}

struct MainWindowObserver: NSViewRepresentable {
    let onMiniaturizationChange: (Bool) -> Void

    func makeNSView(context: Context) -> WindowObservationView {
        let view = WindowObservationView()
        view.onMiniaturizationChange = onMiniaturizationChange
        return view
    }

    func updateNSView(_ nsView: WindowObservationView, context: Context) {
        nsView.onMiniaturizationChange = onMiniaturizationChange
        nsView.observeCurrentWindowIfNeeded()
    }
}

final class WindowObservationView: NSView {
    var onMiniaturizationChange: ((Bool) -> Void)?

    private weak var observedWindow: NSWindow?
    private var miniaturizeObserver: NSObjectProtocol?
    private var deminiaturizeObserver: NSObjectProtocol?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        observeCurrentWindowIfNeeded()
    }

    func observeCurrentWindowIfNeeded() {
        guard let window, window !== observedWindow else { return }
        removeObservers()
        observedWindow = window
        MainWindowRestorer.register(window)

        miniaturizeObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didMiniaturizeNotification,
            object: window,
            queue: .main
        ) { [weak self] _ in
            self?.onMiniaturizationChange?(true)
        }

        deminiaturizeObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didDeminiaturizeNotification,
            object: window,
            queue: .main
        ) { [weak self] _ in
            self?.onMiniaturizationChange?(false)
        }
    }

    private func removeObservers() {
        if let miniaturizeObserver {
            NotificationCenter.default.removeObserver(miniaturizeObserver)
        }
        if let deminiaturizeObserver {
            NotificationCenter.default.removeObserver(deminiaturizeObserver)
        }
        miniaturizeObserver = nil
        deminiaturizeObserver = nil
    }

    deinit {
        removeObservers()
    }
}

struct FloatingTimerView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismissWindow) private var dismissWindow

    var body: some View {
        VStack(spacing: 0) {
            if showsTimer {
                HStack(spacing: 14) {
                    progressRing

                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(statusTint)
                                .frame(width: 6, height: 6)
                            Text(statusText)
                                .font(.system(size: 10, weight: .bold))
                                .tracking(0.7)
                                .foregroundStyle(BloomTheme.secondaryText)
                        }

                        Text(timerText)
                            .font(.system(size: 29, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(BloomTheme.primaryText)
                    }

                    Spacer(minLength: 2)

                    VStack(spacing: 7) {
                        if store.phase == .focusing || store.phase == .paused {
                            floatingButton(
                                symbol: store.phase == .paused ? "play.fill" : "pause.fill",
                                help: store.phase == .paused ? "继续" : "暂停"
                            ) {
                                store.togglePause()
                            }
                        } else if store.phase == .microBreak {
                            floatingButton(symbol: "arrow.right", help: "提前继续") {
                                store.skipMicroBreak()
                            }
                        }

                        floatingButton(symbol: "arrow.up.left.and.arrow.down.right", help: "返回主窗口") {
                            restoreMainWindow()
                        }
                    }
                }
                .padding(.horizontal, 17)
                .frame(height: 116)
            }

            if showsSignals {
                if showsTimer {
                    Divider()
                        .overlay(BloomTheme.hairline)
                        .padding(.horizontal, 16)
                }

                HStack(spacing: 8) {
                    signalButton(
                        title: "我走神了",
                        count: store.currentEvents.filter { $0.kind == .mindWander }.count,
                        symbol: "scope",
                        tint: BloomTheme.coral
                    ) {
                        store.recordMindWander()
                    }

                    signalButton(
                        title: "我开始累了",
                        count: store.currentEvents.filter { $0.kind == .fatigue }.count,
                        symbol: "battery.25",
                        tint: BloomTheme.amber
                    ) {
                        store.recordFatigue()
                    }
                }
                .padding(.horizontal, 12)
                .frame(height: showsTimer ? 58 : 70)
            }
        }
        .frame(width: floatingWidth, height: floatingHeight)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: floatingCornerRadius, style: .continuous)
                    .fill(floatingBackground)
                LinearGradient(
                    colors: floatingGradientColors,
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .clipShape(RoundedRectangle(cornerRadius: floatingCornerRadius, style: .continuous))
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: floatingCornerRadius, style: .continuous)
                .stroke(floatingBorder, lineWidth: 1)
        }
        .shadow(
            color: Color.black.opacity(isDarkMode ? 0.48 : 0.20),
            radius: isDarkMode ? 24 : 20,
            y: isDarkMode ? 10 : 8
        )
        .background(FloatingWindowConfigurator())
        .accessibilityElement(children: .contain)
        .animation(.easeInOut(duration: 0.2), value: store.settings.resolvedFloatingSignalButtons)
        .animation(.easeInOut(duration: 0.2), value: store.settings.resolvedFloatingTimerOnMinimize)
    }

    private var showsTimer: Bool {
        store.settings.resolvedFloatingTimerOnMinimize
    }

    private var showsSignals: Bool {
        store.settings.resolvedFloatingSignalButtons
    }

    private var isDarkMode: Bool {
        store.settings.resolvedAppearanceMode == .dark
    }

    private var floatingBackground: Color {
        isDarkMode
            ? Color(hex: 0x10191D, alpha: 0.97)
            : Color(hex: 0xF7FAF8, alpha: 0.97)
    }

    private var floatingGradientColors: [Color] {
        if isDarkMode {
            return [
                BloomTheme.mint.opacity(0.13),
                Color.clear,
                BloomTheme.blue.opacity(0.07)
            ]
        }
        return [
            BloomTheme.mint.opacity(0.08),
            Color.clear,
            BloomTheme.blue.opacity(0.04)
        ]
    }

    private var floatingBorder: Color {
        isDarkMode
            ? Color.white.opacity(0.15)
            : Color(hex: 0x14211C, alpha: 0.11)
    }

    private var floatingWidth: CGFloat {
        showsSignals ? 292 : 264
    }

    private var floatingHeight: CGFloat {
        switch (showsTimer, showsSignals) {
        case (true, true): return 174
        case (true, false): return 116
        case (false, true): return 70
        case (false, false): return 0
        }
    }

    private var floatingCornerRadius: CGFloat {
        showsTimer ? 24 : 19
    }

    private var progressRing: some View {
        ZStack {
            Circle()
                .stroke(BloomTheme.surface(0.07), lineWidth: 5)
            Circle()
                .trim(from: 0, to: ringProgress)
                .stroke(
                    statusTint,
                    style: StrokeStyle(lineWidth: 5, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            Image(systemName: phaseSymbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(statusTint)
        }
        .frame(width: 49, height: 49)
    }

    private var ringProgress: Double {
        store.phase == .microBreak ? 1 : max(0.02, store.progress)
    }

    private var timerText: String {
        store.phase == .microBreak
            ? "\(store.breakRemainingSeconds) 秒"
            : store.format(seconds: store.remainingSeconds)
    }

    private var statusText: String {
        switch store.phase {
        case .microBreak: return "微休息"
        case .paused: return "已暂停"
        default: return "专注中"
        }
    }

    private var phaseSymbol: String {
        switch store.phase {
        case .microBreak: return "sparkles"
        case .paused: return "pause.fill"
        default: return "leaf.fill"
        }
    }

    private var statusTint: Color {
        switch store.phase {
        case .microBreak: return BloomTheme.blue
        case .paused: return BloomTheme.amber
        default: return BloomTheme.mint
        }
    }

    private func floatingButton(
        symbol: String,
        help: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(BloomTheme.primaryText)
                .frame(width: 28, height: 28)
                .background(BloomTheme.surface(0.07))
                .clipShape(Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(help)
    }

    private func signalButton(
        title: String,
        count: Int,
        symbol: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(tint)
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(
                        isDarkMode
                            ? Color.white.opacity(0.94)
                            : BloomTheme.primaryText
                    )
                Spacer(minLength: 2)
                Text("\(count)")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(tint)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(tint.opacity(isDarkMode ? 0.16 : 0.09))
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(tint.opacity(isDarkMode ? 0.42 : 0.18), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(store.phase == .microBreak)
        .opacity(store.phase == .microBreak ? 0.45 : 1)
        .help("\(title)，本轮已记录 \(count) 次")
    }

    private func restoreMainWindow() {
        if MainWindowRestorer.restore() {
            dismissWindow(id: FloatingTimerWindow.id)
        }
    }
}

struct FloatingWindowConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = FloatingWindowConfigurationView()
        DispatchQueue.main.async {
            view.configureWindow()
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        guard let view = nsView as? FloatingWindowConfigurationView else { return }
        DispatchQueue.main.async {
            view.configureWindow()
        }
    }
}

final class FloatingWindowConfigurationView: NSView {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        configureWindow()
    }

    func configureWindow() {
        guard let window else { return }
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isMovableByWindowBackground = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.isExcludedFromWindowsMenu = true
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.styleMask.insert(.fullSizeContentView)
        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true
    }
}
