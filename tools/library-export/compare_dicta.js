/**
 * Fidelity check of the phone's Dicta converter (extras/dicta.js) against Sofer's importer.
 *
 * For each book in <folder> (made by dicta_fidelity.py: NNN.json, what the converter reads as
 * Sofer read it, and books.json, with the path of Sofer's converted edition) the phone's code
 * chooses the text (Otzaria's layout, Dicta's pages or another collection's copy) and converts
 * it; its choice, version name, source line, licence, sections (the headings to each) and
 * paragraphs are compared with Sofer's.
 *
 * With --app the other collections' copies get the app's licences (extras/otzaria.js
 * COLLECTIONS, Otzaria's README of 2026-11) instead of Sofer's: the books whose choice changes
 * are listed (that is the app's rule, not a difference of the converter).
 *
 *   node -r @babel/register tools/library-export/compare_dicta.js <folder> [--quiet] [--app]
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');

// (extras/dicta.js downloads with React Native's modules; the comparison needs none of them)
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'expo-file-system/legacy' || request === 'react-native-zip-archive') { return {}; }
  return load.call(this, request, ...rest);
};
const {choose, versionOf} = require('../../extras/dicta');
const {COLLECTIONS} = require('../../extras/otzaria');
const RULES = require('../../extras/otzariaRules.json');

function ourSections(tree) {
  const out = [];
  const walk = (node, trail) => {
    if (!node.children.length) { out.push({path: trail.concat(node.title), paras: node.paras}); return; }
    if (node.paras.length) { out.push({path: trail.concat(node.title, ''), paras: node.paras}); }
    for (const g of node.children) { if (!g.empty()) { walk(g, trail.concat(node.title)); } }
  };
  if (!tree.children.length) {
    if (tree.paras.length) { out.push({path: [''], paras: tree.paras}); }
  } else {
    for (const c of tree.children) { if (!c.empty()) { walk(c, []); } }
  }
  return out;
}

function soferSections(doc) {
  const out = [];
  const walk = (nodes, text, trail) => {
    for (const n of nodes) {
      const key = n.default ? '' : n.key;
      const t = text[key];
      const name = n.default ? '' : n.heTitle;
      if (n.nodes) { walk(n.nodes, t || {}, trail.concat(name)); } else { out.push({path: trail.concat(name), paras: t || []}); }
    }
  };
  walk(doc.schema.nodes, doc.text, []);
  return out;
}

function compare(ours, theirs) {
  const res = {sections: [ours.length, theirs.length], samePaths: 0, sameParas: 0, paras: [0, 0], firstDiff: null};
  for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
    const a = ours[i];
    const b = theirs[i];
    if (a) { res.paras[0] += a.paras.length; }
    if (b) { res.paras[1] += b.paras.length; }
    if (!a || !b) { res.firstDiff = res.firstDiff || {i, ours: a && a.path, sofer: b && b.path}; continue; }
    if (JSON.stringify(a.path) === JSON.stringify(b.path)) { res.samePaths += 1; } else if (!res.firstDiff) {
      res.firstDiff = {i, ours: a.path, sofer: b.path};
    }
    if (JSON.stringify(a.paras) === JSON.stringify(b.paras)) { res.sameParas += 1; } else if (!res.firstDiff) {
      const j = a.paras.findIndex((p, k) => p !== b.paras[k]);
      res.firstDiff = {i, para: j, ours: (a.paras[j] || '').slice(0, 80), sofer: (b.paras[j] || '').slice(0, 80)};
    }
  }
  return res;
}

/** The app's licence for a collection Sofer names (null: the app does not use it) */
function appLicence(collection, text) {
  const coll = Object.values(COLLECTIONS).find(c => c.source === collection);
  if (!coll || !coll.offered) { return null; }
  const he = (/^<h1>(.*?)<\/h1>/m.exec(text) || [])[1];
  const permitted = he && (RULES.permitted || {})[`${collection}|${he}`];
  if (coll.offered === 'permitted' && !permitted) { return null; }
  return permitted || coll.license;
}

const dir = process.argv[2];
const quiet = process.argv.includes('--quiet');
const app = process.argv.includes('--app');
const books = JSON.parse(fs.readFileSync(path.join(dir, 'books.json'), 'utf8'));
let sameCount = 0;
const kinds = {};
const diffs = {};
for (const b of books) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, `${b.key}.json`), 'utf8'));
  if (app) {
    doc.copies = doc.copies.map(c => ({...c, license: appLicence(c.collection, c.text)})).filter(c => c.license);
  }
  const sofer = JSON.parse(fs.readFileSync(b.sofer, 'utf8'));
  const c = choose(doc);
  const v = versionOf(b, doc);
  kinds[c.kind.split('/')[0] + (c.kind.includes('/') ? '/…' : '')] = (kinds[c.kind.split('/')[0] + (c.kind.includes('/') ? '/…' : '')] || 0) + 1;
  const r = compare(ourSections(c.tree), soferSections(sofer));
  const checks = {
    kind: c.kind === sofer.sofer_source,
    versionTitle: v.versionTitle === sofer.versionTitle,
    versionSource: v.versionSource === sofer.versionSource,
    license: v.license === sofer.license,
    sections: r.sections[0] === r.sections[1] && r.samePaths === r.sections[1],
    paragraphs: r.sameParas === r.sections[1] && r.sections[0] === r.sections[1],
  };
  const same = Object.values(checks).every(Boolean);
  sameCount += same ? 1 : 0;
  for (const [k, ok] of Object.entries(checks)) { if (!ok) { diffs[k] = (diffs[k] || 0) + 1; } }
  if (quiet && same) { continue; }
  console.log(`${same ? 'SAME' : 'DIFF'}  ${b.key} ${b.he}  (ours ${c.kind}, Sofer ${sofer.sofer_source})`);
  if (!same) {
    console.log(`      differ: ${Object.keys(checks).filter(k => !checks[k]).join(', ')}; sections ours/Sofer ${r.sections.join('/')},`
      + ` headings equal ${r.samePaths}, paragraphs equal ${r.sameParas}, paragraphs ${r.paras.join('/')}`);
    if (!checks.versionTitle) { console.log(`      version "${v.versionTitle}" vs "${sofer.versionTitle}"`); }
    if (!checks.license) { console.log(`      licence "${v.license}" vs "${sofer.license}"`); }
    if (r.firstDiff) { console.log('      first difference', JSON.stringify(r.firstDiff)); }
  }
}
console.log(`choices: ${JSON.stringify(kinds)}; differences: ${JSON.stringify(diffs)}`);
console.log(`${sameCount} of ${books.length} books the same as Sofer's${app ? ' (with the app\'s collection licences)' : ''}`);
process.exit(sameCount === books.length ? 0 : 1);
