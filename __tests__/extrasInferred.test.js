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

describe('beyond Sofer: comments placed loosely by their opening words', () => {
  const {looseQuote, amudOf, amudimWanted, talmudUnits, looseComments, paraOpening} = require('../extras/inferred');

  test('the quote: after "גמ\'", "בתוס\' ד"ה", the daf; to "וכו\'" or a stop; an abbreviation any one word', () => {
    expect(looseQuote('גמ\' אמר רבא האי ריהטא וכו\' דמחוזא')).toEqual(['אמר', 'רבא', 'האי', 'ריהטא']);
    expect(looseQuote('בתוס\' ד"ה והתניא היה ישן כו\' פי\'')).toEqual(['והתניא', 'היה', 'ישן']);
    expect(looseQuote('דף ב ע"א סברוה מאי מחיצה גודא. פי\' כותל')).toEqual(['סברוה', 'מאי', 'מחיצה', 'גודא']);
    expect(looseQuote('שם גמ\' אמר ר"ג וכו\'')).toEqual(['אמר']);
    expect(looseQuote('אמר ר"ג ורבנן אמרי')).toEqual(['אמר', '*', 'ורבנן', 'אמרי']);
    expect(paraOpening('<b>גְּמָ\'</b> אמר')).toBe('גמ\' אמר');
  });

  test('the amud a heading or an opening names', () => {
    expect(amudOf('דף ב.')).toEqual({daf: 2, side: 'a'});
    expect(amudOf('דף י"ב:')).toEqual({daf: 12, side: 'b'});
    expect(amudOf('דף קיב')).toEqual({daf: 112, side: null});
    expect(amudOf('דף ב ע"ב שם')).toEqual({daf: 2, side: 'b'});
    expect(amudOf('ע"א אמר')).toEqual({daf: null, side: 'a'});
    expect(amudOf('אמר רבא')).toBe(null);
    expect(amudimWanted({leaves: [['X, S1', '', ['S1'], ['דף ג.'], [''], ['גמ\' אמר']]]})).toEqual(['2b', '3a', '3b']);
  });

  test('on the Gemara: searched in the amud named and beside it, in order; not found: with its neighbour', () => {
    const units = talmudUnits('Masechet', 'מסכת', [
      ['2a', [`מאימתי קורין את שמע ${L}`, `אמר רבא האי ריהטא דחקלאי ${L}`]],
      ['2b', [`תנו רבנן מאימתי ${L}`]],
      ['5a', [`אמר רבא האי ריהטא דחקלאי ${L}`]],
    ]);
    const got = looseComments([
      {path: ['S1'], heTitles: ['דף ב.'], openings: ['גמ\' מאימתי קורין את שמע וכו\'', 'גמ\' אמר רבא האי ריהטא כו\'', 'וקשה לי']},
      {path: ['S2'], heTitles: ['דף ב:'], openings: ['גמ\' תנו רבנן מאימתי כו\'']},
      {path: ['S3'], heTitles: ['דף ה.'], openings: ['גמ\' אמר רבא האי ריהטא כו\'']},
    ], units);
    expect(got.map(p => [units[p.unit].ref, p.how, p.exact])).toEqual([
      ['Masechet 2a:1', 'loose', true],
      ['Masechet 2a:2', 'loose', true],           // (and not 5a: out of the window)
      ['Masechet 2a:2', 'loose-neighbour', false],
      ['Masechet 2b:1', 'loose', true],
      ['Masechet 5a:1', 'loose', true],
    ]);
    // (a book whose comments are not found: not a commentary on it - responsa named for it)
    expect(looseComments([{path: ['S1'], heTitles: [''], openings: ['ב"ה שלום רב', 'לכבוד הרב']}], units)).toEqual([]);
  });
});

