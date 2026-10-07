#!/usr/bin/env node
/**
 * DSH 会话内容搜索工具（早期版本）
 *
 * ⚠️ 已被 dsh-search.mjs 取代，建议优先使用后者：
 *      node dsh-search.mjs 关键词
 *   本脚本保留仅作参考。两者已知差距：
 *   1. 本脚本按"文件"平铺统计，未合并同一会话目录下的多个日志格式
 *      （实测有 4 个会话同时存在 v3/v4 日志，且互为补充而非超集，
 *        不平铺合并会导致重复计数与内容遗漏）；
 *   2. 本脚本不建立会话标题索引，纯标题命中（如"DSH无法搜索聊天内容"）搜不到；
 *   3. 不支持多关键词 AND 匹配。
 *   会话文件名的版本差异（v3/v4）已于 2026-10-03 修复。
 *
 * 背景：DSH 出厂默认关闭全文搜索（openAt: never），且 GUI 没有搜索框，
 *       所以本工具直接解密 ~/.dsh/sessions 下的 session.jsonl.zstd 来搜。
 *
 * 用法:
 *   node dsh-session-search.js <关键词> [选项]
 *
 * 选项:
 *   --limit N       最多显示 N 条结果（默认 30）
 *   --context N     结果前后额外显示 N 行（默认 0）
 *   --user          只搜我发的消息
 *   --assistant     只搜 AI 的回复
 *   --ws <关键词>   只在工作区路径包含该词的会话中搜
 *   --session <id>  只搜指定会话（id 前 8 位即可）
 *   --list          列出全部会话（按大小）
 *   --stats         显示会话统计概览
 *
 * 示例:
 *   node dsh-session-search.js "招标"
 *   node dsh-session-search.js "PPT" --assistant --limit 10
 *   node dsh-session-search.js "配置" --ws DSH
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SESSIONS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.dsh', 'sessions');
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

// ── 多帧 zstd 解压（DSH 是追加式写入，一个文件含多个 zstd 帧）──
function decompressMultiFrame(raw) {
  const frames = [];
  let pos = 0;
  while (true) {
    const idx = raw.indexOf(ZSTD_MAGIC, pos);
    if (idx < 0) break;
    frames.push(idx);
    pos = idx + 4;
  }
  let out = '';
  for (let i = 0; i < frames.length; i++) {
    const start = frames[i];
    const end = i + 1 < frames.length ? frames[i + 1] : raw.length;
    try { out += zlib.zstdDecompressSync(raw.subarray(start, end)).toString('utf8'); } catch { /* 跳过损坏帧 */ }
  }
  return out;
}

// ── 收集所有会话文件 ──
// 注意：会话文件名存在版本差异——session.jsonl.zstd / session.v3.jsonl.zstd /
// session.v4.jsonl.zstd 都会出现。只匹配精确名会漏掉大半会话（实测 48/106）。
function findSessionFiles(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findSessionFiles(p, acc);
    else if (/^session(\..+)?\.jsonl\.zstd$/.test(e.name)) acc.push(p);
  }
  return acc;
}

// ── 从事件中提取可读文本 ──
function extractText(obj) {
  const d = obj.data;
  if (!d) return '';
  const parts = [];
  if (obj.type === 'user/message') {
    if (Array.isArray(d.content)) for (const c of d.content) {
      if (c.type === 'text' && c.text) parts.push(c.text);
    }
  } else if (obj.type === 'assistant/message') {
    if (Array.isArray(d.content)) for (const c of d.content) {
      if (c.type === 'text' && c.text) parts.push(c.text);
    }
  } else if (obj.type === 'tool/result') {
    const content = d.message && d.message.content;
    if (Array.isArray(content)) for (const c of content) {
      if (Array.isArray(c.content)) for (const cc of c.content) if (cc.text) parts.push(cc.text);
    }
  } else if (obj.type === 'tool/call') {
    parts.push(typeof d.input === 'string' ? d.input : JSON.stringify(d.input || ''));
  }
  return parts.join('\n');
}

