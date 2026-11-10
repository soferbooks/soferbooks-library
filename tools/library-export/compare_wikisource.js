/**
 * Fidelity check of the phone's Wikisource converter (extras/wikisourceParse.js) against Sofer's.
 *
 * For every book Sofer imported from Wikitext (C:\Users\morde\Sofer\data, read only): the pages
 * Sofer downloaded (data/wikisource/books/<book>.json, the site's rendered pages) are converted
 * with the phone's code and compared with Sofer's converted edition
 * (data/sefaria-export/json/<category>/Wikitext/<book>/Hebrew/Wikitext.json) and its editors'
 * notes book (.../Wikitext/Notes/הערות המהדיר על <book>/...): sections (their names and order),
 * paragraphs, the notes on each paragraph, and the author.
 *
 *   node -r @babel/register tools/library-export/compare_wikisource.js [--quiet] [--live <dir>]
 *
 * --live <dir>: also compare books fetched now from the site by the phone's own download code
 * (<dir>/<book>.json, written by fetch_wikisource_live.js) with Sofer's copy - the site may have
 * been edited since Sofer fetched it.
 *
 * --sofer-on <dir>: the books in <dir> (<book>.json) converted by Sofer's importer
 * (wikisource_fixtures.py <dir> -> <book>.sofer.json) and by the phone: the converter alone, on
 * the pages as they are now.
 */
const fs = require('fs');
const path = require('path');
const {wikiTree, wikiAuthor} = require('../../extras/wikisourceParse');
const {exportOf} = require('../../extras/wikisource');
const {safe} = require('../../extras/tree');

const SOFER = 'C:\\Users\\morde\\Sofer\\data';
const BOOKS = path.join(SOFER, 'wikisource', 'books');
const EXPORT = path.join(SOFER, 'sefaria-export', 'json');
const NOTES_PREFIX = 'הערות המהדיר על ';

/** {safe title: folder of its Hebrew editions} of Sofer's Wikitext books */
function soferBooks() {
  const out = {};
  for (const top of fs.readdirSync(EXPORT)) {
    const w = path.join(EXPORT, top, 'Wikitext');
    if (!fs.existsSync(w)) { continue; }
    for (const t of fs.readdirSync(w)) {
      if (t !== 'Notes') { out[t] = path.join(w, t, 'Hebrew'); }
    }
    const n = path.join(w, 'Notes');
    if (fs.existsSync(n)) {
      for (const t of fs.readdirSync(n)) { out[t] = path.join(n, t, 'Hebrew'); }
    }
  }
  return out;
}

/** The sections of an export's text: [{path, paras}] */
function sections(nodes, text, trail = []) {
  const out = [];
  for (const n of nodes) {
    const key = n.default ? '' : n.key;
    const name = n.default ? '' : n.heTitle;
    if (n.nodes) { out.push(...sections(n.nodes, (text || {})[key] || {}, trail.concat(name))); } else {
      out.push({path: trail.concat(name), paras: (text || {})[key] || []});
    }
  }
  return out;
}

function compare(ours, theirs) {
  const r = {sections: [ours.length, theirs.length], samePaths: 0, sameParas: 0, paras: [0, 0], equalParas: 0, firstDiff: null};
  for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
    const a = ours[i];
    const b = theirs[i];
    if (a) { r.paras[0] += a.paras.length; }
    if (b) { r.paras[1] += b.paras.length; }
    if (!a || !b) { r.firstDiff = r.firstDiff || {i, ours: a && a.path, sofer: b && b.path}; continue; }
    if (JSON.stringify(a.path) === JSON.stringify(b.path)) { r.samePaths += 1; } else if (!r.firstDiff) {
      r.firstDiff = {i, ours: a.path, sofer: b.path};
    }
    a.paras.forEach((p, k) => { if (JSON.stringify(p) === JSON.stringify(b.paras[k])) { r.equalParas += 1; } });
    if (JSON.stringify(a.paras) === JSON.stringify(b.paras)) { r.sameParas += 1; } else if (!r.firstDiff) {
      const j = a.paras.findIndex((p, k) => JSON.stringify(p) !== JSON.stringify(b.paras[k]));
      r.firstDiff = {i, path: a.path, para: j, ours: JSON.stringify(a.paras[j] || '').slice(0, 160),
        sofer: JSON.stringify(b.paras[j] || '').slice(0, 160)};
    }
  }
  r.same = r.sections[0] === r.sections[1] && r.samePaths === r.sections[1] && r.sameParas === r.sections[1];
  return r;
}