describe('as Sofer\'s loose_placement.py: Rishon LeTzion on Berakhot', () => {
  const {looseQuote, talmudUnits, looseComments} = require('../extras/inferred');
  // (lines of Berakhot 45b-46b, cut short; Rishon LeTzion's openings under its daf headings)
  const amudim = [
    ['45b', ['דניחא להו דמקבע להו בחובה מעיקרא', 'תא שמע נשים מזמנות לעצמן ועבדים מזמנים לעצמן',
      'שאני התם דאיכא דעות', 'אי הכי אימא סיפא נשים ועבדים אם רצו לזמן אין מזמנין']],
    ['46a', ['רבי זירא חלש על לגביה רבי אבהו אמר ליה לא סבר לה מר להא דרבי יוחנן דאמר בעל הבית בוצע',
      'כי מטא לברוכי אמר ליה נבריך לן מר אמר ליה לא סבר לה מר להא דרב הונא דמן בבל דאמר בוצע מברך',
      'ואיהו כמאן סבירא ליה']],
    ['46b', ['ויש מהן שחותם בהן בברוך ואין פותח בברוך והטוב והמטיב פותח בברוך',
      'הטוב והמטיב אין דיין אמת לא אלא אימא אף הטוב והמטיב']],
  ];
  const comm = [
    {path: ['S7', 'S2'], heTitles: ['פרק ז - שלשה שאכלו', 'דף מה:'], openings: [
      'גמ\' שאני התם דאיכא דעות וכו\' פירוש', 'גמ\' נשים מזמנות לעצמן כו\'']},
    {path: ['S7', 'S3'], heTitles: ['פרק ז - שלשה שאכלו', 'דף מו.'], openings: [
      'גמ\' לא סבר לה מר להא דר"ה דאמר בוצע מברך ע"כ כתב הרמב"ם']},
    {path: ['S7', 'S4'], heTitles: ['פרק ז - שלשה שאכלו', 'דף מו:'], openings: [
      'גמ\' ויש מהן שחותם בהן וכו\'', 'גמ\' הטוב והמטיב אין דיין אמת כו\'']},
  ];
  const placed = (units, opts) => looseComments(comm, units, opts).map(p => [comm[p.leaf].path.join(' ') + ':' + p.para, units[p.unit].ref, p.how]);

  test('the masechet and perek running into the first comment are not part of its quote', () => {
    expect(looseQuote('ברכות פרק א משעה שהכהנים וכו\' רש"י כתב')).toEqual(['משעה', 'שהכהנים']);
    expect(looseQuote('פרק ב היה קורא בתורה וכו\'')).toEqual(['היה', 'קורא', 'בתורה']);
  });

  test('"לא סבר לה מר להא" goes on 46a, the amud its heading names', () => {
    expect(placed(talmudUnits('Berakhot', 'ברכות', amudim))).toEqual([
      ['S7 S2:0', 'Berakhot 45b:3', 'loose'],
      ['S7 S2:1', 'Berakhot 45b:2', 'loose'],
      ['S7 S3:0', 'Berakhot 46a:1', 'loose'],
      ['S7 S4:0', 'Berakhot 46b:1', 'loose'],
      ['S7 S4:1', 'Berakhot 46b:2', 'loose'],
    ]);
  });

  test('46a could not be read: its comment is left out, not put on 45b beside the one before', () => {
    const without46a = amudim.filter(([label]) => label !== '46a');
    const got = placed(talmudUnits('Berakhot', 'ברכות', without46a), {unread: new Set([90])});
    expect(got.map(([c]) => c)).not.toContain('S7 S3:0');
    expect(got).toHaveLength(4);
  });
});

