#!/usr/bin/env node
/**
 * Builds tanach/shvaNaMarks.json: where the shva na (U+05C8) and dagesh chazak (U+05C9) go in
 * every pasuk of Tanach, as SoferBooks prints them (owner, 2026-11-20: "our Tanach with shva
 * na's" in the app).
 *
 * Source (read only): the website's copy of Sefaria's "Miqra according to the Masorah"
 * (C:\Users\morde\SoferShared\library\sefaria-export\json\Tanakh\...\Miqra according to the
 * Masorah.json, CC BY-SA 4.0), marked by Sofer's update_masorah.py from Ben Denckla's Phonetic
 * MAM (CC BY-SA 4.0). Nothing is recomputed here: the marks are read off that text.
 *
 * For each pasuk: its text with the marks made plain again (U+05C8 -> shva, U+05C9 -> dagesh)
 * is the text the phone has from Sefaria; the file keeps that text's hash and the places of
 * the marks in it, so the phone marks a pasuk only when its text is the same (tanach/shvaNa.js).
 *
 *   {v: 1, built, source, books: {Title: {"<chapter>:<verse>": "<hash>|<na places>|<chazak places>"}}}
 *   places: UTF-16 indexes into the plain text, in base 36, joined by ","
 *
 * Usage: node tools/shvaNa/buildShvaNaMarks.js [libraryRoot]
 */
const fs = require('fs');
const path = require('path');
const md5 = require('md5');

const ROOT = process.argv[2] || process.env.SOFER_LIBRARY || 'C:/Users/morde/SoferShared/library';
const TANAKH = path.join(ROOT, 'sefaria-export', 'json', 'Tanakh');
const VERSION_FILE = 'Miqra according to the Masorah.json';
const OUT = path.join(__dirname, '..', '..', 'tanach', 'shvaNaMarks.json');
const SHVA = '\u05B0', DAGESH = '\u05BC', SHVA_NA = '\u05C8', CHAZAK = '\u05C9';

// (the hash is of the text with the kamatz katan as a plain kamatz: Sefaria marks it, the website's
//  copy decides it again - one character for one, so the places of the marks are the same)
const KAMATZ_KATAN = /ׇ/g;
const hashOf = text => md5(text.replace(KAMATZ_KATAN, 'ָ')).slice(0, 8);

/** {plain, na: [i], chazak: [i]} of a marked pasuk */
function marksOf(marked) {
  const na = [];
  const chazak = [];
  let plain = '';
  for (const ch of marked) {
    if (ch === SHVA_NA) { na.push(plain.length); plain += SHVA; } else if (ch === CHAZAK) { chazak.push(plain.length); plain += DAGESH; } else { plain += ch; }
  }
  return { plain, na, chazak };
}

function findFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { out.push(...findFiles(p)); } else if (e.name === VERSION_FILE) { out.push(p); }
  }
  return out;
}

function main() {
  const books = {};
  let verses = 0, na = 0, chazak = 0;
  for (const f of findFiles(TANAKH)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const book = {};
    d.text.forEach((chapter, c) => (chapter || []).forEach((verse, v) => {
      if (typeof verse !== 'string' || (!verse.includes(SHVA_NA) && !verse.includes(CHAZAK))) { return; }
      const m = marksOf(verse);
      book[`${c + 1}:${v + 1}`] = `${hashOf(m.plain)}|${m.na.map(i => i.toString(36)).join(',')}|${m.chazak.map(i => i.toString(36)).join(',')}`;
      verses += 1; na += m.na.length; chazak += m.chazak.length;
    }));
    books[d.title] = book;
  }
  const out = {
    v: 1,
    built: new Date().toISOString().slice(0, 10),
    source: 'Miqra according to the Masorah (Sefaria, CC BY-SA 4.0) as marked by SoferBooks from Phonetic MAM (Ben Denckla, CC BY-SA 4.0)',
    books,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT}: ${Object.keys(books).length} books, ${verses} pesukim, ${na} shva na, ${chazak} dagesh chazak`);
}

if (require.main === module) { main(); }
module.exports = { marksOf, hashOf };
