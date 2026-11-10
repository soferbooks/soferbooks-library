import {
  monthlyPsalms, weeklyPsalms, psalmsItem, mishnahBerurah, chokLeYisrael, shnayimMikra,
  withExtraSchedules, WEEKLY_PSALMS, TITLES,
} from '../learningSchedules/extraSchedules';
import { rowSubtitle } from '../learningSchedules/LearningSchedulesBox';
import CHOK from '../learningSchedules/data/chokLeYisrael.json';

const day = (y, m, d) => new Date(y, m - 1, d);

// Sefaria's calendar.json items for Tuesday 10 November 2026 (30 Cheshvan 5787), trimmed
const sefariaItems = [
  { title: { en: 'Parashat Hashavua', he: 'פרשת השבוע' }, order: 1, category: 'Tanakh',
    refs: ['Genesis 25:19-28:9'], subs: [{ en: 'Toldot', he: 'תולדות' }] },
  { title: { en: 'Haftarah', he: 'הפטרה' }, order: 2, category: 'Tanakh', refs: ['Malachi 1:1-2:7'],
    subs: [{ en: 'Malachi 1:1-2:7', he: 'מלאכי א׳:א׳-ב׳:ז׳' }] },
  { title: { en: 'Daily Rambam (3 Chapters)', he: 'הרמב"ם היומי (3 פרקים)' }, order: 7, category: 'Halakhah',
    refs: ['Mishneh Torah, Neighbors 13-14', 'Mishneh Torah, Agents and Partners 1'],
    subs: [{ en: 'Neighbors 13-14', he: 'הלכות שכנים י״ג-י״ד' }, { en: 'Agents and Partners 1', he: 'הלכות שלוחין ושותפין א׳' }] },
  { title: { en: 'Chok LeYisrael', he: 'חק לישראל' }, url: 'collections/חק-לישראל?tag=Toldot', order: 12,
    category: 'Tanakh', subs: [{ en: 'Toldot', he: 'תולדות' }] },
];

describe('Tehillim', () => {
  // expected values from @hebcal/learning 6.13.1 dailyPsalms()
  test('monthly: by Hebrew day of the month', () => {
    expect(monthlyPsalms(day(2026, 11, 10)).refs).toEqual(['Psalms 145-150']);   // 30 Cheshvan
    expect(monthlyPsalms(day(2026, 11, 13)).refs).toEqual(['Psalms 18-22']);     // 3 Kislev
    expect(monthlyPsalms(day(2027, 1, 3)).refs).toEqual(['Psalms 113-118']);     // 24 Tevet
  });

  test('monthly: a 29-day month reads the 29th and 30th portions together', () => {
    // 29 Tevet 5787 (Tevet has 29 days)
    expect(monthlyPsalms(day(2027, 1, 8)).refs).toEqual(['Psalms 140-150']);
  });

  test('monthly: Psalm 119 is split by verse', () => {
    expect(psalmsItem('119:1', '119:96')).toEqual({
      refs: ['Psalms 119:1-96'], subs: [{ en: 'Psalms 119:1-96', he: 'תהלים קיט:א-צו' }],
    });
  });

  test('weekly: the traditional division, Sunday to Shabbat, covers the book once', () => {
    expect(weeklyPsalms(day(2026, 11, 8)).refs).toEqual(['Psalms 1-29']);     // Sunday
    expect(weeklyPsalms(day(2026, 11, 10)).refs).toEqual(['Psalms 51-72']);   // Tuesday
    expect(weeklyPsalms(day(2026, 11, 14)).refs).toEqual(['Psalms 120-150']); // Shabbat
    WEEKLY_PSALMS.forEach(([b], i) => expect(b).toBe(i ? WEEKLY_PSALMS[i - 1][1] + 1 : 1));
    expect(WEEKLY_PSALMS[6][1]).toBe(150);
  });
});

