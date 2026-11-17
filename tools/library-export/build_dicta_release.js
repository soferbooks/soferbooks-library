/**
 * Build the Dicta Library release for SoferBooks Library:
 * Fetches Dicta's catalogue (extras/dicta.js fetchCatalog), converts each book with the
 * app's own converter (extras/dicta.js, schema7.js, localSearch.js, extras/links.js),
 * and packs them into ~200 MB shard zips (dicta-shard-1.zip, ...) + dicta-manifest.json
 * ready to upload to a GitHub Release on soferbooks/soferbooks-library-data.
 *
 * Usage:
 *   node tools/library-export/build_dicta_release.js <work dir> <out dir> [--tag <tag>] [--limit <n>]
 */
require('@babel/register')({
  presets: ['babel-preset-expo'],
  extensions: ['.js'],
  ignore: [/node_modules/],
});

const Module = require('module');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const takeFlag = (flag, def = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const TAG = takeFlag('--tag', `dicta-${new Date().toISOString().slice(0, 10)}`);
const LIMIT = parseInt(takeFlag('--limit', '0'), 10) || 0;
const CONCURRENCY = parseInt(takeFlag('--concurrency', '8'), 10) || 8;
const SHARD_MAX_BYTES = 200 * 1024 * 1024;
const [WORK_ARG, OUT_ARG] = args;

if (!WORK_ARG || !OUT_ARG) {
  throw new Error('Usage: build_dicta_release.js <work dir> <out dir> [--tag <tag>] [--limit <n>]');
}

const WORK_ROOT = path.resolve(WORK_ARG);
const OUT_DIR = path.resolve(OUT_ARG);
const DOC_DIR = `${path.join(WORK_ROOT, 'doc').replace(/\\/g, '/')}/`;
const CACHE_DIR = `${path.join(WORK_ROOT, 'cache').replace(/\\/g, '/')}/`;
fs.mkdirSync(DOC_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const toFsPath = uri => String(uri || '').replace(/^file:\/\//, '');

// Node stubs for React Native / Expo modules so extras/dicta.js + links.js run verbatim.
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'expo-file-system/legacy' || request === 'expo-file-system') {
    return {
      documentDirectory: DOC_DIR,
      cacheDirectory: CACHE_DIR,
      bundleDirectory: DOC_DIR,
      getInfoAsync: async p => {
        const fp = toFsPath(p);
        try {
          const st = fs.statSync(fp);
          return { exists: true, isDirectory: st.isDirectory(), size: st.size, uri: fp };
        } catch (e) {
          return { exists: false };
        }
      },
      makeDirectoryAsync: async p => { fs.mkdirSync(toFsPath(p), { recursive: true }); },
      deleteAsync: async p => { fs.rmSync(toFsPath(p), { recursive: true, force: true }); },
      readDirectoryAsync: async p => fs.readdirSync(toFsPath(p)),
      readAsStringAsync: async p => fs.readFileSync(toFsPath(p), 'utf8'),
      writeAsStringAsync: async (p, content) => {
        const fp = toFsPath(p);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, content, 'utf8');
      },
      downloadAsync: async (url, dest) => {
        const fp = toFsPath(dest);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        const res = await fetch(url);
        if (!res.ok) { return { status: res.status, uri: dest }; }
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(fp, buf);
        return { status: res.status, uri: dest };
      },
      createDownloadResumable: null,
    };
  }
  if (request === 'react-native-zip-archive') {
    return {
      unzip: async (zipPath, destDir) => {
        const r = spawnSync('python', [
          '-I', '-c',
          'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
          toFsPath(zipPath), toFsPath(destDir),
        ], { encoding: 'utf8' });
        if (r.status !== 0) { throw new Error(`unzip failed: ${r.stderr}`); }
        return destDir;
      },
      zip: async () => '',
    };
  }
  if (request === '@react-native-async-storage/async-storage') {
    return { default: { getItem: async () => null, setItem: async () => {} } };
  }
  if (request === 'react-native') {
    return { Platform: { OS: 'android' }, InteractionManager: { runAfterInteractions: fn => fn() } };
  }
  return origLoad.call(this, request, ...rest);
};

