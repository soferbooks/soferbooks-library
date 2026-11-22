/**
 * Chok LeYisrael read as Sefaria's sheets lay it out (learningSchedules/data/chokSheets.json,
 * built by tools/buildChokSheets.js from Sefaria's collection "חק לישראל"): the whole day on one
 * page, as on Sefaria's site. A passage of a book on Sefaria (Genesis 18:22-26, Zevachim 54b:3-9,
 * Zohar, Vayera 36:509-513 ...) is shown from the book itself, a row per pasuk/segment, so tapping
 * it opens that passage's commentaries and connections like any book's; the text the sheet writes
 * out itself (the kavanot, the Zohar's Hebrew translation, mussar Sefaria lacks) is shown as is.
 *
 * Which day: the week's parsha and the day of the week (learningSchedules/chokDay.js); Thursday
 * night's learning (ליל שישי) from sunset on Thursday until alos hashachar on Friday (a quarter past
 * four on Friday is still ליל שישי - owner, 2026-11-20); any other day before alos is that day
 * (owner, 2026-11-22). Alos and
 * sunset are worked out for the city of the phone's time zone (@hebcal/core; the app does not ask
 * for the phone's location), or, for a time zone it does not know, from its UTC offset.
 *
 * The page is the reader's sheet mode (ReaderApp.loadChokSheet), its tab's ref "Sheet chok:<key>".
 */
import { HDate, Location, Zmanim } from '@hebcal/core';
import { chokDayInfo, DAYS, THURSDAY_NIGHT, weekParshiot, SCHEDULE_TITLE, dateLabel } from './chokDay';
import { HE_TITLE } from '../extras/chok';
import pLimit from 'p-limit';

export const CHOK_REF_PREFIX = 'Sheet chok:';
export const isChokSheetRef = ref => typeof ref === 'string' && ref.startsWith(CHOK_REF_PREFIX);
// (a week of two parshiot: both days' keys, joined by "+")
export const chokSheetRef = keys => `${CHOK_REF_PREFIX}${[].concat(keys).join('+')}`;
export const keysOfChokRef = ref => (isChokSheetRef(ref) ? ref.slice(CHOK_REF_PREFIX.length).split('+').filter(Boolean) : []);

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'thu_night', 'fri'];
const DAY_BY_KEY = Object.fromEntries(DAYS.concat([THURSDAY_NIGHT]).map(d => [d.key, d]));
// (the order of a week's days on the page's day picker)
export const WEEK_DAY_KEYS = DAY_KEYS;

let _outline = null;
/** The outline (lazily: 2 MB of JSON, read only when Chok LeYisrael is opened) */
export const chokOutline = () => {
  if (!_outline) { _outline = require('./data/chokSheets.json'); }
  return _outline;
};
export const _setOutline = o => { _outline = o; };

export const parseKey = key => {
  const m = /^(.+)\|([a-z_]+)$/.exec(String(key || ''));
  return m && DAY_BY_KEY[m[2]] ? { parshaHe: m[1], dayKey: m[2], day: DAY_BY_KEY[m[2]] } : null;
};

// ---------------------------------------------------------------- the time of day

// cities @hebcal/core knows, for the phone's time zone
const TZ_CITY = {
  'Asia/Jerusalem': 'Jerusalem', 'America/New_York': 'New York', 'America/Chicago': 'Chicago',
  'America/Denver': 'Denver', 'America/Phoenix': 'Phoenix', 'America/Los_Angeles': 'Los Angeles',
  'America/Detroit': 'Detroit', 'America/Toronto': 'Toronto', 'America/Vancouver': 'Vancouver',
  'America/Mexico_City': 'Mexico City', 'America/Sao_Paulo': 'Sao Paulo', 'America/Argentina/Buenos_Aires': 'Buenos Aires',
  'America/Panama': 'Panama City', 'America/Bogota': 'Bogota', 'Pacific/Honolulu': 'Hawaii',
  'Europe/London': 'London', 'Europe/Paris': 'Paris', 'Europe/Berlin': 'Berlin', 'Europe/Budapest': 'Budapest',
  'Europe/Moscow': 'Moscow', 'Europe/Kiev': 'Kiev', 'Europe/Kyiv': 'Kiev', 'Europe/Helsinki': 'Helsinki',
  'Europe/Gibraltar': 'Gibraltar', 'Europe/Brussels': 'Paris', 'Europe/Amsterdam': 'Paris',
  'Africa/Johannesburg': 'Johannesburg', 'Australia/Melbourne': 'Melbourne', 'Australia/Sydney': 'Sydney',
};

