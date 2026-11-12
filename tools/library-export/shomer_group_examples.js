// Which real books and translations in the library each filter group hides, for the Settings
// screen (shomer/groupExamples.json). Runs the app's own matcher (shomer/matcher.js) over:
//   - Sefaria: every book and every edition in the export (Sofer's data/sefaria-export),
//   - Dicta's catalog, Otzaria's file list, our Wikisource list and the Sofer Library index.
// A group with nothing in the library is left out of the screen.
//
//   node tools/library-export/shomer_group_examples.js [path/to/sefaria-export]
require('@babel/register')({presets: ['babel-preset-expo'], extensions: ['.js'], ignore: [/node_modules/]});
const fs = require('fs');
const path = require('path');
const {match, bookText} = require('../../shomer/matcher');
const {GROUPS} = require('../../shomer/presets');

const ROOT = path.resolve(__dirname, '../..');
const EXPORT = process.argv[2] || 'C:/Users/morde/Sofer/data/sefaria-export';
const MAX_EXAMPLES = 6;

const found = {};   // group -> Map(name -> count of hits)
GROUPS.forEach(g => { found[g.id] = new Map(); });
const cfgFor = id => ({active: true, groups: {[id]: true}});
// label: what the screen shows. An edition of a translation group is named by the translation
// (without a "[pt]" language tag or year); any other hidden edition is "<book> (one translation)",
// since only that edition is hidden, not the book (unless the whole book is already listed).
const HE = new Map();   // label -> its Hebrew name (for the Hebrew interface)
const check = (text, label, edition, he) => {
  for (const g of GROUPS) {
    // a translation group hides editions only, never a book (matcher.bookMatch): a book whose name
    // has a translator's name in it is listed under the group that hides the book. Everett Fox's
    // books were under both "Non-Orthodox Tanakh translations" and "Haskalah & secular" (QA 2026-11-11)
    if (g.translation && !edition) { continue; }
    const m = match(cfgFor(g.id), text);
    if (!m || m.group !== g.id) { continue; }
    const map = found[g.id];
    let name = label;
    if (edition && g.translation) {
      name = edition.versionTitle.replace(/\s*\[[a-z]{2,3}\]$/, '').replace(/,?\s*\d{4}(-\d{2,4})?$/, '').trim();
      if (edition.versionTitleInHebrew) { HE.set(name, edition.versionTitleInHebrew); }
    } else if (edition) {
      if (map.has(edition.title)) { continue; }
      name = `${edition.title} (${edition.english ? 'one translation' : 'one edition'})`;
      if (edition.heTitle) { HE.set(name, `${edition.heTitle} (${edition.english ? 'תרגום אחד' : 'מהדורה אחת'})`); }
    } else if (he) { HE.set(name, he); }
    map.set(name, (map.get(name) || 0) + 1);
  }
};

// Sefaria: books from the app's toc, editions from the export
const walk = (nodes, fn) => (nodes || []).forEach(n => (n.contents ? walk(n.contents, fn) : fn(n)));
const head = file => {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(3000);
  const n = fs.readSync(fd, buf, 0, 3000, 0);
  fs.closeSync(fd);
  const s = buf.slice(0, n).toString('utf8');
  const get = k => (s.match(new RegExp(`"${k}":\\s*"((?:[^"\\\\]|\\\\.)*)"`)) || [])[1] || '';
  return {versionTitle: get('versionTitle'), versionSource: get('versionSource'),
    versionTitleInHebrew: get('versionTitleInHebrew'), title: get('title'), heTitle: get('heTitle')};
};
let editions = 0;
const walkDir = dir => {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walkDir(p); continue; }
    if (!e.name.endsWith('.json') || !/[\\/](English|Hebrew)[\\/]/.test(p)) { continue; }
    const v = head(p);
    editions += 1;
    if (!v.versionTitle || v.versionTitle === 'merged') { continue; }
    v.versionTitle = v.versionTitle.replace(/\\"/g, '"');
    v.english = /[\\/]English[\\/]/.test(p);
    // the label names the edition (a translation of many books is listed once)
    check([v.versionTitle, v.versionTitleInHebrew, v.versionSource].filter(Boolean).join(' | '), v.versionTitle, v);
  }
};