const md5 = require('md5');
const dicta = require('../../extras/dicta').default;
const { bookFiles } = require('../../extras/schema7');
const { bookLines } = require('../../localSearch');
const { sectionsOf } = require('../../extras/schema7');
const linksMod = require('../../extras/links');

const digest = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');

function zipDictToBuffer(entriesObj) {
  const tmpJson = path.join(WORK_ROOT, `zip-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const tmpZip = `${tmpJson}.zip`;
  fs.writeFileSync(tmpJson, JSON.stringify(entriesObj), 'utf8');
  const py = `
import json, sys, zipfile
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    files = json.load(f)
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for name in sorted(files):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, files[name].encode('utf-8'))
`;
  try {
    const r = spawnSync('python', ['-I', '-c', py, tmpJson, tmpZip], { encoding: 'utf8' });
    if (r.status !== 0) { throw new Error(`python zip failed: ${r.stderr}`); }
    return fs.readFileSync(tmpZip);
  } finally {
    fs.rmSync(tmpJson, { force: true });
    fs.rmSync(tmpZip, { force: true });
  }
}

function buildShardZip(items, outZipPath) {
  const manifestJson = path.join(WORK_ROOT, `shard-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(manifestJson, JSON.stringify(items), 'utf8');
  const py = `
import json, sys, zipfile
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    items = json.load(f)
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for arcname, src in items:
        z.write(src, arcname)
`;
  try {
    const r = spawnSync('python', ['-I', '-c', py, manifestJson, outZipPath], { encoding: 'utf8' });
    if (r.status !== 0) { throw new Error(`python shard zip failed: ${r.stderr}`); }
  } finally {
    fs.rmSync(manifestJson, { force: true });
  }
}

async function convertOneBook(entry) {
  const doc = await dicta.fetchBook(entry, null);
  const [tree, author] = dicta.toTree(doc, entry);
  const { files, firstSection } = bookFiles(tree, {
    title: entry.title,
    heTitle: entry.heTitle,
    categories: entry.categories,
    heCategories: entry.heCategories,
    authors: author ? [{ he: author, en: '' }] : null,
    versions: dicta.versionsOf(entry, doc, tree),
  });
  const textEntries = Object.fromEntries(Object.entries(files).map(([n, d]) => [n, JSON.stringify(d)]));
  const bookZipBuf = zipDictToBuffer(textEntries);
  const searchNames = Object.keys(files).filter(n => !n.endsWith('_index.json'));
  const lines = await bookLines(searchNames, async n => files[n]);
  const searchText = lines.length ? `${lines.join('\n')}\n` : '';

  const where = dicta.linksOf(entry, doc) || {};
  const { data: linkData, later } = await linksMod.collect({
    title: entry.title,
    heTitle: entry.heTitle,
    tree,
    where,
    fetchCitations: where.dictaPages && dicta.fetchPageCitations
      ? () => dicta.fetchPageCitations(entry, { cancelled: false })
      : null,
    stillWanted: () => false,
  });
  const cites = await later.catch(() => false);
  void cites;
  // Wait for citations if dictaPages was present so pre-built links include them!
  let finalLinks = linkData;
  if (where.dictaPages && dicta.fetchPageCitations) {
    try {
      const passages = linksMod.passagesOf(tree, entry.title, entry.heTitle);
      const pages = await dicta.fetchPageCitations(entry, { cancelled: false });
      const extracted = linksMod.placeCitations(pages, passages);
      if (extracted && extracted.length) {
        finalLinks = { ...linkData, links: (linkData.links || []).concat(extracted) };
      }
    } catch (e) { /* keep base links */ }
  }

  return {
    entry,
    firstSection,
    bookZipBuf,
    searchText,
    linksJson: JSON.stringify(finalLinks),
  };
}