const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; } };

/** [latitude, longitude] for the zmanim: the time zone's city, else from the UTC offset */
export function placeFor({ timeZone = deviceTz(), israel = false, date = new Date() } = {}) {
  const city = TZ_CITY[timeZone] || (israel ? 'Jerusalem' : null);
  const loc = city && Location.lookup(city);
  if (loc) { return [loc.getLatitude(), loc.getLongitude()]; }
  return [israel ? 31.77 : 40, Math.max(-180, Math.min(180, -date.getTimezoneOffset() / 4))];
}

const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** alos hashachar and sunset of `date`'s day ({alos, sunset}: Dates, or null where there are none) */
export function zmanimOf(date, place) {
  try {
    const z = new Zmanim(midnight(date), place[0], place[1]);
    const ok = d => (d instanceof Date && !isNaN(d.getTime()) ? d : null);
    return { alos: ok(z.alotHaShachar()), sunset: ok(z.sunset()) };
  } catch (e) {
    return { alos: null, sunset: null };
  }
}

/**
 * The Chok day for the moment `now`: {date (the day's calendar date), dayKey, night}, or null on
 * Shabbat. The calendar day, but Thursday night's learning (ליל שישי) goes from sunset on Thursday
 * until alos on Friday (owner, 2026-11-22: "before dawn should be the same for every day besides
 * for friday since theres a friday eve one": Sunday before dawn is Sunday).
 */
export function chokMoment(now = new Date(), { israel = false, place = null } = {}) {
  const where = place || placeFor({ israel, date: now });
  const { alos, sunset } = zmanimOf(now, where);
  const beforeAlos = alos ? now < alos : now.getHours() < 4;
  const fridayBeforeAlos = beforeAlos && DAYS[now.getDay()].key === 'fri';
  const date = fridayBeforeAlos ? addDays(now, -1) : midnight(now);
  const afterSunset = !beforeAlos && (sunset ? now >= sunset : now.getHours() >= 18);
  const night = beforeAlos || afterSunset;
  const weekday = DAYS[date.getDay()].key;
  if (weekday === 'shabbat') { return null; }
  const dayKey = weekday === 'thu' && (afterSunset || fridayBeforeAlos) ? 'thu_night' : weekday;
  return { date, dayKey, night };
}

/** The week's sheet keys for `date` ([{key, parsha: {en, he}, day}] in the week's order) */
export function weekKeys(date, { israel = false } = {}) {
  const out = [];
  for (const p of weekParshiot(date, israel)) {
    for (const k of DAY_KEYS) { out.push({ key: `${p.he}|${k}`, parsha: p, day: DAY_BY_KEY[k] }); }
  }
  return out;
}

/** The sheet keys for the moment: the parsha(s) of the week and the day ([] on Shabbat) */
export function keysForMoment(moment, { israel = false } = {}) {
  if (!moment) { return []; }
  return weekParshiot(moment.date, israel).map(p => `${p.he}|${moment.dayKey}`);
}

/** The schedule item for the home page and the schedules page (Sefaria's calendar item shape) */
export function chokSheetCalendarItem(now = new Date(), { israel = false, place = null } = {}) {
  const moment = chokMoment(now, { israel, place });
  if (!moment) { return null; }
  const info = chokDayInfo(moment.date, { israel });
  if (!info) { return null; }
  const day = DAY_BY_KEY[moment.dayKey];
  const iso = `${moment.date.getFullYear()}-${String(moment.date.getMonth() + 1).padStart(2, '0')}-${String(moment.date.getDate()).padStart(2, '0')}`;
  return {
    title: SCHEDULE_TITLE,
    category: 'Tanakh',
    order: 12,
    refs: [chokSheetRef(keysForMoment(moment, { israel }))],
    subs: info.parshiot.map(p => ({ en: `${p.en}, ${day.en}`, he: `${p.he}, ${day.he}` })),
    summary: {
      en: `${info.parshiot.map(p => p.en).join('-')}, ${day.en}`,
      he: `${info.parshiot.map(p => p.he).join('-')}, ${day.he}`,
    },
    chok: { date: iso, israel: !!israel, dayKey: moment.dayKey },
  };
}

