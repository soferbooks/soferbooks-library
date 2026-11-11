/**
 * The "full library" estimate's measured part (see full_library_sizes.py, which runs first):
 *
 * 1. ratios: sample books (written by full_library_sizes.py --samples) converted with the app's
 *    own code (extras/*.js, schema7.bookFiles); a book's space on the phone is its files zipped
 *    (deflate, as react-native-zip-archive) plus its search lines (localSearch.js's format:
 *    "ref:n, heRef:n, lang, version, text" a passage - counted here, localSearch.js needs the app).
 *    ratio = space on the phone / bytes downloaded, per source.
 * 2. totals: each extra source's catalogue as the phone reads it (fetched now from the sources'
 *    servers, the Sofer Library's from its release), the books the app keeps (chooseBooks: one
 *    copy of each sefer, Sefaria's first) and the default content filter shows, with their
 *    download size (fullLibrarySizes.json, the catalogue's own for the Sofer Library) and space.
 *
 *    node -r @babel/register tools\library-export\full_library_sizes.js <samples folder>
 * Writes ratios and totals into fullLibrarySizes.json.
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// (the converters' modules import React Native's; the measurement needs none of them)
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'expo-file-system/legacy' || request === 'react-native-zip-archive') { return {}; }
  if (request === '@react-native-async-storage/async-storage') {
    return {default: {getItem: async () => null, setItem: async () => {}}};
  }
  return load.call(this, request, ...rest);
};
const otzaria = require('../../extras/otzaria');
const dicta = require('../../extras/dicta');
const wikisource = require('../../extras/wikisource');
const sofer = require('../../extras/sofer');
const {bookFiles} = require('../../extras/schema7');
const {chooseBooks, addToToc} = require('../../extras/catalog');
const {filterToc} = require('../../shomer/matcher');
const {normalize, DEFAULT_PRESET} = require('../../shomer/presets');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'fullLibrarySizes.json');
const SEFARIA_TOC = 'https://readonly.sefaria.org/static/ios-export/7/toc.json';

/** A converted book's space on the phone: its files zipped and its search lines */
async function phoneBytes(files) {
  let n = 0;
  for (const [name, data] of Object.entries(files)) {
    n += zlib.deflateRawSync(Buffer.from(JSON.stringify(data))).length + 76 + 2 * Buffer.byteLength(name);
  }
  for (const [name, data] of Object.entries(files)) {
    const m = /^(.*)\.([0-9a-f]{8})\.(he|en)\.json$/.exec(name);
    if (!m) { continue; }
    const passages = [];
    const walk = x => {
      if (typeof x === 'string') { passages.push(x); } else if (x && typeof x === 'object') { Object.values(x).forEach(walk); }
    };
    walk(data);
    for (const p of passages) {
      const text = p.replace(/<[^>]+>/g, '');
      if (text.trim()) { n += Buffer.byteLength(text) + 3 * Buffer.byteLength(m[1]) + 30; }
    }
  }
  return n;
}

/** extras/index.js convertBook, for a source module and its entry */
function convert(source, entry, text) {
  const [tree, author] = source.toTree(text, entry);
  return bookFiles(tree, {
    title: entry.title, heTitle: entry.heTitle, categories: entry.categories, heCategories: entry.heCategories,
    authors: author ? [{he: author, en: ''}] : null,
    ...(source.versionsOf ? {versions: source.versionsOf(entry, text, tree)} : {version: source.versionOf(entry, text)}),
  }).files;
}

