/**
 * Today's Chok LeYisrael: which parsha and day it is (the Hebrew calendar, @hebcal/core), and
 * the day's learning in the downloaded sefer (extras/chok.js) as one unit, in order: the
 * prayers before learning, then Torah (with Onkelos and Rashi), Nevi'im, Ketuvim, Mishnah,
 * Gemara, Zohar, Halacha and Mussar (Friday: the rest of the parsha and the haftarah; Thursday
 * adds Thursday night's Torah). The reader shows it in the schedule's own tab and stops at its
 * end (learningSchedules/scheduleSequence.js: a "bounded" sequence).
 *
 * The week's portion: the parsha read on the coming Shabbat. When that Shabbat is a festival, the
 * next parsha read (the week of Sukkot: Vezot Haberakhah). A week of two parshiot learns both
 * parshiot's portions each day. Shabbat itself has no portion.
 *
 * Pure (no React Native), so it is unit tested directly (__tests__/chok.test.js).
 */
import { HDate, Sedra, parshiot } from '@hebcal/core';
import { TITLE, HE_TITLE, INTRO_HE, PRAYERS_HE } from '../extras/chok';

export const SCHEDULE_TITLE = { en: 'Chok LeYisrael', he: 'חק לישראל' };

// The parshiot as the sefer names them ("פרשת וירא"), in hebcal's order, then Vezot Haberakhah
export const PARSHIOT_EN = [...parshiot, 'Vezot Haberakhah'];
export const PARSHIOT_HE = [
  'בראשית', 'נח', 'לך לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא', 'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי',
  'שמות', 'וארא', 'בא', 'בשלח', 'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא', 'ויקהל', 'פקודי',
  'ויקרא', 'צו', 'שמיני', 'תזריע', 'מצורע', 'אחרי מות', 'קדושים', 'אמור', 'בהר', 'בחוקותי',
  'במדבר', 'נשא', 'בהעלותך', 'שלח', 'קורח', 'חוקת', 'בלק', 'פינחס', 'מטות', 'מסעי',
  'דברים', 'ואתחנן', 'עקב', 'ראה', 'שופטים', 'כי תצא', 'כי תבוא', 'נצבים', 'וילך', 'האזינו', 'וזאת הברכה',
];
const VEZOT_HABERAKHAH = 'Vezot Haberakhah';

export const DAYS = [
  { key: 'sun', en: 'Sunday', he: 'יום ראשון' },
  { key: 'mon', en: 'Monday', he: 'יום שני' },
  { key: 'tue', en: 'Tuesday', he: 'יום שלישי' },
  { key: 'wed', en: 'Wednesday', he: 'יום רביעי' },
  { key: 'thu', en: 'Thursday', he: 'יום חמישי' },
  { key: 'fri', en: 'Friday', he: 'יום שישי' },
  { key: 'shabbat', en: 'Shabbat', he: 'שבת' },
];
export const THURSDAY_NIGHT = { key: 'thu_night', en: 'Thursday night', he: 'ליל שישי' };

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const midnight = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parshaOf = en => {
  const i = PARSHIOT_EN.indexOf(en);
  return i < 0 ? null : { en, he: PARSHIOT_HE[i] };
};

/** The parsha read on Shabbat `sat` (an HDate), or null when that Shabbat is a festival */
function readOn(sat, israel) {
  const r = new Sedra(sat.getFullYear(), israel).lookup(sat);
  return r && !r.chag ? r.parsha : null;
}

/** The week's parshiot ([{en, he}]) for `date` */
export function weekParshiot(date, israel = false) {
  const sat = new HDate(midnight(date)).onOrAfter(6);
  let names = readOn(sat, israel);
  if (!names) {
    // Sukkot (and the festival days after Yom Kippur): Vezot Haberakhah, before Simchat Torah
    if (sat.getMonth() === 7 && sat.getDate() >= 10 && sat.getDate() <= 23) {
      names = [VEZOT_HABERAKHAH];
    } else {
      for (let n = 1; n <= 4 && !names; n++) { names = readOn(sat.add(7 * n, 'd'), israel); }
    }
  }
  return (names || []).map(parshaOf).filter(Boolean);
}

/** {date, parshiot, day, days (Thursday: and Thursday night)}, or null on Shabbat */
export function chokDayInfo(date, { israel = false } = {}) {
  const day = DAYS[date.getDay()];
  if (day.key === 'shabbat') { return null; }
  const parshiot = weekParshiot(date, israel);
  if (!parshiot.length) { return null; }
  return { date: midnight(date), parshiot, day, days: day.key === 'thu' ? [day, THURSDAY_NIGHT] : [day] };
}

