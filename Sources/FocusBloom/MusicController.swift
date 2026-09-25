import AppKit
import ApplicationServices

enum MusicController {
    private static let netEaseBundleID = "com.netease.163music"

    static func playRandom(
        service: MusicService,
        source: MusicSource,
        playlistName: String,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        let script: String
        if service == .appleMusic {
            script = appleMusicScript(source: source, playlistName: playlistName)
        } else {
            do {
                let justLaunched = try prepareNetEase()
                // 冷启动时客户端要先加载界面和播放队列，给足等待时间。
                script = netEaseScript(timeout: justLaunched ? 25 : 6)
            } catch {
                completion(.failure(error))
                return
            }
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            let output = Pipe()
            let errors = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = ["-e", script]
            process.standardOutput = output
            process.standardError = errors

            do {
                try process.run()
                process.waitUntilExit()
                if process.terminationStatus == 0 {
                    let data = output.fileHandleForReading.readDataToEndOfFile()
                    let track = String(data: data, encoding: .utf8)?
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    DispatchQueue.main.async {
                        completion(.success(track?.isEmpty == false ? track! : "已开始随机播放"))
                    }
                } else {
                    let data = errors.fileHandleForReading.readDataToEndOfFile()
                    let message = String(data: data, encoding: .utf8).map(cleanedScriptError) ?? "无法控制“音乐”App"
                    DispatchQueue.main.async {
                        completion(.failure(MusicError.script(message)))
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    completion(.failure(error))
                }
            }
        }
    }

    /// osascript 的报错形如 `6:12: execution error: 消息 (-2700)`，只保留中间的消息。
    private static func cleanedScriptError(_ raw: String) -> String {
        var message = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let range = message.range(of: "execution error: ") {
            message = String(message[range.upperBound...])
        }
        if let range = message.range(of: #" \(-?\d+\)$"#, options: .regularExpression) {
            message.removeSubrange(range)
        }
        return message
    }

    private static func appleMusicScript(source: MusicSource, playlistName: String) -> String {
        let collection: String
        switch source {
        case .library:
            collection = "library playlist 1"
        case .playlist:
            let safeName = playlistName
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
            collection = "first user playlist whose name is \"\(safeName)\""
        }

        return """
        tell application "Music"
            activate
            set sourcePlaylist to \(collection)
            set candidateTracks to every track of sourcePlaylist whose enabled is true
            set trackCount to count of candidateTracks
            if trackCount is 0 then error "这个范围里没有可播放的歌曲"
            set chosenTrack to item (random number from 1 to trackCount) of candidateTracks
            play chosenTrack
            return (name of chosenTrack) & " — " & (artist of chosenTrack)
        end tell
        """
    }

    /// 检查网易云是否安装、专注芽是否拿到辅助功能权限，必要时在后台拉起客户端。返回客户端是否刚被启动。
    private static func prepareNetEase() throws -> Bool {
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: netEaseBundleID) else {
            throw MusicError.script("没有找到网易云音乐客户端")
        }

        // 点菜单依赖辅助功能权限。专注芽是 ad-hoc 签名，每次重新打包后旧授权都会失效（系统设置里仍显示已勾选）。
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        guard AXIsProcessTrustedWithOptions(options) else {
            throw MusicError.script("需要在“系统设置 › 隐私与安全性 › 辅助功能”中允许“专注芽”；如果已经勾选，请先用“−”移除旧条目再重新添加")
        }

        guard NSRunningApplication.runningApplications(withBundleIdentifier: netEaseBundleID).isEmpty else {
            return false
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration)
        return true
    }

    /// 网易云音乐 macOS 客户端没有公开 AppleScript 字典，只能通过“控制”菜单的第一项播放当前队列。
    /// 这一项是开关：暂停时叫“播放”，播放中叫“暂停”，所以先读状态再点，点完再确认状态真的变了。
    /// 菜单点击不需要客户端在前台，也就不会抢走专注芽的焦点。
    private static func netEaseScript(timeout: Int) -> String {
        """
        set playNames to {"播放", "Play"}
        set pauseNames to {"暂停", "Pause"}
        set deadline to (current date) + \(timeout)
        set lastClick to missing value
        set lastProblem to "网易云音乐还没有准备好"
        tell application "System Events"
            repeat
                try
                    set netEase to first application process whose bundle identifier is "\(netEaseBundleID)"
                    set controlMenu to missing value
                    repeat with barItem in menu bar items of menu bar 1 of netEase
                        if name of barItem is in {"控制", "Controls"} then set controlMenu to menu 1 of barItem
                    end repeat
                    if controlMenu is missing value then error "找不到网易云音乐的“控制”菜单"
                    set playItem to menu item 1 of controlMenu
                    set itemName to name of playItem
                    if itemName is in pauseNames then
                        if lastClick is missing value then return "网易云音乐（原本就在播放）"
                        return "网易云音乐当前队列"
                    end if
                    if itemName is not in playNames then error "无法识别网易云音乐的播放菜单：" & itemName
                    -- 冷启动时队列可能还没加载完，第一次点击会被忽略；间隔几秒再补点，避免把刚开始的播放又点成暂停。
                    if enabled of playItem and (lastClick is missing value or ((current date) - lastClick) >= 3) then
                        click playItem
                        set lastClick to current date
                    end if
                on error errMsg number errNum
                    if errNum is -1743 or errNum is -25211 then error errMsg number errNum
                    set lastProblem to errMsg
                end try
                if (current date) > deadline then
                    if lastClick is missing value then error lastProblem
                    error "已发送播放指令，但网易云音乐没有开始播放（播放队列可能为空）"
                end if
                delay 0.2
            end repeat
        end tell
        """
    }

    enum MusicError: LocalizedError {
        case script(String)

        var errorDescription: String? {
            switch self {
            case .script(let message): return message.isEmpty ? "无法控制音乐 App" : message
            }
        }
    }
}
