/**
 * Fixes from the second emulator QA round (qa-screens/round2): the reader keeping its passage
 * across display changes, extra books' section keys and names, counts of one, the search filter
 * count, the footer highlight, the tab labels.
 */
import {
  createAnchor, anchorCorrection, pickVisibleAnchor, ANCHOR_TOP_INSET,
} from '../reader/scrollAnchor';
import { displayMenuTop, READER_HEADER_HEIGHT } from '../reader/panelLayout';
import {
  isSectionKey, nodeEnTitle, refHasSectionKeys, displayRef, readableUrl,
} from '../extras/schema7';
import { withCurrentShelf, CATEGORY, CATEGORY_HE } from '../extras/wikisource';
import { isUnpackedFileOf } from '../extras';
import { tabLabel } from '../tabs/ReaderTabBar';
import { TabMetadata } from '../PageHistory';
import { appliedFilterCount } from '../search/SearchResultPage';
import { isolate } from '../LocalizedStrings';
import Sefaria from '../sefaria';

describe('a display change keeps the passage the reader is on', () => {
  test('the passage starting near the top of the screen is kept where it is', () => {
    const cells = [{ ref: 'Genesis 25:28', y: 900 }, { ref: 'Genesis 25:29', y: 1260 }, { ref: 'Genesis 25:30', y: 1700 }];
    // scrolled so 25:29 starts 40px below the top of the list
    expect(pickVisibleAnchor(cells, 1220, 800)).toEqual({ ref: 'Genesis 25:29', inset: 40 });
  });

  test('a long passage covering the top of the screen is kept, at its (negative) offset', () => {
    const cells = [{ ref: 'A 1:1', y: 0 }, { ref: 'A 1:2', y: 3000 }];
    expect(pickVisibleAnchor(cells, 1000, 800)).toEqual({ ref: 'A 1:1', inset: -1000 });
    expect(pickVisibleAnchor([], 0, 800)).toBeNull();
  });

  test('the anchor holds its own inset; the default is the jump position', () => {
    expect(createAnchor('A 1:3', 1000).inset).toBe(ANCHOR_TOP_INSET);
    expect(createAnchor('A 1:3', 1000, 40).inset).toBe(40);
    // the rows above grew by 500px (commentary under each passage): scroll so the passage stays 40px down
    expect(anchorCorrection({ cellY: 1760, currentY: 1220, inset: 40 })).toEqual({ offset: 1720, seek: false });
    expect(anchorCorrection({ cellY: 1260, currentY: 1220, inset: 40 })).toBeNull();
  });

  test('the display menu opens below the schedule bar, which stays in view', () => {
    expect(displayMenuTop(0, 0)).toBeUndefined();
    expect(displayMenuTop(38, 0)).toBe(READER_HEADER_HEIGHT + 38);
    expect(displayMenuTop(38, 72)).toBe(READER_HEADER_HEIGHT + 38 + 72);
  });
});

describe("extra books: Sofer's section keys are not shown as names", () => {
  test('keys are recognised in names and refs', () => {
    expect(isSectionKey('S0')).toBe(true);
    expect(isSectionKey('S2_3')).toBe(true);
    expect(isSectionKey('Shemot')).toBe(false);
    expect(nodeEnTitle('S1')).toBe('');
    expect(nodeEnTitle('Introduction')).toBe('Introduction');
    expect(refHasSectionKeys('חבור יפה מהישועה, S0')).toBe(true);
    expect(refHasSectionKeys('Chayei Aryeh – Salanter, S1, S2 4')).toBe(true);
    expect(refHasSectionKeys('Shulchan Arukh, Orach Chayim 447:11')).toBe(false);
    expect(refHasSectionKeys('Sefer HaChinukh, Shemot 5')).toBe(false);
  });

  test('a keyed ref shows as its Hebrew ref; without one the keys are left out', () => {
    expect(displayRef('חבור יפה מהישועה, S0', 'חבור יפה מהישועה, פתיחה')).toBe('חבור יפה מהישועה, פתיחה');
    expect(displayRef('חבור יפה מהישועה, S0 3', 'חבור יפה מהישועה, פתיחה')).toBe('חבור יפה מהישועה, פתיחה 3');
    expect(displayRef('חבור יפה מהישועה, S0 3', null)).toBe('חבור יפה מהישועה 3');
    expect(displayRef('Genesis 25', 'בראשית כ״ה')).toBe('Genesis 25');
  });

  test('a web address is shown decoded', () => {
    expect(readableUrl('https://he.wikisource.org/wiki/%D7%90%D7%95%D7%A8_%D7%A8%D7%A9%22%D7%96'))
      .toBe('https://he.wikisource.org/wiki/אור_רש"ז');
    expect(readableUrl('100% sure')).toBe('100% sure');
    expect(readableUrl('bad %E0%A4%A')).toBe('bad %E0%A4%A');
  });
});

