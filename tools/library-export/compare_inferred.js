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
 *   node -r @babel/register tools/library-export/compare_inferred.js loose <commentary export.json> <base export.json> <Title> [--talmud] [--samples n]
 *       a commentary Sofer's rules cannot place (Dicta's), placed by the loose matching (beyond
 *       Sofer): how many comments were placed, and samples with the quote and the passage found
 */
const fs = require('fs');
const {inferredLinks, placeComments, looseComments, numberPaths, paraSign, paraOpening, looseQuote, sefariaUnits, extraUnits, talmudUnits} = require('../../extras/inferred');

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
          paras.map(x => (String(x).trim() ? paraSign(x) : null)), paras.map(x => (String(x).trim() ? paraOpening(x) : null))]);
        out[out.length - 1].id = keys.concat(key);
        out[out.length - 1].paras = paras;
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
    got[leaves[p.leaf].id.concat(p.para).join('|')] = [units[p.unit].key.join('|'), p.how];
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

function loose([commFile, baseFile, title, ...opts]) {
  const comm = read(commFile);
  const base = read(baseFile);
  const talmud = opts.includes('--talmud');
  const si = opts.indexOf('--samples');
  const n = si >= 0 ? parseInt(opts[si + 1], 10) : 5;
  const leaves = exportLeaves(comm);
  const label = i => `${Math.floor(i / 2) + 1}${i % 2 ? 'b' : 'a'}`;
  const units = talmud ? talmudUnits(title, base.heTitle || title, base.text.map((a, i) => [label(i), a]).filter(([, a]) => a && a.length))
    : sefariaUnits(title, base.heTitle || title, base.text.map((v, i) => [i, v]));
  const textOf = {};
  base.text.forEach((a, i) => (a || []).forEach((s, j) => { textOf[talmud ? `${title} ${label(i)}:${j + 1}` : `${title} ${i + 1}:${j + 1}`] = s; }));
  const links = inferredLinks({leaves}, {units});
  const paras = leaves.reduce((a, l) => a + l[4].filter(x => x !== null).length, 0);
  const byHow = {};
  links.forEach(l => { const k = `${l.how}/${l.c}`; byHow[k] = (byHow[k] || 0) + 1; });
  const quoted = links.filter(l => l.how === 'loose').length;
  console.log(`${comm.heTitle} -> ${title}: ${paras} comments; placed by their quote ${quoted} (${(100 * quoted / paras).toFixed(0)}%), `
    + `with a neighbour ${links.length - quoted}; in all ${(100 * links.length / paras).toFixed(0)}%`, byHow);
  const paraText = {};
  leaves.forEach(l => l.paras.forEach((p, j) => { paraText[`${l[0]}:${j + 1}`] = p; }));
  const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/[֑-ׇ]/g, '');
  const qs = links.filter(l => l.how === 'loose');
  const step = Math.max(1, Math.floor(qs.length / n));
  qs.filter((_, i) => i % step === 0).slice(0, n).forEach(l => {
    const o = paraOpening(paraText[l.a]);
    console.log(`  [${l.c}] ${l.a.replace(/^X, /, '')} -> ${l.t}
     quote: ${looseQuote(o).join(' ')}
     comment: ${o}
     text: ${strip(textOf[l.t]).slice(0, 160)}`);
  });
  return 0;
}

/** The loose matching alone on a book Sofer places by its own rules: how often the two agree */
function looseVsSofer([commFile, baseFile, outFile]) {
  const comm = read(commFile);
  const base = read(baseFile);
  const want = read(outFile);
  const leaves = exportLeaves(comm);
  const paths = numberPaths(leaves.map(l => ({keys: l[2], heTitles: l[3]})));
  const units = sefariaUnits('B', 'ב', base.text.map((v, i) => [i, v]));
  const placed = looseComments(leaves.map((l, i) => ({path: paths[i].path, heTitles: l[3], openings: l[5]})), units);
  let quoted = 0;
  let agree = 0;
  let soferSure = 0;
  let bothSure = 0;
  for (const p of placed) {
    const id = leaves[p.leaf].id.concat(p.para).join('|');
    const s = want[id];
    if (s && s[1] !== 'neighbour') { soferSure += 1; }
    if (p.how !== 'loose') { continue; }
    quoted += 1;
    if (s && s[1] !== 'neighbour') {
      bothSure += 1;
      if (s[0] === units[p.unit].key.join('|')) { agree += 1; }
    }
  }
  console.log(`${comm.heTitle}: ${placed.length} comments; Sofer placed ${soferSure} by quote or verse number; `
    + `the loose matching ${quoted} by quote; of those both placed, the same verse: ${agree} of ${bothSure} `
    + `(${(100 * agree / Math.max(1, bothSure)).toFixed(1)}%)`);
  return 0;
}

/**
 * The loose matching on an Otzaria commentary that Sofer places by Otzaria's links (links_otzaria.csv),
 * its verse headings hidden (only its chapters known): how often it finds the verse the links give
 */
function looseVsLinks([commFile, baseFile, linksCsv, title]) {
  const comm = read(commFile);
  const base = read(baseFile);
  const want = {};
  for (const line of fs.readFileSync(linksCsv, 'utf8').split('\n')) {
    const m = /^"?(.+?), (S[^ ]+(?:, S[^ ]+)*) (\d+)"?,([^,]+ \d+:\d+),/.exec(line);
    if (m && m[1] === comm.heTitle) { want[`${m[2].split(', ').join('|')}|${m[3] - 1}`] = m[4]; }
  }
  const leaves = exportLeaves(comm);
  const paths = numberPaths(leaves.map(l => ({keys: l[2], heTitles: l[3]})));
  const units = sefariaUnits(title, title, base.text.map((v, i) => [i, v]));
  const placed = looseComments(leaves.map((l, i) => ({path: paths[i].path.slice(0, 1), heTitles: l[3].slice(0, 1),
    openings: l[5]})), units);
  let quoted = 0;
  let checked = 0;
  let agree = 0;
  for (const p of placed) {
    if (p.how !== 'loose') { continue; }
    quoted += 1;
    const w = want[leaves[p.leaf].id.concat(p.para).join('|')];
    if (w) {
      checked += 1;
      if (w === units[p.unit].ref) { agree += 1; }
    }
  }
  console.log(`${comm.heTitle}: ${placed.length} comments, ${Object.keys(want).length} with Otzaria's links; placed by quote `
    + `${quoted} (${(100 * quoted / Math.max(1, placed.length)).toFixed(0)}%); the same verse as the links: ${agree} of ${checked} `
    + `(${(100 * agree / Math.max(1, checked)).toFixed(1)}%)`);
  return 0;
}

const [mode, ...args] = process.argv.slice(2);
const MODES = {sofer, loose, loosevs: looseVsSofer, loosevslinks: looseVsLinks, live};
process.exit((MODES[mode] || live)(args));
