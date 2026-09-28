// 专注芽 Windows 版的主进程：主窗口、最小化后的悬浮计时、任务栏通知区域（托盘）菜单。
// 对应 macOS 版的 FocusBloomApp.swift（WindowGroup + 悬浮 Window + MenuBarExtra）。
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  shell
} = require('electron');
const fs = require('fs');
const path = require('path');
const core = require('../shared/core');
const { AppStore } = require('./store');
const { createPersistence, buildCSV } = require('./persistence');
const music = require('./music');
const { Updater } = require('./updater');

const ROOT = path.join(__dirname, '..', '..');
const IS_WINDOWS = process.platform === 'win32';
const APP_ID = 'com.local.FocusBloom';
const RELEASES_URL = 'https://github.com/XiangXiaoYuan5254/FocusBloom/releases/latest';
const RENDERER = path.join(ROOT, 'src', 'renderer');
const AMBIENT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'Ambient')
  : path.join(ROOT, '..', 'Resources', 'Ambient');

// 标题栏按钮区域的底色，和页面右上角的渐变色对齐。
const THEME = {
  dark: { background: '#0E1518', overlay: '#101A1C', symbol: '#9CACA7' },
  light: { background: '#F3F7F5', overlay: '#EDF4F0', symbol: '#61716A' }
};
const TITLE_BAR_HEIGHT = 40;
// 悬浮窗是透明窗口，四周留一圈给 CSS 阴影。
const FLOATING_SHADOW = 12;

const STORE_ACTIONS = new Set([
  'startSession',
  'togglePause',
  'stopSessionEarly',
  'abandonSession',
  'recordMindWander',
  'recordFatigue',
  'skipMicroBreak',
  'saveCompletion',
  'setStartEnergy',
  'selectTask',
  'addTask',
  'removeTask',
  'playSound',
  'toggleAppearance',
  'testMusic',
  'toggleAmbientSound',
  'setAmbientVolume',
  'toggleAmbientPlayback',
  'ambientFailed',
  'exportCSV',
  'clearHistory',
  'removeSession'
]);

let store;
let persistence;
let mainWindow;
let floatingWindow;
let tray;
let updater;
let quitting = false;
let mainHidden = false;
let floatingPosition = null;
let trayHintShown = false;
let lastTrayActive = null;
let lastProgressKey = '';
let completionNotice = null;
let updateNotice = null;
const settingsAck = new Map();

function dataDirectory() {
  if (process.env.FOCUSBLOOM_DATA_DIR) return process.env.FOCUSBLOOM_DATA_DIR;
  if (IS_WINDOWS) return path.join(app.getPath('appData'), 'FocusBloom');
  // 在 Mac 上开发调试时，不碰 macOS 版的真实数据（~/Library/Application Support/FocusBloom）。
  return path.join(app.getPath('userData'), 'dev-data');
}

function asset(...parts) {
  return path.join(ROOT, 'assets', ...parts);
}

function liveWindows() {
  return [mainWindow, floatingWindow].filter((win) => win && !win.isDestroyed());
}

function send(channel, payload) {
  for (const win of liveWindows()) win.webContents.send(channel, payload);
}

function broadcastSettings() {
  for (const win of liveWindows()) {
    win.webContents.send('bloom:state', {
      settings: store.settings,
      settingsAck: settingsAck.get(win.webContents.id) || 0
    });
  }
}

// ---- 主窗口 ----

function createMainWindow() {
  const theme = THEME[store.settings.appearanceMode];
  const { workAreaSize } = screen.getPrimaryDisplay();
  const width = Math.min(1180, workAreaSize.width - 40);
  const height = Math.min(790, workAreaSize.height - 40);

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(960, width),
    minHeight: Math.min(640, height),
    show: false,
    title: '专注芽',
    // 安装后的窗口图标直接取自 exe 资源（build/icon.ico），开发时用 PNG。
    icon: app.isPackaged ? undefined : asset('icon.png'),
    backgroundColor: theme.background,
    titleBarStyle: 'hidden',
    ...(IS_WINDOWS
      ? { titleBarOverlay: { color: theme.overlay, symbolColor: theme.symbol, height: TITLE_BAR_HEIGHT } }
      : { trafficLightPosition: { x: 16, y: 14 } }),
    webPreferences: webPreferences()
  });

  mainWindow.loadFile(path.join(RENDERER, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  guardNavigation(mainWindow);

  mainWindow.on('minimize', () => setMainHidden(true));
  mainWindow.on('hide', () => setMainHidden(true));
  mainWindow.on('restore', () => setMainHidden(!mainWindow.isVisible()));
  mainWindow.on('show', () => setMainHidden(mainWindow.isMinimized()));
  mainWindow.on('focus', () => mainWindow.flashFrame(false));

  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (store.settings.closeToTray) {
      mainWindow.hide();
      showTrayHintOnce();
    } else {
      quitApp();
    }
  });

  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') mainWindow.webContents.toggleDevTools();
    });
  }
}

