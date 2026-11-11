/**
 * Build the Wikisource release: the curated Hebrew Wikisource books (extras/wikisourceBooks.json)
 * converted by the phone's own code (extras/wikisource.js convertPages: the same files the phone
 * makes from the site's pages, byte for byte), one zip a book, so the phone downloads one file
 * instead of a request a page (extras/wikisource.js HOSTED_TAG).
 *
 *   node tools/library-export/build_wikisource_release.js <pages dir> <out dir> [--tag <tag>] [--sizes] [page ...]
 *   (page ...: only those books - a trial; the release has them all)
 *
 * <pages dir>: <book>.json for each book, the site's pages as the phone downloads them
 *   (fetch_wikisource_live.js writes them; a book missing there is fetched now, the same way).
 * Writes <out dir>/:
 *   wikisource-index.json   {format, converterVersion, tag, made, books: {page: {title, file, size,
 *                           md5, sha256, hash (newest revision), fetched, pages, firstSection,
 *                           companions: [{entry, firstSection}]}}}
 *   ws-<md5>.zip            each book: its files and its editors' notes book's (JSON.stringify of
 *                           each, as extras/index.js writeBook writes them; ASCII names: GitHub
 *                           renames others)
 *   README.md, SHA256SUMS.txt
 * Each book is checked as it is built: the zip read back gives the same files, and the phone's
 * path for a book from the release (convert, treeOf) gives what converting the pages gives.
 * --sizes: also puts the books' sizes into fullLibrarySizes.json (each book's download, the ratio
 *   of the space it takes on the phone, the totals: full_library_sizes.js's rules; needs the network).
 * Upload: gh release create <tag> --repo soferbooks/soferbooks-library-data --latest=false
 *   --title ... --notes-file <out>/README.md <out>/*
 */
require('@babel/register')({presets: ['babel-preset-expo'], extensions: ['.js'], ignore: [/node_modules/]});
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const {isDeepStrictEqual} = require('util');

const wikisource = require('../../extras/wikisource');
const {sectionsOf} = require('../../extras/schema7');
const CATALOG = require('../../extras/wikisourceBooks.json');

const {fetchPages, apiClient, convertPages, convert, CONVERTER_VERSION, HOSTED_TAG, HOSTED_FORMAT,
  HOSTED_INDEX, HOSTED_REPO} = wikisource;

const fileOf = title => `${title.replace(/[\\/:*?"<>|]/g, '-')}.json`;     // (fetch_wikisource_live.js's)
const assetOf = page => `ws-${crypto.createHash('md5').update(page, 'utf8').digest('hex').slice(0, 12)}.zip`;
const digest = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');

// a zip of {name: text}, by Python's zipfile (deflate; a fixed date, so a book unchanged gives the same zip)
const ZIP_PY = `
import json, sys, zipfile
files = json.loads(sys.stdin.buffer.read().decode("utf-8"))
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in sorted(files):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, files[name].encode("utf-8"))
`;
const UNZIP_PY = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    sys.stdout.buffer.write(json.dumps({n: z.read(n).decode("utf-8") for n in z.namelist()}).encode("utf-8"))
`;
const python = (code, args, input) => {
  const r = spawnSync('python', ['-I', '-c', code, ...args], {input, maxBuffer: 1 << 30});
  if (r.status !== 0) { throw new Error(`python: ${r.stderr}`); }
  return r.stdout;
};

/** The leaves extras/links.js reads of a tree (schema7.sectionsOf) */
const leavesOf = (tree, heTitle) => sectionsOf(tree, heTitle).leaves
  .map(l => ({keys: l.keys, heTitles: l.heTitles, paras: l.paras}));

function readme(tag, books, total) {
  return `# Hebrew Wikisource books for SoferBooks Library (${tag})

