import {
  splitRange, segmentsOf, chokMoment, keysForMoment, weekKeys, chokOutline, chokRows, chokSheetRef,
  keysOfChokRef, isChokSheetRef, chokSheetCalendarItem, segmentRefOf,
} from '../learningSchedules/chokSheet';

const NY = [40.71427, -74.00597];

describe('splitRange', () => {
  test('within a section', () => {
    expect(splitRange('Genesis 18:22-26')).toMatchObject({ start: 'Genesis 18:22', endSection: null, endSegment: '26' });
  });
  test('across sections', () => {
    expect(splitRange('Exodus 7:24-8:6')).toMatchObject({ start: 'Exodus 7:24', endSection: 'Exodus 8', endSegment: '6' });
    expect(splitRange('Berakhot 54b:21-55a:3')).toMatchObject({ start: 'Berakhot 54b:21', endSection: 'Berakhot 55a', endSegment: '3' });
    expect(splitRange('Zohar, Vayera 36:509-513')).toMatchObject({ start: 'Zohar, Vayera 36:509', endSegment: '513' });
  });
  test('a whole section', () => {
    expect(splitRange('Mishnah Zevachim 4')).toMatchObject({ start: 'Mishnah Zevachim 4', endSection: null, endSegment: null });
  });
});

// a fake library: Exodus 7 has 29 verses, Exodus 8 has 28; "Sefer Chasidim" is one level
const sections = {
  'Exodus 7': { sectionRef: 'Exodus 7', next: 'Exodus 8', n: 29 },
  'Exodus 8': { sectionRef: 'Exodus 8', next: 'Exodus 9', n: 28 },
  'Mishnah Zevachim 4': { sectionRef: 'Mishnah Zevachim 4', next: 'Mishnah Zevachim 5', n: 6 },
  'Sefer Chasidim': { sectionRef: 'Sefer Chasidim', next: null, n: 200 },
};
const loadSection = async ref => {
  const m = /^(.*?)(?:[: ](\d+))?$/.exec(ref);
  let sec = sections[ref] || sections[m[1]];
  let seg = null;
  if (!sections[ref]) { seg = m[2]; }
  if (!sec) {
    // "Exodus 7:24"
    const k = Object.keys(sections).find(s => ref.startsWith(`${s}:`));
    sec = sections[k];
    seg = ref.slice(k.length + 1);
  }
  return {
    sectionRef: sec.sectionRef, next: sec.next, isSectionLevel: seg === null, requestedRef: ref,
    content: Array.from({ length: sec.n }, (_, i) => ({ segmentNumber: i + 1, he: `${sec.sectionRef} ${i + 1}`, text: '' })),
  };
};

describe('segmentsOf', () => {
  test('a range inside a section', async () => {
    const segs = await segmentsOf('Exodus 7:3-5', loadSection);
    expect(segs.map(s => s.he)).toEqual(['Exodus 7 3', 'Exodus 7 4', 'Exodus 7 5']);
  });
  test('a range across sections', async () => {
    const segs = await segmentsOf('Exodus 7:28-8:2', loadSection);
    expect(segs.map(s => s.he)).toEqual(['Exodus 7 28', 'Exodus 7 29', 'Exodus 8 1', 'Exodus 8 2']);
  });
  test('a whole section', async () => {
    expect((await segmentsOf('Mishnah Zevachim 4', loadSection)).length).toBe(6);
  });
  test('a book of one level', async () => {
    const segs = await segmentsOf('Sefer Chasidim 173', loadSection);
    expect(segs.map(s => s.he)).toEqual(['Sefer Chasidim 173']);
    expect(segmentRefOf('Sefer Chasidim', 173, 'Sefer Chasidim')).toBe('Sefer Chasidim 173');
    expect(segmentRefOf('Genesis 1', 3, 'Genesis')).toBe('Genesis 1:3');
  });
});

