// 把界面用到的第三方文件和图标整理进 src/renderer，渲染进程不依赖打包工具，直接用普通 <script> 加载。
// 依赖升级或需要新图标时运行：npm run prepare-renderer
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const modules = path.join(root, 'node_modules');
const renderer = path.join(root, 'src', 'renderer');

const vendorFiles = [
  ['preact/dist/preact.min.umd.js', 'preact.min.js'],
  ['preact/hooks/dist/hooks.umd.js', 'preact-hooks.min.js'],
  ['htm/dist/htm.umd.js', 'htm.min.js']
];

for (const [from, to] of vendorFiles) {
  const source = fs.readFileSync(path.join(modules, from), 'utf8').replace(/\n\/\/# sourceMappingURL=.*$/m, '');
  fs.writeFileSync(path.join(renderer, 'vendor', to), source);
}

// Lucide 图标（ISC 授权），和 macOS 版的 SF Symbols 一一对应。
const icons = [
  'activity', 'arrow-right', 'audio-lines', 'battery-low', 'bell-ring', 'bird', 'brain', 'calendar',
  'chart-line', 'chart-spline', 'check', 'chevron-right', 'circle-check', 'circle-dashed', 'circle-pause',
  'clock', 'cloud', 'cloud-rain', 'crosshair', 'droplet', 'eye', 'flame', 'gauge', 'hard-drive',
  'heart-pulse', 'history', 'hourglass', 'layout-grid', 'leaf', 'maximize-2', 'minus', 'moon-star', 'music',
  'pause', 'play', 'plus', 'quote', 'share', 'shuffle', 'sliders-horizontal', 'sparkles', 'sprout',
  'square', 'sun', 'tag', 'text-search', 'timer', 'trash-2', 'trending-up', 'volume-1', 'volume-2',
  'waves', 'wind', 'x'
];

const entries = icons.map((name) => {
  const svg = fs.readFileSync(path.join(modules, 'lucide-static', 'icons', `${name}.svg`), 'utf8');
  const body = svg
    .slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'))
    .replace(/\s*\n\s*/g, '')
    .trim();
  return `  ${JSON.stringify(name)}: ${JSON.stringify(body)}`;
});

fs.writeFileSync(
  path.join(renderer, 'icons.js'),
  `// 由 scripts/prepare-renderer.js 从 lucide-static 生成（ISC 授权），不要手动修改。\n` +
    `window.BloomIcons = {\n${entries.join(',\n')}\n};\n`
);

console.log(`vendor: ${vendorFiles.length} files, icons: ${icons.length}`);
