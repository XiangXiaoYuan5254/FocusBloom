# 专注芽 FocusBloom · Windows 版

和 macOS 版功能对齐的 Windows 桌面版，基于 Electron。界面、配色、统计口径和数据格式都与 Mac 版一致。

## 系统要求

- Windows 10 1809 或更高版本、Windows 11
- x64（Windows on ARM 可以直接运行 x64 版，也可以用 `npm run dist:arm64` 单独打包）

## 安装

- **安装版**：运行 `FocusBloom-Windows-Setup-x64.exe`，可选择安装位置，会创建桌面和开始菜单快捷方式。
- **免安装版**：解压 `FocusBloom-Windows-Portable-x64.zip`，双击 `FocusBloom.exe`。

安装包没有做代码签名，第一次运行时 Windows SmartScreen 可能提示“Windows 已保护你的电脑”，点击“更多信息 → 仍要运行”即可。

## 自动更新

安装版会在启动 15 秒后、之后每 6 小时检查一次官网上的 [`latest.yml`](https://helloxxy.com/works/focusbloom/downloads/latest.yml)（地址在 `package.json` 的 `publish` 里），有新版本就从官网在后台下载，下载时校验 SHA-512。下载好后：

- 侧边栏出现“新版本 vX.Y.Z · 重启并更新”，设置页“软件更新”里也能点；托盘菜单里有“重启并更新”。常驻托盘时会弹一条安静的系统通知。
- 不点也没关系，下次退出专注芽时会静默安装，装到原来的位置。
- 专注中不显示提示，也不能重启更新，不会打断这一轮。

免安装版没法替换自己，只会提示“发现新版本”，点“前往下载”打开官网下载页。“设置 → 软件更新”里可以关闭自动检查，手动检查不受影响。

## 和 macOS 版的对应关系

| macOS 版 | Windows 版 |
|---|---|
| 菜单栏图标 | 任务栏右下角通知区域（托盘）图标：左键打开主窗口，右键快速开始、暂停、记录走神/疲劳、播放环境音或退出 |
| 最小化后的悬浮倒计时 / 状态按钮 | 相同；关到托盘时也会显示 |
| 关闭窗口后继续在菜单栏运行 | 默认留在托盘继续计时，可在“设置 → 专注轮次”里改为直接退出 |
| — | 任务栏按钮上显示本轮进度，暂停时变为黄色；本轮结束时如果窗口不在前台，会弹出系统通知 |
| 系统提示音（Glass、Hero 等） | macOS 的系统音效不能随 Windows 版分发，改为本机合成的同风格提示音，名称保持对应 |
| 环境音 | 相同的 7 段录音（内置、无缝循环）+ 本机生成的棕噪音，可叠加混音 |
| 结束后播放 Apple Music / 网易云音乐 | 通过 Windows 系统媒体控制，支持网易云音乐、QQ 音乐、Apple Music、Spotify 或当前正在使用的播放器：暂停时切到下一首并播放，已在播放时不打断 |

结束音乐只要求播放器支持 Windows 媒体控制——调节音量时，系统浮窗里能看到歌曲名就可以。Windows 上没有接口从资料库或指定播放列表里挑歌，想要“每次随机一首”，把播放器的播放模式设为随机播放即可。播放器没有打开时，专注芽会先在后台启动它（需要在开始菜单里能找到它）。

## 数据

```text
%APPDATA%\FocusBloom\focus-data.json
```

文件格式与 macOS 版完全相同，两边可以直接互相拷贝（Mac 上的位置是 `~/Library/Application Support/FocusBloom/focus-data.json`）。“设置 → 数据”里可以直接打开这个文件夹，也可以导出 CSV（带 BOM，Excel 双击打开不会乱码）。

数据只保存在本机：不需要账号，不上传记录，不包含分析 SDK 或广告。唯一的联网是检查更新，只从官网读取版本信息。卸载程序不会删除这个文件。

## 开发

```bash
cd windows
npm install
npm start          # 运行
npm test           # 单元测试（计时、统计、数据格式）
npm run dist       # 打包 Windows 安装版和免安装版，输出到 windows/dist
npm run smoke-test # 端到端测试：启动真实的 App 走一遍主要功能，截图保存到 windows/smoke
```

### 在 GitHub 上测试

`.github/workflows/windows.yml` 会在 GitHub 提供的 Windows 机器上自动运行：单元测试 → 打包 → 启动打包好的 `FocusBloom.exe` 做端到端测试（开始一轮、最小化出现悬浮窗、记录走神、环境音、一轮结束后复盘并存档、通过系统媒体控制调用播放器、检查更新并提示新版本、各页面截图）。

- 改动 `windows/`、`Resources/Ambient/` 或工作流本身的提交和 Pull Request 会自动触发（只改 `windows/` 里的 .md 说明文档时不触发），也可以在 Actions 页面手动运行。
- 每次运行都会保存测试截图和安装包（Artifacts），不用自己的 Windows 电脑也能下载安装包、看到界面在 Windows 上的样子。
- 推送 `v` 开头的标签时，安装包和自动更新用的 `latest.yml`、`.blockmap` 会自动附加到同名的 GitHub Release（没有就先建一个草稿），发布时把它们放到官网的 `downloads/`。完整的发布步骤见[根目录 README](../README.md#自动更新与发布新版本)。

CI 机器上没有装网易云音乐等播放器、也没有声卡，所以“真的放出歌”“听到声音”这两件事仍需要在自己的电脑上确认。

在 macOS 上也可以运行和打包（不需要 Wine）。在 Mac 上 `npm start` 时，数据写在 `~/Library/Application Support/专注芽/dev-data`，不会碰到 macOS 版的真实数据；也可以用环境变量 `FOCUSBLOOM_DATA_DIR` 指定数据目录。开发时按 F12 打开开发者工具。开发版不检查更新；设置环境变量 `FOCUSBLOOM_UPDATE_URL` 可以把更新地址换成本地服务器（冒烟测试就是这样模拟新版本的）。

环境音素材直接使用仓库根目录的 `Resources/Ambient`，打包时复制进安装包。

### 目录

```text
src/shared/core.js       数据模型与统计（主进程和界面共用，对应 Models.swift 和 AppStore 的计算属性）
src/main/store.js        计时、设置和记录（对应 AppStore.swift）
src/main/persistence.js  读写 focus-data.json、导出 CSV
src/main/music.js        通过 Windows 系统媒体控制播放音乐（对应 MusicController.swift）
src/main/main.js         窗口、悬浮计时、托盘
src/main/updater.js      自动更新（electron-updater，对应 macOS 版的 Sparkle）
src/renderer/            界面（Preact + htm，不需要打包工具）；audio.js 负责环境音和提示音
scripts/                 生成图标、整理第三方文件、端到端测试（smoke-test.js）
test/                    单元测试
```

改了 `assets/icon.svg` 后运行 `npm run icons` 重新生成 `.ico` 和托盘图标；升级 Preact 或需要新图标时运行 `npm run prepare-renderer`。
