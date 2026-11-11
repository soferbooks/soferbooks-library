/**
 * Fidelity check of the phone's inferred commentary links (extras/inferred.js) against Sofer's own
 * placing (inferred_fixtures.py, which runs Sofer's mg_books code), and a look at real books.
 *
 *   node -r @babel/register tools/library-export/compare_inferred.js sofer <commentary.json> <base.json> <sofer.out.json>
 *       the same Sofer export files given to inferred_fixtures.py: each paragraph's place compared
 *   node -r @babel/register tools/library-export/compare_inferred.js live <comm.leaves.json> <base.json> [title heTitle]
 *       <comm.leaves.json>: {title, heTitle, leaves} as extras/links.js keeps them (written by
 *       fetch_inferred_cases.js from the books as the phone downloads them); <base.json>: a Sefaria
 *       export in chapters and verses, or another {title, heTitle, leaves, texts}: sample links
 */
const fs = require('fs');
const {inferredLinks, placeComments, numberPaths, paraSign, sefariaUnits, extraUnits} = require('../../extras/inferred');

const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

/** A Sofer export's sections as the phone keeps them: [[ref, heRef, keys, heTitles, signs]] */
function exportLeaves(doc) {
  const out = [];
  const walk = (nodes, text, keys, heTitles) => {
    let unnamed = 0;
    for (const n of nodes) {
      const dflt = n.default || n.key === 'default';
      const key = dflt ? '' : n.key;
      const k = dflt ? (unnamed++ ? `S0_${unnamed}` : 'S0') : n.key;
      const t = (text || {})[key];
      if (n.nodes) {
        walk(n.nodes, t || {}, keys.concat(k), heTitles.concat(n.heTitle || ''));
      } else {
        const paras = Array.isArray(t) ? t.flat(Infinity) : [];
        out.push([`X, ${keys.concat(k).join(', ')}`, '', keys.concat(k), heTitles.concat(dflt ? doc.heTitle || '' : n.heTitle || ''),
          paras.map(x => (String(x).trim() ? paraSign(x) : null)), keys.concat(key)]);
      }
    }
  };
  walk(doc.schema.nodes, doc.text, [], []);
  return out;
}

function sofer([commFile, baseFile, outFile]) {
  const comm = read(commFile);
  const base = read(baseFile);
  const want = read(outFile);
  const leaves = exportLeaves(comm);
  const paths = numberPaths(leaves.map(l => ({keys: l[2], heTitles: l[3]})));
  const units = sefariaUnits('B', 'ב', base.text.map((v, i) => [i, v]));
  const placed = placeComments(leaves.map((l, i) => ({...paths[i], signs: l[4]})), units);
  const got = {};
  for (const p of placed) {
    got[leaves[p.leaf][5].concat(p.para).join('|')] = [units[p.unit].key.join('|'), p.how];
  }
  let same = 0;
  const diffs = [];
  for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
    if (JSON.stringify(want[k]) === JSON.stringify(got[k])) { same += 1; } else { diffs.push([k, want[k] || null, got[k] || null]); }
  }
  console.log(`Sofer placed ${Object.keys(want).length}, the phone ${Object.keys(got).length}; the same: ${same}; different: ${diffs.length}`);
  diffs.slice(0, 15).forEach(d => console.log('  ', JSON.stringify(d)));
  return diffs.length ? 1 : 0;
}

function live([commFile, baseFile]) {
  const comm = read(commFile);
  const base = read(baseFile);
  const units = base.leaves ? extraUnits(base.leaves, base.texts)
    : sefariaUnits(base.title, base.heTitle, base.text.map((v, i) => [i, v]));
  const links = inferredLinks(comm, {units});
  const count = {};
  links.forEach(l => { const k = `${l.how}/${l.c}`; count[k] = (count[k] || 0) + 1; });
  const paras = (comm.leaves || []).reduce((a, l) => a + (l[4] || []).length, 0);
  console.log(`${comm.heTitle} -> ${base.heTitle || base.title}: ${links.length} links of ${paras} paragraphs`, count);
  const step = Math.max(1, Math.floor(links.length / 8));
  links.filter((_, i) => i % step === 0).slice(0, 8).forEach(l => console.log(`   ${l.a}  ->  ${l.t}   (${l.c}, ${l.how})`));
  return 0;
}

const [mode, ...args] = process.argv.slice(2);
process.exit(mode === 'sofer' ? sofer(args) : live(args));
