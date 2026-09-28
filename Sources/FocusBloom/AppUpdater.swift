import Sparkle
import SwiftUI

/// 自动更新：Sparkle 定期读取 GitHub Release 上的 appcast.xml，发现新版本后弹出更新窗口，
/// 下载、校验签名、替换 App 并重新打开都由 Sparkle 完成。
/// 专注中发现的新版本不弹窗打断，只在侧边栏留一个提示，等用户有空时再点。
@MainActor
final class AppUpdater: NSObject, ObservableObject {
    @Published private(set) var canCheckForUpdates = false
    @Published var automaticallyChecksForUpdates = false {
        didSet {
            guard let updater, updater.automaticallyChecksForUpdates != automaticallyChecksForUpdates else { return }
            updater.automaticallyChecksForUpdates = automaticallyChecksForUpdates
        }
    }
    /// 专注中推迟显示的新版本号。
    @Published private(set) var deferredVersion: String?

    /// 直接运行 swift build 产物（不是 .app）时没有 Info.plist 里的更新配置，此时不启用。
    let isAvailable = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil

    private let isBusy: @MainActor () -> Bool
    private var controller: SPUStandardUpdaterController?
    private var updater: SPUUpdater? { controller?.updater }

    init(isBusy: @escaping @MainActor () -> Bool) {
        self.isBusy = isBusy
        super.init()
        guard isAvailable else { return }
        let controller = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: nil,
            userDriverDelegate: self
        )
        self.controller = controller
        automaticallyChecksForUpdates = controller.updater.automaticallyChecksForUpdates
        controller.updater.publisher(for: \.canCheckForUpdates)
            .receive(on: RunLoop.main)
            .assign(to: &$canCheckForUpdates)
    }

    var currentVersion: String {
        guard let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String else {
            return "开发版"
        }
        return "v\(version)"
    }

    func checkForUpdates() {
        deferredVersion = nil
        controller?.checkForUpdates(nil)
    }
}

extension AppUpdater: SPUStandardUserDriverDelegate {
    nonisolated var supportsGentleScheduledUpdateReminders: Bool { true }

    nonisolated func standardUserDriverShouldHandleShowingScheduledUpdate(
        _ update: SUAppcastItem,
        andInImmediateFocus immediateFocus: Bool
    ) -> Bool {
        MainActor.assumeIsolated { !isBusy() }
    }

    nonisolated func standardUserDriverWillHandleShowingUpdate(
        _ handleShowingUpdate: Bool,
        forUpdate update: SUAppcastItem,
        state: SPUUserUpdateState
    ) {
        let version = update.displayVersionString
        MainActor.assumeIsolated {
            deferredVersion = handleShowingUpdate ? nil : version
        }
    }

    nonisolated func standardUserDriverDidReceiveUserAttention(forUpdate update: SUAppcastItem) {
        MainActor.assumeIsolated { deferredVersion = nil }
    }

    nonisolated func standardUserDriverWillFinishUpdateSession() {
        MainActor.assumeIsolated { deferredVersion = nil }
    }
}

/// 应用菜单里的“检查更新…”。
struct CheckForUpdatesCommand: View {
    @ObservedObject var updater: AppUpdater

    var body: some View {
        Button("检查更新…") {
            updater.checkForUpdates()
        }
        .disabled(!updater.canCheckForUpdates)
    }
}

/// 专注中推迟的新版本，一轮结束后在侧边栏提示。
struct UpdateNoticeView: View {
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var updater: AppUpdater

    var body: some View {
        if let version = updater.deferredVersion, !store.isSessionActive {
            Button {
                updater.checkForUpdates()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(BloomTheme.mint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("新版本 v\(version)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(BloomTheme.primaryText)
                        Text("点击查看并更新")
                            .font(.system(size: 10))
                            .foregroundStyle(BloomTheme.secondaryText)
                    }
                    Spacer()
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
                .background(BloomTheme.mint.opacity(0.09))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(BloomTheme.mint.opacity(0.28))
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
        }
    }
}
