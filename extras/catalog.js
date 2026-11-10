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
// `preferred` is used instead of the copies it `replaces`: wikisource.PREFERRED)
export const PRECEDENCE = ['sefaria', 'dicta', 'otzaria', 'wikisource'];

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
 * Returns {books: {title: entry}, skipped: {duplicate: n, blocked: n}}.
 */
export function chooseBooks(toc, catalogs, {installed = {}, blocked = {}} = {}) {
  const {names, titles} = namesInToc(toc);
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
      if (!name || all.some(n => names.has(n))) { skipped.duplicate += 1; continue; }
      all.concat((entry.replaces || []).map(normTitle)).forEach(n => names.add(n));
      let title = keepTitle[key];
      if (!title) {
        const base = safe(entry.title || entry.heTitle);
        title = base;
        for (let n = 2; titles.has(title.toLowerCase()); n++) { title = `${base} (${n})`; }
      }
      titles.add(title.toLowerCase());
      books[title] = {...entry, source: entry.source || source, title};
    }
  }
  return {books, skipped};
}

/**
 * The toc with the chosen books added under their categories. The toc given is not changed
 * (the categories on the way are copied). firstSections: {title: ref} of downloaded books.
 */
export function addToToc(toc, books, firstSections = {}) {
  const out = (toc || []).slice();
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
