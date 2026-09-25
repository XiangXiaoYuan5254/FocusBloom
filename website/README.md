# 专注芽官网

纯静态网站，没有构建步骤，把整个 `website/` 目录部署到任意静态托管即可（Nginx、Vercel、Netlify、Cloudflare Pages、GitHub Pages、阿里云 OSS / 腾讯云 COS 等）。

```text
website/
├── index.html
├── assets/
│   ├── css/style.css
│   ├── js/main.js      ← 版本号、下载地址等配置在文件顶部的 SITE 对象
│   ├── img/            ← App 图标（由 Scripts/generate_icon.swift 生成）
│   └── audio/          ← 环境音网页试听版（96 kbps，由 Resources/Ambient 转码）
└── downloads/          ← 官网直链下载的安装包放这里
```

## 本地预览

```bash
python3 -m http.server 5391 --directory website
```

然后打开 <http://localhost:5391>。环境音试听需要通过 http 访问，直接双击打开 `index.html` 时无法加载音频。

## 发布新版本

1. 构建 App 并打包成 zip：

   ```bash
   zsh Scripts/package_app.sh
   ditto -c -k --keepParent "dist/专注芽.app" website/downloads/FocusBloom-macOS.zip
   ```

2. 修改 `assets/js/main.js` 顶部 `SITE.version`。
3. 把同一个 zip 以 `FocusBloom-macOS.zip` 为文件名上传到 GitHub Release。
4. 重新部署 `website/`。

如果 `downloads/` 里没有安装包，页面会自动把「官网下载」按钮指向 GitHub 最新 Release 中的 `FocusBloom-macOS.zip`，不会出现 404。

安装包也可以放在 CDN 或对象存储上，把 `SITE.downloadUrl` 改成完整地址即可。

## 更新环境音试听

```bash
for f in rain waves stream wind fire birds crickets; do
  afconvert -f m4af -d aac -b 96000 "Resources/Ambient/$f.m4a" "website/assets/audio/$f.m4a"
done
```
