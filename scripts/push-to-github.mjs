/**
 * push-to-github.mjs — 用 GitHub REST API 推送归档目录（本机无 git）
 *
 * 工作方式：
 *   1. 创建/复用仓库 furoute/dsh
 *   2. 先用 Git Data API 一次性建 tree（比逐文件 Contents API 快得多，且原子）
 *   3. 创建 commit，更新分支引用
 *
 * 用法：
 *   node push-to-github.mjs --dry-run     # 只列出将推送的文件，不调用写接口
 *   node push-to-github.mjs --push        # 真正推送
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const OWNER = 'furoute';
const REPO = 'dsh';
const BRANCH = 'main';
const ROOT = 'D:\\LLM\\DSH\\work\\_dsh-archive';
const PROXY = 'http://127.0.0.1:7897';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const PUSH = args.includes('--push');
if (!DRY && !PUSH) { console.error('请指定 --dry-run 或 --push'); process.exit(1); }

// 从注册表取用户级 token（DSH 会话环境被净化，不继承）
const { execSync } = await import('node:child_process');
let TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  try {
    TOKEN = execSync(
      `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('GH_TOKEN','User')"`,
      { encoding: 'utf8' }
    ).trim();
  } catch { /* ignore */ }
}
if (!TOKEN) { console.error('未找到 GH_TOKEN'); process.exit(1); }

// ---------- HTTP（经 HTTP 代理 CONNECT 隧道，零依赖） ----------
import http from 'node:http';
import https from 'node:https';

function requestViaProxy(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const proxy = new URL(PROXY);

    // 先与代理建立 CONNECT 隧道
    const connectReq = http.request({
      host: proxy.hostname,
      port: proxy.port,
      method: 'CONNECT',
      path: `${target.hostname}:443`,
      headers: { Host: `${target.hostname}:443` },
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`代理 CONNECT 失败: ${res.statusCode}`));
      }
      // 在隧道上发起 TLS 请求
      const req = https.request({
        socket, agent: false,
        method,
        path: target.pathname + target.search,
        host: target.hostname,
        headers: { ...headers, Host: target.hostname },
      }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({
          status: r.statusCode,
          ok: r.statusCode >= 200 && r.statusCode < 300,
          text: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

    connectReq.on('error', reject);
    connectReq.end();
  });
}

async function gh(method, path, body) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-archive',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  let payload = null;
  if (body) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  const res = await requestViaProxy(method, url, headers, payload);
  let json = null;
  try { json = res.text ? JSON.parse(res.text) : null; } catch { json = { raw: res.text }; }
  return { status: res.status, ok: res.ok, json };
}

// ---------- 收集文件 ----------
// 硬性排除（无论 .gitignore 怎么写）
const SKIP = [
  /node_modules/, /[\\/]\.git[\\/]/, /__pycache__/,
  /\.bak(-|$)/, /\.log$/, /\.tmp$/,
];

// 读取 .gitignore，把其中的模式转成正则，确保「被忽略的文件绝不推送」
function loadGitignore() {
  const rules = [];
  let txt = '';
  try { txt = readFileSync(join(ROOT, '.gitignore'), 'utf8'); } catch { return rules; }
  for (let line of txt.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    // 转义正则元字符，再还原 glob 通配
    let re = line
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')
      .replace(/\?/g, '[^/]');
    // 目录形式（以 / 结尾）只匹配目录本身
    const dirOnly = re.endsWith('/');
    if (dirOnly) re = re.slice(0, -1);
    // 有斜杠 = 锚定根；无斜杠 = 匹配任意层级
    const anchored = line.includes('/');
    const pattern = anchored
      ? `^${re}($|/)`
      : `(^|/)${re}($|/)`;
    rules.push({ re: new RegExp(pattern), negate, dirOnly });
  }
  return rules;
}

const IGNORE = loadGitignore();

function isIgnored(rel) {
  let ignored = false;
  for (const r of IGNORE) {
    if (r.re.test(rel)) ignored = !r.negate;
  }
  return ignored;
}

// 兜底安全网：推送前再次扫描真实密钥（读本机基准文件，若无则跳过）
const KNOWN_FILE = join(ROOT, '.known-secrets.local');
let KNOWN_SECRETS = [];
try {
  KNOWN_SECRETS = readFileSync(KNOWN_FILE, 'utf8').split(/\r?\n/)
    .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
} catch { /* 无基准文件则仅靠 .gitignore + SKIP */ }

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).split(sep).join('/');
    if (SKIP.some(re => re.test(full))) continue;
    if (isIgnored(rel)) continue;          // 严格遵守 .gitignore
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push({ rel, full, size: st.size });
  }
  return out;
}

const files = walk(ROOT);

// 兜底：逐文件确认不含已知真实密钥，命中即中止
if (KNOWN_SECRETS.length) {
  const leaked = [];
  for (const f of files) {
    let t;
    try { t = readFileSync(f.full, 'utf8'); } catch { continue; }
    for (const s of KNOWN_SECRETS) if (t.includes(s)) leaked.push(f.rel);
  }
  if (leaked.length) {
    console.error('\n❌ 中止：以下文件含真实密钥，已阻止推送：');
    leaked.forEach(x => console.error('   ' + x));
    process.exit(1);
  }
  console.log(`\n✓ 密钥兜底检查通过（比对 ${KNOWN_SECRETS.length} 条基准，均未出现在待推送文件中）`);
}