// ---------------------------------------------------------------- a passage's segments

/**
 * A ref as its first and last place: {start, endSection, endSegment}. endSection: the prefix and
 * the address after "-" when it names a section ("Exodus 7:24-8:6" -> "Exodus 8", 6); null when
 * the range ends in the start's own section (endSegment then the last segment, or null for the
 * whole section).
 */
export function splitRange(ref) {
  const s = String(ref || '').trim();
  const sp = s.lastIndexOf(' ');
  const prefix = sp < 0 ? '' : s.slice(0, sp);
  const addr = sp < 0 ? s : s.slice(sp + 1);
  const [a, b] = addr.split('-');
  const start = prefix ? `${prefix} ${a}` : a;
  if (b === undefined) { return { start, endSection: null, endSegment: null, startIsSegment: a.includes(':') }; }
  const aParts = a.split(':');
  const bParts = b.split(':');
  if (bParts.length > 1) {
    return { start, endSection: `${prefix} ${bParts.slice(0, -1).join(':')}`, endSegment: bParts[bParts.length - 1], startIsSegment: true };
  }
  if (aParts.length > 1) {
    // (in the start's own section: "Genesis 18:22-26")
    return { start, endSection: null, endSegment: b, startIsSegment: true };
  }
  // "Mishnah Shabbat 4-5": whole sections; or, in a book of one level, segments ("Sefer Chasidim 173-175")
  return { start, endSection: `${prefix} ${b}`, endSegment: null, startIsSegment: false, sameLevel: b };
}

const segNo = x => String(x == null ? '' : x).replace(/^.*[: ]/, '');

/**
 * The segments of `ref`: [{sectionRef, heSectionRef, index, segmentNumber, he, text}] in order,
 * read with `loadSection(ref) -> textContent` (offlineOnline.loadText(ref, true).textContent: the
 * whole section, its `content`, `next`, `isSectionLevel`, `requestedRef`). At most 12 sections.
 */
export async function segmentsOf(ref, loadSection) {
  const range = splitRange(ref);
  let tc = await loadSection(range.start);
  if (!tc) { return []; }
  const startSection = tc.sectionRef;
  const levelOne = !tc.isSectionLevel && !range.startIsSegment;     // ("Sefer Chasidim 173": a segment)
  const startSeg = tc.isSectionLevel ? null : segNo(tc.requestedRef || range.start);
  let endSection = range.endSection;
  let endSeg = range.endSegment;
  if (levelOne && range.sameLevel) { endSection = null; endSeg = range.sameLevel; }
  if (!endSection) { endSection = startSection; if (!endSeg && !tc.isSectionLevel) { endSeg = startSeg; } }
  const out = [];
  let started = startSeg === null;
  for (let n = 0; tc && n < 12; n++) {
    const content = tc.content || [];
    const last = tc.sectionRef === endSection;
    for (let i = 0; i < content.length; i++) {
      const seg = content[i];
      const num = String(seg.segmentNumber);
      if (!started && num === String(startSeg)) { started = true; }
      if (started && (seg.he || seg.text)) {
        out.push({ sectionRef: tc.sectionRef, heSectionRef: tc.heSectionRef || tc.heRef, index: i, segmentNumber: num, he: seg.he || '', text: seg.text || '' });
      }
      if (last && endSeg && num === String(endSeg)) { return out; }
    }
    if (last || !tc.next) { break; }
    tc = await loadSection(tc.next);
  }
  return out;
}

/** "Genesis 18" + 22 -> "Genesis 18:22"; a book of one level ("Sefer Chasidim") -> "Sefer Chasidim 22" */
export const segmentRefOf = (sectionRef, segmentNumber, title) => (sectionRef === title
  ? `${sectionRef} ${segmentNumber}` : `${sectionRef}:${segmentNumber}`);

// ---------------------------------------------------------------- the page

