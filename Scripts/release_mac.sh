#!/bin/zsh
# 发布 macOS 版：打包 → 压缩成 FocusBloom-macOS.zip → 用 Sparkle 私钥签名 → 生成 appcast.xml。
# 已安装的专注芽通过 GitHub 最新 Release 里的 appcast.xml 发现新版本，所以这两个文件都要上传。
#
#   zsh Scripts/release_mac.sh            只在 dist/ 里生成两个文件
#   zsh Scripts/release_mac.sh --upload   同时上传到 GitHub 上 v<版本号> 的 Release（没有就先建一个草稿）
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

upload=false
if [[ "${1:-}" == "--upload" ]]; then
  upload=true
  command -v gh >/dev/null || { echo "上传需要 GitHub CLI（gh），先运行 brew install gh 并 gh auth login。" >&2; exit 1; }
fi

zsh "$project_dir/Scripts/package_app.sh" >/dev/null
rm -f "$zip_path"
ditto -c -k --keepParent "$dist_dir/专注芽.app" "$zip_path"

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
      <enclosure url="https://github.com/$repo/releases/download/$tag/FocusBloom-macOS.zip" type="application/octet-stream" $signature/>
    </item>
  </channel>
</rss>
XML

echo "$zip_path"
echo "$appcast_path"

if $upload; then
  if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
    gh release create "$tag" --repo "$repo" --draft --title "专注芽 $tag" --notes ""
  fi
  gh release upload "$tag" "$zip_path" "$appcast_path" --repo "$repo" --clobber
  echo "已上传到 $tag。Release 发布（不是草稿）之后，已安装的用户才会收到更新。"
fi
