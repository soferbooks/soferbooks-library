/**
 * The extra books' connections (extras/links.js): Otzaria's link files put on the converted book's
 * passages (as Sofer's importers.otzaria_links), Dicta's page citations placed by their letters,
 * both ends indexed by section, and added to what the links API gives (offlineOnline.loadRelated).
 * (SYNTHETIC TEST FIXTURE texts - not real texts.)
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {otzariaTree, linksPathFor, parseCatalog} from '../extras/otzaria';
import {pageCitations, pagesBase, linksOf} from '../extras/dicta';
import {
  passagesOf, lineMap, mapOtzariaLinks, placeCitations, sefariaUrlToRef, buildIndex, relatedFromIndex,
  sectionOf, withExtraLinks, otzariaBookName, rangeStart,
} from '../extras/links';
import * as extras from '../extras';

jest.mock('react-native-zip-archive', () => {
  const fsMock = require('expo-file-system/legacy');
  return {
    zip: jest.fn(async (dir, target) => {
      const entries = {};
      for (const name of await fsMock.readDirectoryAsync(dir)) {
        entries[name] = await fsMock.readAsStringAsync(`${dir}${name}`);
      }
      await fsMock.writeAsStringAsync(target, JSON.stringify(entries));
      return target;
    }),
    unzip: jest.fn(),
  };
});

const L = 'SYNTHETIC TEST FIXTURE - not a real text';
// lines:     1            2          3               4            5            6               7
const BOOK = `<h1>פירוש בדיקה</h1>\nמחבר בדיקה\n<h2>פרק א</h2>\nראשון ${L}\nשני ${L}\n<h2>פרק ב</h2>\nשלישי ${L}\n`;
const NOTES = `<h1>הערות על פירוש בדיקה</h1>\nמחבר בדיקה\nהערה א ${L}\nהערה ב ${L}\n`;
const RAW = [
  {line_index_1: 4, line_index_2: 1, ref_2: 'Mishneh Torah, Prayer 1:1', heRef_2: 'משנה תורה, הלכות תפילה א, א',
    path_2: 'משנה תורה, הלכות תפילה.txt', 'Conection Type': 'source'},
  {line_index_1: 5, line_index_2: 2, ref_2: 'Mishneh Torah, Prayer 1:2-3', heRef_2: '',
    path_2: 'משנה תורה, הלכות תפילה.txt', 'Conection Type': 'source'},
  {line_index_1: 6, line_index_2: 4, heRef_2: 'הערות', path_2: 'אוצריא\\הלכה\\הערות על פירוש בדיקה.txt',
    'Conection Type': 'footnotes'},             // (a heading's line: the paragraph under it)
  {line_index_1: 7, line_index_2: 9, ref_2: 'Elsewhere 3:1', path_2: 'x.txt', 'Conection Type': 'reference'},
  {line_index_1: 2, line_index_2: 1, ref_2: 'Elsewhere 3:1', path_2: 'x.txt', 'Conection Type': 'source'},  // (the author line)
];

describe('Otzaria\'s link files', () => {
  test('where a book\'s links are', () => {
    expect(linksPathFor('National-LibraryToOtzaria/ספרים/אוצריא/הלכה/משנה תורה/מפרשים/אבני שהם.txt'))
      .toBe('National-LibraryToOtzaria/links/אבני שהם_links.json');
    expect(linksPathFor('DictaToOtzaria/ערוך/ספרים/אוצריא/תלמוד בבלי/אבן העוזר על ברכות.txt'))
      .toBe('DictaToOtzaria/ערוך/links/אבן העוזר על ברכות_links.json');
    const cat = parseCatalog(JSON.stringify({
      'KSK/ספרים/אוצריא/הלכה/א/ספר א.txt': {hash: '1'},
      'KSK/links/ספר א_links.json': {hash: '2'},
      'KSK/ספרים/אוצריא/הלכה/א/ספר ב.txt': {hash: '3'},
    }), {restricted: [], permitted: {}, in_sefaria: []});
    expect(cat.map(e => [e.heTitle, e.links])).toEqual([['ספר א', true], ['ספר ב', false]]);
    expect(otzariaBookName('אוצריא\\הלכה\\הערות על X.txt')).toBe('הערות על X');
  });

  test('each line of the file is its paragraph\'s passage (Otzaria counts lines from 1)', () => {
    const [tree] = otzariaTree(BOOK);
    const p = passagesOf(tree, 'Commentary Test', 'פירוש בדיקה');
    const lines = lineMap(tree, p);
    const ref = l => `${p.leaves[l[0]][0]}:${l[1]}`;
    expect(ref(lines[4])).toBe('Commentary Test, S1:1');
    expect(ref(lines[5])).toBe('Commentary Test, S1:2');
    expect(ref(lines[6])).toBe('Commentary Test, S2:1');     // the heading's line
    expect(ref(lines[7])).toBe('Commentary Test, S2:1');
    expect(lines[1]).toBeUndefined();
    expect(lines[2]).toBeUndefined();
  });

  test('mapped as Sofer maps them: Sefaria\'s ref, or another Otzaria book\'s line', () => {
    const [tree] = otzariaTree(BOOK);
    const p = passagesOf(tree, 'Commentary Test', 'פירוש בדיקה');
    const {links, pending} = mapOtzariaLinks(RAW, lineMap(tree, p), p, 'פירוש בדיקה');
    expect(links).toEqual([
      {a: 'Commentary Test, S1:1', ah: 'פירוש בדיקה, פרק א 1', t: 'Mishneh Torah, Prayer 1:1', th: 'משנה תורה, הלכות תפילה א, א', r: 'base'},
      {a: 'Commentary Test, S1:2', ah: 'פירוש בדיקה, פרק א 2', t: 'Mishneh Torah, Prayer 1:2-3', th: 'Mishneh Torah, Prayer 1:2-3', r: 'base'},
    ]);
    expect(pending).toEqual([{a: 'Commentary Test, S2:1', ah: 'פירוש בדיקה, פרק ב 1', book: 'הערות על פירוש בדיקה', line: 4, r: 'commentary'}]);
  });
});

describe('Dicta\'s citations', () => {
  test('a page\'s citations, and Sefaria\'s address as a ref', () => {
    const page = pageCitations(JSON.stringify({
      tokens: [{str: 'כמו '}, {str: 'ביומא'}, {str: ' '}, {str: '(די"ח)'}, {str: ' ודו"ק'}],
      data: {explicitCitationsResults: [{baseStartChar: 4, baseTextLength: 12, baseMatchedText: 'ביומא (די"ח)',
        sources: [{url: 'sefaria.org/Yoma.18', compNameHe: 'יומא י״ח'}]}]},
    }));
    expect(page.text).toBe('כמו ביומא (די"ח) ודו"ק');
    expect(page.citations[0]).toMatchObject({start: 4, length: 12, sources: [{url: 'sefaria.org/Yoma.18', he: 'יומא י״ח'}]});
    expect(sefariaUrlToRef('sefaria.org/Shulchan_Arukh,_Choshen_Mishpat.51.6')).toBe('Shulchan Arukh, Choshen Mishpat 51:6');
    expect(sefariaUrlToRef('sefaria.org/Tosafot_on_Bava_Metzia.60b.8-75b.14')).toBe('Tosafot on Bava Metzia 60b:8');
    expect(sefariaUrlToRef("sefaria.org/Turei_Zahav_on_Shulchan_Arukh,_Yoreh_De'ah.1")).toBe("Turei Zahav on Shulchan Arukh, Yoreh De'ah 1");
    expect(pagesBase({textUrl: 'https://files.dicta.org.il/library-1-0/b=1/b=1__text_files.zip'}))
      .toBe('https://files.dicta.org.il/library-1-0/b=1/');
  });

  test('placed on the paragraph whose letters they are', () => {
    const [tree] = otzariaTree(`<h1>ספר</h1>\nמחבר\n<h2>א</h2>\nפתיחה ${L}\nוכמו שאמרו <b>ביומא</b> דף יח ובמקום אחר\n<h2>ב</h2>\nושוב ביומא דף יח בסוף\n`);
    const p = passagesOf(tree, 'Dicta Test', 'ספר');
    const cite = (text, word) => ({text, citations: [{start: text.indexOf(word), length: word.length, matched: word,
      sources: [{url: 'sefaria.org/Yoma.18', he: 'יומא י״ח'}]}]});
    const links = placeCitations([cite('וכמו שאמרו ביומא דף יח ובמקום', 'ביומא דף יח'), cite('ושוב ביומא דף יח בסוף', 'ביומא דף יח')], p);
    expect(links.map(l => [l.a, l.t, l.th])).toEqual([
      ['Dicta Test, S1:2', 'Yoma 18', 'יומא י״ח'],
      ['Dicta Test, S2:1', 'Yoma 18', 'יומא י״ח'],
    ]);
  });

  test('which connections a Dicta book gets: Otzaria\'s of its layout, and its page citations', () => {
    const entry = {textUrl: 'https://files.dicta.org.il/library-1-0/b/b__text_files.zip', otzaria: {path: 'DictaToOtzaria/ערוך/ספרים/אוצריא/x/b.txt', links: true}};
    const doc = {otzaria: `<h1>b</h1>\nמחבר\n<h2>א</h2>\nטקסט ${L}\n`, otzariaCopy: entry.otzaria, pages: [], copies: []};
    expect(linksOf(entry, doc)).toEqual({otzariaPath: entry.otzaria.path, dictaPages: true});
    expect(linksOf(entry, {otzaria: null, pages: [`פרק א\nטקסט ${L}`], copies: []})).toEqual({dictaPages: true});
  });
});

describe('the index: both ends of each link, by section', () => {
  const [tree] = otzariaTree(BOOK);
  const p = passagesOf(tree, 'Commentary Test', 'פירוש בדיקה');
  const lines = lineMap(tree, p);
  const book = {title: 'Commentary Test', heTitle: 'פירוש בדיקה', leaves: p.leaves, lines, ...mapOtzariaLinks(RAW, lines, p, 'פירוש בדיקה')};
  const [ntree] = otzariaTree(NOTES);
  const np = passagesOf(ntree, 'Notes Test', 'הערות על פירוש בדיקה');
  const notes = {title: 'Notes Test', heTitle: 'הערות על פירוש בדיקה', leaves: np.leaves, lines: lineMap(ntree, np), links: [], pending: []};

  beforeAll(() => {
    global.Sefaria = {
      textTitleForRef: ref => ['Mishneh Torah, Prayer', 'Commentary Test', 'Notes Test'].find(t => ref.startsWith(t)) || null,
      primaryCategoryForTitle: t => ({'Mishneh Torah, Prayer': 'Halakhah', 'Commentary Test': 'Halakhah', 'Notes Test': 'Reference'}[t]),
      categoriesForTitle: () => ['Halakhah'],
    };
  });
  afterAll(() => { delete global.Sefaria; });

  test('sections of refs', () => {
    expect(sectionOf('Mishneh Torah, Prayer 1:2-3')).toBe('Mishneh Torah, Prayer 1');
    expect(sectionOf('Commentary Test, S2, S1:4')).toBe('Commentary Test, S2, S1');
    expect(sectionOf('Yoma 18')).toBe(null);
    expect(rangeStart('Chavatzelet HaSharon - Vol. 2, S1:3-5')).toBe('Chavatzelet HaSharon - Vol. 2, S1:3');
  });

  test('the commentary\'s passage shows its source; the source\'s passage shows the commentary', () => {
    const map = buildIndex([book]);
    expect(relatedFromIndex(map, 'Commentary Test, S1')).toEqual([
      {sourceRef: 'Mishneh Torah, Prayer 1:1', sourceHeRef: 'משנה תורה, הלכות תפילה א, א', index_title: 'Mishneh Torah, Prayer',
        collectiveTitle: undefined, category: 'Halakhah', anchorRef: 'Commentary Test, S1:1', sourceHasEn: false},
      expect.objectContaining({sourceRef: 'Mishneh Torah, Prayer 1:2-3', anchorRef: 'Commentary Test, S1:2'}),
    ]);
    expect(relatedFromIndex(map, 'Mishneh Torah, Prayer 1')).toEqual([
      expect.objectContaining({sourceRef: 'Commentary Test, S1:1', sourceHeRef: 'פירוש בדיקה, פרק א 1', category: 'Commentary', anchorRef: 'Mishneh Torah, Prayer 1:1'}),
      expect.objectContaining({sourceRef: 'Commentary Test, S1:2', category: 'Commentary', anchorRef: 'Mishneh Torah, Prayer 1:2'}),
    ]);
    // (the notes are not downloaded: nothing for that link yet)
    expect(relatedFromIndex(map, 'Commentary Test, S2')).toEqual([]);
  });

  test('a link to another Otzaria book counts once that book is downloaded too', () => {
    const map = buildIndex([book, notes]);
    expect(relatedFromIndex(map, 'Commentary Test, S2')).toEqual([
      expect.objectContaining({sourceRef: 'Notes Test, S0:2', category: 'Commentary', anchorRef: 'Commentary Test, S2:1'}),
    ]);
    expect(relatedFromIndex(map, 'Notes Test, S0')).toEqual([
      expect.objectContaining({sourceRef: 'Commentary Test, S2:1', category: 'Halakhah', anchorRef: 'Notes Test, S0:2'}),
    ]);
  });

  test('a book not in the library (the content filter hides it) gives no links', () => {
    const map = buildIndex([book]);
    Sefaria.textTitleForRef = ref => (ref.startsWith('Mishneh Torah, Prayer') ? 'Mishneh Torah, Prayer' : null);
    expect(relatedFromIndex(map, 'Mishneh Torah, Prayer 1')).toEqual([]);
  });

  test('added to the links API\'s response once', () => {
    const extra = [{anchorRef: 'X 1:1', sourceRef: 'Y 2:2'}, {anchorRef: 'X 1:2', sourceRef: 'Y 2:3'}];
    const response = {links: [{anchorRef: 'X 1:1', sourceRef: 'Y 2:2'}], sheets: []};
    expect(withExtraLinks(response, extra)).toEqual({links: [extra[0], extra[1]], sheets: []});
    expect(withExtraLinks(response, [])).toBe(response);
  });
});

describe('downloaded with the book', () => {
  const CATALOG = parseCatalog(JSON.stringify({
    'KSK/ספרים/אוצריא/הלכה/מפרשים/פירוש בדיקה.txt': {hash: 'v1'},
    'KSK/links/פירוש בדיקה_links.json': {hash: 'l1'},
  }), {restricted: [], permitted: {}, in_sefaria: []});
  const TOC = [{category: 'Halakhah', heCategory: 'הלכה', contents: [
    {title: 'Mishneh Torah, Prayer', heTitle: 'משנה תורה, הלכות תפילה', categories: ['Halakhah']}]}];

  beforeEach(async () => {
    FileSystem.clear();
    await AsyncStorage.clear();
    extras._reset({enabled: {otzaria: true}, catalogs: {otzaria: {fetchedAt: Date.now(), entries: CATALOG}}});
    extras.applyToToc(TOC);
    global.fetch = jest.fn(async url => {
      if (url.endsWith(encodeURIComponent('פירוש בדיקה') + '.txt')) { return {ok: true, status: 200, text: async () => BOOK}; }
      if (url.endsWith(encodeURIComponent('פירוש בדיקה_links.json'))) { return {ok: true, status: 200, text: async () => JSON.stringify(RAW)}; }
      return {ok: false, status: 404, text: async () => ''};
    });
    global.Sefaria = {
      textTitleForRef: ref => ['Mishneh Torah, Prayer', 'פירוש בדיקה'].find(t => ref.startsWith(t)) || null,
      primaryCategoryForTitle: () => 'Halakhah',
      categoriesForTitle: () => ['Halakhah'],
    };
  });
  afterEach(() => { delete global.fetch; delete global.Sefaria; });

  test('the links file comes from Otzaria\'s server with the book; deleting the book deletes it', async () => {
    await extras.downloadBook('פירוש בדיקה');
    expect(global.fetch.mock.calls[1][0]).toMatch(/^https:\/\/raw\.githubusercontent\.com\/Otzaria\/otzaria-library\/main\/KSK\/links\//);
    const onSefaria = await extras.extraLinksFor('Mishneh Torah, Prayer 1');
    expect(onSefaria.map(l => [l.anchorRef, l.sourceRef, l.category])).toEqual([
      ['Mishneh Torah, Prayer 1:1', 'פירוש בדיקה, S1:1', 'Commentary'],
      ['Mishneh Torah, Prayer 1:2', 'פירוש בדיקה, S1:2', 'Commentary'],
    ]);
    const onBook = await extras.withExtraLinks('פירוש בדיקה, S1', {links: []});
    expect(onBook.links.map(l => l.sourceRef)).toEqual(['Mishneh Torah, Prayer 1:1', 'Mishneh Torah, Prayer 1:2-3']);
    await extras.deleteBook('פירוש בדיקה');
    expect(await extras.extraLinksFor('Mishneh Torah, Prayer 1')).toEqual([]);
  });
});
