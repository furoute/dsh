// 遍历 asar 索引（顶层即文件树）
const fs = require('fs');
const path = require('path');
const j = require('D:/LLM/DSH/work/asar-search-extract/header.json');

const all = [];
function walk(node, prefix) {
  if (!node || typeof node !== 'object') return;
  if (node.files) {
    for (const k of Object.keys(node.files)) {
      walk(node.files[k], prefix ? prefix + '/' + k : k);
    }
  } else if (typeof node.size === 'number') {
    all.push({ p: prefix, size: node.size, offset: node.offset });
  }
}
walk(j, '');

console.log('文件总数:', all.length);
fs.writeFileSync(path.join(__dirname, 'files.json'), JSON.stringify(all));

console.log('\n=== 路径含 search 的文件 ===');
const s = all.filter(f => /search/i.test(f.p));
s.forEach(f => console.log('  ', (f.size / 1024).toFixed(0) + 'KB', f.p));
console.log('小计:', s.length);

const ds = new Set();
all.filter(f => f.p.includes('@deepseek-ai/')).forEach(f => {
  const m = f.p.match(/@deepseek-ai\/([^/]+)/); if (m) ds.add(m[1]);
});
console.log('\n=== @deepseek-ai 包 ===');
console.log([...ds].sort().join('\n  '));
