// 解析 app.asar 头部，提取文件索引
const fs = require('fs');
const path = require('path');

const asar = 'C:\\Users\\<USER>\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
const outDir = __dirname;

const fd = fs.openSync(asar, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const jsonLen = head.readUInt32LE(12);
const buf = Buffer.alloc(jsonLen);
fs.readSync(fd, buf, 0, jsonLen, 16);
fs.closeSync(fd);

fs.writeFileSync(path.join(outDir, 'header.json'), buf);
const j = JSON.parse(buf.toString('utf8'));

console.log('顶层:', Object.keys(j.files).join(', '));
const d = j.files.dsh;
console.log('dsh子项:', d ? Object.keys(d.files || {}).join(', ') : '无');

// 递归收集所有文件路径
const all = [];
function walk(node, prefix) {
  if (!node.files) { all.push({ p: prefix, size: node.size, offset: node.offset }); return; }
  for (const [k, v] of Object.entries(node.files)) walk(v, prefix + '/' + k);
}
walk(j.files, '');
fs.writeFileSync(path.join(outDir, 'files.json'), JSON.stringify(all, null, 0));
console.log('文件总数:', all.length);
