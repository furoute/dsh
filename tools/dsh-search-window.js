#!/usr/bin/env node
/**
 * DSH 会话搜索窗口 —— 当前会话的 Ctrl+F
 *
 * 启动后打开一个搜索窗口，自动跟随 DSH 最新（当前）会话，
 * 输入关键字即可实时高亮匹配，支持上下跳转，像浏览器 Ctrl+F 一样。
 *
 * 用法:
 *   node dsh-search-window.js              # 自动跟随最新会话
 *   node dsh-search-window.js --port 8899  # 指定端口
 *   node dsh-search-window.js --all        # 默认搜全部会话（跨会话模式）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { exec } = require('child_process');

const SESSIONS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.dsh', 'sessions');
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? parseInt(argv[portArg + 1], 10) : 8899;

// ── 多帧 zstd 解压 ──
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
    try { out += zlib.zstdDecompressSync(raw.subarray(start, end)).toString('utf8'); } catch { }
  }
  return out;
}

// ── 找所有会话（兼容 session.jsonl.zstd / session.v4.jsonl.zstd 等）──
function findSessionFiles(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findSessionFiles(p, acc);
    else if (/^session.*\.jsonl\.zstd$/.test(e.name)) acc.push(p);
  }
  return acc;
}

// ── 取最新（当前）会话 ──
function latestSession() {
  const files = findSessionFiles(SESSIONS_DIR);
  let best = null;
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (!best || st.mtimeMs > best.mtimeMs) best = { file: f, mtimeMs: st.mtimeMs, size: st.size };
    } catch { }
  }
  return best;
}

function decodeWorkspace(name) {
  let s = name.replace(/^--/, '').replace(/--$/, '');
  s = s.replace(/~([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return s.replace(/-/g, '\\');
}

// ── 解析会话为消息列表 ──
function parseSession(file) {
  const raw = fs.readFileSync(file);
  const text = decompressMultiFrame(raw);
  const lines = text.split('\n').filter(Boolean);
  const messages = [];
  let title = '';
  let cwd = '';

  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    if (o.type === 'session') { cwd = o.cwd || ''; continue; }
    if (o.type === 'session/title') {
      const t = o.data && (o.data.title || o.data.text);
      if (t) title = t;
      continue;
    }

    let role = null, body = '';
    if (o.type === 'user/message') {
      role = 'user';
      if (Array.isArray(o.data?.content)) {
        body = o.data.content.filter(c => c.type === 'text' && c.text).map(c => c.text).join('\n');
      }
    } else if (o.type === 'assistant/message') {
      role = 'assistant';
      if (Array.isArray(o.data?.content)) {
        body = o.data.content.filter(c => c.type === 'text' && c.text).map(c => c.text).join('\n');
      }
    } else if (o.type === 'tool/call') {
      role = 'tool';
      body = typeof o.data?.input === 'string' ? o.data.input : JSON.stringify(o.data?.input || '');
    } else if (o.type === 'tool/result') {
      role = 'toolresult';
      const content = o.data?.message?.content;
      if (Array.isArray(content)) {
        const parts = [];
        for (const c of content) if (Array.isArray(c.content)) for (const cc of c.content) if (cc.text) parts.push(cc.text);
        body = parts.join('\n');
      }
    }

    if (!role || !body.trim()) continue;
    // 跳过纯系统提醒
    if (role === 'user' && /^\s*<system-reminder>/.test(body) && body.trim().endsWith('</system-reminder>')) continue;

    messages.push({ role, time: o.time || 0, text: body, seq: o.seq ?? 0 });
  }

  // 没标题就用第一条用户消息
  if (!title) {
    const firstUser = messages.find(m => m.role === 'user');
    if (firstUser) title = firstUser.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
  }

  return { title, cwd, messages };
}

// ── 会话列表（含标题摘要，带缓存）──
const metaCache = new Map();
function sessionMeta(f) {
  try {
    const st = fs.statSync(f);
    const key = f + ':' + st.mtimeMs;
    if (metaCache.has(key)) return metaCache.get(key);
    const p = parseSession(f);
    const rel = path.relative(SESSIONS_DIR, f);
    const parts = rel.split(path.sep);
    const meta = {
      file: f,
      ws: decodeWorkspace(parts[0]),
      sid: (parts[1] || '').replace('session-', ''),
      shortId: (parts[1] || '').replace('session-', '').slice(0, 8),
      title: p.title || '(无标题)',
      cwd: p.cwd,
      mtime: st.mtimeMs,
      size: st.size,
      msgCount: p.messages.length,
    };
    metaCache.set(key, meta);
    return meta;
  } catch (e) {
    return null;
  }
}

// ── HTTP 服务 ──
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // 会话列表
  if (url.pathname === '/api/sessions') {
    const files = findSessionFiles(SESSIONS_DIR);
    const list = files.map(sessionMeta).filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(list));
  }

  // 单个会话内容
  if (url.pathname === '/api/session') {
    const file = url.searchParams.get('file');
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404); return res.end('not found');
    }
    // 安全：只允许 sessions 目录内
    if (!path.resolve(file).startsWith(path.resolve(SESSIONS_DIR))) {
      res.writeHead(403); return res.end('forbidden');
    }
    try {
      const p = parseSession(file);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(p));
    } catch (e) {
      res.writeHead(500); return res.end(String(e));
    }
  }

  // 最新会话信息
  if (url.pathname === '/api/latest') {
    const l = latestSession();
    if (!l) { res.writeHead(404); return res.end('{}'); }
    const meta = sessionMeta(l.file);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(meta || {}));
  }

  // 页面
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE_HTML);
});

// ── 前端页面 ──
const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DSH 会话搜索</title>
<style>
  :root { --bg:#0f1115; --panel:#161a22; --border:#262c38; --fg:#e6e8ee; --dim:#8b93a5; --accent:#4a9eff; --hit:#ffd54a; --hitcur:#ff9f43; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:"Microsoft YaHei",system-ui,sans-serif; background:var(--bg); color:var(--fg); height:100vh; display:flex; flex-direction:column; }
  header { padding:10px 14px; background:var(--panel); border-bottom:1px solid var(--border); }
  .row { display:flex; gap:8px; align-items:center; }
  select { flex:1; min-width:0; background:#0b0e13; color:var(--fg); border:1px solid var(--border); border-radius:6px; padding:7px 9px; font-size:13px; }
  input[type=text] { flex:1; min-width:0; background:#0b0e13; color:var(--fg); border:1px solid var(--border); border-radius:6px; padding:9px 11px; font-size:14px; outline:none; }
  input[type=text]:focus { border-color:var(--accent); }
  button { background:#222836; color:var(--fg); border:1px solid var(--border); border-radius:6px; padding:8px 12px; cursor:pointer; font-size:13px; white-space:nowrap; }
  button:hover { background:#2c3444; }
  button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  .count { font-size:12px; color:var(--dim); margin-left:6px; white-space:nowrap; }
  .meta { font-size:11px; color:var(--dim); margin-top:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  main { flex:1; overflow-y:auto; padding:12px 14px; }
  .msg { margin-bottom:14px; border-left:3px solid var(--border); padding-left:10px; }
  .msg.user { border-left-color:#3d7eff; }
  .msg.assistant { border-left-color:#3ddc97; }
  .msg.tool, .msg.toolresult { border-left-color:#6b7280; opacity:.72; }
  .hdr { font-size:11px; color:var(--dim); margin-bottom:4px; }
  .body { font-size:13.5px; line-height:1.68; white-space:pre-wrap; word-break:break-word; }
  mark { background:var(--hit); color:#000; border-radius:2px; padding:0 1px; }
  mark.cur { background:var(--hitcur); box-shadow:0 0 0 2px rgba(255,159,67,.45); }
  .msg.dimmed { opacity:.35; }
  footer { padding:8px 14px; background:var(--panel); border-top:1px solid var(--border); font-size:12px; color:var(--dim); display:flex; justify-content:space-between; }
</style>
</head>
<body>
<header>
  <div class="row">
    <select id="sess" title="选择会话"></select>
    <button id="follow" class="on" title="自动跟随 DSH 当前会话">跟随当前</button>
  </div>
  <div class="row" style="margin-top:8px">
    <input type="text" id="q" placeholder="输入关键字，实时高亮…  (Enter 下一个 / Shift+Enter 上一个 / Esc 清空)" autofocus>
    <button id="prev">↑</button>
    <button id="next">↓</button>
    <span class="count" id="count">—</span>
  </div>
  <div class="meta" id="meta"></div>
</header>
<main id="content"></main>
<footer>
  <span>外挂式搜索 · 不改动 DSH 本体</span>
  <span id="refreshInfo"></span>
</footer>
<script>
let currentFile = null;
let msgs = [];
let hits = [];
let hitIdx = -1;
let followMode = true;
let lastMtime = 0;

const $ = id => document.getElementById(id);

function esc(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// 渲染消息（keyword 为空则原样显示）
function render() {
  const q = $('q').value.trim();
  const box = $('content');
  const frag = document.createDocumentFragment();
  hits = [];

  msgs.forEach((m, mi) => {
    const d = document.createElement('div');
    d.className = 'msg ' + m.role;
    const who = m.role === 'user' ? '👤 我' : m.role === 'assistant' ? '🤖 AI' : m.role === 'tool' ? '🔧 工具调用' : '📄 工具结果';
    const t = m.time ? new Date(m.time).toLocaleString('zh-CN') : '';
    d.innerHTML = '<div class="hdr">' + who + (t ? ' · ' + t : '') + '</div><div class="body"></div>';
    const bodyEl = d.querySelector('.body');

    if (!q) {
      bodyEl.textContent = m.text;
    } else {
      const low = m.text.toLowerCase(), k = q.toLowerCase();
      let i = 0, last = 0, any = false;
      while ((i = low.indexOf(k, last)) >= 0) {
        if (!any) { bodyEl.appendChild(document.createTextNode(m.text.slice(0, i))); any = true; }
        else bodyEl.appendChild(document.createTextNode(m.text.slice(last, i)));
        const mk = document.createElement('mark');
        mk.textContent = m.text.slice(i, i + k.length);
        mk.dataset.hit = hits.length;
        bodyEl.appendChild(mk);
        hits.push(mk);
        last = i + k.length;
        i = last;
      }
      if (!any) { bodyEl.textContent = m.text; d.classList.add('dimmed'); }
      else bodyEl.appendChild(document.createTextNode(m.text.slice(last)));
    }
    frag.appendChild(d);
  });

  box.replaceChildren(frag);
  hitIdx = -1;
  updateCount();
  if (hits.length) gotoHit(0, true);
}

function updateCount() {
  const q = $('q').value.trim();
  if (!q) { $('count').textContent = msgs.length + ' 条消息'; return; }
  $('count').textContent = hits.length ? (hitIdx + 1) + ' / ' + hits.length : '无匹配';
}

function gotoHit(i, scroll) {
  if (!hits.length) return;
  hits.forEach(h => h.classList.remove('cur'));
  hitIdx = (i + hits.length) % hits.length;
  const el = hits[hitIdx];
  el.classList.add('cur');
  if (scroll !== false) el.scrollIntoView({ block:'center', behavior:'smooth' });
  updateCount();
}

async function loadSessions() {
  const r = await fetch('/api/sessions');
  const list = await r.json();
  const sel = $('sess');
  const cur = sel.value;
  sel.replaceChildren();
  list.forEach(s => {
    const o = document.createElement('option');
    o.value = s.file;
    const d = new Date(s.mtime);
    o.textContent = '[' + d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) + '] ' + s.title.slice(0,46) + '  —  ' + s.ws;
    sel.appendChild(o);
  });
  if (cur && list.some(s => s.file === cur)) sel.value = cur;
  return list;
}

async function loadSession(file) {
  if (!file) return;
  currentFile = file;
  const r = await fetch('/api/session?file=' + encodeURIComponent(file));
  const data = await r.json();
  msgs = data.messages || [];
  const st = (await fetch('/api/latest')).ok ? null : null;
  $('meta').textContent = (data.title || '(无标题)') + '   ·   ' + msgs.length + ' 条消息';
  render();
}

// 自动跟随：定时看最新会话是否变化
async function tick() {
  try {
    const l = await (await fetch('/api/latest')).json();
    if (l && l.file) {
      lastMtime = l.mtime;
      $('refreshInfo').textContent = '当前会话更新于 ' + new Date(l.mtime).toLocaleTimeString('zh-CN');
      if (followMode && l.file !== currentFile) {
        await loadSessions();
        $('sess').value = l.file;
        await loadSession(l.file);
      } else if (followMode && l.file === currentFile) {
        // 同一会话有新内容则刷新
        const prev = msgs.length;
        await loadSession(l.file);
        if (msgs.length !== prev) render();
      }
    }
  } catch (e) { /* 忽略 */ }
}