/** "Wednesday, 11 Nov" / "יום רביעי, א׳ כסלו" */
export function dateLabel(date) {
  const day = DAYS[date.getDay()];
  const he = new HDate(midnight(date)).renderGematriya(true).split(' ').slice(0, -1).join(' ');
  return { en: `${day.en}, ${date.getDate()} ${MONTHS_EN[date.getMonth()]}`, he: `${day.he}, ${he}` };
}

/**
 * The day's item for the learning schedules (Sefaria's calendar item shape). refs: the book,
 * so the row can be opened; `chok` tells ReaderApp.openChokDay which day to open.
 */
export function chokCalendarItem(date, { israel = false } = {}) {
  const info = chokDayInfo(date, { israel });
  if (!info) { return null; }
  const { parshiot, day } = info;
  return {
    title: SCHEDULE_TITLE,
    category: 'Tanakh',
    order: 12,
    refs: [TITLE],
    subs: parshiot.map(p => ({ en: `${p.en}, ${day.en}`, he: `${p.he}, ${day.he}` })),
    summary: {
      en: `${parshiot.map(p => p.en).join('-')}, ${day.en}`,
      he: `${parshiot.map(p => p.he).join('-')}, ${day.he}`,
    },
    chok: { date: isoDate(info.date), israel: !!israel },
  };
}

// ---------- the day in the downloaded sefer ----------

const KINDS = [
  ['תורה', 'Torah'], ['נביאים', 'Prophets'], ['כתובים', 'Writings'], ['הפטרת', 'Haftarah'],
  ['משנה', 'Mishnah'], ['גמרא', 'Gemara'], ['זוהר', 'Zohar'], ['הלכה', 'Halakhah'], ['מוסר', 'Musar'],
];
/** A part's kind from its heading ("משנה ברכות פרק א" -> Mishnah), or null */
export const partKind = he => (KINDS.find(([k]) => String(he || '').startsWith(k)) || [])[1] || null;

const findNode = (nodes, he) => (nodes || []).find(n => n.heTitle === he) || null;
const leavesOf = (node, keys) => (node.nodes
  ? [].concat(...node.nodes.map(n => leavesOf(n, keys.concat(n.key))))
  : [{ node, keys }]);

/**
 * The day's learning in the downloaded book (its index: {title, schema}) as a bounded schedule
 * sequence ({key, title, tabLabel, items: [{ref, en, he, section}], index, bounded, date}), or
 * null when the book does not have the day.
 */
export function chokDaySequence(index, item) {
  const info = item && item.chok ? chokDayInfo(parseIso(item.chok.date), { israel: item.chok.israel }) : null;
  const nodes = index && index.schema && index.schema.nodes;
  if (!info || !nodes) { return null; }
  const title = index.title || TITLE;
  const ref = keys => `${title}, ${keys.join(', ')}`;
  const items = [];
  const intro = findNode(nodes, INTRO_HE);
  const prayers = intro && findNode(intro.nodes, PRAYERS_HE);
  if (prayers) {
    items.push({ ref: ref([intro.key, prayers.key]), en: 'Prayers before learning', he: PRAYERS_HE, section: null });
  }
  const many = info.parshiot.length > 1;
  let parts = 0;
  for (const p of info.parshiot) {
    const pNode = findNode(nodes, `פרשת ${p.he}`);
    if (!pNode) { continue; }
    for (const d of info.days) {
      const dNode = findNode(pNode.nodes, d.he);
      if (!dNode) { continue; }
      const night = d.key === 'thu_night';
      for (const { node, keys } of leavesOf(dNode, [pNode.key, dNode.key])) {
        const he = node.heTitle === d.he ? d.he : node.heTitle;
        const kind = partKind(he) || he;
        const prefixHe = [many ? p.he : null, night ? d.he : null].filter(Boolean).join(', ');
        const prefixEn = [many ? p.en : null, night ? d.en : null].filter(Boolean).join(', ');
        items.push({
          ref: ref(keys),
          he: prefixHe ? `${prefixHe}: ${he}` : he,
          en: prefixEn ? `${prefixEn}: ${kind}` : kind,
          section: partKind(he),
        });
        parts += 1;
      }
    }
  }
  if (!parts) { return null; }
  const summary = chokCalendarItem(info.date, { israel: item.chok.israel }).summary;
  const label = dateLabel(info.date);
  return {
    key: SCHEDULE_TITLE.en,
    title: { en: `${SCHEDULE_TITLE.en} · ${summary.en}`, he: `${HE_TITLE} · ${summary.he}` },
    tabLabel: { en: `${SCHEDULE_TITLE.en} — ${label.en}`, he: `${HE_TITLE} — ${label.he}` },
    items,
    index: 0,
    bounded: true,
    date: item.chok.date,
  };
}

function parseIso(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
