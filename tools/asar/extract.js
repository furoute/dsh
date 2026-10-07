// 从 app.asar 中提取指定包的所有文件
const fs = require('fs');
const path = require('path');

const ASAR = 'C:\\Users\\<USER>\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
const OUT = __dirname;
const all = require(path.join(OUT, 'files.json'));

const fd = fs.openSync(ASAR, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const jsonLen = head.readUInt32LE(12);
const buf = Buffer.alloc(jsonLen);
fs.readSync(fd, buf, 0, jsonLen, 16);
const j = JSON.parse(buf.toString('utf8'));
const base = 16 + jsonLen;

function getNode(p) {
  let n = j;
  for (const seg of p.split('/')) n = n.files[seg];
  return n;
}

// 关键词过滤：提取哪些包
const keywords = process.argv.slice(2);
if (!keywords.length) { console.log('用法: node extract.js <关键词...>'); process.exit(1); }

const targets = all.filter(f => keywords.some(k => f.p.includes(k)));
console.log('匹配文件数:', targets.length);

const outDir = path.join(OUT, 'extract');
fs.mkdirSync(outDir, { recursive: true });

for (const t of targets) {
  const node = getNode(t.p);
  if (!node || typeof node.size !== 'number') continue;
  const off = base + Number(node.offset);
  const b = Buffer.alloc(node.size);
  fs.readSync(fd, b, 0, node.size, off);
  const dest = path.join(outDir, t.p.replace(/[/\\]/g, '_'));
  fs.writeFileSync(dest, b);
}
fs.closeSync(fd);
console.log('已提取到:', outDir);
