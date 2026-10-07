// 验证 DSH 所用 FTS5 unicode61 分词器对中文的实际行为
// 依据：session-query-sqlite 使用 SQLite FTS5，默认 unicode61 分词器
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec("CREATE VIRTUAL TABLE docs USING fts5(body)");

// 模拟 DSH 会话里的真实中文句子
const samples = [
  '这个关键字能不能被搜索到',
  'DSH 的会话搜索：全文检索（FTS5）后端',
  '我需要的是在当前会话页面里，能搜索到关键字的效果',
];
for (const s of samples) db.prepare('INSERT INTO docs(body) VALUES (?)').run(s);

console.log('=== 被索引的三段文本 ===');
samples.forEach((s, i) => console.log(`  [${i}] ${s}`));

console.log('\n=== 关键词命中测试 ===');
const queries = ['关键字', '搜索', '会话', '全文检索', 'DSH', 'FTS5', '当前会话', '这个关键字能不能被搜索到'];
console.log('查询词'.padEnd(28) + '命中数   说明');
console.log('─'.repeat(76));
for (const q of queries) {
  let n = 0;
  try {
    n = db.prepare('SELECT COUNT(*) c FROM docs WHERE docs MATCH ?').get(q).c;
  } catch (e) {
    console.log(q.padEnd(28) + 'ERROR   ' + e.message);
    continue;
  }
  const note = n > 0 ? '✅ 命中' : '❌ 0 命中（中文被当成整词）';
  console.log(q.padEnd(28) + String(n).padEnd(9) + note);
}

console.log('\n=== 验证分词方式（用 fts5vocab 看真实切出的 token） ===');
try {
  db.exec("CREATE VIRTUAL TABLE v USING fts5vocab(docs, 'row')");
  const toks = db.prepare('SELECT term FROM v ORDER BY term').all();
  console.log('索引里实际的 token:');
  toks.forEach(t => console.log('  「' + t.term + '」'));
  console.log('\n token 总数:', toks.length, '（三段中文文本）');
  console.log(' 若中文被整段切分 → token 数会远少于字符数');
} catch (e) {
  console.log('fts5vocab 不可用:', e.message);
}
db.close();