function webPreferences() {
  return {
    preload: path.join(ROOT, 'src', 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    // 最小化或关到托盘后，环境音和提示音还要照常播放。
    backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required'
  };
}

function guardNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function setMainHidden(hidden) {
  mainHidden = hidden;
  updateFloating();
}

function showTrayHintOnce() {
  if (trayHintShown || !tray) return;
  trayHintShown = true;
  const title = '专注芽仍在运行';
  const content = '计时会在后台继续。点击任务栏右下角的专注芽图标可以重新打开，右键可以快速记录或退出。';
  if (IS_WINDOWS) {
    tray.displayBalloon({ title, content, iconType: 'info' });
  } else if (Notification.isSupported()) {
    new Notification({ title, body: content, silent: true }).show();
  }
}

function quitApp() {
  quitting = true;
  app.quit();
}

// ---- 悬浮计时 ----

function floatingContentSize(settings) {
  const timer = settings.floatingTimerOnMinimize;
  const signals = settings.floatingSignalButtons;
  return {
    width: signals ? 292 : 264,
    height: timer && signals ? 174 : timer ? 116 : 70
  };
}

function ensureFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) return;
  const size = floatingContentSize(store.settings);
  floatingWindow = new BrowserWindow({
    width: size.width + FLOATING_SHADOW * 2,
    height: size.height + FLOATING_SHADOW * 2,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: '专注芽倒计时',
    webPreferences: webPreferences()
  });
  floatingWindow.setAlwaysOnTop(true, 'floating');
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingWindow.loadFile(path.join(RENDERER, 'floating.html'));
  guardNavigation(floatingWindow);
  floatingWindow.on('moved', () => {
    floatingPosition = floatingWindow.getPosition();
  });
  floatingWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    floatingWindow.hide();
  });
}

function floatingBounds() {
  const content = floatingContentSize(store.settings);
  const width = content.width + FLOATING_SHADOW * 2;
  const height = content.height + FLOATING_SHADOW * 2;
  if (floatingPosition) {
    const [x, y] = floatingPosition;
    const display = screen.getDisplayMatching({ x, y, width, height });
    const area = display.workArea;
    return {
      x: core.clamp(x, area.x - FLOATING_SHADOW, area.x + area.width - width + FLOATING_SHADOW),
      y: core.clamp(y, area.y - FLOATING_SHADOW, area.y + area.height - height + FLOATING_SHADOW),
      width,
      height
    };
  }
  const area = (mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay()).workArea;
  return {
    x: area.x + area.width - width - 16,
    y: area.y + area.height - height - 16,
    width,
    height
  };
}

function updateFloating() {
  if (!store) return;
  const settings = store.settings;
  const wanted =
    mainHidden && store.isSessionActive && (settings.floatingTimerOnMinimize || settings.floatingSignalButtons);
  if (!wanted) {
    if (floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()) floatingWindow.hide();
    return;
  }
  ensureFloatingWindow();
  const bounds = floatingBounds();
  const current = floatingWindow.getBounds();
  if (!floatingWindow.isVisible() || current.width !== bounds.width || current.height !== bounds.height) {
    floatingWindow.setBounds(bounds);
  }
  if (!floatingWindow.isVisible()) floatingWindow.showInactive();
}

// ---- 托盘 ----