describe('the Wikisource shelf is named as in Settings', () => {
  test('new entries go under Wikisource; old catalogues are moved there', () => {
    expect(CATEGORY).toBe('Wikisource');
    expect(CATEGORY_HE.Wikisource).toBe('ויקיטקסט');
    const old = { title: 'x', categories: ['Musar', 'Wikitext', 'Notes'] };
    expect(withCurrentShelf(old).categories).toEqual(['Musar', 'Wikisource', 'Notes']);
    const otz = { title: 'y', categories: ['Halakhah', 'Otzaria'] };
    expect(withCurrentShelf(otz)).toBe(otz);
  });
});

describe('a deleted extra book leaves no unpacked sections behind', () => {
  test('the files offline.js unpacked from its zip, and only those', () => {
    const t = 'אור רש-ז';
    expect(isUnpackedFileOf('אור רש-ז, S1.metadata.json', t)).toBe(true);
    expect(isUnpackedFileOf('אור רש-ז, S1, S0_2.1a2b3c4d.he.json', t)).toBe(true);
    expect(isUnpackedFileOf('אור רש-ז.metadata.json', t)).toBe(true);
    expect(isUnpackedFileOf('אור רש-ז אחר, S1.metadata.json', t)).toBe(false);
    expect(isUnpackedFileOf('Genesis 1.metadata.json', t)).toBe(false);
    expect(isUnpackedFileOf('אור רש-ז, S1.metadata.txt', t)).toBe(false);
  });
});

describe('tab labels name the passage', () => {
  beforeAll(() => {
    Sefaria.booksDict['Shulchan Arukh, Orach Chayim'] = 1;
  });

  test("a tab opened at a se'if says so, in both languages", () => {
    const tab = {
      title: 'Shulchan Arukh, Orach Chayim', ref: 'Shulchan Arukh, Orach Chayim 447',
      heRef: 'שולחן ערוך, אורח חיים תמ״ז', segmentRef: 'Shulchan Arukh, Orach Chayim 447:11',
    };
    expect(tabLabel(tab, false)).toBe('Shulchan Arukh, Orach Chayim 447:11');
    expect(tabLabel(tab, true)).toMatch(/^שולחן ערוך, אורח חיים תמ״ז:/);
    expect(tabLabel({ ...tab, segmentRef: null }, false)).toBe('Shulchan Arukh, Orach Chayim 447');
    // a place in another section is not this section's
    expect(tabLabel({ ...tab, segmentRef: 'Shulchan Arukh, Orach Chayim 448:1' }, false)).toBe('Shulchan Arukh, Orach Chayim 447');
  });

  test("an extra book's tab shows its Hebrew section names", () => {
    expect(tabLabel({ title: 'חבור יפה מהישועה', ref: 'חבור יפה מהישועה, S0', heRef: 'חבור יפה מהישועה, פתיחה' }, false))
      .toBe('חבור יפה מהישועה, פתיחה');
  });
});

describe('search and footer', () => {
  test('"Exact Matches Only" counts as a filter', () => {
    const state = { appliedFilters: ['Tanakh'], field: 'naive_lemmatizer', fieldExact: 'exact', fieldBroad: 'naive_lemmatizer' };
    expect(appliedFilterCount(state)).toBe(1);
    expect(appliedFilterCount({ ...state, field: 'exact' })).toBe(2);
    expect(appliedFilterCount({ ...state, appliedFilters: [], field: 'exact' })).toBe(1);
    expect(appliedFilterCount(null)).toBe(0);
  });

  test("the footer highlights the page that is showing (home after a text opened from search)", () => {
    expect(TabMetadata.selectedTabName('navigation', 'Search')).toBe('Texts');
    expect(TabMetadata.selectedTabName('autocomplete', 'Texts')).toBe('Search');
    expect(TabMetadata.selectedTabName('search', 'Search')).toBe('Search');
    expect(TabMetadata.selectedTabName(null, 'Search')).toBe('Search');   // the reader: its tab's
  });
});

describe('a Hebrew title inside an English sentence', () => {
  test('is isolated, so the sentence keeps its direction', () => {
    expect(isolate('זמרת הארץ')).toBe('⁨זמרת הארץ⁩');
  });
});
