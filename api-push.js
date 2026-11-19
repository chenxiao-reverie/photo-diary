#!/usr/bin/env node
/**
 * api-push.js — 通过 GitHub REST API 推送（绕过 git 协议被代理拦截的问题）
 * 流程：blob 上传 → tree 构建 → commit 创建 → refs/heads/main 创建
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OWNER = 'chenxiao-reverie';
const REPO = 'photo-diary';
const TOKEN = require('child_process').execSync('gh auth token').toString().trim();
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const COMMIT_MSG = process.argv[2] || 'feat: 图片日记 v1.0 —— 网页/App 双形态图片日记卡片生成器';

// 与 .gitignore 一致的排除规则
const EXCLUDE = new Set(['.git', '.workbuddy', '图片日记-单文件版.html', 'PhotoDiary-需求确凿书.md', '.DS_Store']);
// 字体目录：排除霞鹜包内未使用的变体切片（GB 版等），其余全部放行
function fontFileWanted(rel) {
  if (!rel.startsWith('fonts/LXGWWenKaiScreen/files/')) return true;
  return /^fonts\/LXGWWenKaiScreen\/files\/lxgwwenkaiscreen-subset-\d+\.woff2$/.test(rel);
}

function walk(dir, base) {
  let out = [];
  for (const name of fs.readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue;
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) out = out.concat(walk(full, rel));
    else out.push({ rel, full, size: st.size });
  }
  return out;
}

async function ghApi(url, body, method = 'POST', tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const resp = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'photo-diary-push'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!resp.ok) throw new Error(`${method} ${url} -> ${resp.status}: ${await resp.text()}`);
      return resp.json();
    } catch (e) {
      if (i === tries) throw e;
      const isRateLimit = /403|rate limit/i.test(e.message);
      const wait = isRateLimit ? 65000 : 2000 * i;
      process.stdout.write(`\n  [重试 ${i}/${tries}] ${e.message.slice(0, 70)} → 等 ${Math.round(wait / 1000)}s\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function main() {
  let files = walk(ROOT, '').filter((f) => fontFileWanted(f.rel));
  // .github/ 下的文件 Git Data API 会 404，稍后单独走 Contents API
  const workflowFile = files.find((f) => f.rel.startsWith('.github/'));
  files = files.filter((f) => !f.rel.startsWith('.github/'));
  console.log(`共 ${files.length} 个文件待上传（另有 ${workflowFile ? 1 : 0} 个工作流文件走 Contents API）`);

  // 0. 空仓库引导：用 Contents API 创建首个 commit（否则 blob 接口返回 409）
  const readmeLocal = path.join(ROOT, 'README.md');
  try {
    await ghApi(`${API}/contents/README.md`, {
      message: 'chore: 仓库初始化',
      content: fs.readFileSync(readmeLocal).toString('base64')
    }, 'PUT');
    console.log('空仓库引导 commit 已创建');
  } catch (e) {
    if (!String(e).includes('422')) throw e;  // 422 = 已存在，正常
    console.log('仓库已有内容，跳过引导');
  }

  // 1. 并发上传 blob（并发 3 + 节流，避免触发次级限流）
  const entries = [];
  let done = 0;
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      const content = fs.readFileSync(f.full).toString('base64');
      const { sha } = await ghApi(`${API}/git/blobs`, { content, encoding: 'base64' });
      entries.push({ path: f.rel, mode: '100644', type: 'blob', sha });
      done++;
      process.stdout.write(`\r  blob ${done}/${files.length}  ${f.rel.slice(0, 60).padEnd(60)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  console.log('');

  // 2. 基于 main 当前 commit 构建根 tree（main 不存在则从 master 镜像创建）
  let baseSha;
  try {
    baseSha = (await ghApi(`${API}/git/ref/heads/main`, null, 'GET')).object.sha;
  } catch (e) {
    baseSha = (await ghApi(`${API}/git/ref/heads/master`, null, 'GET')).object.sha;
    await ghApi(`${API}/git/refs`, { ref: 'refs/heads/main', sha: baseSha });
    console.log('main 分支不存在，已从 master 镜像创建');
  }
  const baseCommit = await ghApi(`${API}/git/commits/${baseSha}`, null, 'GET');
  // 树/提交/引用用 gh CLI（fetch 在本环境对这类请求不稳定），blob 已用 fetch 完成上传
  const { execSync } = require('child_process');
  function ghCli(endpoint, jsonFile, method) {
    const m = method ? `-X ${method}` : '';
    return JSON.parse(execSync(`gh api ${m} ${endpoint} --input "${jsonFile}" -H "Content-Type: application/json"`).toString());
  }
  const os = require('os');
  const tmpTree = path.join(os.tmpdir(), 'pd-tree.json');
  fs.writeFileSync(tmpTree, JSON.stringify({ base_tree: baseCommit.tree.sha, tree: entries }));
  let tree, commit;
  for (let i = 1; i <= 3; i++) {
    try {
      tree = ghCli(`repos/${OWNER}/${REPO}/git/trees`, tmpTree);
      break;
    } catch (e) {
      if (i === 3) throw e;
      console.log(`\n  [重试 ${i}/3] trees: ${String(e).slice(0, 60)}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  console.log(`tree: ${tree.sha}`);

  const tmpCommit = path.join(os.tmpdir(), 'pd-commit.json');
  fs.writeFileSync(tmpCommit, JSON.stringify({ message: COMMIT_MSG, tree: tree.sha, parents: [baseSha] }));
  commit = ghCli(`repos/${OWNER}/${REPO}/git/commits`, tmpCommit);
  console.log(`commit: ${commit.sha}`);

  // 4. 更新 main 分支引用
  const tmpRef = path.join(os.tmpdir(), 'pd-ref.json');
  fs.writeFileSync(tmpRef, JSON.stringify({ sha: commit.sha, force: true }));
  ghCli(`repos/${OWNER}/${REPO}/git/refs/heads/main`, tmpRef, 'PATCH');
  console.log('分支 main 已更新');

  // 5. 工作流文件走 Contents API（Git Data API 对 .github/ 路径返回 404）
  // 注意：token 缺 workflow scope 时 PUT 会 404 —— 先比对内容，没变就跳过
  if (workflowFile) {
    const localContent = fs.readFileSync(workflowFile.full).toString('base64');
    let remoteSha = null;
    try {
      remoteSha = (await ghApi(`${API}/contents/${workflowFile.rel}?ref=main`, null, 'GET')).sha;
    } catch (e) { /* 远端不存在，继续走 PUT */ }
    if (remoteSha) {
      try {
        const remoteContent = (await ghApi(`${API}/contents/${workflowFile.rel}?ref=main`, null, 'GET')).content.replace(/\n/g, '');
        if (remoteContent === localContent) {
          console.log('工作流文件无变化，跳过上传');
          return finish();
        }
      } catch (e) {}
      console.log('⚠️ 工作流有改动，但 token 缺 workflow scope 无法更新 —— 请运行 `gh auth refresh -s workflow` 或在网页端手动更新');
      return finish();
    }
    await ghApi(`${API}/contents/${workflowFile.rel}`, {
      message: 'ci: 添加 APK 云端打包流水线',
      content: localContent,
      branch: 'main'
    }, 'PUT');
    console.log(`工作流已上传: ${workflowFile.rel}`);
  }

  function finish() {
    console.log(`✅ 推送完成：https://github.com/${OWNER}/${REPO}/actions`);
  }

  console.log(`✅ 推送完成：https://github.com/${OWNER}/${REPO}/commit/${commit.sha.slice(0, 7)}`);
}

main().catch((e) => { console.error('\n❌ 推送失败:', e.message); process.exit(1); });
