/**
 * The extra sources' books in the library's table of contents (pure; tested in
 * __tests__/extras.test.js).
 *
 * One copy of each sefer (Sofer's rule, importers.run): Sefaria's first, then Dicta's, then
 * Otzaria's, then Wikisource's. Books are compared by their Hebrew names without nikud and
 * punctuation (tree.normTitle). Each book goes under its source's categories (Sofer's
 * placement: Sefaria's top category, then the source, then the source's own shelf).
 */
import {normTitle, safe} from './tree';
import {tocItem} from './schema7';

// Sofer's order: who wins when two sources have the same sefer (but a book a source marks
// `preferred` is used instead of the copies it `replaces`: wikisource.PREFERRED - Sefaria's
// own copy too, which then leaves the toc: owner, 2026-11-12, "Sefaria will soon add Rokeach on
// Shir HaShirim but without the footnotes; make sure not to replace our footnoted edition")
export const PRECEDENCE = ['sefaria', 'dicta', 'otzaria', 'wikisource'];

/** A name as books are matched by it: normTitle, any case (Sefaria's English names too) */
const nameKey = n => normTitle(n).toLowerCase();

// Hebrew names of the categories Sefaria's toc has (export_v7.HEBREW_CATEGORIES)
const TOP_HE = {
  Tanakh: 'תנ״ך', Mishnah: 'משנה', Talmud: 'תלמוד', Midrash: 'מדרש', Halakhah: 'הלכה', Kabbalah: 'קבלה',
  Liturgy: 'סדר התפילה', 'Jewish Thought': 'מחשבת ישראל', Chasidut: 'חסידות', Musar: 'מוסר',
  Responsa: 'שו״ת', 'Second Temple': 'בית שני', Reference: 'מקורות ונספחים',
};

function walkBooks(toc, fn) {
  for (const item of toc || []) {
    if (item.contents) { walkBooks(item.contents, fn); } else if (item.title) { fn(item); }
  }
}

/** The normalised Hebrew (and English) names of the books in a toc */
export function namesInToc(toc) {
  const names = new Set();
  const titles = new Set();
  walkBooks(toc, b => {
    if (b.heTitle) { names.add(normTitle(b.heTitle)); }
    titles.add(String(b.title).toLowerCase());
  });
  return {names, titles};
}

/**
 * Which entries of the extra sources' catalogues go into the library.
 * catalogs: {sourceId: [entry]}; installed: {title: {source, id}} (a downloaded book keeps
 * its title); blocked: {`${source}|${id}`: reason} (books found restricted on download).
 * Returns {books: {title: entry}, skipped: {duplicate: n, blocked: n}, replaced: {title: title}}:
 * replaced, the toc's (Sefaria's) books a `preferred` book is used instead of - any whose Hebrew
 * or English name is one of its names (heTitle, names, replaces), as nameKey compares them - and
 * the chosen book's title. addToToc leaves those out of the toc.
 */
export function chooseBooks(toc, catalogs, {installed = {}, blocked = {}} = {}) {
  const {names, titles} = namesInToc(toc);
  const tocByName = {};          // {nameKey: [the toc's titles]}
  walkBooks(toc, b => {
    for (const n of [b.title, b.heTitle]) {
      const k = n && nameKey(n);
      if (k) { (tocByName[k] = tocByName[k] || []).push(b.title); }
    }
  });
  const replaced = {};
  const books = {};
  const skipped = {duplicate: 0, blocked: 0};
  const keepTitle = {};
  for (const [title, rec] of Object.entries(installed)) { keepTitle[`${rec.source}|${rec.id}`] = title; }
  const order = Object.keys(catalogs).sort((a, b) => {
    const ia = PRECEDENCE.indexOf(a);
    const ib = PRECEDENCE.indexOf(b);
    return (ia < 0 ? PRECEDENCE.length : ia) - (ib < 0 ? PRECEDENCE.length : ib);
  });
  // (a book chosen over another source's copy - entry.preferred, entry.replaces: the copies' names -
  //  is taken before the other sources' books; entry.names: its other names, as Sofer compares them)
  const passes = [true, false].map(pref => order.map(source => [source, (catalogs[source] || [])
    .filter(e => !!e.preferred === pref)]));
  for (const [source, entries] of [].concat(...passes)) {
    for (const entry of entries) {
      const key = `${entry.source || source}|${entry.id}`;
      if (blocked[key]) { skipped.blocked += 1; continue; }
      const name = normTitle(entry.heTitle);
      const all = [name, ...(entry.names || []).map(normTitle)];
      // (a preferred book: the toc's copies of it are not "the same sefer already there" - it
      //  is used instead of them)
      const ousts = !entry.preferred || !name ? [] : [...new Set([].concat(...[entry.heTitle, ...(entry.names || []),
        ...(entry.replaces || [])].map(n => tocByName[nameKey(n)] || [])))].filter(t => !(t in replaced));
      const theirs = new Set();
      walkBooks(toc, b => { if (ousts.includes(b.title) && b.heTitle) { theirs.add(normTitle(b.heTitle)); } });
      if (!name || all.some(n => names.has(n) && !theirs.has(n))) { skipped.duplicate += 1; continue; }
      all.concat((entry.replaces || []).map(normTitle)).forEach(n => names.add(n));
      ousts.forEach(t => titles.delete(String(t).toLowerCase()));
      let title = keepTitle[key];
      if (!title) {
        const base = safe(entry.title || entry.heTitle);
        title = base;
        for (let n = 2; titles.has(title.toLowerCase()); n++) { title = `${base} (${n})`; }
      }
      titles.add(title.toLowerCase());
      books[title] = {...entry, source: entry.source || source, title};
      ousts.forEach(t => { replaced[t] = title; });
    }
  }
  return {books, skipped, replaced};
}

