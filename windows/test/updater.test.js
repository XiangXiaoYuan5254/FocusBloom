const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Updater } = require('../src/main/updater');

// 代替 electron-updater 的 autoUpdater：记录调用，由测试发出事件。
class FakeAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.installs = [];
  }

  checkForUpdates() {
    this.checks += 1;
    return Promise.resolve(null);
  }

  quitAndInstall(...args) {
    this.installs.push(args);
  }
}

function makeUpdater({ canInstall = true, enabled = true } = {}) {
  const autoUpdater = new FakeAutoUpdater();
  const settings = { autoCheckUpdates: enabled };
  const updater = new Updater({ autoUpdater, canInstall, isEnabled: () => settings.autoCheckUpdates });
  const states = [];
  updater.on('change', (state) => states.push(state));
  return { autoUpdater, updater, settings, states };
}

test('安装版在后台下载，下载好后可以静默安装并重新打开', () => {
  const { autoUpdater, updater, states } = makeUpdater();
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);

  updater.check();
  assert.equal(autoUpdater.checks, 1);
  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('update-available', { version: '1.2.0' });
  autoUpdater.emit('download-progress', { percent: 42.7 });
  assert.deepEqual(
    { status: updater.state.status, version: updater.state.version, percent: updater.state.percent },
    { status: 'downloading', version: '1.2.0', percent: 42 }
  );

  autoUpdater.emit('update-downloaded', { version: '1.2.0' });
  assert.equal(updater.state.status, 'downloaded');
  assert.deepEqual(
    states.map((state) => state.status),
    ['checking', 'downloading', 'downloading', 'downloaded']
  );

  // 已经下载好了，定时检查不再重复下载。
  updater.check();
  assert.equal(autoUpdater.checks, 1);

  updater.install();
  assert.deepEqual(autoUpdater.installs, [[true, true]]);
});

test('免安装版只提醒，不下载也不在退出时安装', () => {
  const { autoUpdater, updater } = makeUpdater({ canInstall: false });
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);

  updater.check();
  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('update-available', { version: '1.2.0' });
  assert.equal(updater.state.status, 'available');
  assert.equal(updater.state.canInstall, false);

  updater.install();
  assert.deepEqual(autoUpdater.installs, []);
});

test('关闭自动检查后只响应手动检查', () => {
  const { autoUpdater, updater, settings } = makeUpdater({ enabled: false });
  updater.check();
  assert.equal(autoUpdater.checks, 0);
  updater.check({ manual: true });
  assert.equal(autoUpdater.checks, 1);

  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('update-not-available', { version: '1.1.0' });
  assert.equal(updater.state.status, 'latest');

  settings.autoCheckUpdates = true;
  updater.check();
  assert.equal(autoUpdater.checks, 2);
});

test('检查或下载失败时给出能看懂的提示，之后还能重试', () => {
  const { autoUpdater, updater } = makeUpdater();
  const original = console.error;
  console.error = () => {};
  try {
    updater.check({ manual: true });
    autoUpdater.emit('checking-for-update');
    autoUpdater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    assert.equal(updater.state.status, 'error');
    assert.equal(updater.state.message, '检查更新失败，请检查网络后重试。');

    updater.check({ manual: true });
    autoUpdater.emit('checking-for-update');
    autoUpdater.emit('update-available', { version: '1.2.0' });
    autoUpdater.emit('error', new Error('sha512 checksum mismatch'));
    assert.equal(updater.state.message, '新版本下载失败，稍后会自动重试。');
    assert.equal(autoUpdater.checks, 2);
  } finally {
    console.error = original;
  }
});

test('正在检查时不会重复发起检查', () => {
  const { autoUpdater, updater } = makeUpdater();
  updater.check({ manual: true });
  autoUpdater.emit('checking-for-update');
  updater.check({ manual: true });
  assert.equal(autoUpdater.checks, 1);
});
