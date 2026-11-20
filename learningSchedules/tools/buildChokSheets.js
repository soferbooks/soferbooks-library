#!/usr/bin/env node
/**
 * Builds learningSchedules/data/chokSheets.json: every day of Chok LeYisrael as Sefaria's public
 * collection "חק לישראל" lays it out (https://www.sefaria.org/collections/חק-לישראל), one source
 * sheet per parsha and day (54 parshiot x Sunday..Friday and Thursday night = 378 sheets).
 *
 * Each day is kept in the sheet's order as parts (תורה, נביאים, כתובים, משנה, גמרא, זוהר, הלכה
 * פסוקה, מוסר, הפטרה), each a list of
 *   {r, hr}   a passage of a book on Sefaria (its ref): the phone shows the book's own text, so
 *             tapping it opens that passage's connections, as on Sefaria's site
 *   {t}       text the sheet writes out itself (the kavanot before the Torah, the Zohar's
 *             Hebrew translation, mussar from books Sefaria does not have): shown as it is;
 *             {t, r} when the passage was found in a book on Sefaria (tapping it shows its connections)
 * learningSchedules/data/chokFixes.json (checked 2026-11-20) is applied: the Zohar refs Sefaria
 * renumbered since the sheets were made, and the sheet-written passages found on Sefaria.
 * Only the refs are kept for passages, not their text (the phone reads that from the library).
 *
 * Usage: node learningSchedules/tools/buildChokSheets.js [cacheDir]
 *   needs the network the first time (about 2 minutes); sheets already in cacheDir are reused.
 */
const fs = require('fs');
const path = require('path');

const API = 'https://www.sefaria.org/api';
const COLLECTION = 'חק-לישראל';
const OUT = path.join(__dirname, '..', 'data', 'chokSheets.json');
const FIXES = path.join(__dirname, '..', 'data', 'chokFixes.json');
const HEADERS = { 'User-Agent': 'SoferBooksLibrary-build/1.0' };

const DAYS = {
  'יום ראשון': 'sun', 'יום שני': 'mon', 'יום שלישי': 'tue', 'יום רביעי': 'wed',
  'יום חמישי': 'thu', 'ליל שישי': 'thu_night', 'יום שישי': 'fri',
};
// The headings the sheets divide a day by
const PARTS = ['תורה', 'נביאים', 'כתובים', 'משנה', 'גמרא', 'זוהר', 'הלכה פסוקה', 'מוסר', 'הפטרה'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile)) { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); }
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) {
      const text = await res.text();
      if (cacheFile) { fs.writeFileSync(cacheFile, text); }
      await sleep(150);
      return JSON.parse(text);
    }
    if (attempt >= 4) { throw new Error(`${res.status} for ${url}`); }
    await sleep(2000 * attempt);
  }
}

const plain = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** The sheet's HTML as the reader's: paragraphs as line breaks, bold/small kept, the rest's text only */
function cleanHtml(html) {
  return String(html || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<\/(p|div|h\d)>\s*<(p|div|h\d)[^>]*>/gi, '<br>')
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/<(\/?)(strong)>/gi, '<$1b>')
    .replace(/<(?!\/?(b|small|br)>)[^>]*>/gi, '')
    .replace(/(<br>\s*)+$/i, '').replace(/^(\s*<br>)+/i, '')
    .replace(/<(b|small)>\s*<\/\1>/gi, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** A sheet's sources as the day's parts: [{h, items: [{r, hr} | {t}]}] */
function partsOf(sheet) {
  const parts = [];
  let part = null;
  for (const src of sheet.sources || []) {
    if (src.ref) {
      if (!part) { part = { h: '', items: [] }; parts.push(part); }
      part.items.push({ r: src.ref, hr: src.heRef || src.ref });
      continue;
    }
    const html = src.outsideText || (src.outsideBiText && (src.outsideBiText.he || src.outsideBiText.en)) || '';
    const text = plain(html);
    if (!text) { continue; }
    const heading = PARTS.find(p => text === p || text === `${p}:`);
    if (heading) {
      part = { h: heading, items: [] };
      parts.push(part);
      continue;
    }
    if (!part) { part = { h: '', items: [] }; parts.push(part); }
    part.items.push({ t: cleanHtml(html) });
  }
  return parts.filter(p => p.items.length);
}

const bare = s => plain(s).replace(/[֑-ׇ]/g, '').replace(/[^א-ת ]/g, ' ').replace(/\s+/g, ' ').trim();

/** The checked fixes (chokFixes.json) on a day's parts */
function applyFixes(key, parts, fixes) {
  const z = fixes.zohar && fixes.zohar[key];
  if (z) {
    for (const p of parts) { for (const it of p.items) { if (it.r === z.old) { it.r = z.new; delete it.hr; } } }
  }
  for (const f of (fixes.texts && fixes.texts[key]) || []) {
    // (the item whose words share most of the passage's opening - the sheet's spelling differs here and there)
    const words = bare(f.opening).split(' ').filter(w => w.length > 1);
    const part = parts.find(p => p.h === f.part) || { items: [] };
    let best = null;
    let bestScore = 0;
    for (const it of part.items.filter(i => i.t && !i.r)) {
      const have = new Set(bare(it.t).split(' '));
      const score = words.filter(w => have.has(w)).length / (words.length || 1);
      if (score > bestScore) { best = it; bestScore = score; }
    }
    if (best && bestScore >= 0.5) { best.r = f.ref; }
  }
  return parts;
}

async function main() {
  const cache = process.argv[2] || null;
  const fixes = fs.existsSync(FIXES) ? JSON.parse(fs.readFileSync(FIXES, 'utf8')) : {};
  if (cache) { fs.mkdirSync(cache, { recursive: true }); }
  const collection = await getJson(`${API}/collections/${encodeURIComponent(COLLECTION)}`, cache && path.join(cache, 'collection.json'));
  const out = {
    source: `https://www.sefaria.org/collections/${COLLECTION}`,
    built: new Date().toISOString().slice(0, 10),
    days: {},
  };
  for (const s of collection.sheets) {
    const m = s.title.match(/^חק לישראל - פרשת (.+?) ((?:יום|ליל) \S+)$/);
    if (!m || !DAYS[m[2]]) { console.warn('skipped', s.id, s.title); continue; }
    const sheet = await getJson(`${API}/sheets/${s.id}`, cache && path.join(cache, `${s.id}.json`));
    const key = `${m[1]}|${DAYS[m[2]]}`;
    if (out.days[key]) { console.warn('twice', key, out.days[key].sheet, s.id); continue; }
    out.days[key] = { sheet: s.id, parts: applyFixes(key, partsOf(sheet), fixes) };
    process.stdout.write('.');
  }
  const ordered = {};
  for (const k of Object.keys(out.days).sort()) { ordered[k] = out.days[k]; }
  out.days = ordered;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`\nwrote ${OUT}: ${Object.keys(out.days).length} days`);
}

if (require.main === module) { main().catch(e => { console.error(e); process.exit(1); }); }
module.exports = { partsOf, cleanHtml, applyFixes };
