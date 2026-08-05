import SwiftUI

struct HistoryView: View {
    @EnvironmentObject private var store: AppStore
    @State private var sessionToDelete: StudySession?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .bottom) {
                    SectionHeading(
                        eyebrow: "Focus Journal",
                        title: "每一轮，都是一条线索",
                        subtitle: "记录不是监督，而是帮你找到更适合自己的节律。"
                    )
                    Spacer()
                    Button {
                        store.exportCSV()
                    } label: {
                        Label("导出 CSV", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(BloomSecondaryButtonStyle())
                }

                if store.sessions.isEmpty {
                    emptyState
                } else {
                    HStack(spacing: 14) {
                        summaryMetric(value: "\(store.sessions.count)", label: "总轮次", symbol: "circle.grid.2x2.fill")
                        summaryMetric(
                            value: "\(store.sessions.reduce(0) { $0 + $1.focusedMinutes })",
                            label: "累计分钟",
                            symbol: "clock.fill"
                        )
                        summaryMetric(
                            value: String(format: "%.1f", averageFocus),
                            label: "平均专注评分",
                            symbol: "sparkles"
                        )
                    }

                    LazyVStack(spacing: 12) {
                        ForEach(store.sessions) { session in
                            sessionRow(session)
                                .contextMenu {
                                    Button("删除这条记录", role: .destructive) {
                                        sessionToDelete = session
                                    }
                                }
                        }
                    }
                }
            }
            .padding(.horizontal, 30)
            .padding(.top, 34)
            .padding(.bottom, 34)
        }
        .alert("删除这条专注记录？", isPresented: Binding(
            get: { sessionToDelete != nil },
            set: { if !$0 { sessionToDelete = nil } }
        )) {
            Button("取消", role: .cancel) { sessionToDelete = nil }
            Button("删除", role: .destructive) {
                if let sessionToDelete {
                    store.removeSession(sessionToDelete)
                }
                sessionToDelete = nil
            }
        } message: {
            Text("删除后无法恢复。")
        }
    }

    private var averageFocus: Double {
        guard !store.sessions.isEmpty else { return 0 }
        return Double(store.sessions.reduce(0) { $0 + $1.focusRating }) / Double(store.sessions.count)
    }

    private func summaryMetric(value: String, label: String, symbol: String) -> some View {
        HStack(spacing: 13) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(BloomTheme.mint)
                .frame(width: 38, height: 38)
                .background(BloomTheme.mint.opacity(0.1))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(BloomTheme.primaryText)
                Text(label)
                    .font(.system(size: 10))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .bloomCard(padding: 15)
    }

    private func sessionRow(_ session: StudySession) -> some View {
        HStack(spacing: 18) {
            VStack(spacing: 4) {
                Text(dayFormatter.string(from: session.startedAt))
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(BloomTheme.primaryText)
                Text(monthFormatter.string(from: session.startedAt))
                    .font(.system(size: 9, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(BloomTheme.secondaryText)
            }
            .frame(width: 52)

            RoundedRectangle(cornerRadius: 2)
                .fill(session.completed ? BloomTheme.mint : BloomTheme.amber)
                .frame(width: 4, height: 52)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text("\(session.focusedMinutes) 分钟专注")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(BloomTheme.primaryText)
                    Label(session.displayTaskName, systemImage: "tag.fill")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(
                            session.displayTaskName == "未分类"
                                ? BloomTheme.secondaryText
                                : BloomTheme.blue
                        )
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(
                            (
                                session.displayTaskName == "未分类"
                                    ? BloomTheme.secondaryText
                                    : BloomTheme.blue
                            )
                            .opacity(0.09)
                        )
                        .clipShape(Capsule())
                        .lineLimit(1)
                        .frame(maxWidth: 120)
                    Text(session.completed ? "已完成" : "提前结束")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(session.completed ? BloomTheme.mint : BloomTheme.amber)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background((session.completed ? BloomTheme.mint : BloomTheme.amber).opacity(0.1))
                        .clipShape(Capsule())
                }
                Text(session.note.isEmpty ? "没有写本轮备注" : session.note)
                    .font(.system(size: 10))
                    .foregroundStyle(BloomTheme.secondaryText)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            sessionMetric(value: "\(session.focusRating)/5", label: "专注")
            sessionMetric(value: "\(session.mindWanderCount)", label: "走神")
            sessionMetric(value: "\(session.startEnergy)→\(session.endEnergy)", label: "精力")
            sessionMetric(value: "\(session.reminderMinimumMinutes)–\(session.reminderMaximumMinutes)", label: "提示/分")

            Text(timeFormatter.string(from: session.startedAt))
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(BloomTheme.secondaryText)
                .frame(width: 48)
        }
        .padding(.horizontal, 18)
        .frame(minHeight: 84)
        .background(BloomTheme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 18).stroke(BloomTheme.hairline) }
    }

    private func sessionMetric(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(BloomTheme.primaryText)
            Text(label)
                .font(.system(size: 8, weight: .medium))
                .foregroundStyle(BloomTheme.secondaryText)
        }
        .frame(width: 54, alignment: .leading)
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle().fill(BloomTheme.mint.opacity(0.1))
                Image(systemName: "leaf")
                    .font(.system(size: 30))
                    .foregroundStyle(BloomTheme.mint)
            }
            .frame(width: 76, height: 76)
            Text("还没有专注记录")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(BloomTheme.primaryText)
            Text("完成第一轮后，时长、走神、精力和复盘会出现在这里。")
                .font(.system(size: 12))
                .foregroundStyle(BloomTheme.secondaryText)
            Button("去开始第一轮") {
                store.selectedSection = .focus
            }
            .buttonStyle(BloomPrimaryButtonStyle())
        }
        .frame(maxWidth: .infinity, minHeight: 430)
        .bloomCard()
    }

    private var dayFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = "dd"
        return formatter
    }

    private var monthFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "MMM"
        return formatter
    }

    private var timeFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }
}
