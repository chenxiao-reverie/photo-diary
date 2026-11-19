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

fs.writeFileSync(OUT, html);
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`✅ 已生成 ${path.basename(OUT)}（${mb} MB，内嵌 ${inlined} 个字体分块）`);
