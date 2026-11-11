/**
 * The obvious connections of downloaded extra books (extras/inferred.js, extras/links.js inferAll):
 * a commentary found by its name, its paragraphs put on the text's passages as Sofer places them,
 * worked out whichever book is downloaded first, shown in both directions as a commentary.
 * (SYNTHETIC TEST FIXTURE texts - not real texts.)
 */
import {
  gematria, heNumber, headingNumber, numberPaths, paraSign, hebrewWords, placeComments, inferBase, nameKey,
  inferredLinks, sefariaUnits, extraUnits,
} from '../extras/inferred';
import {inferAll, buildIndex, relatedFromIndex} from '../extras/links';

const L = 'SYNTHETIC TEST FIXTURE';

describe('Hebrew numbers and headings (hebrew.gematria, mg_books.chapter_sections)', () => {
  test('gematria as Sofer writes it', () => {
    expect([1, 15, 16, 19, 270, 304, 999].map(gematria)).toEqual(['א', 'טו', 'טז', 'יט', 'ער', 'דש', 'תתקצט']);
    expect(heNumber(1)).toBe('א׳');
    expect(heNumber(12)).toBe('י״ב');
  });

  test('a heading\'s number', () => {
    expect(headingNumber('פרק א')).toBe(1);
    expect(headingNumber('פרק י"ב')).toBe(12);
    expect(headingNumber('פסוק יא')).toBe(11);
    expect(headingNumber('א.')).toBe(1);
    expect(headingNumber('(ג)')).toBe(3);
    expect(headingNumber('סימן קס"ה')).toBe(165);
    expect(headingNumber('הקדמה')).toBe(null);
    expect(headingNumber('פרק יה')).toBe(null);          // (not as gematria writes 15)
  });

  test('sections numbered level by level; a level only partly numbered is "likely"', () => {
    const got = numberPaths([
      {keys: ['S0'], heTitles: ['ספר']},
      {keys: ['S1', 'S1'], heTitles: ['פרק א', 'פסוק א']},
      {keys: ['S1', 'S2'], heTitles: ['פרק א', 'פסוק ג']},
      {keys: ['S2', 'S1'], heTitles: ['פרק ב', 'הקדמה']},
      {keys: ['S2', 'S2'], heTitles: ['פרק ב', 'פסוק ב']},
      {keys: ['S2', 'S3'], heTitles: ['פרק ב', 'פסוק ג']},
    ]);
    expect(got.map(x => x.path)).toEqual([['S0'], [0, 0], [0, 2], [1, 'S1'], [1, 1], [1, 2]]);
    expect(got.map(x => x.likely)).toEqual([false, false, false, false, true, true]);
    // (two sections of the same number: not numbered)
    expect(numberPaths([{keys: ['S1'], heTitles: ['פרק א']}, {keys: ['S2'], heTitles: ['א']}])
      .map(x => x.path)).toEqual([['S1'], ['S2']]);
  });
});

