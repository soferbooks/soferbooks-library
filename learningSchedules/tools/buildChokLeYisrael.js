#!/usr/bin/env node
/**
 * Builds learningSchedules/data/chokLeYisrael.json: for every weekly portion and day, the
 * references of that day's Chok LeYisrael reading, so the app can show and open it offline
 * (the texts themselves come from the downloaded library).
 *
 * Source: Sefaria's public collection "חק לישראל" (https://www.sefaria.org/collections/חק-לישראל),
 * one source sheet per portion and day (54 portions x 7: Sunday to Friday and Thursday night).
 * Only the references and the sheet ids are kept; the few passages a sheet quotes as plain text
 * (no reference) are left out, and the app links to the sheet for them.
 *
 * Usage: node learningSchedules/tools/buildChokLeYisrael.js   (needs network; about 2 minutes)
 */
const fs = require('fs');
const path = require('path');

const API = 'https://www.sefaria.org/api';
const COLLECTION = 'חק-לישראל';
const OUT = path.join(__dirname, '..', 'data', 'chokLeYisrael.json');
const HEADERS = { 'User-Agent': 'SoferBooksLibrary-build/1.0' };

const DAYS = {
  'יום ראשון': 'sun', 'יום שני': 'mon', 'יום שלישי': 'tue', 'יום רביעי': 'wed',
  'יום חמישי': 'thu', 'ליל שישי': 'thu_night', 'יום שישי': 'fri',
};
// The section headings the sheets use, in English
const SECTIONS = {
  'תורה': 'Torah', 'נביאים': 'Prophets', 'כתובים': 'Writings', 'משנה': 'Mishnah', 'גמרא': 'Talmud',
  'זוהר': 'Zohar', 'הפטרה': 'Haftarah', 'הלכה פסוקה': 'Halakhah', 'הלכה': 'Halakhah', 'מוסר': 'Musar', 'אדרא': 'Idra',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) { return res.json(); }
    if (attempt >= 4) { throw new Error(`${res.status} for ${url}`); }
    await sleep(2000 * attempt);
  }
}
const plain = html => String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function main() {
  const collection = await getJson(`${API}/collections/${encodeURIComponent(COLLECTION)}`);
  const out = {
    source: `https://www.sefaria.org/collections/${COLLECTION}`,
    built: new Date().toISOString().slice(0, 10),
    portions: {},
  };
  for (const s of collection.sheets) {
    const m = s.title.match(/^חק לישראל - פרשת (.+?) (יום \S+|ליל \S+)$/);
    const parsha = (s.tags || [])[0];
    if (!m || !parsha || !DAYS[m[2]]) { console.warn('skipped', s.id, s.title); continue; }
    const sheet = await getJson(`${API}/sheets/${s.id}`);
    let section = null;
    let quoted = 0;
    const refs = [];
    for (const src of sheet.sources || []) {
      if (src.ref) {
        refs.push({ ref: src.ref, heRef: src.heRef, section: section && (SECTIONS[section] || section) });
      } else if (src.outsideText && /<h\d/.test(src.outsideText)) {
        section = plain(src.outsideText);
      } else if (src.outsideText || src.outsideBiText) {
        quoted++;
      }
    }
    out.portions[parsha] = out.portions[parsha] || { he: m[1] };
    out.portions[parsha][DAYS[m[2]]] = { sheet: s.id, refs, ...(quoted ? { quoted } : {}) };
    process.stdout.write('.');
    await sleep(150);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`\nwrote ${OUT}: ${Object.keys(out.portions).length} portions`);
}

main().catch(e => { console.error(e); process.exit(1); });
