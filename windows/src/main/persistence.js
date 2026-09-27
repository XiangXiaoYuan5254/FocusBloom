// 本地数据读写，对应 macOS 版的 Persistence.swift。
// 文件格式和 Mac 版一致（ISO 8601 日期、不带毫秒、字段名相同），两边的 focus-data.json 可以互相拷贝。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('../shared/core');

function newId() {
  return crypto.randomUUID().toUpperCase();
}

/// Swift 的 .iso8601 策略不接受小数秒，写出时去掉毫秒。
function toISO(time) {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function intOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

const EVENT_KINDS = ['reminder', 'mindWander', 'fatigue', 'pause', 'resume'];

function sessionFromJSON(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startedAt = parseTime(raw.startedAt);
  const endedAt = parseTime(raw.endedAt);
  if (startedAt === null || endedAt === null) return null;
  const events = (Array.isArray(raw.events) ? raw.events : [])
    .map((event) => {
      const date = parseTime(event && event.date);
      if (date === null || !EVENT_KINDS.includes(event.kind)) return null;
      return {
        id: typeof event.id === 'string' ? event.id : newId(),
        date,
        elapsedSeconds: intOr(event.elapsedSeconds, 0),
        kind: event.kind
      };
    })
    .filter(Boolean);
  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    startedAt,
    endedAt,
    taskName: typeof raw.taskName === 'string' ? raw.taskName : null,
    plannedMinutes: intOr(raw.plannedMinutes, 0),
    focusedSeconds: intOr(raw.focusedSeconds, 0),
    reminderMinimumMinutes: intOr(raw.reminderMinimumMinutes, 3),
    reminderMaximumMinutes: intOr(raw.reminderMaximumMinutes, 5),
    microBreakSeconds: intOr(raw.microBreakSeconds, 10),
    events,
    startEnergy: intOr(raw.startEnergy, 3),
    endEnergy: intOr(raw.endEnergy, 3),
    focusRating: intOr(raw.focusRating, 3),
    completed: Boolean(raw.completed),
    note: typeof raw.note === 'string' ? raw.note : ''
  };
}

function sessionToJSON(session) {
  const json = {
    completed: session.completed,
    endEnergy: session.endEnergy,
    endedAt: toISO(session.endedAt),
    events: session.events.map((event) => ({
      date: toISO(event.date),
      elapsedSeconds: event.elapsedSeconds,
      id: event.id,
      kind: event.kind
    })),
    focusRating: session.focusRating,
    focusedSeconds: session.focusedSeconds,
    id: session.id,
    microBreakSeconds: session.microBreakSeconds,
    note: session.note,
    plannedMinutes: session.plannedMinutes,
    reminderMaximumMinutes: session.reminderMaximumMinutes,
    reminderMinimumMinutes: session.reminderMinimumMinutes,
    startEnergy: session.startEnergy,
    startedAt: toISO(session.startedAt)
  };
  if (session.taskName) json.taskName = session.taskName;
  return json;
}

function settingsToJSON(settings) {
  const json = { ...settings };
  // Swift 用 Optional 表示“没有选择任务”，直接省略这个键。
  if (json.selectedTaskName == null) delete json.selectedTaskName;
  return json;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

function createPersistence(directory) {
  const file = path.join(directory, 'focus-data.json');

  function load() {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return { settings: core.normalizeSettings({}), sessions: [] };
    }
    try {
      const data = JSON.parse(text);
      const sessions = (Array.isArray(data.sessions) ? data.sessions : [])
        .map(sessionFromJSON)
        .filter(Boolean)
        .sort((a, b) => b.startedAt - a.startedAt);
      return { settings: core.normalizeSettings(data.settings), sessions };
    } catch (error) {
      // 读不出来时先把原文件改名留底，再从空数据开始，避免下一次保存把它覆盖掉。
      const backup = path.join(directory, `focus-data.unreadable-${Date.now()}.json`);
      try {
        fs.renameSync(file, backup);
      } catch {}
      console.error(`FocusBloom: 数据文件无法读取，已另存为 ${backup}`, error);
      return { settings: core.normalizeSettings({}), sessions: [] };
    }
  }

  function save(settings, sessions) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      const payload = sortKeys({ settings: settingsToJSON(settings), sessions: sessions.map(sessionToJSON) });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(payload, null, 2));
      fs.renameSync(temporary, file);
    } catch (error) {
      console.error('FocusBloom save failed:', error);
    }
  }

  return { file, directory, load, save };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatCSVDate(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function escapeCSV(text) {
  return `"${String(text).replace(/"/g, '""')}"`;
}

/// 和 Mac 版相同的列；加 UTF-8 BOM 和 CRLF，Windows 上的 Excel 直接双击打开不会乱码。
function buildCSV(sessions) {
  const header = '开始时间,任务,计划分钟,专注分钟,完成,专注评分,开始精力,结束精力,走神次数,疲劳次数,提示次数,备注';
  const rows = [...sessions]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((session) =>
      [
        formatCSVDate(session.startedAt),
        escapeCSV(core.displayTaskName(session)),
        session.plannedMinutes,
        core.focusedMinutes(session),
        session.completed ? '是' : '否',
        session.focusRating,
        session.startEnergy,
        session.endEnergy,
        core.mindWanderCount(session),
        core.fatigueCount(session),
        core.reminderCount(session),
        escapeCSV(session.note)
      ].join(',')
    );
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}

module.exports = { createPersistence, buildCSV, newId, toISO };
