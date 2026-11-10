/**
 * Fidelity check of the phone's Otzaria converter (extras/otzaria.js) against Sofer's.
 *
 * For each book in <folder> (made by otzaria_fidelity.py: NN.txt, Otzaria's text as Sofer read
 * it, and NN.sofer.json, Sofer's converted edition) the phone's converter is run on the text and
 * its sections (the path of headings to each, and its paragraphs) are compared with Sofer's.
 *
 *   node -r @babel/register tools/library-export/compare_otzaria.js <folder>
 */
const fs = require('fs');
const path = require('path');
const {otzariaTree, versionOf} = require('../../extras/otzaria');
const {bookFiles} = require('../../extras/schema7');

function ourSections(tree) {
  const out = [];
  const walk = (node, trail) => {
    if (node.paras.length) { out.push({path: trail.concat(''), paras: node.paras}); }
    for (const c of node.children) {
      if (c.empty()) { continue; }
      if (c.children.length || !c.paras.length) {
        if (c.paras.length) { out.push({path: trail.concat(c.title, ''), paras: c.paras}); }
        for (const g of c.children) { if (!g.empty()) { walk2(g, trail.concat(c.title)); } }
      } else {
        out.push({path: trail.concat(c.title), paras: c.paras});
      }
    }
  };
  const walk2 = (node, trail) => {
    if (!node.children.length) { out.push({path: trail.concat(node.title), paras: node.paras}); return; }
    if (node.paras.length) { out.push({path: trail.concat(node.title, ''), paras: node.paras}); }
    for (const g of node.children) { if (!g.empty()) { walk2(g, trail.concat(node.title)); } }
  };
  if (!tree.children.length) {
    if (tree.paras.length) { out.push({path: [''], paras: tree.paras}); }
  } else {
    walk(tree, []);
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
  const n = Math.max(ours.length, theirs.length);
  for (let i = 0; i < n; i++) {
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

const dir = process.argv[2];
const quiet = process.argv.includes('--quiet');   // only the books that differ, and the count
const books = JSON.parse(fs.readFileSync(path.join(dir, 'books.json'), 'utf8'));
let allSame = true;
let sameCount = 0;
for (const b of books) {
  b.title = b.title || b.he;
  const text = fs.readFileSync(path.join(dir, `${b.key}.txt`), 'utf8').replace(/^﻿/, '');
  const sofer = JSON.parse(fs.readFileSync(b.sofer || path.join(dir, `${b.key}.sofer.json`), 'utf8'));
  const [tree, author] = otzariaTree(text);
  const r = compare(ourSections(tree), soferSections(sofer));
  const entry = {title: b.title, heTitle: b.he, categories: ['X', 'Otzaria', 'Y'], heCategories: [], collection: b.source, license: 'x'};
  const {files, sections} = bookFiles(tree, {...entry, version: versionOf(entry, text)});
  const same = r.sections[0] === r.sections[1] && r.samePaths === r.sections[1] && r.sameParas === r.sections[1]
    && author === (sofer.author || '');
  allSame = allSame && same;
  sameCount += same ? 1 : 0;
  if (quiet && same) { continue; }
  console.log(`${same ? 'SAME' : 'DIFF'}  ${b.source.padEnd(17)} ${b.he}`);
  console.log(`      sections ours/Sofer ${r.sections.join('/')}, headings equal ${r.samePaths}, paragraphs equal ${r.sameParas},`
    + ` paragraphs ${r.paras.join('/')}, author ${author === (sofer.author || '') ? 'equal' : `"${author}" vs "${sofer.author}"`},`
    + ` reader sections ${sections.length}, files ${Object.keys(files).length}`);
  if (r.firstDiff) { console.log('      first difference', JSON.stringify(r.firstDiff)); }
}
console.log(`${sameCount} of ${books.length} books the same as Sofer's`);
process.exit(allSame ? 0 : 1);
