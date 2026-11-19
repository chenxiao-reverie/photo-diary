#!/usr/bin/env node
/**
 * fetch-fonts.js — 从 npmmirror 下载 fontsource 中文字体切片包，
 * 只保留 400.css 引用到的 woff2（去重后一般 2~5MB/字体），供离线嵌入。
 * 用法：node fetch-fonts.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REGISTRY = 'https://registry.npmmirror.com';
const FONTS_DIR = path.join(__dirname, 'fonts');
const TARGETS = [
  { pkg: '@fontsource/ma-shan-zheng', dir: 'ma-shan-zheng' },
  { pkg: '@fontsource/zcool-kuaile', dir: 'zcool-kuaile' },
  { pkg: '@fontsource/long-cang', dir: 'long-cang' },
  { pkg: '@fontsource/zhi-mang-xing', dir: 'zhi-mang-xing' },
  { pkg: '@fontsource/noto-serif-sc', dir: 'noto-serif-sc' }
];

function dl(url, out) {
  execSync(`curl -sL --retry 3 --connect-timeout 15 -o "${out}" "${url}"`, { stdio: 'pipe' });
}

for (const t of TARGETS) {
  const dest = path.join(FONTS_DIR, t.dir);
  if (fs.existsSync(dest)) { console.log(`跳过 ${t.dir}（已存在，如需重下先删除目录）`); continue; }
  console.log(`下载 ${t.pkg} ...`);
  const meta = JSON.parse(execSync(`curl -sL "${REGISTRY}/${t.pkg}/latest"`).toString());
  const tgz = path.join('/tmp', t.dir + '.tgz');
  dl(meta.dist.tarball, tgz);
  fs.mkdirSync(dest, { recursive: true });
  execSync(`tar -xzf "${tgz}" -C "${dest}" --strip-components=1`);
  // 只保留 400.css 引用的 woff2（避免整个包的多字重体积；woff 是 fallback 不需要）
  const css = fs.readFileSync(path.join(dest, '400.css'), 'utf8');
  const used = new Set(
    [...css.matchAll(/url\(\.\/([^)']+?\.woff2)\)/g)].map((m) => m[1])
  );
  const keep = new Set(['400.css', 'LICENSE', ...used]);
  // 清掉没被 400.css 引用的文件
  (function clean(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = path.relative(dest, full);
      if (fs.statSync(full).isDirectory()) clean(full);
      else if (!keep.has(rel)) fs.unlinkSync(full);
    }
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory() && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    }
  })(dest);
  const size = execSync(`du -sk "${dest}" | cut -f1`).toString().trim();
  console.log(`  ✓ ${t.dir}: ${size} KB（${used.size} 个引用文件）`);
}
console.log('全部字体就绪');