/** The toc without these books (categories left empty by it dropped); the toc given is not changed */
export function withoutBooks(toc, titles) {
  const drop = new Set(titles || []);
  if (!drop.size) { return toc; }
  const prune = list => {
    const out = [];
    for (const item of list || []) {
      if (item.contents) {
        const contents = prune(item.contents);
        if (contents.length || !item.contents.length) {
          out.push(contents.length === item.contents.length && contents.every((x, i) => x === item.contents[i])
            ? item : {...item, contents});
        }
      } else if (!drop.has(item.title)) {
        out.push(item);
      }
    }
    return out;
  };
  return prune(toc);
}

/**
 * The book a ref of a replaced book (chooseBooks' replaced) opens instead: the preferred book's
 * title - its own sections need not be the other copy's, so it opens at its start - or null.
 * "Rokeach on Song of Songs 1:2" -> "רוקח על שיר השירים". The longest title wins, as in
 * Sefaria.textTitleForRef; `known` (optional): the library's title of the ref, which a longer
 * title of the library keeps.
 */
export function replacementForRef(ref, replaced, known = null) {
  if (!ref || typeof ref !== 'string' || !replaced) { return null; }
  for (let i = ref.length; i > 0; i--) {
    if (known && i <= known.length) { return null; }
    const next = ref[i];
    if (next !== undefined && !/[\s,:.]/.test(next)) { continue; }
    const t = ref.slice(0, i);
    if (Object.prototype.hasOwnProperty.call(replaced, t)) { return replaced[t]; }
  }
  return null;
}

/**
 * Sefaria's Name API answer (autocomplete) with the replaced books as the books used instead
 * (one line each): a completion naming one opens the preferred book, as does a ref to one.
 * books: {title: entry} (its Hebrew name is shown).
 */
export function redirectNameResults(results, replaced, books = {}) {
  if (!results || !replaced || !Object.keys(replaced).length) { return results; }
  const out = {...results};
  const shown = t => (books[t] && books[t].heTitle) || t;
  if (Array.isArray(results.completion_objects)) {
    const seen = new Set();
    out.completion_objects = [];
    for (const c of results.completion_objects) {
      const ours = replacementForRef(c && c.key, replaced) || replacementForRef(c && c.title, replaced);
      if (!ours) { out.completion_objects.push(c); continue; }
      if (seen.has(ours)) { continue; }
      seen.add(ours);
      out.completion_objects.push({...c, title: shown(ours), key: ours, type: 'book'});
    }
  }
  if (Array.isArray(results.completions)) {
    out.completions = [...new Set(results.completions.map(t => {
      const ours = replacementForRef(t, replaced);
      return ours ? shown(ours) : t;
    }))];
  }
  const oursRef = results.is_ref
    && (replacementForRef(results.ref, replaced) || replacementForRef(results.book, replaced) || replacementForRef(results.index, replaced));
  if (oursRef) {
    Object.assign(out, {ref: oursRef, book: oursRef, index: oursRef, is_book: true, is_node: false, is_section: false,
      is_segment: false, is_range: false, sections: [], sectionNames: []});
  }
  return out;
}

/**
 * The toc with the chosen books added under their categories. The toc given is not changed
 * (the categories on the way are copied). firstSections: {title: ref} of downloaded books.
 * replaced: chooseBooks' (the toc's books the chosen ones are used instead of: left out).
 */
export function addToToc(toc, books, firstSections = {}, replaced = {}) {
  const out = withoutBooks(toc || [], Object.keys(replaced || {})).slice();
  const place = (list, cats, heCats, depth, item) => {
    if (depth === cats.length) {
      list.push(item);
      return;
    }
    const name = cats[depth];
    let i = list.findIndex(x => x.category === name);
    if (i < 0) {
      list.push({
        category: name,
        heCategory: heCats[depth] || (depth === 0 ? TOP_HE[name] : null) || name,
        enShortDesc: '', heShortDesc: '', contents: [],
      });
      i = list.length - 1;
    } else {
      list[i] = {...list[i], contents: (list[i].contents || []).slice()};
    }
    place(list[i].contents, cats, heCats, depth + 1, item);
  };
  for (const entry of Object.values(books)) {
    place(out, entry.categories, entry.heCategories || [], 0, tocItem(entry, firstSections[entry.title]));
  }
  return out;
}

/** Hebrew names of the categories the books bring ({English: Hebrew}), for hebrewCategory() */
export function categoryNames(books) {
  const out = {};
  for (const e of Object.values(books)) {
    (e.categories || []).forEach((c, i) => {
      const he = (e.heCategories || [])[i];
      if (he && !(c in out)) { out[c] = he; }
    });
  }
  return out;
}