/**
 * The day as the reader's sheet rows ([{type, ...}], TextColumn's sheet mode):
 *   {type: 'outsideText', he, text: ''}                        a heading or the sheet's own text
 *   {type: 'ref', sourceRef, sourceHeRef, he, text, sectionRef, segmentIndex, cite}
 * `cite`: the passage's Hebrew name, on its first row. loadSection as for segmentsOf; titleOf(ref)
 * the book's title. A passage that cannot be read is shown by its name, so the day still reads.
 */
export async function chokRows(keys, { loadSection, titleOf } = {}) {
  const all = [].concat(keys);
  // (the day's passages - each from another book - read side by side, a few at a time, not one
  //  after another: the day took long to open on the 32-bit tablet - owner, 2026-11-22)
  const limit = pLimit(CHOK_READ_AT_ONCE);
  const segments = new Map();
  const segmentsOfItem = ref => {
    if (!segments.has(ref)) { segments.set(ref, limit(() => segmentsOf(ref, loadSection)).catch(() => [])); }
    return segments.get(ref);
  };
  for (const key of all) {
    const day = chokOutline().days[key];
    for (const part of (day && day.parts) || []) { for (const item of part.items) { if (item.r) { segmentsOfItem(item.r); } } }
  }
  const rows = [];
  for (const key of all) {
    const day = chokOutline().days[key];
    if (day) { rows.push(...(await dayRows(key, day, { titleOf, multiple: all.length > 1, segmentsOfItem }))); }
  }
  return rows.length ? rows : null;
}

const CHOK_READ_AT_ONCE = 3;

/** The book passages of the days `keys` (their refs, in order) */
export const chokItemRefs = keys => [].concat(keys).flatMap(key => {
  const day = chokOutline().days[key];
  return ((day && day.parts) || []).flatMap(part => part.items.filter(item => item.r && !item.t).map(item => item.r));
});

async function dayRows(key, day, { titleOf, multiple, segmentsOfItem }) {
  const parsed = parseKey(key);
  const rows = [];
  if (multiple && parsed) { rows.push({ type: 'outsideText', he: `<big><b>פרשת ${parsed.parshaHe}</b></big>`, text: '' }); }
  for (const part of day.parts) {
    if (part.h) { rows.push({ type: 'outsideText', he: `<big><b>${part.h}</b></big>`, text: '', heading: true }); }
    for (const item of part.items) {
      if (item.t) {
        const row = { type: 'outsideText', he: item.t, text: '' };
        if (item.r) {
          // (found in a book on Sefaria: tapping it shows that passage's connections)
          let first = null;
          try { first = (await segmentsOfItem(item.r))[0] || null; } catch (e) { first = null; }
          if (first) {
            Object.assign(row, { sourceRef: segmentRefOf(first.sectionRef, first.segmentNumber, titleOf(item.r)),
              sectionRef: first.sectionRef, segmentIndex: first.index, segmentNumber: first.segmentNumber });
          }
        }
        rows.push(row);
        continue;
      }
      let segs = [];
      try { segs = await segmentsOfItem(item.r); } catch (e) { segs = []; }
      if (!segs.length) {
        rows.push({ type: 'outsideText', he: `<small>${item.hr || item.r}</small>`, text: '' });
        continue;
      }
      const title = titleOf(item.r);
      segs.forEach((s, j) => rows.push({
        type: 'ref',
        sourceRef: segmentRefOf(s.sectionRef, s.segmentNumber, title),
        sourceHeRef: j === 0 ? (item.hr || item.r) : '',
        he: s.he,
        text: s.text,
        sectionRef: s.sectionRef,
        segmentIndex: s.index,
        segmentNumber: s.segmentNumber,
      }));
    }
  }
  return rows;
}

/** The page's title and the tab's label */
export function chokTitles(keys, date = null) {
  const all = [].concat(keys).map(parseKey).filter(Boolean);
  const p = all[0] ? { ...all[0], parshaHe: all.map(x => x.parshaHe).join('-') } : null;
  const he = p ? `${HE_TITLE} · פרשת ${p.parshaHe}, ${p.day.he}` : HE_TITLE;
  const en = p ? `${SCHEDULE_TITLE.en} · ${p.day.en}` : SCHEDULE_TITLE.en;
  const label = date ? dateLabel(date) : null;
  return { he, en, tabHe: label ? `${HE_TITLE} — ${p ? p.day.he : label.he}` : he, tabEn: en };
}
