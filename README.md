# 专注芽 FocusBloom

专注芽是一款本地优先的 macOS 专注训练工具。它用随机提示帮助你觉察走神，通过疲劳与专注记录逐渐找到适合自己的学习节律。

数据只保存在你的 Mac 上，不需要账号。

> Windows 版在 [windows/](windows/README.md) 目录，功能与 Mac 版对齐，数据文件可以两边互相拷贝。

## 功能

- 任意整数分钟的专注时长（1–1440 分钟），并保留 30 / 50 / 90 分钟快捷选项
- 自定义随机提示区间，例如 3–5 分钟或 8–17 分钟
- 自定义微休息秒数和提示音
- 提示音可选择“随机”，每次提示重新抽取一种系统声音
- 一键切换日间模式和夜间模式
- 一键记录走神与疲劳时刻
- 最小化主窗口后，可独立悬浮倒计时和“我走神了 / 我开始累了”按钮
- 每轮可选择或新增任务，并按任务统计专注分钟、轮数和平均评分
- 可以放弃临时或被打断的专注轮次，不计入任何统计
- 每轮结束记录专注评分、精力变化和备注
- 最近 7 天专注时长、专注质量趋势和渐进训练建议
- 环境音：雨声、海浪、溪流、风声、篝火、鸟鸣、虫鸣（真实录音，内置无缝循环）和棕噪音（本机实时生成），可叠加混音、分别调音量，可随专注自动播放/暂停，不需要联网
- 专注结束后可选择 Apple Music 或网易云音乐自动播放；Apple Music 支持从整个资料库或指定播放列表随机播放
- 全部记录仅保存在本机，可导出 CSV
- 菜单栏计时和快捷记录
- 自动更新：有新版本时弹出提示，一键安装并重新打开；专注中不打扰，等这一轮结束再提示

## 系统要求

- macOS 14 或更高版本
- Xcode Command Line Tools / Swift 5.10 或更高版本

## 从源码构建

克隆仓库后运行：

```bash
zsh Scripts/package_app.sh
```

构建结果位于 `dist/专注芽.app`。第一次构建时 Swift Package Manager 会从 GitHub 下载自动更新框架 [Sparkle](https://sparkle-project.org)。

版本号只在 `windows/package.json` 的 `version` 里维护，Mac 版和 Windows 版共用。

如果钥匙串里有名为 `FocusBloom Dev` 的代码签名证书（可在“钥匙串访问 → 证书助理 → 创建证书”中创建：身份类型选“自签名根证书”，证书类型选“代码签名”），打包脚本会用它签名，系统授权在重新打包后仍然有效；否则使用临时签名，每次打包后需要在系统设置中重新授权。也可以用环境变量 `FOCUSBLOOM_SIGNING_IDENTITY` 指定其他证书名称。

首次使用 Apple Music 功能时，macOS 会询问是否允许“专注芽”控制“音乐”。使用网易云音乐时，需要在“系统设置 → 隐私与安全性 → 辅助功能”中允许“专注芽”控制网易云音乐。

## 自动更新与发布新版本

两个版本都从 GitHub 最新的 Release 检查新版本：

- **macOS**：Sparkle 每天读取一次 Release 里的 `appcast.xml`，发现新版本后弹出更新窗口（显示 Release 正文作为更新说明），用户点“安装更新”即可自动下载、校验、替换并重新打开。更新包用 EdDSA 私钥签名，App 里内置对应的公钥，签名不对的更新包不会被安装。
- **Windows**：见 [windows/README.md](windows/README.md#自动更新)。

发布一个新版本：

1. 把 `windows/package.json` 里的 `version` 改大（例如 `1.2.0`），提交并推送。
2. 推送同名标签：`git tag v1.2.0 && git push origin v1.2.0`。GitHub Actions 会打包 Windows 版，把安装包和 `latest.yml` 附加到草稿 Release `v1.2.0`。
3. 在 GitHub 上把这个 Release 的正文改成这次的更新说明（Markdown）。
4. 在 Mac 上运行 `zsh Scripts/release_mac.sh --upload`：打包 Mac 版、签名，生成 `appcast.xml`，连同 `FocusBloom-macOS.zip` 一起上传到这个 Release。
5. 在 GitHub 上发布这个 Release（取消草稿）。已安装的用户下次检查时就会收到更新。

两样东西只存在这台 Mac 的钥匙串里，务必备份，否则以后没法给已安装的 Mac 用户推送更新：

- Sparkle 私钥（钥匙串里账户为 `FocusBloom` 的条目）。导出：`.build/artifacts/sparkle/Sparkle/bin/generate_keys --account FocusBloom -x 备份文件路径`；在新电脑上导入：把 `-x` 换成 `-f`。
- 代码签名证书 `FocusBloom Dev`（在“钥匙串访问”里右键导出为 .p12）。换了证书，更新仍能安装，但用户需要重新授权辅助功能和自动化。

## 环境音素材

环境音录音来自 Freesound，均为 CC0（公共领域）授权，来源和处理方式见 [Resources/Ambient/CREDITS.md](Resources/Ambient/CREDITS.md)。

## 数据位置

```text
~/Library/Application Support/FocusBloom/focus-data.json
```

“专注能力”是根据近期走神前时长、完成率、主观专注评分和精力变化给出的个人趋势估计，不是医学诊断。

## 隐私

- 不需要注册或登录
- 不上传专注记录
- 唯一的联网是检查更新：从 GitHub 读取最新版本信息，不发送任何记录；可以在“设置 → 软件更新”里关闭自动检查
- 不包含分析 SDK 或广告
- 删除 App 不会自动删除上述数据文件

## 技术栈

- Swift
- SwiftUI
- AppKit
- Swift Package Manager
