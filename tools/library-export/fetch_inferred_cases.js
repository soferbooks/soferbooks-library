/**
 * Download a few commentaries now from their sources' servers, with the phone's own code, and keep
 * what the phone keeps of them for their obvious connections (extras/links.js sectionSigns), for
 * compare_inferred.js live:
 *
 *   node -r @babel/register tools/library-export/fetch_inferred_cases.js <dir>
 *
 * Writes <dir>/<name>.json: {title, heTitle, leaves: [[ref, heRef, keys, headings, signs]],
 * texts: {section ref: [paragraph]}}. Dicta's zips are unpacked by Python's zipfile (the app
 * unpacks them with react-native-zip-archive, which needs no part here).
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'expo-file-system/legacy' || request === 'react-native-zip-archive') { return {}; }
  return load.call(this, request, ...rest);
};
const {fetchPages, apiClient} = require('../../extras/wikisource');
const {wikiTree} = require('../../extras/wikisourceParse');
const {otzariaTree, bookUrlForPath, CATALOG_URL} = require('../../extras/otzaria');
const dicta = require('../../extras/dicta');
const {passagesOf, sectionSigns} = require('../../extras/links');
const {sectionsOf} = require('../../extras/schema7');

const OTZARIA = ['פירוש הגרא על שיר השירים', 'רבינו יונה על משלי', 'הערות על רבינו יונה על משלי'];
const DICTA = ['אבן עזרא הקצר על שמות', 'פירוש הרוקח על שיר השירים'];
const WIKISOURCE = ['רוקח על שיר השירים'];

function keep(dir, name, tree, heTitle) {
  const title = heTitle;
  const passages = passagesOf(tree, title, heTitle);
  const leaves = sectionSigns(tree, heTitle, passages);
  const texts = {};
  sectionsOf(tree, heTitle).leaves.forEach((l, i) => { texts[leaves[i][0]] = l.paras; });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({title, heTitle, leaves, texts}));
  console.log(`${name}: ${leaves.length} sections, ${passages.texts.length} paragraphs`);
}

async function text(url) {
  const r = await fetch(url);
  if (!r.ok) { throw new Error(`HTTP ${r.status} for ${url}`); }
  return (await r.text()).replace(/^﻿/, '');
}

async function main() {
  const dir = process.argv[2];
  fs.mkdirSync(dir, {recursive: true});
  for (const page of WIKISOURCE) {
    const book = await fetchPages(page, {client: apiClient()});
    keep(dir, page, wikiTree(book), page);
  }
  const manifest = await text(CATALOG_URL);
  const paths = Object.keys(JSON.parse(manifest));
  for (const name of OTZARIA) {
    const p = paths.find(x => x.endsWith(`/${name}.txt`) && x.includes('/ספרים/אוצריא/'));
    if (!p) { console.log(`${name}: not in Otzaria's library now`); continue; }
    const hasLinks = paths.some(x => x.endsWith(`/links/${name}_links.json`));
    console.log(`${name}: ${p} (links file: ${hasLinks})`);
    keep(dir, name, otzariaTree(await text(bookUrlForPath(p)))[0], name);
  }
  const entries = dicta.parseCatalog(await text(dicta.CATALOG_URL), manifest);
  for (const name of DICTA) {
    const e = entries.find(x => x.heTitle === name);
    if (!e) { console.log(`${name}: not in Dicta's catalogue now`); continue; }
    const doc = {otzaria: null, pages: null, copies: []};
    if (e.otzaria) { doc.otzaria = await text(bookUrlForPath(e.otzaria.path)); }
    if (!e.otzaria || !dicta.choose({...doc}).tree.children.length) {
      const zipDir = fs.mkdtempSync(path.join(dir, 'dicta-'));
      const zip = path.join(zipDir, 'pages.zip');
      fs.writeFileSync(zip, Buffer.from(await (await fetch(e.textUrl)).arrayBuffer()));
      execFileSync('python', ['-I', '-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, path.join(zipDir, 'p')]);
      const files = [];
      const walk = d => fs.readdirSync(d, {withFileTypes: true}).forEach(f => (f.isDirectory() ? walk(path.join(d, f.name))
        : f.name.endsWith('.txt') && files.push(path.join(d, f.name))));
      walk(path.join(zipDir, 'p'));
      doc.pages = files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
        .map(f => fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
    }
    const c = dicta.choose(doc);
    console.log(`${name}: Dicta, as ${c.kind}`);
    keep(dir, name, c.tree, name);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
