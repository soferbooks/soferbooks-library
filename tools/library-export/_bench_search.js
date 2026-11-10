/* Desktop benchmark: old vs new scanning logic over the same search files. */
const fs = require('fs');
const path = require('path');

const DEVICE = 'C:\\Users\\morde\\Soferia\\_device_files.txt';
const SEARCH = 'C:\\Users\\morde\\Soferia\\export-v7\\_search';

const names = fs.readFileSync(DEVICE, 'utf8').split(/\r?\n/)
    .filter(n => n.endsWith('_search.txt'))
    .map(n => n.slice(0, -'_search.txt'.length));
const files = names.map(t => path.join(SEARCH, t + '.txt')).filter(p => fs.existsSync(p));
const totalBytes = files.reduce((s, p) => s + fs.statSync(p).size, 0);
console.log(`books ${files.length}, ${(totalBytes / 1e9).toFixed(2)} GB`);

const HEBREW_LETTER = /[\u05D0-\u05EA]/;
const NIQQUD = /[\u0591-\u05C7\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
const HEBREW_PUNCT = /[\u05F3\u05F4'"׳״]/g;

function normalize(word) { return word.replace(NIQQUD, '').replace(HEBREW_PUNCT, '').trim(); }
function escapeRe(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wordRegExp(word) {
  const letters = Array.from(normalize(word));
  let src = '';
  for (const l of letters) {
    src += escapeRe(l);
    if (HEBREW_LETTER.test(l)) src += '[\\u0591-\\u05C7]*';
  }
  const he = letters.some(l => HEBREW_LETTER.test(l));
  return he ? new RegExp(src) : new RegExp(`(^|\\W)${src}`, 'i');
}

const query = process.argv[2] || '1656 years';
const terms = query.split(/\s+/).map(w => {
  const n = normalize(w);
  return { plain: n.toLowerCase(), hebrew: HEBREW_LETTER.test(n), re: wordRegExp(n) };
});

function scanOld(content) {
  let total = 0;
  for (const line of content.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f.length < 5) continue;
    const text = f[4];
    let ok = true;
    for (const t of terms) { if (!t.re.exec(text)) { ok = false; break; } }
    if (ok) total++;
  }
  return total;
}

function mayContainAll(content) {
  let he = null, en = null;
  for (const t of terms) {
    if (t.hebrew) {
      if (he === null) he = content.replace(NIQQUD, '').replace(HEBREW_PUNCT, '');
      if (!he.includes(t.plain)) return false;
    } else {
      if (en === null) en = content.toLowerCase();
      if (!en.includes(t.plain)) return false;
    }
  }
  return true;
}

function scanNew(content) {
  if (!mayContainAll(content)) return 0;
  return scanOld(content);
}

for (const [label, fn] of [['old', scanOld], ['new', scanNew]]) {
  const t0 = Date.now();
  let total = 0;
  for (const p of files) total += fn(fs.readFileSync(p, 'utf8'));
  const ms = Date.now() - t0;
  console.log(`${label}: ${ms} ms, hits ${total}`);
}
