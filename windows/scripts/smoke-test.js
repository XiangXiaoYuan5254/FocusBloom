// 端到端冒烟测试：启动真实的专注芽（Windows 上是打包好的 FocusBloom.exe），
// 通过 Chrome DevTools 协议操作界面、检查结果，并把截图保存到 windows/smoke/。
// GitHub Actions 的 Windows 机器上会自动运行；本地也可以运行：npm run smoke-test
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'smoke');
const IS_WINDOWS = process.platform === 'win32';
const PAGE_PORT = 9322;
const MAIN_PORT = 9329;
const UPDATE_PORT = 9331;
const UPDATE_VERSION = '99.0.0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

function launchCommand() {
  if (process.argv[2]) return [process.argv[2], []];
  if (IS_WINDOWS) return [path.join(root, 'dist', 'win-unpacked', 'FocusBloom.exe'), []];
  // 其他系统上用开发版运行，方便本地调试这个脚本。
  return [require('electron'), [root]];
}

async function json(url) {
  const response = await fetch(url);
  return response.json();
}

async function waitFor(check, { timeout = 20000, interval = 250, label } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(interval);
  }
  throw new Error(`超时：${label}${last instanceof Error ? `（${last.message}）` : ''}`);
}

async function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`无法连接 ${webSocketUrl}`));
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method === 'Runtime.exceptionThrown') {
      errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    } else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      errors.push(data.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (body) => {
    const response = await send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.error) throw new Error(response.error.message);
    if (response.result.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
    }
    return response.result.result.value;
  };
  return { send, evaluate, errors, close: () => socket.close() };
}