${Object.keys(books).length} whole sefarim from **Hebrew Wikisource** (ויקיטקסט, https://he.wikisource.org),
converted for the SoferBooks Library app by its own converter (one zip a book: the book's files and
its editors' notes), so the app downloads one file a book instead of a request a page.
Total ${(total / 1e6).toFixed(1)} MB.

## Licence and credit

The texts are from Hebrew Wikisource and are licensed under the
**Creative Commons Attribution-ShareAlike 4.0 licence (CC BY-SA 4.0)**,
https://creativecommons.org/licenses/by-sa/4.0/ . They were written and edited by Wikisource's
volunteers; each book's contributors are listed in the history of its pages on the site, and each
edition in these files names its page, the date it was retrieved and that history. The converted
books are shared under the same licence. Converted from the pages as they were on the date given
for each book in \`${HOSTED_INDEX}\`; the site may have been edited since.

## Files

* \`${HOSTED_INDEX}\` - each book (by its Wikisource page): its file, size, md5, sha256, newest
  revision, the pages it was made from and the date they were retrieved.
* \`ws-*.zip\` - the books.
* \`SHA256SUMS.txt\`

Built by \`tools/library-export/build_wikisource_release.js\` (converter version ${CONVERTER_VERSION}).
`;
}

async function sizes(out, index) {
  const sizesTool = require('./full_library_sizes');   // (it stubs React Native's modules it does not need)
  const data = JSON.parse(fs.readFileSync(sizesTool.OUT, 'utf8'));
  const kb = n => Math.max(1, Math.round(n / 1024));
  const map = {};
  let down = 0;
  let phone = 0;
  for (const [page, b] of Object.entries(index.books)) {
    map[page] = kb(b.size);
    down += b.size;
    const zip = JSON.parse(python(UNZIP_PY, [path.join(out, b.file)]).toString('utf8'));
    const files = Object.fromEntries(Object.entries(zip).map(([n, t]) => [n, JSON.parse(t)]));
    phone += await sizesTool.phoneBytes(files);
  }
  data.wikisource = map;
  data.wikisourceRelease = index.tag;
  data.ratios = {...(data.ratios || {}), wikisource: Math.round((phone / down) * 100) / 100};
  const t = await sizesTool.totals(data, data.ratios);
  data.totals = {...(data.totals || {}), wikisource: t.wikisource};
  fs.writeFileSync(sizesTool.OUT, JSON.stringify(data));
  console.log(`fullLibrarySizes.json: wikisource ratio x${data.ratios.wikisource}, totals`, t.wikisource);
}

async function main() {
  const args = process.argv.slice(2);
  const ti = args.indexOf('--tag');
  const tag = ti >= 0 ? args.splice(ti, 2)[1] : HOSTED_TAG;
  const si = args.indexOf('--sizes');
  if (si >= 0) { args.splice(si, 1); }
  const [pagesDir, out, ...only] = args;
  if (!pagesDir || !out) { throw new Error('usage: build_wikisource_release.js <pages dir> <out dir> [--tag <tag>] [--sizes]'); }
  fs.mkdirSync(pagesDir, {recursive: true});
  fs.rmSync(out, {recursive: true, force: true});
  fs.mkdirSync(out, {recursive: true});

  const index = {format: HOSTED_FORMAT, converterVersion: CONVERTER_VERSION, tag, repo: HOSTED_REPO,
    made: new Date().toISOString().slice(0, 10), source: 'https://he.wikisource.org', license: 'CC BY-SA 4.0', books: {}};
  let total = 0;
  for (const entry of wikisource.parseCatalog().filter(e => !only.length || only.includes(e.id))) {
    const pagesFile = path.join(pagesDir, fileOf(entry.id));
    if (!fs.existsSync(pagesFile)) {
      console.log(`${entry.id}: fetching from the site`);
      fs.writeFileSync(pagesFile, JSON.stringify(await fetchPages(entry.id, {client: apiClient()})));
    }
    const book = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    const made = convertPages(entry, book);
    const all = {...made.files};
    for (const c of made.companions) { Object.assign(all, c.files); }
    const texts = Object.fromEntries(Object.entries(all).map(([n, d]) => [n, JSON.stringify(d)]));
    const file = assetOf(entry.id);
    const zipPath = path.join(out, file);
    python(ZIP_PY, [zipPath], Buffer.from(JSON.stringify(texts), 'utf8'));
    const buf = fs.readFileSync(zipPath);
    const rec = wikisource.installRecord(entry, book);   // (what the phone keeps of pages from the site)
    const hosted = {
      title: book.title, file, size: buf.length, md5: digest('md5', buf), sha256: digest('sha256', buf),
      hash: rec.hash, fetched: book.fetched, pages: rec.pages, firstSection: made.firstSection,
      companions: made.companions.map(c => ({entry: c.entry, firstSection: c.firstSection})),
    };

    // the checks: the zip as the phone reads it, and the phone's path for a book from the release
    const back = JSON.parse(python(UNZIP_PY, [zipPath]).toString('utf8'));
    if (!isDeepStrictEqual(back, texts)) { throw new Error(`${entry.id}: the zip does not give its files back`); }
    const files = Object.fromEntries(Object.entries(back).map(([n, t]) => [n, JSON.parse(t)]));
    const doc = {hosted: true, title: hosted.title, fetched: hosted.fetched, hash: hosted.hash, pages: hosted.pages,
      files, firstSection: hosted.firstSection, companions: hosted.companions};
    const phone = convert(entry, doc);
    const same = isDeepStrictEqual(phone.files, made.files) && phone.firstSection === made.firstSection
      && isDeepStrictEqual(phone.companions, made.companions.map(c => ({entry: c.entry, files: c.files, firstSection: c.firstSection})))
      && isDeepStrictEqual(leavesOf(phone.tree, entry.heTitle), leavesOf(made.tree, entry.heTitle));
    if (!same) { throw new Error(`${entry.id}: the release's copy is not what the phone makes`); }

    index.books[entry.id] = hosted;
    total += buf.length;
    console.log(`${entry.id}: ${book.pages.length} pages, ${Object.keys(all).length} files, ${(buf.length / 1024).toFixed(0)} kB`
      + `${made.companions.length ? ' (with its notes)' : ''}`);
  }
  fs.writeFileSync(path.join(out, HOSTED_INDEX), JSON.stringify(index, null, 1));
  fs.writeFileSync(path.join(out, 'README.md'), readme(tag, index.books, total));
  const sums = fs.readdirSync(out).filter(f => f !== 'SHA256SUMS.txt').sort()
    .map(f => `${digest('sha256', fs.readFileSync(path.join(out, f)))}  ${f}`);
  fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  console.log(`${Object.keys(index.books).length} books, ${(total / 1e6).toFixed(1)} MB -> ${out}`);
  if (si >= 0) { await sizes(out, index); }
}

main().catch(e => { console.error(e); process.exit(1); });