async function ratios(samples) {
  const out = {};
  const add = (id, down, phone) => { out[id] = out[id] || [0, 0]; out[id][0] += down; out[id][1] += phone; };
  const dir = id => path.join(samples, id);
  for (const f of fs.readdirSync(dir('otzaria'))) {
    const text = fs.readFileSync(path.join(dir('otzaria'), f), 'utf8');
    const entry = {source: 'otzaria', id: f, title: f.slice(0, -4), heTitle: f.slice(0, -4), categories: ['Halakhah', 'Otzaria', 'General'],
      heCategories: [], collection: 'Orayta', license: 'unknown'};
    add('otzaria', fs.statSync(path.join(dir('otzaria'), f)).size, await phoneBytes(convert(otzaria.default, entry, text)));
  }
  for (const f of fs.readdirSync(dir('dicta'))) {
    const s = JSON.parse(fs.readFileSync(path.join(dir('dicta'), f), 'utf8'));
    const entry = {source: 'dicta', id: s.fileName, title: s.fileName, heTitle: s.fileName, categories: ['Halakhah', 'Dicta Library', 'General'],
      heCategories: [], license: 'CC-BY-SA', nikudUrl: s.nikud ? 'x' : null};
    const doc = {otzaria: null, pages: s.pages, copies: [], nikud: s.nikud || null};
    add('dicta', s.download, await phoneBytes(convert(dicta.default, entry, doc)));
  }
  for (const f of fs.readdirSync(dir('wikisource'))) {
    const book = JSON.parse(fs.readFileSync(path.join(dir('wikisource'), f), 'utf8'));
    const entry = wikisource.entryFor({page: book.title, category: 'Halakhah'});
    add('wikisource', fs.statSync(path.join(dir('wikisource'), f)).size, await phoneBytes(convert(wikisource.default, entry, book)));
  }
  for (const f of fs.existsSync(dir('sofer_library')) ? fs.readdirSync(dir('sofer_library')) : []) {
    const s = JSON.parse(fs.readFileSync(path.join(dir('sofer_library'), f), 'utf8'));
    add('sofer_library', s.download, await phoneBytes(s.files));
  }
  const r = {};
  for (const [id, [down, phone]] of Object.entries(out)) {
    r[id] = Math.round((phone / down) * 100) / 100;
    console.log(`${id}: ${(down / 1e6).toFixed(1)} MB downloaded -> ${(phone / 1e6).toFixed(1)} MB on the phone (x${r[id]})`);
  }
  return r;
}

const get = async url => {
  const res = await fetch(url, {headers: {'User-Agent': 'SoferBooks-library-builder/1.0'}});
  if (!res.ok) { throw new Error(`HTTP ${res.status} for ${url}`); }
  return res.text();
};

async function totals(sizes, ratio) {
  const manifest = await get(otzaria.CATALOG_URL);
  const catalogs = {
    otzaria: otzaria.parseCatalog(manifest),
    dicta: dicta.parseCatalog(await get(dicta.CATALOG_URL), manifest),
    wikisource: wikisource.parseCatalog(),
    sofer_library: sofer.parseCatalog(await get(sofer.CATALOG_URL)),
  };
  const toc = JSON.parse(await get(SEFARIA_TOC));
  const {books} = chooseBooks(toc, catalogs);
  const hidden = {};
  filterToc(normalize({preset: DEFAULT_PRESET}), addToToc([], books), hidden);
  const out = {};
  for (const id of Object.keys(catalogs)) {
    const list = Object.values(books).filter(b => b.source === id && !(b.title in hidden));
    const kB = b => sizeOfEntry(sizes, b);
    const download = list.reduce((n, b) => n + kB(b), 0);
    out[id] = {books: list.length, hidden: Object.values(books).filter(b => b.source === id && b.title in hidden).length,
      catalogue: catalogs[id].length, downloadKB: download, phoneKB: Math.round(download * (ratio[id] || 1))};
    console.log(`${id}: ${list.length} books (of ${catalogs[id].length} in its catalogue), `
      + `${(download / 1024 / 1024).toFixed(2)} GB download, ${(out[id].phoneKB / 1024 / 1024).toFixed(2)} GB on the phone`);
  }
  return out;
}

/** A catalogue entry's download in kB (fullLibrary.js has the same rule) */
function sizeOfEntry(sizes, b) {
  if (b.source === 'sofer_library') {
    return Math.round([b, ...(b.companions || [])].reduce((n, e) => n + (e.size || 0), 0) / 1024);
  }
  const map = sizes[b.source] || {};
  const key = b.source === 'otzaria' ? b.heTitle : b.id;
  if (map[key]) { return map[key]; }
  const all = Object.values(map);
  return all.length ? Math.round(all.reduce((x, y) => x + y, 0) / all.length) : 0;
}

module.exports = {phoneBytes, totals, OUT};

if (require.main === module) {
  (async () => {
    const samples = process.argv[2];
    const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const before = data.ratios || {};
    data.ratios = await ratios(samples);
    // (Wikisource's books downloaded from its release: its ratio is the release's,
    //  build_wikisource_release.js)
    if (data.wikisourceRelease && before.wikisource) { data.ratios.wikisource = before.wikisource; }
    data.totals = await totals(data, data.ratios);
    data.totalsMade = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(OUT, JSON.stringify(data));
  })().catch(e => { console.error(e); process.exit(1); });
}