function trayStatus() {
  const runtime = store.runtime;
  const task = store.currentTaskDisplayName;
  switch (runtime.phase) {
    case 'focusing':
      return `专注中 ${core.formatClock(runtime.remainingSeconds)} · ${task}`;
    case 'paused':
      return `已暂停 ${core.formatClock(runtime.remainingSeconds)} · ${task}`;
    case 'microBreak':
      return `微休息 · ${runtime.breakRemainingSeconds} 秒后继续`;
    case 'completed':
      return '本轮完成，等待复盘';
    default:
      return '准备好时，开始一轮安静的专注';
  }
}

function trayMenu() {
  const runtime = store.runtime;
  const items = [{ label: trayStatus(), enabled: false }, { type: 'separator' }];
  if (runtime.phase === 'focusing' || runtime.phase === 'paused') {
    items.push(
      { label: runtime.phase === 'paused' ? '继续' : '暂停', click: () => store.togglePause() },
      { label: '我走神了', click: () => store.recordMindWander() },
      { label: '我开始累了', click: () => store.recordFatigue() }
    );
  } else if (runtime.phase === 'microBreak') {
    items.push({ label: '现在继续', click: () => store.skipMicroBreak() });
  } else if (runtime.phase === 'completed') {
    items.push({ label: '去复盘这一轮', click: showMain });
  } else {
    items.push({ label: `开始 ${store.settings.selectedDurationMinutes} 分钟`, click: () => store.startSession() });
  }
  items.push(
    { type: 'separator' },
    { label: runtime.isAmbientPlaying ? '暂停环境音' : '播放环境音', click: () => store.toggleAmbientPlayback() },
    { type: 'separator' }
  );
  if (updateState().status === 'downloaded' && !store.isSessionActive) {
    items.push({ label: `重启并更新到 v${updateState().version}`, click: () => updater.install() });
  }
  items.push({ label: '打开专注芽', click: showMain }, { label: '退出专注芽', click: quitApp });
  return Menu.buildFromTemplate(items);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(asset('tray', 'tray-idle.png')));
  lastTrayActive = false;
  tray.setToolTip('专注芽');
  tray.on('click', showMain);
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const active = store.isSessionActive;
  if (active !== lastTrayActive) {
    lastTrayActive = active;
    tray.setImage(nativeImage.createFromPath(asset('tray', active ? 'tray-active.png' : 'tray-idle.png')));
  }
  tray.setToolTip(`专注芽 · ${trayStatus()}`);
}

// ---- 任务栏进度、完成提醒、主题 ----

function updateTaskbarProgress() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const runtime = store.runtime;
  const modes = { focusing: 'normal', paused: 'paused', microBreak: 'indeterminate' };
  const mode = modes[runtime.phase];
  const value = mode ? Math.max(0.01, core.progress(runtime)) : -1;
  const key = mode ? `${mode}:${value.toFixed(3)}` : 'none';
  if (key === lastProgressKey) return;
  lastProgressKey = key;
  mainWindow.setProgressBar(value, mode ? { mode } : undefined);
}

function onCompleted() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) return;
  if (mainWindow.isVisible()) mainWindow.flashFrame(true);
  if (Notification.isSupported()) {
    // 结束提示音已经响过，通知本身保持安静。
    completionNotice = new Notification({
      title: '本轮完成',
      body: '花一分钟复盘，注意力训练才会留下可比较的数据。',
      silent: true
    });
    completionNotice.on('click', showMain);
    completionNotice.show();
  }
}

function applyTheme() {
  const mode = store.settings.appearanceMode;
  const theme = THEME[mode];
  nativeTheme.themeSource = mode;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBackgroundColor(theme.background);
  if (IS_WINDOWS) {
    mainWindow.setTitleBarOverlay({ color: theme.overlay, symbolColor: theme.symbol, height: TITLE_BAR_HEIGHT });
  }
}

// ---- 导出 ----

async function exportCSV(sessions) {
  const options = {
    title: '导出专注记录',
    defaultPath: path.join(app.getPath('documents'), '专注芽-专注记录.csv'),
    filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  try {
    await fs.promises.writeFile(result.filePath, buildCSV(sessions), 'utf8');
    return true;
  } catch (error) {
    console.error('FocusBloom export failed:', error);
    return false;
  }
}

// ---- 自动更新 ----

function createUpdater() {
  // 冒烟测试用本地地址代替 GitHub Release，开发版也能走一遍检查流程。
  const testFeed = process.env.FOCUSBLOOM_UPDATE_URL;
  if (!testFeed && !(app.isPackaged && IS_WINDOWS)) return null;
  const { autoUpdater } = require('electron-updater');
  if (testFeed) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
  }
  return new Updater({ autoUpdater, canInstall: isInstalled(), isEnabled: () => store.settings.autoCheckUpdates });
}