describe('Mishnah Berurah Yomi (Dirshu Daf HaYomi B\'Halacha, from @hebcal/learning)', () => {
  // expected values from @hebcal/learning 6.13.1 dirshuDafHalacha()
  test('a weekday: one amud, opening the siman in the Mishnah Berurah', () => {
    expect(mishnahBerurah(day(2026, 11, 10))).toMatchObject({
      title: TITLES.mishnahBerurah,
      refs: ['Mishnah Berurah 447'],
      subs: [{ en: 'Orach Chayim 447:11-447:12', he: 'אורח חיים תמז:יא-תמז:יב' }],
    });
    expect(mishnahBerurah(day(2027, 1, 3)).subs[0].en).toBe('Orach Chayim 453:5');
  });

  test('Friday and Shabbat review the week', () => {
    expect(mishnahBerurah(day(2026, 11, 13)).subs[0].en).toBe('Review: Orach Chayim 447:9-448:3');
    expect(mishnahBerurah(day(2026, 11, 14)).subs[0].he).toBe('חזרה: אורח חיים תמז:ט-תמח:ג');
  });

  test('ends with the transcribed luach (31 August 2027)', () => {
    expect(mishnahBerurah(day(2027, 8, 31)).subs[0].en).toBe('Orach Chayim 514:8-514:11');
    expect(mishnahBerurah(day(2027, 9, 1))).toBeNull();
    expect(mishnahBerurah(day(2020, 1, 1))).toBeNull();
  });
});

describe('Chok LeYisrael (Sefaria\'s collection, bundled)', () => {
  test('the bundled index has every portion, Sunday to Friday and Thursday night', () => {
    expect(Object.keys(CHOK.portions)).toHaveLength(54);
    for (const p of Object.values(CHOK.portions)) {
      expect(Object.keys(p).sort()).toEqual(['fri', 'he', 'mon', 'sun', 'thu', 'thu_night', 'tue', 'wed']);
    }
  });

  test('a weekday gives that day\'s references, as on the sheet', () => {
    const item = chokLeYisrael(day(2026, 11, 10), sefariaItems);   // Tuesday, Toldot
    expect(item.summary).toEqual({ en: 'Toldot, Tuesday', he: 'תולדות, יום שלישי' });
    // sheet 389760, "חק לישראל - פרשת תולדות יום שלישי"
    expect(item.sheets).toEqual([389760]);
    expect(item.refs.slice(0, 3)).toEqual(['Genesis 25:29-33', 'Malachi 1:11-2:1', 'Proverbs 6:1-5']);
    expect(item.subs[0]).toMatchObject({ en: 'Genesis 25:29-33', section: 'Torah' });
    expect(item.refs).toHaveLength(item.subs.length);
  });

  test('Thursday adds Thursday night; Shabbat has none', () => {
    const thu = chokLeYisrael(day(2026, 11, 12), sefariaItems);
    expect(thu.sheets).toHaveLength(2);
    expect(thu.subs.some(s => s.day.en === 'Thursday night')).toBe(true);
    expect(chokLeYisrael(day(2026, 11, 14), sefariaItems)).toBeNull();
  });

  test('a combined week reads both portions', () => {
    const combined = [{ title: { en: 'Parashat Hashavua' }, subs: [{ en: 'Vayakhel-Pekudei' }], refs: ['Exodus 35:1-40:38'] }];
    expect(chokLeYisrael(day(2026, 11, 9), combined).sheets).toHaveLength(2);
  });
});

describe('Shnayim Mikra and the merged list', () => {
  test('Shnayim Mikra is the week\'s parsha', () => {
    expect(shnayimMikra(sefariaItems)).toMatchObject({
      title: { en: 'Shnayim Mikra' }, refs: ['Genesis 25:19-28:9'], subs: [{ en: 'Toldot', he: 'תולדות' }],
    });
    expect(shnayimMikra([])).toBeNull();
  });

  test('extras are added in calendar order and replace Sefaria\'s link-only Chok LeYisrael', () => {
    const items = withExtraSchedules(sefariaItems, day(2026, 11, 10));
    expect(items.map(i => i.title.en)).toEqual([
      'Parashat Hashavua', 'Shnayim Mikra', 'Haftarah', 'Mishnah Berurah Yomi', 'Daily Rambam (3 Chapters)',
      'Chok LeYisrael', 'Tehillim (Monthly)', 'Tehillim (Weekly)',
    ]);
    expect(items.find(i => i.title.en === 'Chok LeYisrael').url).toBeUndefined();
    expect(sefariaItems).toHaveLength(4);  // input untouched
  });

  test('without Sefaria\'s calendar, the computed schedules still show', () => {
    expect(withExtraSchedules([], day(2026, 11, 10)).map(i => i.title.en))
      .toEqual(['Mishnah Berurah Yomi', 'Tehillim (Monthly)', 'Tehillim (Weekly)']);
  });

  test('the home row shows every reading of a multi-part item, or its summary', () => {
    expect(rowSubtitle(sefariaItems[2]).en).toBe('Neighbors 13-14, Agents and Partners 1');
    expect(rowSubtitle(chokLeYisrael(day(2026, 11, 10), sefariaItems)).en).toBe('Toldot, Tuesday');
  });
});
