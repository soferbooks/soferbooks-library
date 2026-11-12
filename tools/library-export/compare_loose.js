/**
 * The phone's loose placement (extras/inferred.js looseComments) against Sofer's (loose_placement.py),
 * on the same inputs: the files loose_fixtures.py writes (the Gemara as Sofer reads it, the
 * commentary's comments, Rashi's and Tosafos' dibburim, the perakim, and Sofer's places).
 *
 *   C:\Users\morde\Sofer\.venv\Scripts\python.exe tools\library-export\loose_fixtures.py C:\tmp\loose
 *   node -r @babel/register tools\library-export\compare_loose.js C:\tmp\loose [--quiet]
 *
 * For each book: how many comments got the same place (and the same kind: by quote, by Rashi's /
 * Tosafos' dibbur, at the daf of its siman, beside a neighbour); and whether the phone's dibburimOf
 * reads Rashi's and Tosafos' text as dibburim.load does.
 */
const fs = require('fs');
const path = require('path');
const {looseComments, paraOpening, hebrewWords, dibburimOf} = require('../../extras/inferred');

const HOW = {loose: 'loose', dibbur: 'dibbur', daf: 'daf', neighbour: 'loose-neighbour'};

function compareOne(doc, quiet) {
  const {keys, htmls, amuds, lines} = doc.units;
  const units = keys.map((key, i) => ({key, amud: amuds ? amuds[i] : undefined, line: lines ? lines[i] : undefined,
    words: hebrewWords(htmls[i])}));
  ['amud', 'line'].forEach(f => units.forEach(u => { if (u[f] === null) { u[f] = undefined; } }));
  // the comments as the phone keeps a book: a section (its headings) for each of Sofer's new sections
  const comm = [];
  const index = [];          // comment k -> [leaf, para]
  doc.comments.forEach(([heads, chapter, html], k) => {
    if (heads.length || !comm.length) {
      comm.push({path: [typeof chapter === 'number' ? chapter : 'S'], heTitles: heads, openings: []});
    }
    const leaf = comm[comm.length - 1];
    index.push([comm.length - 1, leaf.openings.length]);
    leaf.openings.push(paraOpening(html));
  });
  const dibburim = new Map(Object.entries(doc.dibburim).map(([a, v]) =>
    [Number(a), v.map(([who, words, text, line]) => ({who, words, text, line}))]));
  // (the phone reads Rashi's and Tosafos' text itself: the same dibburim as Sofer's?)
  const mine = dibburimOf(doc.raw);
  let dibSame = 0;
  let dibAll = 0;
  for (const [a, v] of dibburim) {
    const m = mine.get(a) || [];
    v.forEach((d, i) => { dibAll += 1; if (m[i] && JSON.stringify(m[i]) === JSON.stringify(d)) { dibSame += 1; } });
    if (m.length !== v.length) { dibAll += Math.abs(m.length - v.length); }
  }
  for (const [a, m] of mine) { if (!dibburim.has(a)) { dibAll += m.length; } }

  const placed = looseComments(comm, units, {dibburim, perakim: doc.perakim});
  const byComment = new Map(placed.map(p => [`${p.leaf}|${p.para}`, p]));
  const want = doc.result;
  let same = 0;
  const diffs = [];
  const kinds = {};
  doc.comments.forEach((c, k) => {
    const p = byComment.get(index[k].join('|'));
    const ours = p ? [JSON.stringify(units[p.unit].key), p.how] : [null, null];
    const theirs = want && want[k] && want[k][0] ? [JSON.stringify(want[k][0]), HOW[want[k][1]]] : [null, null];
    if (ours[0] === theirs[0] && ours[1] === theirs[1]) {
      same += 1;
      kinds[ours[1]] = (kinds[ours[1]] || 0) + 1;
    } else {
      diffs.push({k, opening: paraOpening(c[2]).slice(0, 50), sofer: theirs, phone: ours});
    }
  });
  const n = doc.comments.length;
  console.log(`${doc.commentary} on ${doc.book}: ${same} of ${n} the same (${((100 * same) / n).toFixed(1)}%)`,
    JSON.stringify(kinds), `| dibburim read the same: ${dibSame} of ${dibAll}`);
  if (!quiet) { diffs.slice(0, 8).forEach(d => console.log('   ', JSON.stringify(d))); }
  return {same, n, dibSame, dibAll};
}

function main(argv) {
  const dir = argv[0];
  const quiet = argv.includes('--quiet');
  let same = 0;
  let n = 0;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    const r = compareOne(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), quiet);
    same += r.same;
    n += r.n;
  }
  console.log(`all: ${same} of ${n} comments placed the same (${((100 * same) / n).toFixed(2)}%)`);
  return same === n ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
