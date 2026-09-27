const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AppStore } = require('../src/main/store');
const { createPersistence, buildCSV } = require('../src/main/persistence');

function makeStore(t, seed) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focusbloom-'));
  if (seed) fs.writeFileSync(path.join(directory, 'focus-data.json'), JSON.stringify(seed));
  const persistence = createPersistence(directory);
  const chimes = [];
  const store = new AppStore({
    persistence,
    playMusic: async () => '测试歌曲 — 测试歌手',
    exportCSV: async () => true
  });
  store.on('chime', (name) => chimes.push(name));
  t.after(() => {
    store.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, persistence, chimes, directory };
}

function advance(t, seconds) {
  // 计时器每 250ms 检查一次，逐步推进才能触发中间的微休息。
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += 250) t.mock.timers.tick(250);
}

test('a full round: micro-break, completion, review saved to disk', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date(2026, 8, 26, 9, 0).getTime() });
  const { store, persistence, chimes } = makeStore(t);
  store.updateSettings({ reminderMinimumMinutes: 1, reminderMaximumMinutes: 1, microBreakSeconds: 5, ambientSounds: ['rain'] });

  store.startSession(3);
  assert.equal(store.runtime.phase, 'focusing');
  assert.equal(store.runtime.isAmbientPlaying, true, 'ambient follows focus');

  advance(t, 60);
  assert.equal(store.runtime.phase, 'microBreak');
  assert.equal(chimes.at(-1), 'Glass');

  advance(t, 5);
  assert.equal(store.runtime.phase, 'focusing');
  store.recordMindWander();

  advance(t, 125);
  assert.equal(store.runtime.phase, 'completed');
  assert.equal(store.runtime.showCompletionSheet, true);
  assert.equal(store.runtime.isAmbientPlaying, false);
  assert.equal(chimes.at(-1), 'Hero');
  assert.equal(store.runtime.focusedElapsedSeconds, 180, 'micro-break does not count towards focus time');

  store.saveCompletion({ focusRating: 5, endEnergy: 2, note: '后半程更费力' });
  assert.equal(store.runtime.phase, 'idle');
  const saved = persistence.load().sessions;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].completed, true);
  assert.equal(saved[0].focusRating, 5);
  assert.deepEqual(
    saved[0].events.map((event) => event.kind),
    ['reminder', 'mindWander', 'reminder']
  );
});

test('pausing stops the clock and the ambient sound', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.now() });
  const { store } = makeStore(t);
  store.updateSettings({ reminderMinimumMinutes: 60, reminderMaximumMinutes: 60, ambientSounds: ['rain'] });
  store.startSession(10);
  advance(t, 30);
  store.togglePause();
  const remaining = store.runtime.remainingSeconds;
  assert.equal(store.runtime.isAmbientPlaying, false);
  advance(t, 120);
  assert.equal(store.runtime.remainingSeconds, remaining);
  store.togglePause();
  advance(t, 10);
  assert.equal(store.runtime.remainingSeconds, remaining - 10);
});

test('ending early keeps partial time; abandoning keeps nothing', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.now() });
  const { store } = makeStore(t);
  store.updateSettings({ reminderMinimumMinutes: 60, reminderMaximumMinutes: 60 });

  store.startSession(30);
  advance(t, 90);
  store.stopSessionEarly();
  store.saveCompletion({ focusRating: 3, endEnergy: 3, note: '' });
  assert.equal(store.sessions[0].completed, false);
  assert.equal(store.sessions[0].focusedSeconds, 90);

  store.startSession(30);
  advance(t, 90);
  store.abandonSession();
  assert.equal(store.sessions.length, 1);
  assert.equal(store.runtime.phase, 'idle');
});

test('tasks are locked during a round and recorded on the session', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.now() });
  const { store } = makeStore(t);
  assert.equal(store.addTask('力扣'), true);
  assert.equal(store.addTask('力扣 '), true, 'duplicate selects the existing task');
  assert.deepEqual(store.settings.taskNames, ['力扣']);
  store.startSession(5);
  assert.equal(store.addTask('AI 学习'), false);
  store.selectTask(null);
  assert.equal(store.settings.selectedTaskName, '力扣');
  store.stopSessionEarly();
  store.saveCompletion({});
  assert.equal(store.sessions[0].taskName, '力扣');
});

test('auto-play music reports the track in the completion sheet', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.now() });
  const { store } = makeStore(t);
  store.updateSettings({ autoPlayMusic: true });
  store.startSession(1);
  advance(t, 61);
  assert.equal(store.runtime.phase, 'completed');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.runtime.musicMessage, '正在播放：测试歌曲 — 测试歌手');
});

test('data files use Mac-compatible ISO dates and keep Mac-only settings', (t) => {
  const seed = {
    settings: { selectedDurationMinutes: 45, musicService: '网易云音乐', musicSource: '指定播放列表', playlistName: '学习' },
    sessions: [
      {
        id: 'AAAA',
        startedAt: '2026-09-20T01:02:03Z',
        endedAt: '2026-09-20T01:47:03Z',
        taskName: '阅读',
        plannedMinutes: 45,
        focusedSeconds: 2700,
        reminderMinimumMinutes: 3,
        reminderMaximumMinutes: 5,
        microBreakSeconds: 10,
        events: [{ id: 'E1', date: '2026-09-20T01:10:00Z', elapsedSeconds: 480, kind: 'mindWander' }],
        startEnergy: 4,
        endEnergy: 3,
        focusRating: 4,
        completed: true,
        note: '备注'
      }
    ]
  };
  const { store, directory } = makeStore(t, seed);
  store.saveNow();
  const written = JSON.parse(fs.readFileSync(path.join(directory, 'focus-data.json'), 'utf8'));
  assert.equal(written.sessions[0].startedAt, '2026-09-20T01:02:03Z');
  assert.equal(written.sessions[0].events[0].date, '2026-09-20T01:10:00Z');
  assert.equal(written.settings.musicService, '网易云音乐');
  assert.equal(written.settings.playlistName, '学习');
  assert.equal('selectedTaskName' in written.settings, false, 'nil optionals are omitted like Swift');
});

test('an unreadable data file is set aside instead of being overwritten', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focusbloom-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'focus-data.json'), '{ broken');
  const data = createPersistence(directory).load();
  assert.equal(data.sessions.length, 0);
  assert.ok(fs.readdirSync(directory).some((name) => name.startsWith('focus-data.unreadable-')));
});

test('CSV export opens cleanly in Excel (BOM, CRLF, quoted text)', () => {
  const csv = buildCSV([
    {
      startedAt: new Date(2026, 8, 20, 9, 5, 0).getTime(),
      taskName: '读"书"',
      plannedMinutes: 30,
      focusedSeconds: 1800,
      events: [{ kind: 'mindWander' }, { kind: 'reminder' }],
      startEnergy: 4,
      endEnergy: 3,
      focusRating: 4,
      completed: true,
      note: '第一行,含逗号'
    }
  ]);
  assert.ok(csv.startsWith('﻿开始时间,任务'));
  assert.ok(csv.includes('\r\n2026-09-20 09:05:00,"读""书""",30,30,是,4,4,3,1,0,1,"第一行,含逗号"\r\n'));
});
