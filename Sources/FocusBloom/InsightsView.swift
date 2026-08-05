import Charts
import SwiftUI

struct InsightsView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .bottom) {
                    SectionHeading(
                        eyebrow: "Attention Lab",
                        title: "看见你的注意力节律",
                        subtitle: "用趋势做调整，不用某一次状态定义自己。"
                    )
                    Spacer()
                    Text("基于最近 \(min(12, store.sessions.count)) 轮")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(BloomTheme.secondaryText)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(BloomTheme.surface(0.05))
                        .clipShape(Capsule())
                }

                HStack(spacing: 14) {
                    insightMetric(
                        symbol: "brain.head.profile",
                        value: "\(store.attentionCapacityMinutes) 分钟",
                        label: "当前稳定专注估计",
                        footnote: "走神前时长的中位估计",
                        tint: BloomTheme.mint
                    )
                    insightMetric(
                        symbol: "arrow.up.forward",
                        value: "\(store.recommendedMinutes) 分钟",
                        label: "下一轮建议",
                        footnote: "连续稳定后每次只加 5 分钟",
                        tint: BloomTheme.blue
                    )
                    insightMetric(
                        symbol: "scope",
                        value: wanderRateText,
                        label: "平均走神率",
                        footnote: "每小时主动记录次数",
                        tint: BloomTheme.coral
                    )
                    insightMetric(
                        symbol: "bolt.heart",
                        value: energyDropText,
                        label: "平均精力变化",
                        footnote: "开始与结束的主观差值",
                        tint: BloomTheme.amber
                    )
                }

                HStack(alignment: .top, spacing: 16) {
                    weeklyChart
                        .frame(maxWidth: .infinity)
                    trainingPlan
                        .frame(width: 330)
                }

                taskBreakdown

                HStack(alignment: .top, spacing: 16) {
                    qualityTrend
                        .frame(maxWidth: .infinity)
                    interpretationCard
                        .frame(width: 330)
                }
            }
            .padding(.horizontal, 30)
            .padding(.top, 34)
            .padding(.bottom, 34)
        }
    }

    private var completedSessions: [StudySession] {
        store.sessions.filter { $0.focusedSeconds > 0 }
    }

    private var wanderRateText: String {
        let minutes = completedSessions.reduce(0) { $0 + $1.focusedMinutes }
        let wanders = completedSessions.reduce(0) { $0 + $1.mindWanderCount }
        guard minutes > 0 else { return "—" }
        return String(format: "%.1f 次/时", Double(wanders) / Double(minutes) * 60)
    }

    private var energyDropText: String {
        guard !completedSessions.isEmpty else { return "—" }
        let delta = completedSessions.reduce(0) { $0 + ($1.endEnergy - $1.startEnergy) }
        let average = Double(delta) / Double(completedSessions.count)
        return String(format: "%+.1f 格", average)
    }

    private func insightMetric(
        symbol: String,
        value: String,
        label: String,
        footnote: String,
        tint: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(tint)
                Spacer()
                Circle().fill(tint).frame(width: 6, height: 6)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(value)
                    .font(.system(size: 23, weight: .bold, design: .rounded))
                    .foregroundStyle(BloomTheme.primaryText)
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BloomTheme.primaryText.opacity(0.82))
            }
            Text(footnote)
                .font(.system(size: 9))
                .foregroundStyle(BloomTheme.secondaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .bloomCard(padding: 17)
    }

    private var weeklyChart: some View {
        VStack(alignment: .leading, spacing: 18) {
            chartHeader(title: "最近 7 天", subtitle: "净专注分钟", symbol: "calendar")
            Chart(store.weeklySummaries) { day in
                BarMark(
                    x: .value("日期", day.date, unit: .day),
                    y: .value("分钟", day.minutes)
                )
                .foregroundStyle(
                    LinearGradient(
                        colors: [BloomTheme.mint, BloomTheme.mint.opacity(0.42)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .cornerRadius(6)
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { value in
                    AxisValueLabel(format: .dateTime.weekday(.narrow))
                        .foregroundStyle(BloomTheme.secondaryText)
                    AxisGridLine().foregroundStyle(.clear)
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) {
                    AxisGridLine().foregroundStyle(BloomTheme.surface(0.055))
                    AxisValueLabel().foregroundStyle(BloomTheme.secondaryText)
                }
            }
            .frame(height: 190)
        }
        .bloomCard(padding: 20)
    }

    private var qualityTrend: some View {
        let values = Array(store.sessions.prefix(10).reversed())
        return VStack(alignment: .leading, spacing: 18) {
            chartHeader(title: "专注质量趋势", subtitle: "每轮复盘评分（1–5）", symbol: "waveform.path.ecg")
            if values.isEmpty {
                emptyChart
            } else {
                Chart(Array(values.enumerated()), id: \.element.id) { index, session in
                    LineMark(
                        x: .value("轮次", index + 1),
                        y: .value("评分", session.focusRating)
                    )
                    .foregroundStyle(BloomTheme.blue)
                    .interpolationMethod(.catmullRom)
                    PointMark(
                        x: .value("轮次", index + 1),
                        y: .value("评分", session.focusRating)
                    )
                    .foregroundStyle(BloomTheme.blue)
                    .symbolSize(35)
                }
                .chartYScale(domain: 1...5)
                .chartXAxis {
                    AxisMarks { value in
                        AxisGridLine().foregroundStyle(.clear)
                        AxisValueLabel().foregroundStyle(BloomTheme.secondaryText)
                    }
                }
                .chartYAxis {
                    AxisMarks(values: [1, 2, 3, 4, 5]) {
                        AxisGridLine().foregroundStyle(BloomTheme.surface(0.055))
                        AxisValueLabel().foregroundStyle(BloomTheme.secondaryText)
                    }
                }
                .frame(height: 180)
            }
        }
        .bloomCard(padding: 20)
    }

    private var taskBreakdown: some View {
        let summaries = Array(store.taskSummaries.prefix(8))
        let maximumMinutes = max(1, summaries.map(\.focusedMinutes).max() ?? 1)

        return VStack(alignment: .leading, spacing: 17) {
            chartHeader(
                title: "任务专注分布",
                subtitle: "按任务汇总全部专注记录；已从任务列表移除的历史任务仍会保留",
                symbol: "tag.fill"
            )

            if summaries.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "tag")
                        .font(.system(size: 24))
                        .foregroundStyle(BloomTheme.secondaryText.opacity(0.5))
                    Text("完成一轮后，这里会出现任务统计")
                        .font(.system(size: 11))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
                .frame(maxWidth: .infinity, minHeight: 96)
            } else {
                HStack {
                    Text("任务")
                        .frame(width: 130, alignment: .leading)
                    Text("专注占比")
                    Spacer()
                    Text("分钟")
                        .frame(width: 52, alignment: .trailing)
                    Text("轮次")
                        .frame(width: 45, alignment: .trailing)
                    Text("评分")
                        .frame(width: 48, alignment: .trailing)
                }
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(BloomTheme.secondaryText)

                VStack(spacing: 10) {
                    ForEach(summaries) { summary in
                        HStack(spacing: 12) {
                            HStack(spacing: 7) {
                                Image(systemName: "tag.fill")
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundStyle(
                                        summary.name == "未分类"
                                            ? BloomTheme.secondaryText
                                            : BloomTheme.blue
                                    )
                                Text(summary.name)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(BloomTheme.primaryText)
                                    .lineLimit(1)
                            }
                            .frame(width: 130, alignment: .leading)

                            ProgressView(
                                value: Double(summary.focusedMinutes),
                                total: Double(maximumMinutes)
                            )
                            .progressViewStyle(.linear)
                            .tint(summary.name == "未分类" ? BloomTheme.secondaryText : BloomTheme.mint)

                            Text("\(summary.focusedMinutes)")
                                .frame(width: 52, alignment: .trailing)
                            Text("\(summary.sessions)")
                                .frame(width: 45, alignment: .trailing)
                            Text(String(format: "%.1f", summary.averageFocus))
                                .frame(width: 48, alignment: .trailing)
                        }
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(BloomTheme.secondaryText)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(BloomTheme.surface(0.035))
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    }
                }

                if store.taskSummaries.count > summaries.count {
                    Text("仅显示专注分钟最多的前 \(summaries.count) 个任务。")
                        .font(.system(size: 9))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
            }
        }
        .bloomCard(padding: 20)
    }

    private var trainingPlan: some View {
        VStack(alignment: .leading, spacing: 17) {
            chartHeader(title: "渐进训练", subtitle: "下一阶段", symbol: "figure.stairs")

            ZStack {
                Circle()
                    .stroke(BloomTheme.surface(0.06), lineWidth: 12)
                Circle()
                    .trim(from: 0, to: min(1, Double(store.attentionCapacityMinutes) / 120.0))
                    .stroke(BloomTheme.mint, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 2) {
                    Text("\(store.recommendedMinutes)")
                        .font(.system(size: 31, weight: .bold, design: .rounded))
                        .foregroundStyle(BloomTheme.primaryText)
                    Text("分钟")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(BloomTheme.secondaryText)
                }
            }
            .frame(width: 128, height: 128)
            .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 9) {
                planRow(symbol: "1.circle.fill", text: "先稳定完成建议时长")
                planRow(symbol: "2.circle.fill", text: "连续 3 轮：评分 ≥ 4、走神 ≤ 1")
                planRow(symbol: "3.circle.fill", text: "下一轮增加 5 分钟")
            }

            Button("把建议用于下一轮") {
                store.settings.selectedDurationMinutes = store.recommendedMinutes
                store.selectedSection = .focus
            }
            .buttonStyle(BloomSecondaryButtonStyle())
            .frame(maxWidth: .infinity)
        }
        .bloomCard(padding: 20, strong: true)
    }

    private var interpretationCard: some View {
        VStack(alignment: .leading, spacing: 15) {
            chartHeader(title: "怎么读这些数据", subtitle: "重要的不是越久越好", symbol: "text.magnifyingglass")

            interpretation(
                tint: BloomTheme.mint,
                title: "稳定区",
                text: "评分稳定、走神率下降、结束时仍有余力。可以小幅增加时长。"
            )
            interpretation(
                tint: BloomTheme.amber,
                title: "训练边缘",
                text: "后半程更费力，但仍能完成且次日状态正常。先保持，不急着加量。"
            )
            interpretation(
                tint: BloomTheme.coral,
                title: "恢复信号",
                text: "走神突然变多、精力连续下降或烦躁，优先检查睡眠、压力与任务难度。"
            )

            Text("这里是个人训练记录，不是医学诊断。若注意力变化持续影响生活，值得咨询专业人士。")
                .font(.system(size: 9))
                .foregroundStyle(BloomTheme.secondaryText.opacity(0.75))
                .fixedSize(horizontal: false, vertical: true)
        }
        .bloomCard(padding: 20)
    }

    private var emptyChart: some View {
        VStack(spacing: 8) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 25))
                .foregroundStyle(BloomTheme.secondaryText.opacity(0.5))
            Text("完成第一轮后，这里会出现趋势")
                .font(.system(size: 11))
                .foregroundStyle(BloomTheme.secondaryText)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
    }

    private func chartHeader(title: String, subtitle: String, symbol: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(BloomTheme.primaryText)
                Text(subtitle)
                    .font(.system(size: 10))
                    .foregroundStyle(BloomTheme.secondaryText)
            }
            Spacer()
            Image(systemName: symbol)
                .foregroundStyle(BloomTheme.mint)
        }
    }

    private func planRow(symbol: String, text: String) -> some View {
        HStack(spacing: 9) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BloomTheme.mint)
            Text(text)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(BloomTheme.secondaryText)
        }
    }

    private func interpretation(tint: Color, title: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 11) {
            RoundedRectangle(cornerRadius: 2)
                .fill(tint)
                .frame(width: 4, height: 33)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(BloomTheme.primaryText)
                Text(text)
                    .font(.system(size: 9))
                    .foregroundStyle(BloomTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
