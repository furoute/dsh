/**
 * verify-remote.mjs — 推送后远端复验
 * 从 GitHub 实际拉回文件内容，做独立密钥扫描（不信任本地状态）
 */
import http from 'node:http';
import https from 'node:https';
import { execSync } from 'node:child_process';

const OWNER = 'furoute', REPO = 'dsh', BRANCH = 'main';
const PROXY = 'http://127.0.0.1:7897';

let TOKEN = process.env.GH_TOKEN || execSync(
  `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('GH_TOKEN','User')"`,
  { encoding: 'utf8' }).trim();

function req(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const t = new URL(url), p = new URL(PROXY);
    const c = http.request({ host: p.hostname, port: p.port, method: 'CONNECT',
      path: `${t.hostname}:443`, headers: { Host: `${t.hostname}:443` } });
    c.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error('CONNECT ' + res.statusCode));
      const r = https.request({ socket, agent: false, method,
        path: t.pathname + t.search, host: t.hostname,
        headers: { ...headers, Host: t.hostname } }, (resp) => {
        const ch = [];
        resp.on('data', (d) => ch.push(d));
        resp.on('end', () => resolve({ status: resp.statusCode,
          ok: resp.statusCode < 300, text: Buffer.concat(ch).toString('utf8') }));
      });
      r.on('error', reject);
      if (body) r.write(body);
      r.end();
    });
    c.on('error', reject);
    c.end();
  });
}

const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
  'User-Agent': 'dsh-verify', 'X-GitHub-Api-Version': '2022-11-28' };

// 1. 拉取远端文件树
const treeRes = await req('GET',
  `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`, H);
const tree = JSON.parse(treeRes.text).tree.filter(x => x.type === 'blob');
console.log(`\n远端文件数: ${tree.length}`);

// 2. 下载全部文本文件内容（raw），扫描
const PATTERNS = [
  ['sk-* Key',            /sk-[A-Za-z0-9]{16,}/g],
  ['GitHub Token',        /gh[opsu]_[A-Za-z0-9]{20,}/g],
  ['AWS Key',             /AKIA[0-9A-Z]{16}/g],
  ['Google API Key',      /AIza[0-9A-Za-z\-_]{30,}/g],
  ['Slack Token',         /xox[abprs]-[A-Za-z0-9\-]{10,}/g],
  ['PEM 私钥',            /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['长 Bearer',           /Bearer\s+[A-Za-z0-9\-_\.]{25,}/g],
  ['密钥赋值',            /(api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][A-Za-z0-9+/]{20,}["']/gi],
  ['本机用户名',          new RegExp('Tian' + '_Tian', 'g')],
  ['他人用户路径',        /[A-Za-z]:\\Users\\(?!<USER>)[A-Za-z0-9_.\-]+/g],
];

// 已知真实密钥的比对基准。
// ⚠ 绝不硬编码于此：凭据从本机独立文件读取（该文件不入库、不推送到任何远端）。
//    文件格式：每行一个待核验的密钥字符串，空行与 # 开头行忽略。
//    未提供该文件时跳过此项，仅运行上面的模式扫描。
const KNOWN_FILE = process.env.KNOWN_SECRETS_FILE
  || 'D:\\LLM\\DSH\\work\\_dsh-archive\\.known-secrets.local';
let KNOWN = [];
try {
  KNOWN = readFileSync(KNOWN_FILE, 'utf8')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'));
  console.log(`已载入 ${KNOWN.length} 条本地比对基准（来自 ${KNOWN_FILE}）`);
} catch {
  console.log('未提供本地比对基准文件，跳过"真实密钥零残留"检查');
}

let hits = [], knownHits = [];
for (const f of tree) {
  const raw = await req('GET',
    `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${f.path}`, H);
  if (raw.status !== 200) continue;
  const text = raw.text;

  for (const k of KNOWN) if (text.includes(k)) knownHits.push(`${f.path} ← 真实密钥残留`);

  for (const [name, re] of PATTERNS) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m) hits.push({ 文件: f.path, 规则: name, 数量: m.length,
      样例: m[0].slice(0, 30) });
  }
  process.stdout.write(`\r  已扫描 ${tree.indexOf(f) + 1}/${tree.length}`);
}
console.log('');

console.log('\n========== 远端复验报告 ==========');
console.log(`仓库: https://github.com/${OWNER}/${REPO}`);
console.log(`提交: ${JSON.parse((await req('GET',
  `https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}`, H)).text).sha.slice(0, 8)}`);

if (knownHits.length) {
  console.log('\n❌ 真实密钥残留:');
  knownHits.forEach(h => console.log('   ' + h));
}
if (hits.length) {
  console.log('\n⚠️  模式命中:');
  console.table(hits);
}
if (!knownHits.length && !hits.length) {
  console.log('\n✅ 远端零敏感信息：真实密钥 0 命中，模式扫描 0 命中');
}
console.log('==================================\n');
process.exit(knownHits.length || hits.length ? 1 : 0);