// ── 工作区目录名解码（DSH 把路径编码成 ~XXXX 形式）──
function decodeWorkspace(name) {
  let s = name.replace(/^--/, '').replace(/--$/, '');
  s = s.replace(/~([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // DSH 用 '-' 代替路径分隔符，这里还原成更易读的形式
  return s.replace(/-/g, '\\');
}

// ── 参数解析 ──
const argv = process.argv.slice(2);
function flagVal(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const listOnly = argv.includes('--list');
const statsOnly = argv.includes('--stats');
const onlyUser = argv.includes('--user');
const onlyAssistant = argv.includes('--assistant');
const limit = parseInt(flagVal('--limit', '30'), 10);
const wsFilter = flagVal('--ws', '');
const sessionFilter = flagVal('--session', '');

// 关键词 = 第一个非选项、非选项值的参数
const optValues = new Set([flagVal('--limit'), flagVal('--ws'), flagVal('--session'), flagVal('--context')]);
const keyword = argv.find(a => !a.startsWith('--') && !optValues.has(a)) || '';

if (!argv.length || (!keyword && !listOnly && !statsOnly)) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

if (!fs.existsSync(SESSIONS_DIR)) {
  console.error('❌ 会话目录不存在:', SESSIONS_DIR);
  process.exit(1);
}

const files = findSessionFiles(SESSIONS_DIR);
console.error(`[扫描] 共 ${files.length} 个会话文件\n`);

// ── 列表模式 ──
if (listOnly) {
  const rows = [];
  for (const f of files) {
    const rel = path.relative(SESSIONS_DIR, f);
    const parts = rel.split(path.sep);
    rows.push({ ws: decodeWorkspace(parts[0]), sid: (parts[1] || '').replace('session-', '').slice(0, 8), size: fs.statSync(f).size });
  }
  rows.sort((a, b) => b.size - a.size);
  console.log('大小(KB)   会话ID     工作区');
  console.log('─'.repeat(100));
  for (const r of rows) {
    console.log(`${(r.size / 1024).toFixed(0).padStart(7)}   ${r.sid}   ${r.ws}`);
  }
  console.log(`\n合计 ${rows.length} 个会话，${(rows.reduce((s, r) => s + r.size, 0) / 1024 / 1024).toFixed(1)} MB`);
  process.exit(0);
}

// ── 搜索 / 统计 ──
const kw = keyword.toLowerCase();
let totalHits = 0, scanned = 0;
const results = [];

for (const f of files) {
  const rel = path.relative(SESSIONS_DIR, f);
  const parts = rel.split(path.sep);
  const wsRaw = parts[0];
  const wsName = decodeWorkspace(wsRaw);
  const sid = (parts[1] || '').replace('session-', '').slice(0, 8);

  if (wsFilter && !wsRaw.toLowerCase().includes(wsFilter.toLowerCase())) continue;
  if (sessionFilter && !sid.startsWith(sessionFilter)) continue;

  let raw;
  try { raw = fs.readFileSync(f); } catch { continue; }

  const text = decompressMultiFrame(raw);
  const lines = text.split('\n').filter(Boolean);
  scanned++;

  let title = '', msgCount = 0;
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }

    if (o.type === 'session/title') {
      const t = o.data && (o.data.title || o.data.text);
      if (t) title = t;
    }
    // 标题优先取第一条用户消息
    if (!title && o.type === 'user/message') {
      const body = extractText(o);
      const clean = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (clean.length > 4) title = clean.slice(0, 40);
    }

    if (statsOnly) { if (o.type === 'user/message' || o.type === 'assistant/message') msgCount++; continue; }

    const body = extractText(o);
    if (!body) continue;
    if (onlyUser && o.type !== 'user/message') continue;
    if (onlyAssistant && o.type !== 'assistant/message') continue;

    if (body.toLowerCase().includes(kw)) {
      hits.push({ type: o.type, seq: o.seq, time: o.time, text: body, lineIdx: i });
    }
  }

  if (statsOnly) {
    if (msgCount > 0) results.push({ wsName, sid, title, msgCount, size: raw.length, lines: lines.length });
    continue;
  }

  if (hits.length) {
    totalHits += hits.length;
    results.push({ wsName, sid, title, hits, lines, file: f });
  }
}

// ── 统计输出 ──
if (statsOnly) {
  results.sort((a, b) => b.msgCount - a.msgCount);
  console.log('消息数  行数    大小(KB)  会话ID     标题 / 工作区');
  console.log('─'.repeat(110));
  for (const r of results) {
    console.log(`${String(r.msgCount).padStart(6)}  ${String(r.lines).padStart(6)}  ${(r.size / 1024).toFixed(0).padStart(7)}  ${r.sid}   ${(r.title || '(无标题)').slice(0, 32)}  |  ${r.wsName}`);
  }
  console.log(`\n合计 ${results.length} 个有内容的会话，${results.reduce((s, r) => s + r.msgCount, 0)} 条消息`);
  process.exit(0);
}

// ── 搜索结果输出 ──
console.log(`🔍 搜索 "${keyword}"  →  命中 ${results.length} 个会话 / ${totalHits} 处匹配\n`);

if (!results.length) {
  console.log('（无结果）可试试：换关键词、去掉 --user/--assistant 限制，或先用 --list 看有哪些会话');
  process.exit(0);
}

// 按匹配数排序
results.sort((a, b) => b.hits.length - a.hits.length);

let shown = 0;
for (const r of results) {
  if (shown >= limit) break;
  console.log('┌' + '─'.repeat(96));
  console.log(`│ 📁 ${r.wsName}`);
  console.log(`│ 💬 ${r.sid}  《${r.title || '无标题'}》  —  ${r.hits.length} 处匹配`);
  console.log('├' + '─'.repeat(96));

  for (const h of r.hits) {
    if (shown >= limit) break;
    shown++;
    const t = h.time ? new Date(h.time).toLocaleString('zh-CN') : '';
    const who = h.type === 'user/message' ? '👤 我' : h.type === 'assistant/message' ? '🤖 AI' : h.type === 'tool/result' ? '🔧 工具结果' : '⚙️  ' + h.type;
    // 高亮关键词（终端用反色，简单可靠）
    let snip = h.text.replace(/\s+/g, ' ').trim();
    const lower = snip.toLowerCase();
    const at = lower.indexOf(kw);
    let start = Math.max(0, at - 90);
    snip = (start > 0 ? '…' : '') + snip.slice(start, start + 260) + (snip.length > start + 260 ? '…' : '');
    console.log(`│  ${who}   ${t}`);
    console.log(`│     ${snip}`);
    console.log('│');
  }
  console.log('└' + '─'.repeat(96) + '\n');
}

if (totalHits > shown) {
  console.log(`（仅显示前 ${shown} 条，共 ${totalHits} 条；用 --limit N 调整）`);
}