describe('a comment\'s place (mg_books.QuotePlacer and build_plan\'s loop)', () => {
  test('what a paragraph says of its place', () => {
    expect(paraSign('<b>ג</b>')).toBe('m:ג');
    expect(paraSign('<b>שִׁיר הַשִּׁירִים אשר לשלמה וגו\'</b> פירוש')).toBe('d:שיר השירים אשר לשלמה');
    expect(paraSign('דבר אחר: <b>אשר</b> לשלמה')).toBe('d:אשר');
    expect(paraSign('בלי מילים מודגשות')).toBe('');
    expect(hebrewWords('<i>בית־המקדש</i> "כד"א"')).toEqual(['בית', 'המקדש', 'כד', 'א']);
  });

  const verses = [
    [0, [`שיר השירים אשר לשלמה ${L}`, `ישקני מנשיקות פיהו ${L}`, `לריח שמניך טובים ${L}`]],
    [1, [`אני חבצלת השרון ${L}`, `כשושנה בין החוחים ${L}`]],
  ];
  const units = sefariaUnits('Song', 'שיר', verses);

  test('by the quoted words, a verse\'s number, and next to the neighbours, kept in order', () => {
    const comm = [
      {path: [0], signs: ['d:שיר', '', 'd:מנשיקות', 'm:ג', '', 'd:שיר השירים']},
      {path: [1], signs: ['d:שושנה', 'd:חבצלת']},
      {path: ['S9'], signs: ['d:חבצלת']},           // (a section of no chapter: no place)
    ];
    const got = placeComments(comm, units).map(p => [p.leaf, p.para, units[p.unit].ref, p.how]);
    expect(got).toEqual([
      [0, 0, 'Song 1:1', 'quote'],
      [0, 1, 'Song 1:1', 'neighbour'],
      [0, 2, 'Song 1:2', 'quote'],
      [0, 3, 'Song 1:3', 'marker'],
      [0, 4, 'Song 1:3', 'neighbour'],
      [0, 5, 'Song 1:3', 'neighbour'],       // (verse 1 is behind the last placed: not its place)
      [1, 0, 'Song 2:2', 'quote'],           // (a letter of prefix: שושנה = כשושנה)
      [1, 1, 'Song 2:2', 'neighbour'],
    ]);
  });

  test('arranged like the text, one level deeper', () => {
    const got = placeComments([{path: [1, 0], signs: ['', 'd:לא נמצא']}], units);
    expect(got.map(p => [units[p.unit].ref, p.how])).toEqual([['Song 2:1', 'structure'], ['Song 2:1', 'structure']]);
  });

  test('the links, with their confidence', () => {
    const comm = {leaves: [
      ['פירוש, S1', 'פירוש, פרק א', ['S1'], ['פרק א'], ['d:ישקני', '']],
      ['פירוש, S2', 'פירוש, פרק ב', ['S2'], ['פרק ב'], ['m:א']],
    ]};
    expect(inferredLinks(comm, {units})).toEqual([
      {a: 'פירוש, S1:1', ah: 'פירוש, פרק א 1', t: 'Song 1:2', th: 'שיר א׳:ב׳', r: 'base', c: 'sure', how: 'quote'},
      {a: 'פירוש, S1:2', ah: 'פירוש, פרק א 2', t: 'Song 1:2', th: 'שיר א׳:ב׳', r: 'base', c: 'likely', how: 'neighbour'},
      {a: 'פירוש, S2:1', ah: 'פירוש, פרק ב 1', t: 'Song 2:1', th: 'שיר ב׳:א׳', r: 'base', c: 'sure', how: 'marker'},
    ]);
  });
});

describe('which book a book is on (library.infer_commentaries)', () => {
  const books = [
    {key: 'sefaria:Song of Songs', kind: 'sefaria', title: 'Song of Songs', heTitle: 'שיר השירים'},
    {key: 'sefaria:Rashi on Song of Songs', kind: 'sefaria', title: 'Rashi on Song of Songs', heTitle: 'רש"י על שיר השירים', commentary: true},
    {key: 'sefaria:Psalms', kind: 'sefaria', title: 'Psalms', heTitle: 'תהילים'},
    {key: 'extra:ספר בדיקה', kind: 'extra', title: 'ספר בדיקה', heTitle: 'ספר בדיקה'},
    {key: 'extra:בדיקה', kind: 'extra', title: 'בדיקה', heTitle: 'בדיקה'},
    {key: 'sefaria:Bedika', kind: 'sefaria', title: 'Bedika', heTitle: 'בדיקה'},
  ];
  test('by its main name: sure', () => {
    expect(nameKey('שִׁיר־הַשִּׁירִים')).toBe('שיר השירים');
    const f = inferBase('רוקח על שיר השירים', books, 'extra:רוקח על שיר השירים');
    expect([f.book.title, f.confidence]).toEqual(['Song of Songs', 'sure']);
    expect(inferBase('הערות על ספר בדיקה', books).book.key).toBe('extra:ספר בדיקה');
  });
  test('the rest: likely, or nothing', () => {
    expect(inferBase('פירוש על תהלים', books)).toMatchObject({book: {title: 'Psalms'}, confidence: 'likely'});
    expect(inferBase('ביאור על רש"י על שיר השירים', books)).toMatchObject({book: {title: 'Rashi on Song of Songs'}, confidence: 'likely'});
    expect(inferBase('פירוש על בדיקה', books)).toMatchObject({book: {key: 'sefaria:Bedika'}, confidence: 'likely'});
    expect(inferBase('ספר בדיקה', books).book).toBe(null);
    expect(inferBase('פירוש על ספר אחר', books).book).toBe(null);
  });
});

