#!/bin/zsh
set -euo pipefail

project_dir=${0:A:h:h}
build_dir="$project_dir/.build/release"
dist_dir="$project_dir/dist"
app_dir="$dist_dir/专注芽.app"
contents_dir="$app_dir/Contents"
iconset_dir="$project_dir/.build/FocusBloom.iconset"
master_icon="$project_dir/.build/FocusBloomIcon.png"

# 版本号只在 windows/package.json 里维护一处，Mac 版和 Windows 版保持一致。
# 自动更新靠它比较新旧版本，每次发布前都要改大。
app_version=$(plutil -extract version raw -o - "$project_dir/windows/package.json")

# 自动更新（Sparkle）：从官网读取 appcast.xml（由 Scripts/release_mac.sh 生成）；更新包用钥匙串里的私钥签名，
# App 用下面的公钥校验。私钥由 Sparkle 的 generate_keys 生成，丢了就没法给已安装的用户推送更新。
feed_url="https://helloxxy.com/works/focusbloom/downloads/appcast.xml"
sparkle_public_key="a4YYKzVnInWnOIYfKWrARvEEsYKyac4bSKazr9nqeLo="

swift build -c release --package-path "$project_dir"

mkdir -p "$contents_dir/MacOS" "$contents_dir/Resources" "$iconset_dir"
cp "$build_dir/FocusBloom" "$contents_dir/MacOS/FocusBloom"

rm -rf "$contents_dir/Frameworks"
mkdir -p "$contents_dir/Frameworks"
ditto "$build_dir/Sparkle.framework" "$contents_dir/Frameworks/Sparkle.framework"
install_name_tool -add_rpath "@executable_path/../Frameworks" "$contents_dir/MacOS/FocusBloom"

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

cat > "$contents_dir/Info.plist" <<PLIST
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
    <string>$app_version</string>
    <key>CFBundleVersion</key>
    <string>$app_version</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>NSAppleEventsUsageDescription</key>
    <string>专注芽需要控制“音乐”App 或通过“System Events”操作网易云音乐，以便在一轮专注结束后自动播放音乐。</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>SUFeedURL</key>
    <string>$feed_url</string>
    <key>SUPublicEDKey</key>
    <string>$sparkle_public_key</string>
    <key>SUEnableAutomaticChecks</key>
    <true/>
</dict>
</plist>
PLIST

# 用 Developer ID 证书签名并开启 hardened runtime，这样才能交给 Apple 公证（Scripts/release_mac.sh）。
# 签名身份不变，系统授权（辅助功能、自动化）在重新打包、更新后仍然有效。
# 由内向外签：Sparkle.framework 自带的是临时签名，里面每个可执行文件都要换成同一张证书；
# 不用 --deep，否则 Downloader.xpc 的 entitlements 会被抹掉。
# 没有这张证书时退回临时签名，只能自己用，公证会失败，每次打包后也要重新授权。
signing_identity="${FOCUSBLOOM_SIGNING_IDENTITY:-Developer ID Application: Li Ming wang (46AL7LQ9T8)}"
if security find-identity -v -p codesigning | grep -qF "\"$signing_identity\""; then
  sign=(codesign --force --sign "$signing_identity" --options runtime --timestamp)
else
  echo "未找到代码签名证书“$signing_identity”，使用临时签名（不能公证，重新打包后需要重新授权辅助功能）。" >&2
  sign=(codesign --force --sign -)
fi
sparkle_dir="$contents_dir/Frameworks/Sparkle.framework/Versions/B"
"${sign[@]}" "$sparkle_dir/XPCServices/Installer.xpc"
"${sign[@]}" --preserve-metadata=entitlements "$sparkle_dir/XPCServices/Downloader.xpc"
"${sign[@]}" "$sparkle_dir/Autoupdate"
"${sign[@]}" "$sparkle_dir/Updater.app"
"${sign[@]}" "$contents_dir/Frameworks/Sparkle.framework"
"${sign[@]}" --entitlements "$project_dir/Scripts/FocusBloom.entitlements" "$app_dir"
codesign --verify --deep --strict "$app_dir"
echo "$app_dir"
