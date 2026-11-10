/**
 * Learning schedules the app adds to Sefaria's calendar (calendar.json), all computed offline.
 *
 *   Shnayim Mikra         the week's parsha (from Sefaria's "Parashat Hashavua" item)
 *   Chok LeYisrael        that day's references, from Sefaria's "חק לישראל" collection
 *                         (data/chokLeYisrael.json, built by tools/buildChokLeYisrael.js);
 *                         replaces Sefaria's own item, which is only a link to the website
 *   Mishnah Berurah Yomi  Dirshu's Daf HaYomi B'Halacha, from @hebcal/learning (BSD-2-Clause)
 *                         (data/hebcalSchedules.json, built by tools/buildHebcalSchedules.mjs)
 *   Tehillim (Monthly)    the 30-day cycle by Hebrew day of the month, from @hebcal/learning
 *   Tehillim (Weekly)     the traditional 7-day division by day of the week
 *
 * Daily Rambam (1 and 3 chapters) come from Sefaria's calendar.json as they are.
 * Every item has the shape of Sefaria's calendar items: {title, refs, subs, category, order}; an
 * item may add `inlineCommentary: {book, key}`, a commentary to show under each passage of `book`
 * when the item is opened (reader/inlineCommentaryPrefs.js, openScheduleRef).
 * Pure JavaScript, so it is unit-tested directly (__tests__/learningSchedules.test.js).
 */
import { HDate, gematriya } from '@hebcal/core';
import HEBCAL from './data/hebcalSchedules.json';
import CHOK from './data/chokLeYisrael.json';

export const TITLES = {
  shnayimMikra: { en: 'Shnayim Mikra', he: 'שניים מקרא ואחד תרגום' },
  chok: { en: 'Chok LeYisrael', he: 'חק לישראל' },
  mishnahBerurah: { en: 'Mishnah Berurah Yomi', he: 'משנה ברורה יומי' },
  psalmsMonthly: { en: 'Tehillim (Monthly)', he: 'תהלים לפי ימי החודש' },
  psalmsWeekly: { en: 'Tehillim (Weekly)', he: 'תהלים לפי ימי השבוע' },
};

const DAYS = [
  { key: 'sun', en: 'Sunday', he: 'יום ראשון' },
  { key: 'mon', en: 'Monday', he: 'יום שני' },
  { key: 'tue', en: 'Tuesday', he: 'יום שלישי' },
  { key: 'wed', en: 'Wednesday', he: 'יום רביעי' },
  { key: 'thu', en: 'Thursday', he: 'יום חמישי' },
  { key: 'fri', en: 'Friday', he: 'יום שישי' },
  { key: 'shabbat', en: 'Shabbat', he: 'שבת' },
];
const THURSDAY_NIGHT = { en: 'Thursday night', he: 'ליל שישי' };

// The traditional division of Tehillim over the week (Sunday to Shabbat), as printed in siddurim
export const WEEKLY_PSALMS = [[1, 29], [30, 50], [51, 72], [73, 89], [90, 106], [107, 119], [120, 150]];

const midnight = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const dayOffset = (from, date) => Math.round((midnight(date) - midnight(from)) / 86400000);
const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const heNum = n => gematriya(Number(n)).replace(/[׳״]/g, '');

// ---------- Tehillim ----------

// "119:97" -> [119, 97]; 23 -> [23, null]
const chapterVerse = x => { const [c, v] = String(x).split(':'); return [Number(c), v ? Number(v) : null]; };

export function psalmsItem(b, e) {
  const [bc, bv] = chapterVerse(b);
  const [ec, ev] = chapterVerse(e);
  const enRange = bv ? `${bc}:${bv}-${ev}` : bc === ec ? `${bc}` : `${bc}-${ec}`;
  const heRange = bv ? `${heNum(bc)}:${heNum(bv)}-${heNum(ev)}` : bc === ec ? heNum(bc) : `${heNum(bc)}-${heNum(ec)}`;
  return { refs: [`Psalms ${enRange}`], subs: [{ en: `Psalms ${enRange}`, he: `תהלים ${heRange}` }] };
}

export function monthlyPsalms(date) {
  const hd = new HDate(midnight(date));
  const day = hd.getDate();
  const { byHebrewDay, shortMonth29 } = HEBCAL.psalms;
  const [b, e] = day === 29 && hd.daysInMonth() === 29 ? shortMonth29 : byHebrewDay[day];
  return { title: TITLES.psalmsMonthly, category: 'Tanakh', order: 13, ...psalmsItem(b, e) };
}

