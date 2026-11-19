#!/usr/bin/env node
/**
 * build-singlefile.js — 把字体 woff2 内嵌进 HTML，生成单文件版
 * 用法：node build-singlefile.js
 * 产物：图片日记-单文件版.html（拷到任何设备双击即用，无需 fonts 目录）
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INDEX = path.join(ROOT, 'index.html');
const FONT_CSS = path.join(ROOT, 'fonts', 'LXGWWenKaiScreen', 'lxgwwenkaiscreen.css');
const FONT_DIR = path.join(ROOT, 'fonts', 'LXGWWenKaiScreen', 'files');
const REGISTRY = 'https://registry.npmmirror.com';
const OUT = path.join(ROOT, '图片日记-单文件版.html');

let css = fs.readFileSync(FONT_CSS, 'utf8');

// 把每个 url('./files/xxx.woff2') 替换为 base64 data URI
const urlRe = /url\('\.\/files\/([^']+)'\)\s*format\('woff2'\)/g;
let inlined = 0, missing = 0;
css = css.replace(urlRe, (_, file) => {
  const p = path.join(FONT_DIR, file);
  if (!fs.existsSync(p)) { missing++; return "url('') format('woff2')"; }
  const buf = fs.readFileSync(p);
  inlined++;
  return `url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2')`;
});

if (missing) console.warn(`⚠️ ${missing} 个字体分块缺失（已跳过，回退系统衬线）`);

let html = fs.readFileSync(INDEX, 'utf8');
const linkTag = '<link rel="stylesheet" href="fonts/LXGWWenKaiScreen/lxgwwenkaiscreen.css">';
if (!html.includes(linkTag)) {
  console.error('❌ index.html 中未找到字体 link 标签，构建中止');
  process.exit(1);
}
html = html.replace(linkTag, `<style>\n/* 霞鹜文楷屏幕阅读版（内嵌 base64，共 ${inlined} 个分块） */\n${css}\n</style>`);

// 其余字体：单文件不带 fonts 目录，改走 jsdelivr CDN（离线时回退系统衬线）
const CDN_FONTS = {
  'fonts/ma-shan-zheng/400.css': '@fontsource/ma-shan-zheng',
  'fonts/zcool-kuaile/400.css': '@fontsource/zcool-kuaile',
  'fonts/long-cang/400.css': '@fontsource/long-cang',
  'fonts/zhi-mang-xing/400.css': '@fontsource/zhi-mang-xing',
  'fonts/noto-serif-sc/400.css': '@fontsource/noto-serif-sc'
};
for (const [localPath, pkg] of Object.entries(CDN_FONTS)) {
  let ver = '5.3.0';
  try {
    const meta = JSON.parse(require('child_process').execSync(
      `curl -sL --connect-timeout 10 "${REGISTRY}/${pkg}/latest"`
    ).toString());
    ver = meta.version || ver;
  } catch (e) { console.warn(`⚠️ ${pkg} 版本查询失败，用默认 ${ver}`); }
  const re = new RegExp(`'${localPath.replace(/\//g, '\\/')}'`, 'g');
  html = html.replace(re, `'https://cdn.jsdelivr.net/npm/${pkg}@${ver}/400.css'`);
}

fs.writeFileSync(OUT, html);
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`✅ 已生成 ${path.basename(OUT)}（${mb} MB，内嵌 ${inlined} 个字体分块）`);