async function main() {
  console.log('Fetching Dicta catalogue...');
  const entries = await dicta.fetchCatalog();
  const target = LIMIT > 0 ? entries.slice(0, LIMIT) : entries;
  console.log(`Found ${entries.length} Dicta entries; processing ${target.length} with concurrency=${CONCURRENCY}`);

  const stageDir = path.join(WORK_ROOT, 'staged');
  fs.mkdirSync(path.join(stageDir, 'library', '_extras', 'links'), { recursive: true });

  const results = [];
  const failed = [];
  let cursor = 0;

  async function worker() {
    while (cursor < target.length) {
      const idx = cursor++;
      const entry = target[idx];
      try {
        const res = await convertOneBook(entry);
        const zipRel = `library/${entry.title}.zip`;
        const zipPath = path.join(stageDir, zipRel);
        fs.writeFileSync(zipPath, res.bookZipBuf);
        const items = [[zipRel, zipPath]];

        if (res.searchText) {
          const searchRel = `library/${entry.title}_search.txt`;
          const searchPath = path.join(stageDir, searchRel);
          fs.writeFileSync(searchPath, res.searchText, 'utf8');
          items.push([searchRel, searchPath]);
        }

        const linkRel = `library/_extras/links/${md5(entry.title)}.json`;
        const linkPath = path.join(stageDir, linkRel);
        fs.writeFileSync(linkPath, res.linksJson, 'utf8');
        items.push([linkRel, linkPath]);

        const totalBytes = items.reduce((n, [, p]) => n + fs.statSync(p).size, 0);
        results.push({
          id: entry.id,
          title: entry.title,
          hash: entry.hash || null,
          firstSection: res.firstSection,
          size: res.bookZipBuf.length,
          totalBytes,
          items,
        });
        if (results.length % 25 === 0 || results.length === target.length) {
          console.log(`Converted ${results.length}/${target.length} (failed: ${failed.length})`);
        }
      } catch (e) {
        failed.push({ title: entry.title, error: String((e && e.message) || e) });
        console.warn(`FAILED ${entry.title}:`, String((e && e.message) || e));
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Pack staged books into ~200 MB shard zips
  const shards = [];
  let curItems = [];
  let curTitles = [];
  let curBytes = 0;

  const flushShard = () => {
    if (!curItems.length) { return; }
    const shardName = `dicta-shard-${shards.length + 1}.zip`;
    const shardPath = path.join(OUT_DIR, shardName);
    buildShardZip(curItems, shardPath);
    const buf = fs.readFileSync(shardPath);
    shards.push({
      file: shardName,
      size: buf.length,
      sha256: digest('sha256', buf),
      titles: curTitles,
    });
    console.log(`Built ${shardName}: ${curTitles.length} books, ${(buf.length / 1e6).toFixed(1)} MB`);
    curItems = [];
    curTitles = [];
    curBytes = 0;
  };

  for (const r of results) {
    if (curItems.length && curBytes + r.totalBytes > SHARD_MAX_BYTES) {
      flushShard();
    }
    curItems.push(...r.items);
    curTitles.push(r.title);
    curBytes += r.totalBytes;
  }
  flushShard();

  const booksMap = {};
  for (const r of results) {
    booksMap[r.title] = {
      id: r.id,
      hash: r.hash,
      firstSection: r.firstSection,
      size: r.size,
    };
  }

  const manifest = {
    format: 1,
    converterVersion: dicta.converterVersion,
    tag: TAG,
    made: new Date().toISOString().slice(0, 10),
    shards,
    books: booksMap,
    failed,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'dicta-manifest.json'), JSON.stringify(manifest, null, 1));
  const totalMB = shards.reduce((n, s) => n + s.size, 0) / 1e6;
  fs.writeFileSync(
    path.join(OUT_DIR, 'README.md'),
    `# Dicta Library for SoferBooks Library (${TAG})\n\n${results.length} books in ${shards.length} shard zip(s) (${totalMB.toFixed(1)} MB total).\nLicense: CC BY-SA 4.0 (Dicta / Otzaria).\n`
  );
  const sums = fs.readdirSync(OUT_DIR).filter(f => f !== 'SHA256SUMS.txt').sort()
    .map(f => `${digest('sha256', fs.readFileSync(path.join(OUT_DIR, f)))}  ${f}`);
  fs.writeFileSync(path.join(OUT_DIR, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  console.log(`Done! ${results.length} books in ${shards.length} shards (${totalMB.toFixed(1)} MB), ${failed.length} failed -> ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