/** Each <book>.json of `dir` converted by the phone, against Sofer's conversion of it (<book>.sofer.json) */
function soferOn(dir) {
  let same = 0;
  let n = 0;
  let paras = [0, 0];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sofer.json')).sort()) {
    const want = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const book = JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.sofer\.json$/, '.json')), 'utf8'));
    const tree = wikiTree(book);
    const ex = exportOf(tree);
    const r = compare(sections(ex.nodes, ex.text), sections(want.nodes, want.text));
    const notesOk = want.notes ? JSON.stringify(exportOf(tree, true).text) === JSON.stringify(want.notes) : !tree.hasNotes();
    const ok = r.same && notesOk && wikiAuthor(book) === want.author;
    n += 1;
    same += ok ? 1 : 0;
    paras = [paras[0] + r.equalParas, paras[1] + r.paras[1]];
    if (!ok) { console.log(`DIFF  ${book.title}`, JSON.stringify(r.firstDiff), notesOk ? '' : 'notes differ'); }
  }
  console.log(`${same} of ${n} books converted the same as Sofer's converter does (paragraphs equal ${paras[0]} of ${paras[1]})`);
}

function main() {
  const si = process.argv.indexOf('--sofer-on');
  if (si > 0) { soferOn(process.argv[si + 1]); return; }
  const quiet = process.argv.includes('--quiet');
  const li = process.argv.indexOf('--live');
  const live = li > 0 ? process.argv[li + 1] : null;
  const sofer = soferBooks();
  let books = 0;
  let same = 0;
  let paras = [0, 0];
  let notesSame = 0;
  let notesBooks = 0;
  const skipped = [];
  let siteChanged = 0;
  for (const f of fs.readdirSync(BOOKS).filter(x => x.endsWith('.json')).sort()) {
    const book = JSON.parse(fs.readFileSync(path.join(BOOKS, f), 'utf8'));
    const title = safe(book.title.split('/')[0]);
    const folder = sofer[title];
    if (!folder || !fs.existsSync(path.join(folder, 'Wikitext.json'))) { skipped.push(book.title); continue; }
    const doc = JSON.parse(fs.readFileSync(path.join(folder, 'Wikitext.json'), 'utf8'));
    let pages = book;
    let edited = '';
    if (live) {
      const lf = path.join(live, f);
      if (!fs.existsSync(lf)) { continue; }
      pages = JSON.parse(fs.readFileSync(lf, 'utf8'));
      // (what changed on the site since Sofer fetched it: pages edited, added, gone)
      const was = Object.fromEntries(book.pages.map(p => [p.page, p.revid]));
      const now = Object.fromEntries(pages.pages.map(p => [p.page, p.revid]));
      const changed = Object.keys(now).filter(p => p in was && was[p] !== now[p]).length;
      const added = Object.keys(now).filter(p => !(p in was)).length;
      const gone = Object.keys(was).filter(p => !(p in now)).length;
      edited = changed + added + gone ? `; on the site since Sofer's copy: ${changed} pages edited, ${added} new, ${gone} gone` : '; site unchanged';
      siteChanged += edited === '; site unchanged' ? 0 : 1;
    }
    const tree = wikiTree(pages);
    const ex = exportOf(tree);
    const r = compare(sections(ex.nodes, ex.text), sections(doc.schema.nodes, doc.text));
    const author = wikiAuthor(pages);
    const authorSame = author === (doc.author || '');
    // the editors' notes
    const nfolder = sofer[safe(NOTES_PREFIX + book.title.split('/')[0])];
    let nr = null;
    if (nfolder || tree.hasNotes()) {
      notesBooks += 1;
      const ndoc = nfolder ? JSON.parse(fs.readFileSync(path.join(nfolder, 'Wikitext.json'), 'utf8')) : {schema: {nodes: []}, text: {}};
      const nex = exportOf(tree, true);
      nr = compare(sections(nex.nodes, nex.text), sections(ndoc.schema.nodes, ndoc.text));
      nr.same = nr.same && tree.hasNotes() === !!nfolder;
      notesSame += nr.same ? 1 : 0;
    }
    const ok = r.same && authorSame && (!nr || nr.same);
    books += 1;
    same += ok ? 1 : 0;
    paras = [paras[0] + r.equalParas, paras[1] + r.paras[1]];
    if (quiet && ok) { continue; }
    console.log(`${ok ? 'SAME' : 'DIFF'}  ${book.title}`);
    console.log(`      sections ours/Sofer ${r.sections.join('/')}, headings equal ${r.samePaths}, sections equal ${r.sameParas},`
      + ` paragraphs equal ${r.equalParas} of ${r.paras[1]} (ours ${r.paras[0]}), author ${authorSame ? 'equal' : `"${author}" vs "${doc.author}"`}`
      + (nr ? `, notes ${nr.same ? 'equal' : `differ (${nr.sameParas}/${nr.sections[1]} sections)`}` : '') + edited);
    if (r.firstDiff) { console.log('      first difference', JSON.stringify(r.firstDiff)); }
    if (nr && nr.firstDiff) { console.log('      notes: first difference', JSON.stringify(nr.firstDiff)); }
  }
  console.log(`${same} of ${books} books the same as Sofer's (paragraphs equal ${paras[0]} of ${paras[1]}; `
    + `notes books equal ${notesSame} of ${notesBooks})${live ? `; books edited on the site since Sofer's copy: ${siteChanged}` : ''};`
    + ` not compared (not imported as one book by Sofer): ${skipped.join(', ')}`);
}

main();
