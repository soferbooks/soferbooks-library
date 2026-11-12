/**
 * The rebuilt Sofer Library release (2026-11-12): its catalogue gives each book's English name and
 * other names, and names the zips of the release before whose text is the same (only the sections'
 * metadata changed: prev/next, the default node's names, Hebrew refs), so a phone that has one is
 * not sent the book again. And the Gemara as the loose placement reads it on the phone (extras/
 * links.js): the whole masechta, Rashi's and Tosafos' lines, the perakim.
 *
 * SYNTHETIC TEST FIXTURE: the catalogue entries, Gemara and comments below are made up (not real
 * texts); they have the shape build_sofer_library.py and Sefaria's files have.
 */
import * as extras from '../extras';
import {entryFor} from '../extras/sofer';
import {tocItem} from '../extras/schema7';
import {localNameResults} from '../search/localAutocomplete';
import {inferAll, perekAmuds} from '../extras/links';

const SL = 'Shuvu Lachem LeOhaleichem';
const BOOK = {
  title: SL, heTitle: 'שובו לכם לאהליכם', kind: 'ben-david', categories: ['Jewish Thought'], heCategories: ['מחשבת ישראל'],
  file: 'Shuvu-Lachem-LeOhaleichem-1.zip', sha256: 'new', md5: 'm', size: 10, firstSection: `${SL}, S1`,
  enTitle: SL, titleVariants: ['Return to Your Homes'], heTitleVariants: ['שובו לכם לאהליכם (באנגלית)'], sameTextAs: ['old'],
};
const POEMS = {
  title: 'שירי בדיקה', heTitle: 'שירי בדיקה', kind: 'ben-yehuda', categories: ['Poetry'], file: 'book-1.zip', sha256: 'new2',
};

describe('the catalogue\'s names and the zips with the same text', () => {
  test('kept from the catalogue', () => {
    const e = entryFor(BOOK);
    expect(e).toMatchObject({enTitle: SL, titleVariants: ['Return to Your Homes'],
      heTitleVariants: ['שובו לכם לאהליכם (באנגלית)'], sameTextAs: ['old']});
    expect(entryFor({...BOOK, titleVariants: 'x', sameTextAs: [1, '']})).not.toHaveProperty('sameTextAs');
    expect(tocItem({...e, source: 'sofer_library'})).toMatchObject({titleVariants: ['Return to Your Homes']});
  });

  test('a phone with the release before\'s zip of the same text is not sent the book again', () => {
    const entries = [entryFor(BOOK), entryFor(POEMS)].map(e => ({...e, source: 'sofer_library'}));
    const installed = {
      [SL]: {source: 'sofer_library', id: SL, hash: 'old', converter: 1},
      'שירי בדיקה': {source: 'sofer_library', id: 'שירי בדיקה', hash: 'old2', converter: 1},
    };
    extras._reset({enabled: {sofer_library: true}, state: {installed, blocked: {}},
      catalogs: {sofer_library: {fetchedAt: Date.now(), entries}}});
    extras.applyToToc([]);
    expect(extras.booksToUpdate('sofer_library')).toEqual(['שירי בדיקה']);
    // (its English name, from the catalogue; a book named only in Hebrew has none)
    expect(extras.englishTitleOf(SL)).toBe(SL);
    expect(extras.englishTitleOf('שירי בדיקה')).toBe(null);
  });
});

describe('the search box finds a book by its other names', () => {
  beforeEach(() => {
    global.Sefaria = {
      booksDict: {[SL]: 1, Genesis: 1},
      index: t => ({[SL]: {heTitle: 'שובו לכם לאהליכם', titleVariants: ['Return to Your Homes']},
        Genesis: {heTitle: 'בראשית'}}[t]),
      toc: [],
    };
  });
  afterEach(() => { delete global.Sefaria; });

  test('"Return to Your Homes" finds Shuvu Lachem LeOhaleichem, shown by its own name', () => {
    expect(localNameResults('Return to').completion_objects).toEqual([{title: SL, key: SL, type: 'ref', is_primary: true}]);
    expect(localNameResults('homes').completion_objects.map(c => c.key)).toEqual([SL]);
    expect(localNameResults('gen').completion_objects.map(c => c.key)).toEqual(['Genesis']);
  });
});

describe('the Gemara as the loose placement reads it on the phone', () => {
  test('the perakim from the index\'s alt structure (mg_books._perek_amuds)', () => {
    expect(perekAmuds({alts: {Chapters: {nodes: [{wholeRef: 'Gittin 2a:1-15a:7'}, {wholeRef: 'Gittin 15a:8-24b:3'}]}}}))
      .toEqual([[2, 28], [28, 47]]);
    expect(perekAmuds(null)).toEqual([]);
  });

  test('the whole masechta and Rashi\'s lines (the offline files give one line at a time)', async () => {
    const gemara = {
      'M 2a': ['אלף בית גימל דלת', 'הא וו זין חית'],
      'M 2b': ['טית יוד כף למד', 'מם נון סמך עין'],
      'M 3a': ['פא צדי קוף ריש', 'שין תו אלף בית'],
    };
    const rashi = {'Rashi on M 2b': ['<b>טית</b> פירוש'], 'Rashi on M 2b:1': ['<b>טית</b> פירוש'], 'Rashi on M 2b:2': ['<b>מם נון</b> פירוש רש"י כאן']};
    const asked = [];
    const loadSection = async ref => {
      asked.push(ref);
      if (gemara[ref] || rashi[ref]) { return gemara[ref] || rashi[ref]; }
      throw new Error('no such section');
    };
    const comm = {heTitle: 'פירוש בדיקה על מסכת', secs: [
      ['X, S1', 'X, S1', ['S1'], ['דף ב.'], ['', '', ''], ['גמ\' אלף בית גימל', 'גמ\' הא וו זין', 'בפירש"י בד"ה מם נון וכו\' קשה']],
      ['X, S2', 'X, S2', ['S2'], ['דף ג.'], [''], ['גמ\' פא צדי קוף']],
    ]};
    const files = {X: comm};
    const books = [{key: 'sefaria:M', kind: 'sefaria', title: 'M', heTitle: 'מסכת', categories: ['Talmud', 'Bavli']}];
    const done = await inferAll({files, books, loadSection, loadIndex: async () => ({schema: {lengths: [6]}})});
    expect(done).toEqual(['X']);
    expect(comm.inferred.map(l => [l.a, l.t, l.c])).toEqual([
      ['X, S1:1', 'M 2a:1', 'sure'],
      ['X, S1:2', 'M 2a:2', 'sure'],
      ['X, S1:3', 'M 2b:2', 'sure'],         // (on Rashi's dibbur, on the line it is on)
      ['X, S2:1', 'M 3a:1', 'sure'],
    ]);
    // (amud by amud to the masechta's end, as its index says; Rashi's 2b line by line)
    expect(asked.filter(r => /^M /.test(r))).toEqual(['M 2a', 'M 2b', 'M 3a', 'M 3b']);
    expect(asked).toContain('Rashi on M 2b:2');
  });
});