export function weeklyPsalms(date) {
  const [b, e] = WEEKLY_PSALMS[date.getDay()];
  return { title: TITLES.psalmsWeekly, category: 'Tanakh', order: 14, ...psalmsItem(b, e) };
}

// ---------- Mishnah Berurah Yomi ----------

export const MB_BASE_TEXT = 'Shulchan Arukh, Orach Chayim';
const heSeif = s => String(s).split(':').map(heNum).join(':');

export function mishnahBerurah(date) {
  const { from, readings } = HEBCAL.mishnahBerurah;
  const r = readings[dayOffset(parseIso(from), date)];
  if (!r) { return null; }  // before or after the transcribed luach
  const [b, e, review] = r;
  const en = e ? `${b}-${e}` : b;
  const he = e ? `${heSeif(b)}-${heSeif(e)}` : heSeif(b);
  return {
    title: TITLES.mishnahBerurah,
    category: 'Halakhah',
    order: 6.5,
    // The schedule is numbered by the Shulchan Arukh's siman and se'if (Sefaria's Mishnah Berurah
    // goes by se'if katan): open the Shulchan Arukh at the se'if where the day's learning starts,
    // with the Mishnah Berurah shown under each se'if (reader/inlineCommentaryPrefs.js)
    refs: [`${MB_BASE_TEXT} ${b}`],
    inlineCommentary: { book: MB_BASE_TEXT, key: 'Mishnah Berurah' },
    subs: [{
      en: `${review ? 'Review: ' : ''}Orach Chayim ${en}`,
      he: `${review ? 'חזרה: ' : ''}אורח חיים ${he}`,
    }],
  };
}

// ---------- Chok LeYisrael ----------

// The week's parsha names, from Sefaria's Chok item ("Toldot") or its parsha ("Vayakhel-Pekudei")
function weekPortions(sefariaItems) {
  const find = t => sefariaItems.find(i => i.title && i.title.en === t);
  const name = (find('Chok LeYisrael') || find('Parashat Hashavua'))?.subs?.[0]?.en;
  if (!name) { return []; }
  if (CHOK.portions[name]) { return [name]; }
  return name.split('-').map(s => s.trim()).filter(p => CHOK.portions[p]);
}

export function chokLeYisrael(date, sefariaItems) {
  const day = DAYS[date.getDay()];
  const portions = weekPortions(sefariaItems);
  if (!portions.length || day.key === 'shabbat') { return null; }
  const parts = [];
  for (const p of portions) {
    const days = [[day, CHOK.portions[p][day.key]]];
    if (day.key === 'thu') { days.push([THURSDAY_NIGHT, CHOK.portions[p].thu_night]); }
    for (const [label, entry] of days) { if (entry) { parts.push({ portion: p, label, entry }); } }
  }
  if (!parts.length) { return null; }
  const refs = [];
  const subs = [];
  for (const { label, entry } of parts) {
    for (const r of entry.refs) {
      refs.push(r.ref);
      subs.push({ en: r.ref, he: r.heRef || r.ref, section: r.section, day: label });
    }
  }
  const first = parts[0];
  return {
    title: TITLES.chok,
    category: 'Tanakh',
    order: 12,
    refs,
    subs,
    summary: {
      en: `${first.portion}, ${day.en}`,
      he: `${CHOK.portions[first.portion].he}, ${day.he}`,
    },
    sheets: parts.map(p => p.entry.sheet),
  };
}

// ---------- Shnayim Mikra ----------

export function shnayimMikra(sefariaItems) {
  const parsha = sefariaItems.find(i => i.title && i.title.en === 'Parashat Hashavua');
  if (!parsha || !parsha.refs || !parsha.refs.length) { return null; }
  return { title: TITLES.shnayimMikra, category: 'Tanakh', order: 1.5, refs: parsha.refs, subs: parsha.subs };
}

/**
 * Sefaria's calendar items for `date` with the app's own schedules added (Sefaria's link-only
 * Chok LeYisrael item is replaced by the offline one), sorted by `order`.
 */
export function withExtraSchedules(sefariaItems, date = new Date()) {
  const extra = [
    shnayimMikra(sefariaItems),
    chokLeYisrael(date, sefariaItems),
    mishnahBerurah(date),
    monthlyPsalms(date),
    weeklyPsalms(date),
  ].filter(Boolean);
  const replaced = new Set(extra.map(i => i.title.en));
  return sefariaItems.filter(i => !replaced.has(i.title.en)).concat(extra).sort((a, b) => a.order - b.order);
}
