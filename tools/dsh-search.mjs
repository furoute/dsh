#!/usr/bin/env node
// dsh-search — full-text search over local DSH (DeepSeek Harness) session logs.
// Pure substring matching, so Chinese keywords work (DSH's built-in FTS tokenizer
// cannot match a Chinese word inside a longer run of Chinese characters).
//
// usage:
//   node dsh-search.mjs 关键词 [关键词...] [--session latest|<id-prefix>] [--limit N]
//                              [--tools] [--snippets N] [--json]
//   node dsh-search.mjs --list [N]        # recent sessions with titles
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function sessionsRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'sessions');
}

/** Decode a DSH session log: one zstd frame per flush, may be many frames. */
function inflate(file) {
  const buffer = fs.readFileSync(file);
  const offsets = [];
  let cursor = 0;
  while ((cursor = buffer.indexOf(ZSTD_MAGIC, cursor)) >= 0) {
    offsets.push(cursor);
    cursor += 4;
  }
  if (offsets.length === 0) return Buffer.alloc(0);
  const parts = [];
  for (const offset of offsets) {
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(offset)));
    } catch {
      // a chance magic-byte hit inside compressed data — skip it
    }
  }
  return Buffer.concat(parts);
}

// One session directory may hold several log formats side by side
// (session.jsonl.zstd / session.v3.jsonl.zstd / session.v4.jsonl.zstd); read them all
// and merge, because a newer file is not always a strict superset of the older one.
function collectSessions(root) {
  const sessions = [];
  for (const workspace of fs.readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const workspacePath = path.join(root, workspace.name);
    for (const session of fs.readdirSync(workspacePath, { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      const sessionPath = path.join(workspacePath, session.name);
      const logs = fs
        .readdirSync(sessionPath)
        .filter((entry) => /^session(\.v\d+)?\.jsonl\.zstd$/.test(entry))
        .map((entry) => path.join(sessionPath, entry));
      if (logs.length === 0) continue;
      const mtime = Math.max(...logs.map((log) => fs.statSync(log).mtimeMs));
      sessions.push({ session, workspace: workspace.name, logs, mtime });
    }
  }
  return sessions;
}

function textOf(event, includeTools) {
  const data = event.data ?? {};
  const blocks = event.type === 'assistant/message' ? data.message?.content : data.content;
  if (!Array.isArray(blocks)) return '';
  const out = [];
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') out.push(['text', block.text]);
    else if (includeTools && block?.type === 'tool-call') out.push(['tool', `${block.name ?? ''} ${block.arguments ?? ''}`]);
    else if (includeTools && block?.type === 'tool-result') out.push(['tool', typeof block.output === 'string' ? block.output : JSON.stringify(block.output ?? '')]);
  }
  return out;
}

function snippets(text, keywords, width) {
  const lower = text.toLowerCase();
  const needles = keywords.map((k) => k.toLowerCase());
  const hits = [];
  for (const needle of needles) {
    let from = 0;
    while (hits.length < 40) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      hits.push(at);
      from = at + needle.length;
    }
  }
  hits.sort((a, b) => a - b);
  return hits.slice(0, 3).map((at) => {
    const start = Math.max(0, at - width);
    const end = Math.min(text.length, at + width);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
  });
}

function readSession(entry, includeTools) {
  const raw = Buffer.concat(entry.logs.map((log) => inflate(log)));
  const events = [];
  let header = null;
  let title = '';
  for (const line of raw.toString('utf8').split('\n')) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'session' && !header) header = event;
    else if (event.type === 'session/title') title = event.data?.title ?? title;
    else events.push(event);
  }
  const messages = [];
  const seen = new Set();
  for (const event of events) {
    const blocks = textOf(event, includeTools);
    if (!blocks || blocks.length === 0 || typeof blocks === 'string') continue;
    for (const [kind, text] of blocks) {
      if (!text) continue;
      const role = event.type === 'user/message' ? '你' : 'DSH';
      const key = `${event.time}|${role}|${kind}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({ seq: event.seq, time: event.time, role, kind, text });
    }
  }
  return { header, title, messages, events };
}

function fmtTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16);
}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const root = sessionsRoot();
const sessions = collectSessions(root);
sessions.sort((a, b) => b.mtime - a.mtime);

if (has('list')) {
  const limit = Number(flag('list', 15)) || 15;
  for (const entry of sessions.slice(0, limit)) {
    const { header, title, messages } = readSession(entry, false);
    console.log(
      `${fmtTime(entry.mtime)}  ${header?.id?.slice(8, 16) ?? entry.session}  ${(header?.cwd ?? '?').padEnd(28)}  ${title || '(无标题)'}  [${messages.length}条]`
    );
  }
  process.exit(0);
}

const keywords = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--session' && argv[i - 1] !== '--limit' && argv[i - 1] !== '--snippets');
if (keywords.length === 0) {
  console.error('用法: node dsh-search.mjs 关键词 [关键词...] [--session latest|<id前缀>] [--limit N] [--tools]');
  process.exit(1);
}

const sessionFilter = flag('session', null);
const limit = Number(flag('limit', 5)) || 5;
const width = Number(flag('snippets', 60)) || 60;
const includeTools = has('tools');

let candidates = sessions;
if (sessionFilter === 'latest') candidates = sessions.slice(0, 1);
else if (sessionFilter) candidates = sessions.filter((e) => e.session.includes(sessionFilter));

const results = [];
let scanned = 0;
for (const entry of candidates) {
  const session = readSession(entry, includeTools);
  scanned++;
  const matches = [];
  for (const message of session.messages) {
    const haystack = message.text.toLowerCase();
    if (keywords.every((k) => haystack.includes(k.toLowerCase()))) {
      matches.push({ ...message, snippets: snippets(message.text, keywords, width) });
    }
  }
  if (matches.length > 0) {
    results.push({
      id: session.header?.id ?? entry.session,
      shortId: (session.header?.id ?? entry.session).slice(8, 16),
      cwd: session.header?.cwd ?? '?',
      title: session.title,
      mtime: entry.mtime,
      total: matches.length,
      matches,
    });
  }
}

if (has('json')) {
  console.log(JSON.stringify({ keywords, scanned, results }, null, 2));
  process.exit(results.length > 0 ? 0 : 1);
}

console.log(`关键词: ${keywords.join(' + ')}   扫描会话: ${scanned}   命中会话: ${results.length}`);
for (const result of results.slice(0, limit)) {
  console.log(`\n■ ${result.title || '(无标题)'}  [${result.shortId}]  ${fmtTime(result.mtime)}  ${result.cwd}  命中 ${result.total} 处`);
  for (const match of result.matches.slice(0, 3)) {
    console.log(`   · ${match.role}(${fmtTime(match.time)}) ${match.snippets[0] ?? match.text.slice(0, 120)}`);
  }
  if (result.total > 3) console.log(`   … 另有 ${result.total - 3} 处命中`);
}
process.exit(results.length > 0 ? 0 : 1);
