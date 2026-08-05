import Foundation

enum MusicController {
    static func playRandom(
        source: MusicSource,
        playlistName: String,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        let script = appleScript(source: source, playlistName: playlistName)

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
                    let message = String(data: data, encoding: .utf8)?
                        .trimmingCharacters(in: .whitespacesAndNewlines) ?? "无法控制“音乐”App"
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

    private static func appleScript(source: MusicSource, playlistName: String) -> String {
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

    enum MusicError: LocalizedError {
        case script(String)

        var errorDescription: String? {
            switch self {
            case .script(let message): return message
            }
        }
    }
}
