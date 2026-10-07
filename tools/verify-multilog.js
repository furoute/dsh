// 验证：同一会话目录下是否真的存在多个日志格式并存，以及合并是否必要
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SESSIONS_DIR = path.join(process.env.USERPROFILE, '.dsh', 'sessions');
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function inflateMulti(raw) {
  const offsets = [];
  let cursor = 0;
  while ((cursor = raw.indexOf(MAGIC, cursor)) >= 0) { offsets.push(cursor); cursor += 4; }
  const parts = [];
  for (const off of offsets) {
    try { parts.push(zlib.zstdDecompressSync(raw.subarray(off))); } catch { }
  }
  return Buffer.concat(parts);
}

// 按"工作区/会话目录"聚合
const byDir = new Map();
for (const ws of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue;
  const wsPath = path.join(SESSIONS_DIR, ws.name);
  for (const s of fs.readdirSync(wsPath, { withFileTypes: true })) {
    if (!s.isDirectory()) continue;
    const sPath = path.join(wsPath, s.name);
    const logs = fs.readdirSync(sPath).filter(e => /^session(\.v\d+)?\.jsonl\.zstd$/.test(e));
    if (logs.length) byDir.set(sPath, { ws: ws.name, sid: s.name, logs: logs.map(l => path.join(sPath, l)) });
  }
}

console.log('会话目录总数:', byDir.size);
console.log('日志文件总数:', [...byDir.values()].reduce((n, v) => n + v.logs.length, 0));

const multi = [...byDir.values()].filter(v => v.logs.length > 1);
console.log('\n=== 同一目录存在多个日志格式的会话 ===', multi.length, '个');
for (const v of multi) {
  console.log(`\n  ${v.sid.slice(0, 20)}`);
  for (const l of v.logs) {
    const st = fs.statSync(l);
    const raw = fs.readFileSync(l);
    const text = inflateMulti(raw).toString('utf8');
    const lines = text.split('\n').filter(Boolean);
    console.log(`    ${path.basename(l).padEnd(24)} ${(st.size/1024).toFixed(0).padStart(5)}KB  ${lines.length} 行  最后写入 ${st.mtime.toLocaleString('zh-CN')}`);
  }
}

// 验证"新文件不是旧文件的严格超集"
if (multi.length) {
  const v = multi[0];
  const sets = v.logs.map(l => {
    const text = inflateMulti(fs.readFileSync(l)).toString('utf8');
    return { name: path.basename(l), lines: new Set(text.split('\n').filter(Boolean)) };
  });
  console.log('\n=== 超集关系验证（' + v.sid.slice(0, 16) + '）===');
  for (let i = 0; i < sets.length; i++) {
    for (let j = 0; j < sets.length; j++) {
      if (i === j) continue;
      const a = sets[i], b = sets[j];
      const onlyInA = [...a.lines].filter(x => !b.lines.has(x)).length;
      console.log(`  ${a.name} 中不在 ${b.name} 的行数: ${onlyInA}  ${onlyInA > 0 ? '← 必须合并！' : '(是子集)'}`);
    }
  }
}
