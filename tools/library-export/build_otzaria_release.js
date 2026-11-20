/**
 * Build the Otzaria release: every Otzaria book the app offers (extras/otzaria.js parseCatalog,
 * the same rules as the phone), as Otzaria's own files - the book's text and its links file - in
 * one zip, so the phone downloads one file instead of a request a book (owner, 2026-11-20: "don't
 * wait for Otzaria", they have not answered about permission). The phone converts each book as
 * if it had fetched it from Otzaria's server (extras/otzaria.js fetchBundleDocs).
 *
 *   node tools/library-export/build_otzaria_release.js <out dir> [--tag otzaria-YYYY-MM-DD] [--cache <dir>]
 *
 * Writes <out dir>/:
 *   otzaria-index.json   {format, tag, made, file, size, md5, sha256, books: {path: {hash, text, links}}}
 *                        hash: Otzaria's (files_manifest.json): the phone uses the bundle's copy of a
 *                        book only while Otzaria's hash is the same; text / links: names in the zip
 *   otzaria-all.zip      o-<md5 of path>.txt and o-<md5 of path>_links.json (ASCII names)
 *   README.md, SHA256SUMS.txt
 * Upload: gh release create <tag> --repo soferbooks/soferbooks-library-data --latest=false
 *   --title "Otzaria books for SoferBooks Library" --notes-file <out>/README.md <out>/*
 */
require('@babel/register')({presets: ['babel-preset-expo'], extensions: ['.js'], ignore: [/node_modules/]});
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync} = require('child_process');

const otzaria = require('../../extras/otzaria');

const HEADERS = {'User-Agent': 'SoferBooksLibrary-build/1.0'};
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const digest = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile)) { return fs.readFileSync(cacheFile, 'utf8'); }
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {headers: HEADERS});
    if (res.status === 404) { return null; }
    if (res.ok) {
      const text = await res.text();
      if (cacheFile) { fs.writeFileSync(cacheFile, text); }
      return text;
    }
    if (attempt >= 5) { throw new Error(`${res.status} for ${url}`); }
    await sleep(2000 * attempt);
  }
}

// a zip of the files in a folder, by Python's zipfile (deflate, a fixed date: the same books give the same zip)
const ZIP_PY = `
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in sorted(os.listdir(src)):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        with open(os.path.join(src, name), "rb") as f:
            z.writestr(info, f.read())
`;

async function main() {
  const args = process.argv.slice(2);
  const out = args[0];
  if (!out) { throw new Error('usage: build_otzaria_release.js <out dir> [--tag t] [--cache dir]'); }
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const tag = opt('--tag') || `otzaria-${new Date().toISOString().slice(0, 10)}`;
  const cache = opt('--cache') || path.join(out, '..', 'otzaria-cache');
  const files = path.join(out, 'files');
  fs.mkdirSync(files, {recursive: true});
  fs.mkdirSync(cache, {recursive: true});

  const manifestText = await get(otzaria.CATALOG_URL, null);
  const entries = otzaria.parseCatalog(manifestText);
  console.log(`${entries.length} books offered`);
  const books = {};
  let n = 0;
  for (const e of entries) {
    const key = `o-${md5(e.id)}`;
    const text = await get(otzaria.bookUrlForPath(e.id), path.join(cache, `${key}.${e.hash || 'x'}.txt`));
    if (text === null) { console.warn('missing', e.id); continue; }
    fs.writeFileSync(path.join(files, `${key}.txt`), text);
    const book = {hash: e.hash || null, text: `${key}.txt`};
    if (e.links) {
      const lp = otzaria.linksPathFor(e.id);
      const links = lp ? await get(otzaria.bookUrlForPath(lp), path.join(cache, `${key}_links.${e.hash || 'x'}.json`)) : null;
      if (links !== null) {
        fs.writeFileSync(path.join(files, `${key}_links.json`), links);
        book.links = `${key}_links.json`;
      }
    }
    books[e.id] = book;
    n += 1;
    if (n % 50 === 0) { console.log(`${n} / ${entries.length}`); }
  }
  const zipPath = path.join(out, 'otzaria-all.zip');
  const z = spawnSync('python', ['-I', '-c', ZIP_PY, files, zipPath], {stdio: 'inherit'});
  if (z.status !== 0) { throw new Error('zip failed'); }
  const buf = fs.readFileSync(zipPath);
  const index = {
    format: 1, tag, made: new Date().toISOString(), file: 'otzaria-all.zip',
    size: buf.length, md5: digest('md5', buf), sha256: digest('sha256', buf), books,
  };
  fs.writeFileSync(path.join(out, 'otzaria-index.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(out, 'README.md'), [
    '# Otzaria books for SoferBooks Library',
    '',
    `The ${Object.keys(books).length} books of the Otzaria library (https://github.com/Otzaria/otzaria-library) that the`,
    'SoferBooks Library app offers, exactly as Otzaria publishes them (each book\'s text and its links file),',
    'in one zip so the app can download them at once. The app converts them on the phone.',
    '',
    "התכנים נאספו, מוינו, סוננו ונערכו על ידי צוות פרויקט 'אוצריא' (otzaria.org).",
    '',
    `Built ${index.made} by tools/library-export/build_otzaria_release.js.`,
  ].join('\n'));
  const sums = ['otzaria-all.zip', 'otzaria-index.json'].map(f => `${digest('sha256', fs.readFileSync(path.join(out, f)))}  ${f}`);
  fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  fs.rmSync(files, {recursive: true, force: true});
  console.log(`wrote ${out}: ${Object.keys(books).length} books, ${(buf.length / 1e6).toFixed(1)} MB zip, tag ${tag}`);
}

main().catch(e => { console.error(e); process.exit(1); });
