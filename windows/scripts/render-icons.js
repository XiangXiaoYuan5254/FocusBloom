// 用 Electron 自带的 Chromium 把 assets/icon.svg 渲染成 Windows 需要的 .ico / .png，
// 并画出托盘用的小叶子图标。在 Mac 和 Windows 上都能运行：npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appIcon = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');

// 托盘图标：一片带尖的叶子（Lucide leaf），小尺寸下也认得出。
// 空闲时是描边，专注中是实心加珊瑚色圆点（对应 Mac 菜单栏的 leaf / leaf.fill）。
const LEAF = 'M11 20a10 10 0 0 0 10-10 25.9 25.9 0 0 0-1.04-7.281 1 1 0 0 0-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0 0 11 20';
const STEM = 'M2 21a5 5 0 0 1 2.911-4.544C7.613 15.212 8.351 15.24 11 13';
const trayIdle = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 24 24">
  <g fill="none" stroke="#4CC49A" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="${LEAF}"/><path d="${STEM}"/>
  </g>
</svg>`;
const trayActive = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 24 24">
  <g stroke="#3FB68B" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="${LEAF}" fill="#6FD3AC"/><path d="${STEM}" fill="none"/>
  </g>
  <circle cx="19" cy="19.2" r="4" fill="#FF8A66" stroke="#0E1518" stroke-opacity="0.3" stroke-width="0.8"/>
</svg>`;

function rasterize(win, svg, size) {
  const source = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  return win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = ${size};
      canvas.height = ${size};
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, ${size}, ${size});
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    image.onerror = () => reject(new Error('svg failed'));
    image.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(source).toString('base64'))};
  })`).then((base64) => Buffer.from(base64, 'base64'));
}

/// Vista 以后的 .ico 可以直接内嵌 PNG。
function buildICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 });
  await win.loadURL('data:text/html,<!doctype html><title>icons</title>');

  const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const images = [];
  for (const size of icoSizes) images.push({ size, png: await rasterize(win, appIcon, size) });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), buildICO(images));
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), await rasterize(win, appIcon, 512));
  fs.writeFileSync(path.join(root, 'assets', 'icon.png'), await rasterize(win, appIcon, 256));

  // 16 px 对应 100% 缩放，其余给 125% / 150% / 200% 的高分屏。
  const trayScales = [
    ['', 16],
    ['@1.25x', 20],
    ['@1.5x', 24],
    ['@2x', 32]
  ];
  fs.mkdirSync(path.join(root, 'assets', 'tray'), { recursive: true });
  for (const [name, svg] of [
    ['tray-idle', trayIdle],
    ['tray-active', trayActive]
  ]) {
    for (const [suffix, size] of trayScales) {
      fs.writeFileSync(path.join(root, 'assets', 'tray', `${name}${suffix}.png`), await rasterize(win, svg, size));
    }
  }

  console.log('icons written: build/icon.ico, build/icon.png, assets/icon.png, assets/tray/*');
  app.quit();
});
