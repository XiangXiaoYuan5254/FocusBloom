import AppKit
import Foundation

enum Persistence {
    private static var appDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("FocusBloom", isDirectory: true)
    }

    private static var dataURL: URL {
        appDirectory.appendingPathComponent("focus-data.json")
    }

    static func load() -> PersistedData {
        guard
            let data = try? Data(contentsOf: dataURL),
            let decoded = try? JSONDecoder.focusBloom.decode(PersistedData.self, from: data)
        else {
            return PersistedData(settings: AppSettings(), sessions: [])
        }
        return decoded
    }

    static func save(settings: AppSettings, sessions: [StudySession]) {
        do {
            try FileManager.default.createDirectory(at: appDirectory, withIntermediateDirectories: true)
            let data = try JSONEncoder.focusBloom.encode(PersistedData(settings: settings, sessions: sessions))
            try data.write(to: dataURL, options: .atomic)
        } catch {
            NSLog("FocusBloom save failed: \(error.localizedDescription)")
        }
    }

    static func exportCSV(sessions: [StudySession]) -> Bool {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "专注芽-专注记录.csv"
        panel.allowedContentTypes = [.commaSeparatedText]
        guard panel.runModal() == .OK, let url = panel.url else { return false }

        let header = "开始时间,任务,计划分钟,专注分钟,完成,专注评分,开始精力,结束精力,走神次数,疲劳次数,提示次数,备注\n"
        let rows = sessions.sorted(by: { $0.startedAt < $1.startedAt }).map { session in
            [
                CSV.dateFormatter.string(from: session.startedAt),
                CSV.escape(session.displayTaskName),
                "\(session.plannedMinutes)",
                "\(session.focusedMinutes)",
                session.completed ? "是" : "否",
                "\(session.focusRating)",
                "\(session.startEnergy)",
                "\(session.endEnergy)",
                "\(session.mindWanderCount)",
                "\(session.fatigueCount)",
                "\(session.reminderCount)",
                CSV.escape(session.note)
            ].joined(separator: ",")
        }

        do {
            try (header + rows.joined(separator: "\n")).write(to: url, atomically: true, encoding: .utf8)
            return true
        } catch {
            return false
        }
    }
}

private enum CSV {
    static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()

    static func escape(_ text: String) -> String {
        "\"\(text.replacingOccurrences(of: "\"", with: "\"\""))\""
    }
}

extension JSONEncoder {
    static var focusBloom: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

extension JSONDecoder {
    static var focusBloom: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