describe('the day: the calendar day, and Thursday night from sunset until alos on Friday', () => {
  // Thursday 19 Nov 2026 (parshat Vayetzei week), New York
  const at = (d, h, m = 0) => new Date(2026, 10, d, h, m);
  test('Thursday morning is Thursday', () => {
    expect(chokMoment(at(19, 10), { place: NY })).toMatchObject({ dayKey: 'thu' });
  });
  test('Thursday evening is Thursday night', () => {
    expect(chokMoment(at(19, 21), { place: NY })).toMatchObject({ dayKey: 'thu_night' });
  });
  test('Friday before alos is still Thursday night', () => {
    const m = chokMoment(at(20, 3, 30), { place: NY });
    expect(m.dayKey).toBe('thu_night');
    expect(m.date.getDate()).toBe(19);
  });
  test('Friday after alos is Friday', () => {
    expect(chokMoment(at(20, 7), { place: NY })).toMatchObject({ dayKey: 'fri' });
  });
  test('any other day before alos is that day (owner, 2026-11-22): Monday 2am is Monday', () => {
    expect(chokMoment(at(16, 2), { place: NY })).toMatchObject({ dayKey: 'mon' });
  });
  test('Sunday before alos (after Shabbat) is Sunday', () => {
    expect(chokMoment(at(22, 5), { place: NY })).toMatchObject({ dayKey: 'sun' });
  });
  test('Thursday before alos is Thursday, not Thursday night', () => {
    expect(chokMoment(at(19, 3), { place: NY })).toMatchObject({ dayKey: 'thu' });
  });
  test('Shabbat has none', () => {
    expect(chokMoment(at(21, 12), { place: NY })).toBeNull();
  });
});

describe('the outline', () => {
  test('every day of every week of a year (both Israel and outside) is in the sheets', () => {
    const days = chokOutline().days;
    for (const israel of [false, true]) {
      for (let d = 0; d < 400; d++) {
        const date = new Date(2026, 8, 1 + d);
        if (date.getDay() === 6) { continue; }
        for (const k of weekKeys(date, { israel })) { expect(days[k.key]).toBeDefined(); }
      }
    }
  });
  test('the Zohar refs Sefaria renumbered are corrected (chokFixes.json)', () => {
    const refs = chokOutline().days['אחרי מות|sun'].parts.flatMap(p => p.items).map(i => i.r);
    expect(refs).toContain('Zohar, Achrei Mot 31:192-32:201');
    expect(refs).not.toContain('Zohar, Achrei Mot 33');
  });
  test('refs carry the day keys', () => {
    const ref = chokSheetRef(['אחרי מות|sun', 'קדושים|sun']);
    expect(isChokSheetRef(ref)).toBe(true);
    expect(keysOfChokRef(ref)).toEqual(['אחרי מות|sun', 'קדושים|sun']);
  });
  test('the calendar item opens the day', () => {
    const item = chokSheetCalendarItem(new Date(2026, 10, 19, 21), { place: NY });
    expect(item.chok.dayKey).toBe('thu_night');
    expect(keysOfChokRef(item.refs[0])).toEqual([`${keysForMoment(chokMoment(new Date(2026, 10, 19, 21), { place: NY }))[0]}`]);
  });
  test('rows: headings, the sheet\'s own text, and a row per segment of a passage', async () => {
    const rows = await chokRows(['וירא|thu'], {
      loadSection: async ref => ({ sectionRef: ref.replace(/:\d+$/, ''), isSectionLevel: !/:\d+$/.test(ref), requestedRef: ref,
        content: Array.from({ length: 40 }, (_, i) => ({ segmentNumber: i + 1, he: `x${i + 1}`, text: '' })), next: null }),
      titleOf: ref => ref.replace(/ [\d:ab-]+$/, ''),
    });
    expect(rows[0]).toMatchObject({ type: 'outsideText', heading: true });
    const torah = rows.filter(r => r.type === 'ref' && r.sectionRef === 'Genesis 18');
    expect(torah.map(r => r.sourceRef)).toEqual(['Genesis 18:22', 'Genesis 18:23', 'Genesis 18:24', 'Genesis 18:25', 'Genesis 18:26']);
    expect(torah[0].sourceHeRef).toMatch(/בראשית/);
    expect(torah[1].sourceHeRef).toBe('');
  });
});