$('q').addEventListener('input', render);
$('q').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); gotoHit(hitIdx + (e.shiftKey ? -1 : 1)); }
  if (e.key === 'Escape') { $('q').value = ''; render(); }
});
$('next').onclick = () => gotoHit(hitIdx + 1);
$('prev').onclick = () => gotoHit(hitIdx - 1);
$('sess').onchange = async e => {
  followMode = false; $('follow').classList.remove('on');
  await loadSession(e.target.value);
};
$('follow').onclick = async () => {
  followMode = !followMode;
  $('follow').classList.toggle('on', followMode);
  if (followMode) await tick();
};
// 全局 Ctrl+F 聚焦搜索框
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('q').focus(); $('q').select(); }
});

(async () => {
  const list = await loadSessions();
  const l = await (await fetch('/api/latest')).json();
  if (l && l.file) { $('sess').value = l.file; await loadSession(l.file); }
  else if (list.length) { $('sess').value = list[0].file; await loadSession(list[0].file); }
  $('q').focus();
  setInterval(tick, 4000);
})();
</script>
</body>
</html>`;

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`\n✅ DSH 会话搜索窗口已启动: ${url}`);
  const l = latestSession();
  if (l) {
    const m = sessionMeta(l.file);
    console.log(`📌 跟随当前会话: 《${m ? m.title : '?'}》`);
  }
  console.log('   关闭此窗口（或按 Ctrl+C）即退出\n');
  // 自动打开浏览器
  exec(`start "" "${url}"`, { shell: 'cmd.exe' });
});

process.on('SIGINT', () => { console.log('\n已退出'); process.exit(0); });