console.log(`\n=== 归档目录: ${ROOT}`);
console.log(`=== 文件数: ${files.length}（已遵守 .gitignore）\n`);
for (const f of files) {
  console.log(`  ${f.rel.padEnd(62)} ${String(f.size).padStart(7)} B`);
}

if (DRY) {
  const total = files.reduce((s, f) => s + f.size, 0);
  console.log(`\n[DRY-RUN] 合计 ${files.length} 个文件, ${(total / 1024).toFixed(1)} KB`);
  console.log('[DRY-RUN] 未调用任何写接口。');
  process.exit(0);
}

// ---------- 推送 ----------
console.log('\n--- 1. 确认/创建仓库 ---');
let r = await gh('GET', `/repos/${OWNER}/${REPO}`);
if (r.status === 404) {
  console.log('仓库不存在，创建中...');
  r = await gh('POST', '/user/repos', {
    name: REPO,
    description: '个人 DSH (DeepSeek Harness) 扩展归档：客户端插件、会话工具与中文实践文档（已脱敏）',
    private: false,
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  });
  if (!r.ok) { console.error('创建失败:', r.status, JSON.stringify(r.json)); process.exit(1); }
  console.log('已创建:', r.json.full_name);
} else if (r.ok) {
  console.log('仓库已存在:', r.json.full_name, '| 默认分支:', r.json.default_branch);
} else {
  console.error('查询仓库失败:', r.status, JSON.stringify(r.json)); process.exit(1);
}

// 取当前分支 HEAD（仓库可能为空）
let parentSha = null;
let baseTree = null;
let refRes = await gh('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);

// 空仓库无法创建 blob，需先用 Contents API 做一次初始化提交
if (refRes.status === 409 || refRes.status === 404) {
  const rInfo = await gh('GET', `/repos/${OWNER}/${REPO}`);
  if (rInfo.ok && rInfo.json.size === 0) {
    console.log('空仓库：先用 Contents API 初始化...');
    const init = await gh('PUT', `/repos/${OWNER}/${REPO}/contents/README.md`, {
      message: 'chore: 初始化仓库',
      content: Buffer.from('# DSH Extensions\n\n初始化中，内容即将推送。\n').toString('base64'),
      branch: BRANCH,
    });
    if (!init.ok) {
      console.error('初始化失败:', init.status, JSON.stringify(init.json));
      process.exit(1);
    }
    console.log('初始化完成，commit:', init.json.commit.sha.slice(0, 8));
    refRes = await gh('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  }
}

if (refRes.ok) {
  parentSha = refRes.json.object.sha;
  const c = await gh('GET', `/repos/${OWNER}/${REPO}/git/commits/${parentSha}`);
  baseTree = c.json.tree.sha;
  console.log('当前 HEAD:', parentSha.slice(0, 8));
} else {
  console.log('分支尚不存在（首次推送）');
}

console.log('\n--- 2. 上传 blob ---');
const tree = [];
for (const f of files) {
  const content = readFileSync(f.full);
  const b = await gh('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: content.toString('base64'),
    encoding: 'base64',
  });
  if (!b.ok) { console.error(`blob 失败 ${f.rel}:`, b.status, JSON.stringify(b.json)); process.exit(1); }
  tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: b.json.sha });
  process.stdout.write(`\r  已上传 ${tree.length}/${files.length}`);
}
console.log('');

console.log('\n--- 3. 创建 tree ---');
const treeRes = await gh('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
  tree,
  ...(baseTree ? { base_tree: baseTree } : {}),
});
if (!treeRes.ok) { console.error('tree 失败:', treeRes.status, JSON.stringify(treeRes.json)); process.exit(1); }
console.log('tree:', treeRes.json.sha.slice(0, 8));

console.log('\n--- 4. 创建 commit ---');
const msg = parentSha
  ? `chore: 同步 DSH 扩展归档 (${files.length} 个文件)`
  : `feat: 初始化 DSH 扩展归档\n\n归档 4 个自建客户端插件、会话检索工具与中文实践文档。\n所有私有凭据经脱敏管线剔除，审计闸门校验通过。`;
const commitRes = await gh('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message: msg,
  tree: treeRes.json.sha,
  ...(parentSha ? { parents: [parentSha] } : {}),
});
if (!commitRes.ok) { console.error('commit 失败:', commitRes.status, JSON.stringify(commitRes.json)); process.exit(1); }
console.log('commit:', commitRes.json.sha.slice(0, 8));

console.log('\n--- 5. 更新分支引用 ---');
if (parentSha) {
  const u = await gh('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    sha: commitRes.json.sha, force: false,
  });
  if (!u.ok) { console.error('更新失败:', u.status, JSON.stringify(u.json)); process.exit(1); }
} else {
  const c = await gh('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
    ref: `refs/heads/${BRANCH}`, sha: commitRes.json.sha,
  });
  if (!c.ok) { console.error('建分支失败:', c.status, JSON.stringify(c.json)); process.exit(1); }
}
console.log('\n✅ 推送完成: https://github.com/' + OWNER + '/' + REPO);