describe('worked out whichever book comes first (extras/links.js inferAll)', () => {
  const sefaria = [{key: 'sefaria:Song of Songs', kind: 'sefaria', title: 'Song of Songs', heTitle: 'שיר השירים'}];
  const chapters = {
    'Song of Songs 1': [`שיר השירים אשר לשלמה ${L}`, `ישקני מנשיקות ${L}`],
    'Song of Songs 2': [`אני חבצלת ${L}`],
  };
  const file = () => ({title: 'רוקח על שיר השירים', heTitle: 'רוקח על שיר השירים', links: [], pending: [], secs: [
    ['רוקח על שיר השירים, S1', 'רוקח על שיר השירים, פרק א', ['S1'], ['פרק א'], ['d:ישקני']],
    ['רוקח על שיר השירים, S2', 'רוקח על שיר השירים, פרק ב', ['S2'], ['פרק ב'], ['d:חבצלת']],
  ]});

  test('a commentary on a Sefaria book: shown under its passages as a commentary', async () => {
    const files = {'רוקח על שיר השירים': file()};
    const asked = [];
    const done = await inferAll({files, books: sefaria, changed: 'רוקח על שיר השירים',
      loadSection: async ref => { asked.push(ref); return chapters[ref]; }});
    expect(done).toEqual(['רוקח על שיר השירים']);
    expect(asked).toEqual(['Song of Songs 1', 'Song of Songs 2']);
    const f = files['רוקח על שיר השירים'];
    expect(f.inferredOn).toBe('sefaria:Song of Songs');
    expect(f.inferred.map(l => [l.a, l.t, l.c])).toEqual([
      ['רוקח על שיר השירים, S1:1', 'Song of Songs 1:2', 'sure'],
      ['רוקח על שיר השירים, S2:1', 'Song of Songs 2:1', 'sure'],
    ]);
    // the index: Song of Songs 1 has it as a commentary; the commentary has the verse
    global.Sefaria = {
      textTitleForRef: ref => (ref.startsWith('Song of Songs') ? 'Song of Songs' : 'רוקח על שיר השירים'),
      primaryCategoryForTitle: t => (t === 'Song of Songs' ? 'Tanakh' : 'Jewish Thought'),
      categoriesForTitle: () => ['Tanakh'],
    };
    try {
      const map = buildIndex([f]);
      expect(relatedFromIndex(map, 'Song of Songs 1')).toEqual([expect.objectContaining({
        sourceRef: 'רוקח על שיר השירים, S1:1', anchorRef: 'Song of Songs 1:2', category: 'Commentary',
        index_title: 'רוקח על שיר השירים', inferred: 'sure'})]);
      expect(relatedFromIndex(map, 'רוקח על שיר השירים, S2')).toEqual([expect.objectContaining({
        sourceRef: 'Song of Songs 2:1', anchorRef: 'רוקח על שיר השירים, S2:1', category: 'Tanakh'})]);
    } finally {
      delete global.Sefaria;
    }
    // nothing changed: not worked out again
    expect(await inferAll({files, books: sefaria, changed: 'other', loadSection: async () => { throw new Error('no'); }})).toEqual([]);
  });

  test('not when the book\'s own links tie it to that book already; kept for later when the text cannot be read', async () => {
    const own = {...file(), links: [{a: 'רוקח על שיר השירים, S1:1', t: 'Song of Songs 1:1', r: 'base'}]};
    const files = {'רוקח על שיר השירים': own};
    expect(await inferAll({files, books: sefaria, changed: 'רוקח על שיר השירים', loadSection: async ref => chapters[ref]}))
      .toEqual(['רוקח על שיר השירים']);
    expect(own.inferred).toEqual([]);
    const offline = {'רוקח על שיר השירים': file()};
    expect(await inferAll({files: offline, books: sefaria, changed: 'רוקח על שיר השירים',
      loadSection: async () => { throw new Error('offline'); }})).toEqual([]);
    expect(offline['רוקח על שיר השירים'].inferredOn).toBe(undefined);
  });

  test('a commentary on another downloaded extra book, downloaded before it', async () => {
    const notes = {title: 'הערות על פירוש בדיקה', heTitle: 'הערות על פירוש בדיקה', links: [], pending: [], secs: [
      ['הערות על פירוש בדיקה, S1', 'הערות, פרק א', ['S1'], ['פרק א'], ['d:שני', 'd:ראשון']],
    ]};
    const base = {title: 'פירוש בדיקה', heTitle: 'פירוש בדיקה', links: [], pending: [], secs: [
      ['פירוש בדיקה, S1', 'פירוש בדיקה, פרק א', ['S1'], ['פרק א'], ['', '']],
    ]};
    const texts = {'פירוש בדיקה, S1': [`ראשון ${L}`, `שני ${L}`]};
    const files = {'הערות על פירוש בדיקה': notes};
    // (alone: nothing to be on)
    await inferAll({files, books: sefaria, changed: 'הערות על פירוש בדיקה', loadSection: async ref => texts[ref]});
    expect(notes.inferred || []).toEqual([]);
    // the book it is on comes: it is worked out again
    files['פירוש בדיקה'] = base;
    const books = sefaria.concat({key: 'extra:פירוש בדיקה', kind: 'extra', title: 'פירוש בדיקה', heTitle: 'פירוש בדיקה'});
    const done = await inferAll({files, books, changed: 'פירוש בדיקה', loadSection: async ref => texts[ref]});
    expect(done).toEqual(['הערות על פירוש בדיקה']);
    expect(notes.inferredOn).toBe('extra:פירוש בדיקה');
    expect(notes.inferred.map(l => [l.a, l.t, l.c])).toEqual([
      ['הערות על פירוש בדיקה, S1:1', 'פירוש בדיקה, S1:2', 'sure'],
      ['הערות על פירוש בדיקה, S1:2', 'פירוש בדיקה, S1:2', 'likely'],   // (behind the last placed)
    ]);
    expect(extraUnits(base.secs).map(u => u.key)).toEqual([[0, 0], [0, 1]]);
    // it is deleted: the connections go
    delete files['פירוש בדיקה'];
    expect(await inferAll({files, books: sefaria, changed: null, loadSection: async ref => texts[ref]}))
      .toEqual(['הערות על פירוש בדיקה']);
    expect(notes.inferred).toEqual([]);
  });
});

describe('a Dicta book Sefaria has under another name is Sefaria\'s (importers.import_dicta)', () => {
  test('left out of Dicta\'s catalogue, as Sofer leaves it out', () => {
    const {parseCatalog} = require('../extras/dicta');
    const books = [
      {fileName: 'a', displayName: 'פירוש בדיקה הקצר על ספר', textFileURL: 'https://x/a.zip'},
      {fileName: 'b', displayName: 'ספר בדיקה אחר', textFileURL: 'https://x/b.zip'},
    ];
    expect(parseCatalog(books, null, {}, ['פירוש בדיקה הקצר על ספר']).map(e => e.heTitle)).toEqual(['ספר בדיקה אחר']);
    expect(require('../extras/dictaRules.json').in_sefaria).toContain('אבן עזרא הקצר על שמות');
  });
});
