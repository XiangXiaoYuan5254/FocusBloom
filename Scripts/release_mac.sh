#!/bin/zsh
# 发布 macOS 版：打包（Developer ID 签名）→ Apple 公证并贴上票据 → 压缩成 FocusBloom-macOS.zip
# → 用 Sparkle 私钥签名 → 生成 appcast.xml。
# 已安装的专注芽读取官网上的 appcast.xml 发现新版本，再从官网下载同目录的 zip，
# 所以这两个文件都要放到官网的 downloads/ 下（本地有 website/ 目录时会自动复制过去）。
#
#   zsh Scripts/release_mac.sh            只在 dist/ 里生成两个文件
#   zsh Scripts/release_mac.sh --upload   同时把 zip 上传到 GitHub 上 v<版本号> 的 Release（没有就先建一个草稿）
#
# 更新窗口里显示的更新说明取自这个 Release 的正文（Markdown），所以先在 GitHub 上写好正文再运行；
# 之后改了正文，重新运行一次即可。
set -euo pipefail

project_dir=${0:A:h:h}
dist_dir="$project_dir/dist"
repo="XiangXiaoYuan5254/FocusBloom"
sparkle_bin="$project_dir/.build/artifacts/sparkle/Sparkle/bin"
version=$(plutil -extract version raw -o - "$project_dir/windows/package.json")
tag="v$version"
zip_path="$dist_dir/FocusBloom-macOS.zip"
appcast_path="$dist_dir/appcast.xml"
downloads_url="https://helloxxy.com/works/focusbloom/downloads"
site_downloads="$project_dir/website/downloads"

# 公证凭据：xcrun notarytool store-credentials helloxxy-notary（存在登录钥匙串里）
notary_profile="${FOCUSBLOOM_NOTARY_PROFILE:-helloxxy-notary}"

upload=false
if [[ "${1:-}" == "--upload" ]]; then
  upload=true
  command -v gh >/dev/null || { echo "上传需要 GitHub CLI（gh），先运行 brew install gh 并 gh auth login。" >&2; exit 1; }
fi

zsh "$project_dir/Scripts/package_app.sh" >/dev/null
app_dir="$dist_dir/专注芽.app"

# 交给 Apple 公证（几分钟，期间别让 Mac 锁屏，否则读不到凭据），通过后把票据贴进 App，
# 这样下载的用户第一次打开不会被 Gatekeeper 拦下。
rm -f "$zip_path"
ditto -c -k --keepParent "$app_dir" "$zip_path"
result=$(xcrun notarytool submit "$zip_path" --keychain-profile "$notary_profile" --wait --output-format json)
if [[ "$(plutil -extract status raw -o - - <<<"$result")" != "Accepted" ]]; then
  echo "公证没有通过：$result" >&2
  echo "查看原因：xcrun notarytool log <id> --keychain-profile $notary_profile" >&2
  exit 1
fi
xcrun stapler staple -q "$app_dir"
# 打包用的 Mac 可能关掉了 Gatekeeper，那样 spctl 什么都放行，所以只认来源是否为已公证的 Developer ID。
spctl -a -vv -t exec "$app_dir" 2>&1 | grep -q "source=Notarized Developer ID" || { echo "$app_dir 没有公证上" >&2; exit 1; }

rm -f "$zip_path"
ditto -c -k --keepParent "$app_dir" "$zip_path"

# 输出形如 sparkle:edSignature="…" length="…"，直接放进 appcast 的 enclosure。
signature=$("$sparkle_bin/sign_update" --account FocusBloom "$zip_path")

notes=""
if command -v gh >/dev/null && gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  notes=$(gh release view "$tag" --repo "$repo" --json body --jq .body)
fi
description=""
if [[ -n "$notes" ]]; then
  description="<description sparkle:format=\"markdown\"><![CDATA[${notes//]]>/]]]]><![CDATA[>}]]></description>"
else
  echo "提示：GitHub 上 $tag 的 Release 还没有正文，更新窗口里不会显示更新说明。" >&2
fi

pub_date=$(LC_ALL=C date -u "+%a, %d %b %Y %H:%M:%S +0000")
cat > "$appcast_path" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>专注芽</title>
    <item>
      <title>专注芽 $version</title>
      <pubDate>$pub_date</pubDate>
      <sparkle:version>$version</sparkle:version>
      <sparkle:shortVersionString>$version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      $description
      <enclosure url="$downloads_url/FocusBloom-macOS.zip" type="application/octet-stream" $signature/>
    </item>
  </channel>
</rss>
XML

echo "$zip_path"
echo "$appcast_path"

if [[ -d "$site_downloads" ]]; then
  cp "$zip_path" "$appcast_path" "$site_downloads/"
  echo "已复制到 $site_downloads，部署官网后已安装的用户就会收到更新。"
fi

if $upload; then
  if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
    gh release create "$tag" --repo "$repo" --draft --title "专注芽 $tag" --notes ""
  fi
  gh release upload "$tag" "$zip_path" --repo "$repo" --clobber
  echo "已上传到 $tag。"
fi