async function page(match) {
  const target = await waitFor(
    async () => (await json(`http://127.0.0.1:${PAGE_PORT}/json/list`)).find((entry) => entry.type === 'page' && entry.url.includes(match)),
    { label: `等待页面 ${match}` }
  );
  const client = await connect(target.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  return client;
}

async function screenshot(client, name) {
  const response = await client.send('Page.captureScreenshot', { format: 'png' });
  if (response.result && response.result.data) {
    fs.writeFileSync(path.join(outDir, name), Buffer.from(response.result.data, 'base64'));
  } else {
    console.warn(`截图 ${name} 失败`, response.error);
  }
}

async function step(name, run, { soft = false } = {}) {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
    console.log(`✔ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, ok: soft, detail: error.message, soft });
    console.log(`${soft ? '⚠' : '✘'} ${name} — ${error.message}`);
  }
}

// 假装官网上有一个新版本：electron-updater 读的是 latest.yml（Mac 上是 latest-mac.yml）。
// 打包出来的 win-unpacked 没有卸载程序，按免安装版处理，只检查不下载，所以安装包本身不需要是真的。
function startUpdateServer() {
  const manifest = [
    `version: ${UPDATE_VERSION}`,
    'files:',
    '  - url: FocusBloom-Windows-Setup-x64.exe',
    '    sha512: AAAA',
    '    size: 1',
    'path: FocusBloom-Windows-Setup-x64.exe',
    'sha512: AAAA',
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ].join('\n');
  const server = http.createServer((request, response) => {
    if (/\/latest(-mac)?\.yml$/.test(request.url.split('?')[0])) {
      response.writeHead(200, { 'Content-Type': 'text/yaml' });
      response.end(manifest);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) => server.listen(UPDATE_PORT, '127.0.0.1', () => resolve(server)));
}

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusbloom-smoke-'));
  const updateServer = await startUpdateServer();
  const [command, args] = launchCommand();
  console.log(`启动 ${command}`);
  const log = fs.createWriteStream(path.join(outDir, 'app.log'));
  const env = {
    ...process.env,
    FOCUSBLOOM_DATA_DIR: dataDir,
    FOCUSBLOOM_UPDATE_URL: `http://127.0.0.1:${UPDATE_PORT}/`,
    ELECTRON_ENABLE_LOGGING: '1'
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(command, [...args, `--remote-debugging-port=${PAGE_PORT}`, `--inspect=${MAIN_PORT}`], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  let ui;
  let mainProcess;
  try {
    ui = await page('index.html');
    const mainTarget = await waitFor(async () => (await json(`http://127.0.0.1:${MAIN_PORT}/json/list`))[0], { label: '等待主进程调试端口' });
    mainProcess = await connect(mainTarget.webSocketDebuggerUrl);
    const inMain = (body) => mainProcess.evaluate(`const { app, BrowserWindow, webContents } = process.mainModule.require('electron'); ${body}`);
    const windows = () =>
      inMain(`return BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible(), minimized: w.isMinimized() }));`);

    await step('主窗口加载并显示专注页', async () => {
      await waitFor(() => ui.evaluate(`return window.BloomClient && BloomClient.state.ready && document.querySelector('h1')?.textContent`), {
        label: '界面就绪'
      });
      const title = await ui.evaluate(`return document.querySelector('h1').textContent`);
      if (!title.includes('练习一次完整的注意')) throw new Error(`标题不对：${title}`);
      await sleep(600);
      await screenshot(ui, '01-focus-dark.png');
      return title;
    });

    await step('开始一轮后倒计时在走', async () => {
      await ui.evaluate(`BloomClient.updateSettings({ reminderMinimumMinutes: 60, reminderMaximumMinutes: 60, floatingSignalButtons: true }); await window.bloom.action('startSession', 1);`);
      await sleep(2500);
      const state = await ui.evaluate(`return { phase: BloomClient.state.runtime.phase, timer: document.querySelector('.timer-text').textContent }`);
      if (state.phase !== 'focusing' || state.timer === '01:00') throw new Error(JSON.stringify(state));
      await screenshot(ui, '02-session.png');
      return `剩余 ${state.timer}`;
    });

    await step('最小化后出现悬浮计时窗，并能记录走神', async () => {
      await inMain(`BrowserWindow.getAllWindows().find((w) => w.getTitle() === '专注芽').minimize();`);
      const floating = await waitFor(async () => (await windows()).find((w) => w.title === '专注芽倒计时' && w.visible), { label: '悬浮窗出现' });
      const floatingUi = await page('floating.html');
      await sleep(800);
      await floatingUi.evaluate(`document.querySelector('.signal-button').click();`);
      await sleep(500);
      const count = await ui.evaluate(`return BloomClient.state.runtime.currentEvents.filter((e) => e.kind === 'mindWander').length`);
      await screenshot(floatingUi, '03-floating.png');
      floatingUi.close();
      if (count !== 1) throw new Error(`走神次数应为 1，实际 ${count}`);
      return JSON.stringify(floating);
    });

    await step('恢复主窗口后悬浮窗隐藏', async () => {
      await inMain(`const w = BrowserWindow.getAllWindows().find((w) => w.getTitle() === '专注芽'); w.restore(); w.show();`);
      await waitFor(async () => !(await windows()).some((w) => w.title === '专注芽倒计时' && w.visible), { label: '悬浮窗隐藏' });
    });

    await step(
      '环境音能解码并播放',
      async () => {
        await ui.evaluate(`await window.bloom.action('toggleAmbientSound', 'rain');`);
        const audible = await waitFor(() => inMain(`return webContents.getAllWebContents().some((w) => w.isCurrentlyAudible());`), {
          timeout: 8000,
          label: '有声音输出（CI 机器可能没有声卡）'
        });
        return `audible=${audible}`;
      },
      { soft: true }
    );

    await step('一轮结束后弹出复盘，保存为 Mac 兼容的数据', async () => {
      await waitFor(() => ui.evaluate(`return BloomClient.state.runtime.phase === 'completed' && !!document.querySelector('.completion-sheet')`), {
        timeout: 75000,
        interval: 1000,
        label: '一分钟后进入复盘'
      });
      await sleep(500);
      await screenshot(ui, '04-completion.png');
      await ui.evaluate(`[...document.querySelectorAll('.completion-actions .btn')].find((b) => b.textContent.includes('保存复盘')).click();`);
      await sleep(800);
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'focus-data.json'), 'utf8'));
      const saved = data.sessions[0];
      if (data.sessions.length !== 1 || saved.focusedSeconds !== 60 || !saved.completed) throw new Error(JSON.stringify(saved));
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(saved.startedAt)) throw new Error(`日期格式不兼容：${saved.startedAt}`);
      return `${saved.focusedSeconds} 秒，${saved.events.length} 个事件`;
    });

    const expectedMusic = [
      '现在没有可以控制的播放器',
      '没有找到',
      '找不到',
      '正在播放',
      '原本就在播放'
    ];
    for (const player of IS_WINDOWS ? ['any', 'netease'] : []) {
      await step(`结束音乐（${player}）：PowerShell 调用系统媒体控制`, async () => {
        await ui.evaluate(`BloomClient.updateSettings({ musicPlayer: '${player}' }); await new Promise((r) => setTimeout(r, 300)); await window.bloom.action('testMusic');`);
        const message = await waitFor(
          async () => {
            const text = await ui.evaluate(`return BloomClient.state.runtime.musicMessage`);
            return text && !text.startsWith('正在连接') ? text : null;
          },
          { timeout: 60000, interval: 500, label: '播放器回应' }
        );
        // Windows Server 上可能没有系统媒体控制组件，这不是专注芽的问题，只记录下来。
        if (message.includes('不支持系统媒体控制')) return `（这台机器没有 SMTC）${message}`;
        if (!expectedMusic.some((fragment) => message.includes(fragment))) throw new Error(message);
        return message;
      });
    }

    await step('各页面都能打开（洞察、记录、设置、日间模式）', async () => {
      const shots = [
        [1, '05-insights.png'],
        [2, '06-history.png'],
        [3, '07-settings.png']
      ];
      for (const [index, name] of shots) {
        await ui.evaluate(`document.querySelectorAll('.nav-item')[${index}].click();`);
        await sleep(500);
        await screenshot(ui, name);
      }
      await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click(); await window.bloom.action('toggleAppearance');`);
      await sleep(600);
      await screenshot(ui, '08-focus-light.png');
    });

    await step('检查更新能发现新版本，并在侧边栏和设置页提示', async () => {
      await ui.evaluate(`window.bloom.command('check-update');`);
      const update = await waitFor(
        async () => {
          const state = await ui.evaluate(`return BloomClient.state.update`);
          return state && (state.status === 'available' || state.status === 'error') ? state : null;
        },
        { timeout: 20000, label: '检查结果' }
      );
      if (update.status !== 'available' || update.version !== UPDATE_VERSION) throw new Error(JSON.stringify(update));
      await ui.evaluate(`document.querySelectorAll('.nav-item')[3].click();`);
      await sleep(500);
      const texts = await ui.evaluate(
        `return { notice: document.querySelector('.update-notice')?.textContent || '', page: document.querySelector('.page').textContent }`
      );
      await ui.evaluate(
        `[...document.querySelectorAll('.settings-card')].find((card) => card.textContent.includes('软件更新')).scrollIntoView({ block: 'center' });`
      );
      await sleep(300);
      await screenshot(ui, '09-update.png');
      if (!texts.notice.includes(`v${UPDATE_VERSION}`)) throw new Error(`侧边栏没有新版本提示：${texts.notice}`);
      if (!texts.page.includes(`前往下载 v${UPDATE_VERSION}`)) throw new Error('设置页没有“前往下载”按钮');
      return `v${update.version}`;
    });

    await step('界面没有报错', async () => {
      if (ui.errors.length) throw new Error(ui.errors.join('\n'));
    });
  } catch (error) {
    results.push({ name: '测试流程', ok: false, detail: error.stack || error.message });
    console.log(`✘ 测试流程中断 — ${error.message}`);
  } finally {
    if (mainProcess) {
      await mainProcess.evaluate(`process.mainModule.require('electron').app.quit();`).catch(() => {});
    }
    ui?.close();
    mainProcess?.close();
    await waitFor(() => exited, { timeout: 10000, label: '退出' }).catch(() => child.kill());
    log.end();
    updateServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const logText = fs.readFileSync(path.join(outDir, 'app.log'), 'utf8');
  const crash = logText.split(/\r?\n/).find((line) => /Uncaught|UnhandledPromiseRejection|TypeError|ReferenceError/.test(line));
  if (crash) results.push({ name: '应用日志没有异常', ok: false, detail: crash });

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过，截图在 ${outDir}`);
  if (failed.length) process.exit(1);
}

if (typeof WebSocket === 'undefined') {
  // Node 22 以前没有内置 WebSocket，改用 Electron 自带的 Node 运行本脚本。
  const rerun = spawn(require('electron'), [__filename, ...process.argv.slice(2)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  });
  rerun.on('exit', (code) => process.exit(code ?? 1));
} else {
  main();
}