describe('as Sofer\'s placement recheck: Rashi\'s and Tosafos\' dibburim, letters, essays by siman', () => {
  const {looseComments, talmudUnits, dibburimOf, dibburOf, onCommentary, namedDaf, perekNumber, partialRatioAtLeast,
    stripNumber, innerDaf} = require('../extras/inferred');
  // (Sofer's tests/test_loose_placement.py _gemara: made-up passages on 2a, 2b, 3a - not a real text)
  const units = talmudUnits('M', 'מ', [
    ['2a', ['אלף בית גימל דלת', 'הא וו זין חית']],
    ['2b', ['טית יוד כף למד', 'מם נון סמך עין']],
    ['3a', ['פא צדי קוף ריש', 'אלף בית גימל דלת שין']],
  ]);
  const leavesOf = list => {
    const comm = [];
    list.forEach(([heads, text]) => {
      if (heads.length || !comm.length) { comm.push({path: ['S'], heTitles: heads, openings: []}); }
      comm[comm.length - 1].openings.push(text);
    });
    return comm;
  };
  const run = (list, opts) => {
    const comm = leavesOf(list);
    return looseComments(comm, units, opts).map(p => [units[p.unit].key.join(':'), p.how]);
  };

  test('what a heading or an opening names', () => {
    expect(namedDaf('סימן יח - לדף ט')).toEqual({daf: 9, side: null});
    expect(namedDaf('(סימן כו - לדף צה)')).toEqual({daf: 95, side: null});
    expect(namedDaf('חיובי נזקי ממונו (ריש המסכת)')).toEqual({daf: 2, side: 'a'});
    expect(namedDaf('סימן א')).toBe(null);
    expect(perekNumber('פרק תשיעי')).toBe(9);
    expect(perekNumber('פרק של שלשה עשר')).toBe(13);
    expect(perekNumber('סימן א')).toBe(null);
    expect(onCommentary('בתוס\' בד"ה תנן וכו\'')).toBe('tosafot');
    expect(onCommentary('בפירש"י בד"ה המביא')).toBe('rashi');
    expect(onCommentary('דף ו\' ע"א. בתוס\' ד"ה לאתויי')).toBe('tosafot');
    expect(onCommentary('בד"ה צריך')).toBe('either');
    expect(onCommentary('שם מן הרקם')).toBe(null);
    expect(stripNumber('א) גמ\' אמר')).toBe('גמ\' אמר');
    expect(innerDaf('ובהא דאמרו בגמרא דף ה\' ע"ב')).toEqual({daf: 5, side: 'b'});
    expect(innerDaf('תוספות כתובות דף ע"ד')).toBe(null);
  });

  test('a comment on Tosafos\' words goes on the line of their dibbur', () => {
    const dibburim = new Map([[3, [{who: 'tosafot', words: 'מם נון', text: 'מם נון - פירוש התוספות כאן', line: 1}]]]);
    const got = run([[['דף ב'], 'גמ\' אלף בית גימל'], [[], 'בתוס\' בד"ה מם נון וכו\' קשה לי'], [[], 'גמ\' פא צדי קוף ריש']],
      {dibburim});
    expect(got[1]).toEqual(['3:1', 'dibbur']);
  });

  test('Rashi\'s and Tosafos\' dibburim read as dibburim.load reads them', () => {
    expect(dibburOf('<b>מתני\' המביא גט.</b> ממדינת הים')).toBe('המביא גט');
    expect(dibburOf('המביא גט - שליח')).toBe('המביא גט');
    const d = dibburimOf({rashi: [[2, [['<b>אלף</b> פירוש'], [], ['<b>הא וו</b> כו']]]], tosafot: [[2, [[], ['<b>בית</b> תוס']]]]});
    expect(d.get(2).map(x => [x.who, x.words, x.line])).toEqual([['rashi', 'אלף', 0], ['tosafot', 'בית', 1], ['rashi', 'הא וו', 2]]);
  });

  test('a quote spelled its own way is found by its letters (rapidfuzz\'s partial ratio)', () => {
    expect(partialRatioAtLeast('טתדכפלמד', 'טתדכפלמדמםנםסמכענ', 88)).toBe(true);
    expect(partialRatioAtLeast('טתדכפלמד', 'אלפבתגמלדלת', 88)).toBe(false);
    // (rapidfuzz: fuzz.partial_ratio("abcd", "xxabxdxx") is 75)
    expect(partialRatioAtLeast('abcd', 'xxabxdxx', 75)).toBe(true);
    expect(partialRatioAtLeast('abcd', 'xxabxdxx', 76)).toBe(false);
  });

  test('essays: each siman at the daf its heading names, a comment there by its quote', () => {
    const essay = [0, 1, 2, 3, 4, 5, 6, 7].map(i => `והנה יש לומר בזה דבר חדש ${i}`);
    expect(run([
      [['סימן א - לדף ב'], 'סוגיא דכותרת'], [[], essay[0]], [[], essay[1]],
      [['סימן ב'], 'דף ג\' ע"א, מם נון סמך עין וכו\''], [[], essay[2]], [[], essay[3]],
      [['סימן ג'], `שם, ${essay[4]}`], [[], essay[5]],
      [['סימן ד'], essay[6]], [[], essay[7]],
    ])).toEqual([['2:0', 'daf'], ['2:0', 'daf'], ['2:0', 'daf'],
      ['3:1', 'loose'], ['3:1', 'daf'], ['3:1', 'daf'],
      ['4:0', 'daf'], ['4:0', 'daf'],
      ['4:0', 'loose-neighbour'], ['4:0', 'loose-neighbour']]);
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
