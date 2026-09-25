#!/bin/zsh
set -euo pipefail

project_dir=${0:A:h:h}
build_dir="$project_dir/.build/release"
dist_dir="$project_dir/dist"
app_dir="$dist_dir/专注芽.app"
contents_dir="$app_dir/Contents"
iconset_dir="$project_dir/.build/FocusBloom.iconset"
master_icon="$project_dir/.build/FocusBloomIcon.png"

swift build -c release --package-path "$project_dir"

mkdir -p "$contents_dir/MacOS" "$contents_dir/Resources" "$iconset_dir"
cp "$build_dir/FocusBloom" "$contents_dir/MacOS/FocusBloom"

swift "$project_dir/Scripts/generate_icon.swift" "$master_icon"

for spec in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  pixels=${spec%% *}
  filename=${spec#* }
  sips -z "$pixels" "$pixels" "$master_icon" --out "$iconset_dir/$filename" >/dev/null
done

iconutil -c icns "$iconset_dir" -o "$contents_dir/Resources/FocusBloom.icns"

# 环境音录音（来源与授权见 Resources/Ambient/CREDITS.md）
rm -rf "$contents_dir/Resources/Ambient"
mkdir -p "$contents_dir/Resources/Ambient"
cp "$project_dir"/Resources/Ambient/*.m4a "$contents_dir/Resources/Ambient/"

cat > "$contents_dir/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>zh_CN</string>
    <key>CFBundleDisplayName</key>
    <string>专注芽</string>
    <key>CFBundleExecutable</key>
    <string>FocusBloom</string>
    <key>CFBundleIconFile</key>
    <string>FocusBloom</string>
    <key>CFBundleIdentifier</key>
    <string>com.local.FocusBloom</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>专注芽</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.1.0</string>
    <key>CFBundleVersion</key>
    <string>2</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>NSAppleEventsUsageDescription</key>
    <string>专注芽需要控制“音乐”App 或通过“System Events”操作网易云音乐，以便在一轮专注结束后自动播放音乐。</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$app_dir"
echo "$app_dir"
