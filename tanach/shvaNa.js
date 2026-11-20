/**
 * "Our Tanach with shva na's" (owner, 2026-11-20): the shva na (U+05C8) and dagesh chazak
 * (U+05C9) that SoferBooks prints, put into Sefaria's Tanach text as it is read (offline or
 * online), from tanach/shvaNaMarks.json (tools/shvaNa/buildShvaNaMarks.js: the places of the
 * marks in each pasuk of the website's marked "Miqra according to the Masorah").
 *
 * A pasuk is marked when its text is the one the marks were taken from (its hash, the kamatz
 * katan read as a kamatz) - 98.7% of Tanach on 2026-11-20 - or, failing that, when it is as long
 * and every mark falls on a shva or dagesh (a word the website corrected elsewhere in it). Any
 * other pasuk is left as Sefaria has it. Only a plain shva / dagesh is ever turned into its marked
 * form: no letter or other point is changed. The fonts draw both (FrankSofer, VilnaSofer,
 * Hadassah); hiding the nikud hides them too (sefaria.js applyVocalizationSettings).
 */
import md5 from 'md5';

const SHVA = 'ְ', DAGESH = 'ּ', SHVA_NA = '׈', CHAZAK = '׉';
const KAMATZ_KATAN = /ׇ/g;

let _marks = null;
/** The marks file (lazily: 0.8 MB of JSON, read the first time a Tanach book is) */
const marksData = () => {
  if (!_marks) { _marks = require('./shvaNaMarks.json'); }
  return _marks;
};
export const _setMarks = m => { _marks = m; };

export const hashOf = text => md5(String(text).replace(KAMATZ_KATAN, 'ָ')).slice(0, 8);

const places = s => (s ? s.split(',').map(x => parseInt(x, 36)) : []);

/** A pasuk with its marks ("hash|na|chazak"), or the pasuk as it was */
export function markVerse(text, entry) {
  if (typeof text !== 'string' || !entry) { return text; }
  const [hash, na, chazak] = entry.split('|');
  const naAt = places(na);
  const chazakAt = places(chazak);
  const exact = hashOf(text) === hash;
  if (!exact && !(naAt.every(i => text[i] === SHVA) && chazakAt.every(i => text[i] === DAGESH))) { return text; }
  const chars = text.split('');
  for (const i of naAt) { if (chars[i] === SHVA) { chars[i] = SHVA_NA; } }
  for (const i of chazakAt) { if (chars[i] === DAGESH) { chars[i] = CHAZAK; } }
  return chars.join('');
}

/** The marks of a book, or null (not a book of Tanach) */
export const bookMarks = title => (title && marksData().books[title]) || null;

/** "Genesis 30" -> "30"; "I Samuel 4" -> "4"; null when the section is not a chapter */
const chapterOf = sectionRef => {
  const m = /\s(\d+)$/.exec(String(sectionRef || ''));
  return m ? m[1] : null;
};

/**
 * A loaded section (offlineOnline.loadText's textContent: {sectionRef, content: [{segmentNumber,
 * he, text}]}) with its pesukim marked; anything else as it is. title: the section's book.
 */
export function markSection(textContent, title) {
  const book = bookMarks(title);
  const chapter = textContent && chapterOf(textContent.sectionRef);
  if (!book || !chapter || !Array.isArray(textContent.content)) { return textContent; }
  let changed = false;
  const content = textContent.content.map(seg => {
    const entry = seg && book[`${chapter}:${seg.segmentNumber}`];
    if (!entry || typeof seg.he !== 'string') { return seg; }
    const he = markVerse(seg.he, entry);
    if (he === seg.he) { return seg; }
    changed = true;
    return { ...seg, he };
  });
  return changed ? { ...textContent, content } : textContent;
}
