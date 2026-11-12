/**
 * The two Wikisource books Sofer makes into other books than the site's page, which the phone's
 * Wikisource source does not convert (extras/wikisourceBooks.json left_out), offered from the
 * Sofer Library instead (tools/library-export/build_sofer_library.py: wikitext_not_on_phone):
 * Megillat Antiochus in Rabbi Menashe Zelicha's edition with its Targum (wikisource.VERSIONS),
 * and Chashukei Chemed on each masechta, arranged by amud (wikisource.BY_MASECHTA).
 *
 * The catalogue entries below are the release's own (sofer-library-2026-11-11b), metadata only.
 */
import {parseCatalog, ID} from '../extras/sofer';
import {chooseBooks, addToToc} from '../extras/catalog';
import {tocItem} from '../extras/schema7';
import {CHOICES, configForPreset} from '../shomer/presets';
import {bookMatch} from '../shomer/matcher';
import WIKISOURCE from '../extras/wikisourceBooks.json';

const MEGILLAH = 'Megillat Antiochus (Rabbi Menashe Zelicha edition)';
const TARGUM = 'Targum Megillat Antiochus (Rabbi Menashe Zelicha edition)';
const BERAKHOT = 'Chashukei Chemed on Berakhot';
const SHARED = {kind: 'wikisource', license: ['CC-BY-SA'], md5: null, sha256: 'a'.repeat(64)};
const notes = (title, heTitle, base, categories, heCategories, firstSection) => ({
  ...SHARED, title, heTitle, categories, heCategories, firstSection, dependence: 'Commentary',
  base_text_titles: [base], companionOf: base, file: `book-${title.length}.zip`, size: 5000,
});

const CATALOG = {
  format: 1,
  source: ID,
  books: [
    {
      ...SHARED, title: BERAKHOT, heTitle: 'חשוקי חמד על ברכות', categories: ['Talmud'], heCategories: ['תלמוד'],
      firstSection: `${BERAKHOT} 2a`, dependence: 'Commentary', base_text_titles: ['Berakhot'],
      file: 'Chashukei-Chemed-on-Berakhot-06f169d2.zip', size: 399161,
      companions: [notes('הערות המהדיר על חשוקי חמד על ברכות', 'הערות המהדיר על חשוקי חמד על ברכות', BERAKHOT,
        ['Talmud'], ['תלמוד'], 'הערות המהדיר על חשוקי חמד על ברכות 2a:1')],
    },
    {
      ...SHARED, title: MEGILLAH, heTitle: 'מגילת אנטיוכוס (מהדורת הרב מנשה זליכה)', categories: ['Second Temple'],
      heCategories: ['בית שני'], firstSection: `${MEGILLAH}, S1`,
      file: 'Megillat-Antiochus-Rabbi-Menashe-Zelicha-edition-b9ac8694.zip', size: 12449,
      companions: [notes('הערות המהדיר על מגילת אנטיוכוס', 'הערות המהדיר על מגילת אנטיוכוס', MEGILLAH,
        ['Second Temple'], ['בית שני'], 'הערות המהדיר על מגילת אנטיוכוס, S1 1')],
    },
    {
      ...SHARED, title: TARGUM, heTitle: 'תרגום מגילת אנטיוכוס (מהדורת הרב מנשה זליכה)', categories: ['Second Temple'],
      heCategories: ['בית שני'], firstSection: `${TARGUM}, S1`, dependence: 'Targum', base_text_titles: [MEGILLAH],
      file: 'Targum-Megillat-Antiochus-Rabbi-Menashe-Zelicha-edition-ef0ece56.zip', size: 8103,
    },
  ],
};