// Extras
const fetchJson = async url => (await fetch(url)).json();
(async () => {
  // (Sefaria's own live table of contents: the app reads the same one)
  const toc = await fetchJson('https://www.sefaria.org/api/index');
  walk(toc, b => b.title && check(bookText(b), b.title, null, b.heTitle));
  walkDir(path.join(EXPORT, 'json'));
  const dicta = await fetchJson('https://raw.githubusercontent.com/Dicta-Israel-Center-for-Text-Analysis/Dicta-Library-Download/main/books.json');
  dicta.forEach(b => check([b.displayName, b.displayNameEnglish, b.author, b.authorEnglish].filter(Boolean).join(' | '),
    b.displayNameEnglish || b.displayName, null, b.displayName));
  const otz = await fetchJson('https://raw.githubusercontent.com/Otzaria/otzaria-library/main/files_manifest.json');
  Object.keys(otz).filter(k => /\.txt$/.test(k) && !/links/.test(k)).forEach(k => {
    const name = path.basename(k, '.txt');
    check(name, name);
  });
  const wiki = JSON.parse(fs.readFileSync(path.join(ROOT, 'extras/wikisourceBooks.json'), 'utf8'));
  wiki.books.forEach(b => check([b.page].concat(b.names || []).join(' | '), b.page));
  const sofer = JSON.parse(fs.readFileSync(path.join(ROOT, 'sofer-library-b/_sofer_library_index.json'), 'utf8'));
  Object.values(sofer.files || {}).forEach(f => { if (f && f[1]) { check(f[1], f[1]); } });

  const out = {made: new Date().toISOString().slice(0, 10), groups: {}};
  for (const g of GROUPS) {
    const all = [...found[g.id].keys()];
    // a series ("Daf Shevui to Sukkah", "... on Mishnah Peah", "... part 2") is shown once
    const series = n => n.replace(/ part \d+$/i, '').replace(/^(Daf Shevui) to .+$/, '$1')
      .replace(/^(.+) on Mishnah .+$/, '$1').replace(/^(.+), Preface$/, '$1')
      .replace(/^(English Explanation of Mishnah) .+$/, '$1');
    const seen = new Set();
    // the Hebrew of a series: the words its members' Hebrew names start with
    const heOf = {};
    for (const n of all) {
      const k = series(n);
      const h = HE.get(n);
      if (!h) { continue; }
      if (!(k in heOf)) { heOf[k] = h; continue; }
      const a = heOf[k].split(' ');
      const b = h.split(' ');
      let i = 0;
      const bare = w => w.replace(/[,:;.]$/, '');
      while (i < a.length && i < b.length && bare(a[i]) === bare(b[i])) { i += 1; }
      heOf[k] = a.slice(0, i).map(bare).join(' ') || heOf[k];
    }
    // ("Daf Shevui" is "דף שבועי", not "דף שבועי על")
    for (const k of Object.keys(heOf)) {
      if (k !== all.find(n => series(n) === k) && !/ (on|to) /.test(k)) { heOf[k] = heOf[k].split(' על ')[0].replace(/ על$/, ''); }
    }
    const names = all.map(series).filter(n => {
      const k = n.toLowerCase();
      if (seen.has(k)) { return false; }
      seen.add(k);
      return true;
    }).filter(n => !/ \(one (translation|edition)\)$/.test(n) || !all.includes(n.replace(/ \(one (translation|edition)\)$/, '')));   // (whole books first: the toc is checked first)
    if (!names.length) { continue; }
    out.groups[g.id] = {count: names.length,
      examples: names.slice(0, MAX_EXAMPLES).map(n => (heOf[n] && heOf[n] !== n ? [n, heOf[n]] : [n]))};
  }
  fs.writeFileSync(path.join(ROOT, 'shomer/groupExamples.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(`${editions} editions checked`);
  for (const g of GROUPS) {
    const n = found[g.id].size;
    console.log(g.id.padEnd(28), String(n).padStart(4), n ? [...found[g.id].keys()].slice(0, 12).join(' ; ') : '(none: not shown)');
  }
})();
