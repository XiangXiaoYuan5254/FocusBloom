// 自动更新（对应 macOS 版的 Sparkle）：从 GitHub Release 检查新版本。
// 安装版在后台下载好新版本，退出时自动安装，也可以点“重启并更新”立即安装；
// 免安装版（zip 解压）没法替换自己，只提醒去下载页。
const { EventEmitter } = require('events');

// 启动后稍等再检查，不和窗口加载抢时间；常驻托盘时每 6 小时再看一次。
const FIRST_CHECK_DELAY = 15 * 1000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

class Updater extends EventEmitter {
  /**
   * @param {object} options
   * @param {import('electron-updater').AppUpdater} options.autoUpdater
   * @param {boolean} options.canInstall 安装版为 true；免安装版为 false，只检查不下载
   * @param {() => boolean} options.isEnabled 是否打开了“自动检查更新”，手动检查不受影响
   */
  constructor({ autoUpdater, canInstall, isEnabled }) {
    super();
    this.autoUpdater = autoUpdater;
    this.isEnabled = isEnabled;
    this.timers = [];
    // status: idle → checking → latest / downloading → downloaded（免安装版是 available），出错时是 error
    this.state = { status: 'idle', version: null, percent: 0, canInstall, message: null };

    autoUpdater.autoDownload = canInstall;
    autoUpdater.autoInstallOnAppQuit = canInstall;

    autoUpdater.on('checking-for-update', () => {
      this.set({ status: 'checking', message: null });
    });
    autoUpdater.on('update-not-available', () => {
      this.set({ status: 'latest', version: null, percent: 0 });
    });
    autoUpdater.on('update-available', (info) => {
      this.set({ status: canInstall ? 'downloading' : 'available', version: info.version, percent: 0 });
    });
    autoUpdater.on('download-progress', (progress) => {
      this.set({ status: 'downloading', percent: Math.floor(progress.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'downloaded', version: info.version, percent: 100 });
    });
    autoUpdater.on('error', (error) => {
      console.error('FocusBloom update failed:', error);
      const message =
        this.state.status === 'downloading' ? '新版本下载失败，稍后会自动重试。' : '检查更新失败，请检查网络后重试。';
      this.set({ status: 'error', message });
    });
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  start() {
    this.timers.push(
      setTimeout(() => {
        this.check();
        this.timers.push(setInterval(() => this.check(), CHECK_INTERVAL));
      }, FIRST_CHECK_DELAY)
    );
  }

  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  check({ manual = false } = {}) {
    const { status } = this.state;
    if (status === 'checking' || status === 'downloading' || status === 'downloaded') return;
    if (!manual && !this.isEnabled()) return;
    // 失败时 electron-updater 会同时发出 error 事件，已经在上面处理。
    this.autoUpdater.checkForUpdates().catch(() => {});
  }

  install() {
    if (this.state.status !== 'downloaded') return;
    // 静默安装到原来的位置，装完自动重新打开专注芽。
    this.autoUpdater.quitAndInstall(true, true);
  }
}

module.exports = { Updater };