// Sefaria's own copies (its toc): Megillat Antiochus among the Apocrypha, Berakhot in the Bavli
const SEFARIA_TOC = [
  {category: 'Talmud', heCategory: 'תלמוד', contents: [{category: 'Bavli', heCategory: 'בבלי', contents: [
    {title: 'Berakhot', heTitle: 'ברכות'}]}]},
  {category: 'Second Temple', heCategory: 'בית שני', contents: [{category: 'Apocrypha', heCategory: 'ספרים חיצוניים',
    contents: [{title: 'Megillat Antiochus', heTitle: 'מגילת אנטיוכוס'}]}]},
];

describe('Wikisource books from the Sofer Library (Megillat Antiochus, Chashukei Chemed)', () => {
  const entries = parseCatalog(CATALOG);

  test('the phone\'s Wikisource leaves them to the Sofer Library', () => {
    const left = Object.fromEntries(WIKISOURCE.left_out.map(x => [x.page, x.why]));
    expect(left['חשוקי חמד']).toBe('split by masechta (in the Sofer Library)');
    expect(left['מגילת אנטיוכוס (מהדורת הרב מנשה זליכה)']).toBe('several versions on one page (in the Sofer Library)');
    const ids = new Set(WIKISOURCE.books.map(b => b.page));
    expect(ids.has('חשוקי חמד')).toBe(false);
    expect(ids.has('מגילת אנטיוכוס (מהדורת הרב מנשה זליכה)')).toBe(false);
  });

  test('each comes with its kind, its place (a commentary by amud, a Targum) and its editors\' notes', () => {
    const by = Object.fromEntries(entries.map(e => [e.title, e]));
    expect(by[BERAKHOT]).toMatchObject({kind: 'wikisource', dependence: 'Commentary', base_text_titles: ['Berakhot'],
      firstSection: 'Chashukei Chemed on Berakhot 2a', license: 'CC-BY-SA'});
    expect(by[BERAKHOT].companions.map(c => c.firstSection)).toEqual(['הערות המהדיר על חשוקי חמד על ברכות 2a:1']);
    expect(by[TARGUM]).toMatchObject({dependence: 'Targum', base_text_titles: [MEGILLAH]});
    expect(by[MEGILLAH].companions.map(c => c.base_text_titles)).toEqual([[MEGILLAH]]);
    expect(tocItem(by[TARGUM])).toMatchObject({dependence: 'Targum', base_text_titles: [MEGILLAH]});
  });

  test('kept beside Sefaria\'s Megillat Antiochus (another edition: its edition in its Hebrew name), not in its place', () => {
    const {books, skipped} = chooseBooks(SEFARIA_TOC, {[ID]: entries});
    expect(Object.keys(books).sort()).toEqual([BERAKHOT, MEGILLAH, TARGUM].sort());
    expect(skipped.duplicate).toBe(0);
    const toc = addToToc(SEFARIA_TOC, books);
    const second = toc.find(c => c.category === 'Second Temple');
    expect(second.contents.find(c => c.category === 'Apocrypha').contents.map(b => b.title)).toEqual(['Megillat Antiochus']);
    expect(second.contents.filter(b => b.title).map(b => b.title)).toEqual([MEGILLAH, TARGUM]);
    const talmud = toc.find(c => c.category === 'Talmud');
    expect(talmud.contents.find(b => b.title === BERAKHOT))
      .toMatchObject({dependence: 'Commentary', base_text_titles: ['Berakhot']});
    // (downloaded, it opens at its first amud, as the release's catalogue says)
    const after = addToToc(SEFARIA_TOC, books, {[BERAKHOT]: books[BERAKHOT].firstSection});
    expect(after.find(c => c.category === 'Talmud').contents.find(b => b.title === BERAKHOT).firstSection)
      .toBe('Chashukei Chemed on Berakhot 2a');
  });

  test('the content filter shows them at every preset (Megillat Antiochus is no sefer chitzoni)', () => {
    for (const p of CHOICES) {
      for (const e of entries.concat(...entries.map(x => x.companions || []))) {
        expect(bookMatch(configForPreset(p.id), {title: e.title, heTitle: e.heTitle})).toBeNull();
      }
    }
  });
});
