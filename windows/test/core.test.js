const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/shared/core');

const MINUTE = 60 * 1000;

function session(overrides = {}) {
  return {
    id: 'X',
    startedAt: Date.now(),
    endedAt: Date.now(),
    taskName: null,
    plannedMinutes: 30,
    focusedSeconds: 30 * 60,
    reminderMinimumMinutes: 3,
    reminderMaximumMinutes: 5,
    microBreakSeconds: 10,
    events: [],
    startEnergy: 4,
    endEnergy: 3,
    focusRating: 4,
    completed: true,
    note: '',
    ...overrides
  };
}

test('normalizeSettings clamps ranges like the Mac app', () => {
  const settings = core.normalizeSettings({
    reminderMinimumMinutes: 80,
    reminderMaximumMinutes: 2,
    microBreakSeconds: 1,
    selectedDurationMinutes: 5000
  });
  assert.equal(settings.reminderMinimumMinutes, 60);
  assert.equal(settings.reminderMaximumMinutes, 60);
  assert.equal(settings.microBreakSeconds, 5);
  assert.equal(settings.selectedDurationMinutes, 1440);
});

test('normalizeSettings dedups tasks case-insensitively and drops invalid selections', () => {
  const settings = core.normalizeSettings({
    taskNames: ['  力扣 ', 'AI 学习', 'ai 学习', '', 'x'.repeat(60)],
    selectedTaskName: '不存在'
  });
  assert.deepEqual(settings.taskNames, ['力扣', 'AI 学习', 'x'.repeat(40)]);
  assert.equal(settings.selectedTaskName, null);
});

test('normalizeSettings keeps Mac-only and unknown keys for round-tripping', () => {
  const settings = core.normalizeSettings({ musicService: '网易云音乐', musicSource: '指定播放列表', futureKey: 1 });
  assert.equal(settings.musicService, '网易云音乐');
  assert.equal(settings.musicSource, '指定播放列表');
  assert.equal(settings.futureKey, 1);
  assert.equal(settings.musicPlayer, 'netease');
});

test('ambient levels square the slider values and silence unselected sounds', () => {
  const levels = core.ambientLevels(
    core.normalizeSettings({ ambientSounds: ['rain', 'nope'], ambientVolumes: { rain: 0.5 }, ambientMasterVolume: 0.8 })
  );
  assert.equal(levels.sounds.rain, 0.25);
  assert.equal(levels.sounds.waves, 0);
  assert.ok(Math.abs(levels.master - 0.64) < 1e-9);
});

test('attention capacity uses the median of recent spans', () => {
  const sessions = [
    session({ events: [{ kind: 'mindWander', elapsedSeconds: 25 * 60 }] }),
    session({ focusedSeconds: 50 * 60, focusRating: 5 }),
    session({ focusedSeconds: 40 * 60, focusRating: 2 })
  ];
  // spans: 25, 50, 30 -> sorted 25, 30, 50 -> median 30
  assert.equal(core.attentionCapacityMinutes(sessions), 30);
  assert.equal(core.attentionCapacityMinutes([]), 30);
});

test('recommendation adds five minutes only after three strong rounds', () => {
  const strong = [session(), session(), session()];
  assert.equal(core.recommendedMinutes(strong), 35);
  const weak = [session({ focusRating: 3 }), session(), session()];
  assert.equal(core.recommendedMinutes(weak), 30);
  assert.equal(core.recommendedMinutes([session()]), 30);
});

test('streak counts back from today, or from yesterday when today is empty', () => {
  const now = new Date(2026, 8, 26, 20, 0).getTime();
  const day = (offset) => core.addDays(core.startOfDay(now), -offset) + 9 * 60 * MINUTE;
  assert.equal(core.streakDays([session({ startedAt: day(0) }), session({ startedAt: day(1) }), session({ startedAt: day(3) })], now), 2);
  assert.equal(core.streakDays([session({ startedAt: day(1) }), session({ startedAt: day(2) })], now), 2);
  assert.equal(core.streakDays([session({ startedAt: day(2) })], now), 0);
});

test('weekly summaries cover seven days ending today', () => {
  const now = new Date(2026, 8, 26, 20, 0).getTime();
  const days = core.weeklySummaries([session({ startedAt: now - 60 * MINUTE, focusedSeconds: 25 * 60 })], now);
  assert.equal(days.length, 7);
  assert.equal(days[6].date, core.startOfDay(now));
  assert.equal(days[6].minutes, 25);
  assert.equal(days[0].minutes, 0);
});

test('task summaries group uncategorized sessions and sort by minutes', () => {
  const summaries = core.taskSummaries([
    session({ taskName: '力扣', focusedSeconds: 20 * 60 }),
    session({ taskName: null, focusedSeconds: 50 * 60, focusRating: 2 }),
    session({ taskName: '力扣', focusedSeconds: 40 * 60 })
  ]);
  assert.deepEqual(
    summaries.map((summary) => [summary.name, summary.focusedMinutes, summary.sessions]),
    [
      ['力扣', 60, 2],
      ['未分类', 50, 1]
    ]
  );
});

test('clock formatting pads minutes and seconds', () => {
  assert.equal(core.formatClock(0), '00:00');
  assert.equal(core.formatClock(65), '01:05');
  assert.equal(core.formatClock(90 * 60), '90:00');
});
