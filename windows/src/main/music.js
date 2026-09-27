// 专注结束后的音乐，对应 macOS 版的 MusicController.swift。
// Mac 上靠 AppleScript 控制“音乐”和网易云；Windows 上改用系统媒体传输控制（SMTC）：
// 任务栏音量浮窗里能看到歌曲信息的播放器都支持，包括网易云音乐、QQ 音乐、Apple Music 和 Spotify。
// 这些接口只有 WinRT 提供，这里借 Windows 自带的 PowerShell 5.1 调用，不需要额外安装任何东西。
const { spawn } = require('child_process');
const core = require('../shared/core');

// 播放器已在运行时等 6 秒；需要先把它启动起来时，冷启动要加载界面和播放队列，给足 25 秒。
const WARM_TIMEOUT = 6;
const COLD_TIMEOUT = 25;

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$cfg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__CONFIG__')) | ConvertFrom-Json

function Finish([string]$status, [string]$message) {
  [Console]::Out.WriteLine($status + ':' + $message)
  exit 0
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
} catch {
  Finish 'ERR' '这台电脑不支持系统媒体控制，需要 Windows 10 1809 或更高版本'
}

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
} | Select-Object -First 1

function Await($operation, [Type]$resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(8000)) { throw '系统媒体控制没有响应' }
  return $task.Result
}

function Find-Session($manager) {
  if ([string]::IsNullOrEmpty($cfg.pattern)) { return $manager.GetCurrentSession() }
  foreach ($candidate in $manager.GetSessions()) {
    if ($candidate.SourceAppUserModelId -match $cfg.pattern) { return $candidate }
  }
  return $null
}

function Test-Playing($session) {
  return [string]$session.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
}

function Get-Track($session) {
  try {
    $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    if ($props -and $props.Title) {
      if ($props.Artist) { return $props.Title + ' — ' + $props.Artist }
      return $props.Title
    }
  } catch {}
  return ''
}

function Start-Player {
  if ([string]::IsNullOrEmpty($cfg.startName)) { return $false }
  try {
    $app = Get-StartApps | Where-Object { $_.Name -match $cfg.startName } | Select-Object -First 1
  } catch {
    return $false
  }
  if (-not $app) { return $false }
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('shell:AppsFolder\' + $app.AppID)
  return $true
}

try {
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $manager = Await ($managerType::RequestAsync()) $managerType

  $session = Find-Session $manager
  $deadline = (Get-Date).AddSeconds($cfg.warmTimeout)
  if (-not $session -and -not [string]::IsNullOrEmpty($cfg.process)) {
    if (-not (Get-Process -Name $cfg.process -ErrorAction SilentlyContinue)) {
      if (Start-Player) {
        $deadline = (Get-Date).AddSeconds($cfg.coldTimeout)
      } else {
        Finish 'ERR' ('没有找到' + $cfg.title + '，请确认已经安装，并且至少打开过一次')
      }
    }
  }

  while (-not $session -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    $session = Find-Session $manager
  }
  if (-not $session) {
    if ([string]::IsNullOrEmpty($cfg.pattern)) { Finish 'ERR' '现在没有可以控制的播放器，请先打开一个播放器并播放一次' }
    Finish 'ERR' ('找不到' + $cfg.title + '的媒体控制。请在' + $cfg.title + '里先播放一次，确认任务栏音量浮窗里能看到歌曲信息')
  }

  if (Test-Playing $session) {
    $track = Get-Track $session
    if ($track) { Finish 'OK' ($track + '（原本就在播放）') }
    Finish 'OK' ($cfg.title + '（原本就在播放）')
  }

  # 暂停时先切到下一首，让它从头播放，而不是接着放上次停下的那首；
  # 有的播放器切歌后仍保持暂停，所以再补一次“播放”。冷启动时指令可能被忽略，隔几秒重试。
  if ($session.GetPlaybackInfo().Controls.IsNextEnabled) {
    $null = Await ($session.TrySkipNextAsync()) ([bool])
    Start-Sleep -Milliseconds 900
  }
  $lastPlay = [DateTime]::MinValue
  $finalDeadline = $deadline.AddSeconds(4)
  while ((Get-Date) -lt $finalDeadline) {
    $current = Find-Session $manager
    if ($current) { $session = $current }
    if (Test-Playing $session) {
      Start-Sleep -Milliseconds 500
      $track = Get-Track $session
      if ($track) { Finish 'OK' $track }
      Finish 'OK' ($cfg.title + '的下一首')
    }
    if (((Get-Date) - $lastPlay).TotalSeconds -ge 3) {
      $null = Await ($session.TryPlayAsync()) ([bool])
      $lastPlay = Get-Date
    }
    Start-Sleep -Milliseconds 250
  }
  Finish 'ERR' ('已发送播放指令，但' + $cfg.title + '没有开始播放（播放列表可能为空）')
} catch {
  Finish 'ERR' $_.Exception.Message
}
`;

function buildScript(player) {
  const config = {
    title: player.title,
    pattern: player.pattern,
    process: player.process,
    startName: player.startName,
    warmTimeout: WARM_TIMEOUT,
    coldTimeout: COLD_TIMEOUT
  };
  return SCRIPT.replace('__CONFIG__', Buffer.from(JSON.stringify(config), 'utf8').toString('base64'));
}

/// 返回正在播放的歌曲描述；失败时 reject，错误信息可以直接给用户看。
function playNext(playerId) {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('结束音乐需要在 Windows 上使用'));
  }
  const player = core.musicPlayer(playerId);
  const encoded = Buffer.from(buildScript(player), 'utf16le').toString('base64');

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', encoded],
      { windowsHide: true }
    );
    let output = '';
    let errors = '';
    const killer = setTimeout(() => child.kill(), (COLD_TIMEOUT + 25) * 1000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(killer);
      reject(new Error(`无法启动 PowerShell：${error.message}`));
    });
    child.on('close', () => {
      clearTimeout(killer);
      const line = output
        .split(/\r?\n/)
        .map((text) => text.trim())
        .reverse()
        .find((text) => text.startsWith('OK:') || text.startsWith('ERR:'));
      if (line && line.startsWith('OK:')) {
        resolve(line.slice(3) || '已开始播放');
      } else if (line) {
        reject(new Error(line.slice(4) || `无法控制${player.title}`));
      } else {
        const detail = errors.replace(/#< CLIXML[\s\S]*/, '').trim();
        reject(new Error(detail || `无法控制${player.title}`));
      }
    });
  });
}

module.exports = { playNext, buildScript };