// 安装版的目录里有 NSIS 卸载程序；免安装版（zip 解压）没有，只能提醒用户去下载。
function isInstalled() {
  if (!IS_WINDOWS || !app.isPackaged) return false;
  try {
    return fs.readdirSync(path.dirname(process.execPath)).some((name) => /^Uninstall .+\.exe$/i.test(name));
  } catch {
    return false;
  }
}

function updateState() {
  return updater ? updater.state : { status: 'unsupported' };
}

function onUpdateChange(state) {
  send('bloom:state', { update: state });
  updateTray();
  // 常驻托盘时看不到主窗口里的提示，下载好后用一条安静的通知告诉用户；专注中不打扰。
  const mainVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized();
  if (state.status !== 'downloaded' || store.isSessionActive || mainVisible || !Notification.isSupported()) return;
  updateNotice = new Notification({
    title: `专注芽 v${state.version} 已准备好`,
    body: '退出专注芽时会自动安装，也可以打开专注芽立即重启并更新。',
    silent: true
  });
  updateNotice.on('click', showMain);
  updateNotice.show();
}

// ---- IPC ----

function registerIPC() {
  ipcMain.handle('bloom:snapshot', (event) => ({
    ...store.snapshot(),
    settingsAck: settingsAck.get(event.sender.id) || 0,
    dataFile: persistence.file,
    version: app.getVersion(),
    update: updateState()
  }));

  ipcMain.handle('bloom:action', (_event, name, ...args) => {
    if (!STORE_ACTIONS.has(name)) throw new Error(`unknown action: ${name}`);
    return store[name](...args);
  });

  ipcMain.on('bloom:settings', (event, patch, seq) => {
    settingsAck.set(event.sender.id, Number(seq) || 0);
    store.updateSettings(patch);
  });

  ipcMain.handle('bloom:ambient-asset', (_event, id) => {
    if (!core.AMBIENT_IDS.includes(id) || id === 'brownNoise') throw new Error(`unknown sound: ${id}`);
    return fs.promises.readFile(path.join(AMBIENT_DIR, `${id}.m4a`));
  });

  ipcMain.on('bloom:window', (_event, command) => {
    if (command === 'restore-main') {
      showMain();
    } else if (command === 'open-data-folder') {
      fs.mkdirSync(persistence.directory, { recursive: true });
      shell.openPath(persistence.directory);
    } else if (command === 'check-update') {
      if (updater) updater.check({ manual: true });
    } else if (command === 'install-update') {
      if (updater && !store.isSessionActive) updater.install();
    } else if (command === 'open-download-page') {
      shell.openExternal(RELEASES_URL);
    }
  });
}

function wireStore() {
  store.on('settings', () => {
    broadcastSettings();
    applyTheme();
    updateFloating();
    updateTray();
  });
  store.on('sessions', (sessions) => send('bloom:state', { sessions }));
  store.on('runtime', (runtime) => {
    send('bloom:state', { runtime });
    updateFloating();
    updateTray();
    updateTaskbarProgress();
  });
  store.on('chime', (name) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bloom:chime', name);
  });
  store.on('completed', onCompleted);
}

function start() {
  if (IS_WINDOWS) Menu.setApplicationMenu(null);
  persistence = createPersistence(dataDirectory());
  store = new AppStore({ persistence, playMusic: music.playNext, exportCSV });
  nativeTheme.themeSource = store.settings.appearanceMode;
  registerIPC();
  wireStore();
  createMainWindow();
  createTray();
  updater = createUpdater();
  if (updater) {
    updater.on('change', onUpdateChange);
    updater.start();
  }
}

app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMain);
  app.on('activate', showMain);
  app.on('before-quit', () => {
    quitting = true;
    if (updater) updater.dispose();
    if (store) store.dispose();
  });
  // 主窗口关到托盘时不退出；真正退出走托盘菜单或关闭“留在托盘”。
  app.on('window-all-closed', () => {});
  app.whenReady().then(start);
}
