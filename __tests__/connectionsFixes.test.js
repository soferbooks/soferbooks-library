/**
 * Mordy's reader test (2026-11-11): the commentary's own text size, a source in the connections
 * panel read three ways (here / new tab / underneath), its dibbur hamaschil in bold there and
 * under each passage, and "ספרות עזר" listed twice on Niddah 2a:1.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import ActionSheet from 'react-native-action-sheet';
import Sefaria from '../sefaria';
import strings from '../LocalizedStrings';
import { reducer, DEFAULT_STATE, STATE_ACTIONS, GlobalStateContext, clampCommentaryFontScale, commentaryFontSize } from '../StateManager';
import { openLinkActionSheet } from '../Misc';
import TextList from '../TextList';
import { inlineKeyForRef } from '../reader/inlineCommentaryPrefs';
import { commentRuns } from '../reader/InlineCommentary';
import { buildIndex } from '../extras/links';

describe('"ספרות עזר" once: categories with the same name are one entry', () => {
  const heNames = {Guides: 'ספרות עזר', Reference: 'ספרות עזר', Talmud: 'תלמוד', Commentary: 'מפרשים'};
  const heName = c => heNames[c] || c;
  const book = (title, refs, extra = false) => ({title, heTitle: title, count: 1, category: '?', refSet: new Set(refs),
    heRefSet: new Set(refs), hasEn: false, extra});

  test('two categories named alike merge; a book in both once, its refs each once', () => {
    const summary = {
      Commentary: {count: 0, books: {}, hasEn: false},
      Guides: {count: 1, books: {'Introductions to the Babylonian Talmud': book('Introductions to the Babylonian Talmud', ['Intro, Niddah 1'])}},
      Reference: {count: 2, books: {
        'מילון': book('מילון', ['מילון 1', 'מילון 2'], true),
        'Introductions to the Babylonian Talmud': book('Introductions to the Babylonian Talmud', ['Intro, Niddah 1', 'Intro, Niddah 2']),
      }},
      Talmud: {count: 1, books: {Berakhot: book('Berakhot', ['Berakhot 2a:1'])}},
    };
    const out = Sefaria.links.mergeSameNamedCategories(summary, heName, ['Tanakh', 'Talmud', 'Reference']);
    expect(Object.keys(out)).toEqual(['Commentary', 'Reference', 'Talmud']);   // (Sefaria's top category kept)
    const ref = out.Reference;
    expect(Object.keys(ref.books).sort()).toEqual(['Introductions to the Babylonian Talmud', 'מילון']);
    expect([...ref.books['Introductions to the Babylonian Talmud'].refSet]).toEqual(['Intro, Niddah 1', 'Intro, Niddah 2']);
    expect(ref.books['מילון'].category).toBe('Reference');
    expect(ref.books['מילון'].extra).toBe(true);
    expect(out.Talmud).toBe(summary.Talmud);
  });

  test('quotes, spaces and capitals aside', () => {
    const names = {Responsa: 'שו״ת', 'שו"ת': 'שו"ת', Commentary: 'מפרשים'};
    const out = Sefaria.links.mergeSameNamedCategories({
      Responsa: {books: {A: book('A', ['A 1'])}},
      'שו"ת': {books: {B: book('B', ['B 1'])}},
      Commentary: {books: {C: book('C', ['C 1'])}},
      commentary: {books: {D: book('D', ['D 1'])}},
    }, c => names[c] || c, ['Responsa']);
    expect(Object.keys(out)).toEqual(['Responsa', 'Commentary']);
    expect(Object.keys(out.Responsa.books)).toEqual(['A', 'B']);
    expect(Object.keys(out.Commentary.books)).toEqual(['C', 'D']);
  });

  describe('the panel of a passage with both (as Niddah 2a:1)', () => {
    let saved;
    beforeEach(() => {
      saved = {index: Sefaria._index, list: Sefaria._commentatorListBySection, he: Sefaria.hebrewCategories,
        top: Sefaria.topLevelCategories};
      Sefaria._commentatorListBySection = {};
      Sefaria._index = {
        'Introductions to the Babylonian Talmud': {heTitle: 'הקדמות לתלמוד הבבלי'},
        'ספר עזר': {heTitle: 'ספר עזר'},
      };
      // (Sefaria's names, with the extra books' "Reference" as theirs: extras/index.js)
      Sefaria.hebrewCategories = {Guides: 'ספרות עזר', Reference: 'ספרות עזר', Talmud: 'תלמוד'};
      Sefaria.topLevelCategories = ['Tanakh', 'Mishnah', 'Talmud', 'Reference'];
    });
    afterEach(() => {
      Sefaria._index = saved.index;
      Sefaria._commentatorListBySection = saved.list;
      Sefaria.hebrewCategories = saved.he;
      Sefaria.topLevelCategories = saved.top;
    });
    test('one "ספרות עזר", with every source of both, each once', () => {
      const link = (textTitle, sourceRef, category) => ({category, textTitle, sourceRef, sourceHeRef: sourceRef, sourceHasEn: false});
      const summary = Sefaria.links.linkSummary('Niddah 2a', [
        link('Introductions to the Babylonian Talmud', 'Introductions to the Babylonian Talmud, Niddah, Introduction to Niddah 1', 'Guides'),
        link('ספר עזר', 'ספר עזר 1:1', 'Reference'),
        link('ספר עזר', 'ספר עזר 1:1', 'Reference'),
      ], 'hebrew');
      const named = summary.filter(c => Sefaria.hebrewCategory(c.category) === 'ספרות עזר');
      expect(named).toHaveLength(1);
      expect(named[0].count).toBe(2);
      expect(named[0].books.map(b => b.title).sort()).toEqual(['Introductions to the Babylonian Talmud', 'ספר עזר']);
    });
  });
});

describe('the commentary\'s own text size', () => {
  test('remembered (saved), within limits, and the size it gives', () => {
    let state = reducer(DEFAULT_STATE, {type: STATE_ACTIONS.setCommentaryFontScale, value: 1.1, fromAsync: true});
    expect(state.commentaryFontScale).toBe(1.1);
    state = reducer(state, {type: STATE_ACTIONS.setCommentaryFontScale, value: 9, fromAsync: true});
    expect(state.commentaryFontScale).toBe(2);
    expect(clampCommentaryFontScale(0.1)).toBe(0.6);
    expect(clampCommentaryFontScale(undefined)).toBe(1);
    expect(DEFAULT_STATE.commentaryFontScale).toBe(1);
    expect(commentaryFontSize(20, 1.5)).toBe(30);
    expect(commentaryFontSize(20, undefined)).toBe(20);
  });

  test('saved under its own key', () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const spy = jest.spyOn(AsyncStorage, 'setItem');
    reducer(DEFAULT_STATE, {type: STATE_ACTIONS.setCommentaryFontScale, value: 0.9});
    expect(spy).toHaveBeenCalledWith('commentaryFontScale', '0.9');
    spy.mockRestore();
  });

  test('the Aa menu: "Commentary Size", its buttons smaller and larger', () => {
    const ReaderDisplayOptionsMenu = require('../ReaderDisplayOptionsMenu').default;
    const {getTheme} = require('../StateManager');
    const incrementCommentaryFont = jest.fn();
    strings.setLanguage('en');
    let tree;
    act(() => {
      tree = renderer.create(<ReaderDisplayOptionsMenu theme={getTheme('white')} themeStr="white" interfaceLanguage="english"
        textLanguage="hebrew" canHaveAliyot={false} canBeContinuous={false} showAliyot={false}
        incrementFont={jest.fn()} incrementCommentaryFont={incrementCommentaryFont} />);
    });
    const label = tree.root.findAll(n => n.props && n.props.label === 'Commentary Size');
    expect(label.length).toBeGreaterThan(0);
    const buttons = label[0].props.content;
    act(() => { buttons[1].props.onPress('larger'); });
    expect(buttons.map(b => b.props.option)).toEqual(['smaller', 'larger']);
    expect(buttons[1].props.onPress).toBe(incrementCommentaryFont);
  });
});

describe('a source tapped in the panel: three ways to read it', () => {
  beforeEach(() => { jest.spyOn(ActionSheet, 'showActionSheetWithOptions').mockImplementation(() => {}); });
  afterEach(() => { ActionSheet.showActionSheetWithOptions.mockRestore(); });

  const choose = i => ActionSheet.showActionSheetWithOptions.mock.calls[0][1](i);

  test('Open here, Open in new tab, Show underneath, Cancel', () => {
    strings.setLanguage('en');
    const openHere = jest.fn(); const openInNewTab = jest.fn(); const showUnderneath = jest.fn();
    openLinkActionSheet({refStr: 'Rashi on Niddah 2a:1:1', heRefStr: 'רש"י על נדה ב. א:א', interfaceLanguage: 'english',
      openHere, openInNewTab, showUnderneath, shownUnderneath: false});
    const [opts] = ActionSheet.showActionSheetWithOptions.mock.calls[0];
    expect(opts.options).toEqual(['Open here', 'Open in new tab', 'Show underneath', 'Cancel']);
    expect(opts.cancelButtonIndex).toBe(3);
    expect(opts.title).toBe('Rashi on Niddah 2a:1:1');
    choose(0); choose(1); choose(2); choose(3);
    expect(openHere).toHaveBeenCalledTimes(1);
    expect(openInNewTab).toHaveBeenCalledTimes(1);
    expect(showUnderneath).toHaveBeenCalledTimes(1);
  });

  test('shown already: "Stop showing underneath"; none offered without its handler', () => {
    strings.setLanguage('he');
    openLinkActionSheet({refStr: 'X 1', heRefStr: 'א א', interfaceLanguage: 'hebrew', openHere: () => {},
      openInNewTab: null, showUnderneath: () => {}, shownUnderneath: true});
    const [opts] = ActionSheet.showActionSheetWithOptions.mock.calls[0];
    expect(opts.options).toEqual(['פתחו כאן', 'הפסיקו להציג מתחת לכל קטע', strings.common.cancel]);
    expect(opts.title).toBe('א א');
    strings.setLanguage('en');
  });

  test('the key "Show underneath" uses: the loaded link\'s, else the collective title, else the book', () => {
    const related = {'Niddah 2a': [{links: [{sourceRef: 'Rashi on Niddah 2a:1:1', textTitle: 'Rashi on Niddah', collectiveTitle: 'Rashi', category: 'Commentary'}]}]};
    expect(inlineKeyForRef(related, 'Rashi on Niddah 2a:1:1')).toBe('Rashi');
    const title = r => r.replace(/ \d.*$/, '');
    expect(inlineKeyForRef({}, 'Tosafot on Niddah 2a:1:1', title, t => (t === 'Tosafot on Niddah' ? 'Tosafot' : null))).toBe('Tosafot');
    expect(inlineKeyForRef({}, 'Ein Mishpat 2a:1', title)).toBe('Ein Mishpat');
    expect(inlineKeyForRef({}, null)).toBe(null);
  });

  describe('the list item', () => {
    let saved;
    beforeEach(() => {
      saved = {textTitleForRef: Sefaria.textTitleForRef, index: Sefaria._index};
      Sefaria._index = {'Rashi on Niddah': {dependence: 'Commentary', primary_category: 'Commentary'}};
    });
    afterEach(() => { Sefaria.textTitleForRef = saved.textTitleForRef; Sefaria._index = saved.index; });

    const render = (props, state = {}) => {
      const filter = {refList: ['Rashi on Niddah 2a:1:1'], heRefList: ['רש"י על נדה ב. א:א'], category: 'Commentary',
        displayRef: () => false, listKey: i => `k${i}`};
      let tree;
      act(() => {
        tree = renderer.create(
          <GlobalStateContext.Provider value={{...DEFAULT_STATE, textLanguage: 'hebrew', ...state}}>
            <TextList recentFilters={[filter]} filterIndex={0} openRef={jest.fn()} loadContent={jest.fn()}
              textLanguage="hebrew" themeStr="white" fontSize={20}
              listContents={[{he: 'מאימתי קורין. משעה', en: '', sectionRef: 'Rashi on Niddah 2a:1'}]} {...props} />
          </GlobalStateContext.Provider>);
      });
      return tree;
    };

    test('a tap offers the three; a long press opens a new tab; the dibbur is bold', () => {
      const openRefHere = jest.fn(); const openRefInNewTab = jest.fn(); const showInline = jest.fn();
      const tree = render({openRefHere, openRefInNewTab, showInline, inlineCommentary: 'Rashi', inlineKeyFor: () => 'Rashi'});
      const item = tree.root.findAllByType(TouchableOpacity)[0];
      act(() => { item.props.onPress(); });
      const [opts] = ActionSheet.showActionSheetWithOptions.mock.calls[0];
      expect(opts.options.length).toBe(5);
      expect(opts.options[2]).toBe(strings.connections.stop_showing_underneath);
      expect(opts.options[3]).toBe(strings.common.copy);
      choose(2);
      expect(showInline).toHaveBeenCalledWith('Rashi on Niddah 2a:1:1');
      act(() => { item.props.onLongPress(); });
      expect(openRefInNewTab).toHaveBeenCalledWith('Rashi on Niddah 2a:1:1');
      const rendered = tree.root.findAll(n => n.props && n.props.source && typeof n.props.source.html === 'string');
      expect(rendered.map(n => n.props.source.html).join('')).toContain('<b>מאימתי קורין.</b> משעה');
    });

    test('the commentary size: the panel\'s text grows with it', () => {
      const sizeOf = tree => tree.root.findAll(n => n.props && n.props.classesStyles && n.props.classesStyles.hebrew)[0]
        .props.classesStyles.hebrew.fontSize;
      expect(sizeOf(render({openRefHere: jest.fn()}, {fontSize: 20, commentaryFontScale: 1}))).toBe(20);
      expect(sizeOf(render({openRefHere: jest.fn()}, {fontSize: 20, commentaryFontScale: 1.5}))).toBe(30);
    });
  });
});

describe('the commentary under each passage: bold dibbur, with or without nikud added', () => {
  test('commentRuns', () => {
    const t = {he: 'מאימתי קורין. משעה', heText: 'מאימתי קורין. משעה', heDibburBold: [true, true, false]};
    expect(commentRuns(t, t.heText, true)).toEqual([{text: 'מאימתי קורין.', bold: true}, {text: ' משעה', bold: false}]);
    expect(commentRuns(t, 'מֵאֵימָתַי קוֹרִין. מִשָּׁעָה', true)[0]).toEqual({text: 'מֵאֵימָתַי קוֹרִין.', bold: true});
    expect(commentRuns(t, t.heText, false)).toEqual([{text: t.heText, bold: false}]);   // (a targum, a connection)
    expect(commentRuns({he: '', en: ''}, 'א', true)).toEqual([{text: 'א', bold: false}]);
  });
});

describe('a downloaded extra book is a commentary when its links tie it to its text', () => {
  test('buildIndex: commentaries', () => {
    const map = buildIndex([
      {title: 'פירוש', links: [{a: 'פירוש, S1:1', t: 'Genesis 1:1', r: 'base'}]},
      {title: 'ספר', links: [{a: 'ספר, S1:1', t: 'Genesis 1:1', r: 'cite'}]},
      {title: 'מפרש', inferred: [{a: 'מפרש, S1:1', t: 'Genesis 1:2', r: 'base', c: 'sure'}]},
    ]);
    expect([...map.commentaries].sort()).toEqual(['מפרש', 'פירוש']);
  });
});

describe('panel height constant and offline link heRef alignment', () => {
  test('READER_HEADER_HEIGHT matches header + category color line (54)', () => {
    expect(require('../reader/panelLayout').READER_HEADER_HEIGHT).toBe(54);
  });

  test('linkSummary keeps refList and heRefList 1-to-1 when offline sourceHeRef is empty', () => {
    const savedIndex = Sefaria._index;
    const savedList = Sefaria._commentatorListBySection;
    Sefaria._index = { 'Rashi on Niddah': { heTitle: 'רש"י על נדה' } };
    Sefaria._commentatorListBySection = {};
    try {
      const summary = Sefaria.links.linkSummary('Niddah 32a', [
        { category: 'Commentary', textTitle: 'Rashi on Niddah', collectiveTitle: 'Rashi', heCollectiveTitle: 'רש"י', sourceRef: 'Rashi on Niddah 32a:1:1', sourceHeRef: '', sourceHasEn: false },
        { category: 'Commentary', textTitle: 'Rashi on Niddah', collectiveTitle: 'Rashi', heCollectiveTitle: 'רש"י', sourceRef: 'Rashi on Niddah 32a:1:2', sourceHeRef: '', sourceHasEn: false },
      ], 'hebrew');
      const rashi = summary.find(c => c.category === 'Commentary').books[0];
      expect(rashi.refList).toEqual(['Rashi on Niddah 32a:1:1', 'Rashi on Niddah 32a:1:2']);
      expect(rashi.heRefList).toHaveLength(2);
      expect(rashi.heRefList.every(Boolean)).toBe(true);
    } finally {
      Sefaria._index = savedIndex;
      Sefaria._commentatorListBySection = savedList;
    }
  });
});

describe('offlineOnline.loadRelated prefers offline Niddah links and fills sourceHeRef', () => {
  const api = require('../api');
  const offlineOnline = require('../offlineOnline');
  const { ERRORS } = require('../errors');

  let savedRelatedCache;
  let savedJsonSectionData;
  let savedIndex;
  let apiSpy;

  beforeEach(() => {
    savedRelatedCache = api._related;
    savedJsonSectionData = Sefaria._jsonSectionData;
    savedIndex = Sefaria._index;
    api._related = {};
    Sefaria._jsonSectionData = {};
    Sefaria._index = {
      ...savedIndex,
      Niddah: { title: 'Niddah', heTitle: 'נדה', categories: ['Talmud', 'Bavli'] },
      'Rashi on Niddah': { title: 'Rashi on Niddah', heTitle: 'רש"י על נדה', dependence: 'Commentary', categories: ['Talmud', 'Bavli', 'Rashi on Talmud'] },
    };
    apiSpy = jest.spyOn(api, 'related').mockResolvedValue({
      links: [{ category: 'Commentary', textTitle: 'Rashi on Niddah', sourceRef: 'Rashi on Niddah 32a:1:1', sourceHeRef: 'רש"י', anchorRef: 'Niddah 32a:1' }],
    });
  });

  afterEach(() => {
    apiSpy.mockRestore();
    api._related = savedRelatedCache;
    Sefaria._jsonSectionData = savedJsonSectionData;
    Sefaria._index = savedIndex;
  });

  test('when offline and section metadata is missing, loadRelated rejects with MISSING_OFFLINE_DATA', async () => {
    await expect(offlineOnline.loadRelated('Niddah 32a', false)).rejects.toBe(ERRORS.MISSING_OFFLINE_DATA);
    expect(apiSpy).not.toHaveBeenCalled();
  });

  test('when online and offline links exist, uses offline links with populated sourceHeRef without calling api.related', async () => {
    Sefaria._jsonSectionData['Niddah 32a|metadata'] = [
      { links: [[{ sourceRef: 'Rashi on Niddah 32a:1:1', sourceHeRef: '', category: 'Commentary', sourceHasEn: false }]] },
      'Niddah 32a',
    ];
    const res = await offlineOnline.loadRelated('Niddah 32a', true);
    expect(apiSpy).not.toHaveBeenCalled();
    expect(res.links).toHaveLength(1);
    expect(res.links[0].sourceRef).toBe('Rashi on Niddah 32a:1:1');
    expect(res.links[0].sourceHeRef).toBeTruthy();
  });

  test('when online and offline metadata is missing, falls back to api.related', async () => {
    const res = await offlineOnline.loadRelated('Niddah 32a', true);
    expect(apiSpy).toHaveBeenCalledWith('Niddah 32a');
    expect(res.links).toHaveLength(1);
  });
});

describe('TextColumn Next Daf selection, scroll tracking, and explicit bold detection', () => {
  const TextColumn = require('../TextColumn');

  let savedIndex;
  beforeEach(() => {
    savedIndex = Sefaria._index;
    Sefaria._index = {
      ...savedIndex,
      'Rashi on Niddah': { title: 'Rashi on Niddah', heTitle: 'רש"י על נדה', dependence: 'Commentary', categories: ['Talmud', 'Bavli', 'Rashi on Talmud'] },
    };
  });
  afterEach(() => {
    Sefaria._index = savedIndex;
  });

  const makeProps = (overrides = {}) => ({
    theme: {},
    themeStr: 'white',
    fontSize: 20,
    data: [
      [{ segmentNumber: '1', text: 's0-1', he: 'פתיחה פרק ראשון' }],
      [
        { segmentNumber: '1', text: 's1-1', he: '<b>ד"ה א</b> פירוש ראשון' },
        { segmentNumber: '2', text: 's1-2', he: '<b>ד"ה ב</b> פירוש שני' },
      ],
    ],
    sectionArray: ['Niddah 31b', 'Niddah 32a'],
    sectionHeArray: ['נדה לא:', 'נדה לב.'],
    textTitle: 'Rashi on Niddah',
    heTitle: 'רש"י על נדה',
    textFlow: 'segmented',
    textLanguage: 'hebrew',
    interfaceLanguage: 'hebrew',
    showAliyot: false,
    handleOpenURL: jest.fn(),
    shareCurrentSegment: jest.fn(),
    getDisplayedText: jest.fn(),
    biLayout: 'stacked',
    textUnavailableAlert: jest.fn(),
    textSegmentPressed: jest.fn(),
    setHighlightedWord: jest.fn(),
    updateTitle: jest.fn(),
    textListVisible: false,
    linksLoaded: [true, true],
    ...overrides,
  });

  test('maps Next Daf segments to real sectionIndex/itemIndex, handles large scroll jumps, and marks noAutoDibbur', () => {
    const props = makeProps();
    const tc = new TextColumn(props);
    tc.sectionListRef = { scrollToLocation: jest.fn(), scrollToOffset: jest.fn() };
    tc.rowYHash['Niddah 32a:2'] = { y: 1200, height: 80 };
    tc.currentY = 100;

    expect(tc.sectionItemMap.get('Niddah 32a:2')).toEqual({ sectionIndex: 1, itemIndex: 1 });
    expect(tc.state.dataSource[0].data[0].data.noAutoDibbur).toBe(false);
    expect(tc.state.dataSource[1].data[0].data.noAutoDibbur).toBe(true);

    tc.textSegmentPressed(1, 1, 'Niddah 32a:2', true);
    expect(tc.sectionListRef.scrollToLocation).toHaveBeenCalledWith({
      animated: false,
      sectionIndex: 1,
      itemIndex: 1,
      viewPosition: 0,
    });
    expect(props.textSegmentPressed).toHaveBeenCalledWith(1, 1, 'Niddah 32a:2', true, true);

    props.textSegmentPressed.mockClear();
    tc.viewableSectionData = { indexes: [1], sections: [[tc.state.dataSource[1].data[1]]] };
    tc.handleScroll({ nativeEvent: { contentOffset: { y: 900 } } });
    expect(props.textSegmentPressed).toHaveBeenCalledWith(1, 1, 'Niddah 32a:2');
  });
});

describe('Tablet sw600dp detection and 2-column grid layouts', () => {
  test('isIPad treats 600dp shortest side as tablet', () => {
    let tablet;
    jest.isolateModules(() => {
      const RN = require('react-native');
      const spy = jest.spyOn(RN.Dimensions, 'get').mockReturnValue({ width: 600, height: 960, scale: 2, fontScale: 1 });
      try {
        tablet = require('../isIPad').default;
      } finally {
        spy.mockRestore();
      }
    });
    expect(tablet).toBe(true);
  });

  test('TextsPage, LearningSchedulesBox, TextCategoryPage, and ReaderTextTableOfContents use 2-column tablet layouts on width >= 600', () => {
    const RN = require('react-native');
    const { FlatList } = RN;
    const { TwoBox } = require('../Misc');
    const ReaderAppContext = require('../context').default;
    const { TextsPage } = require('../TextsPage');
    const { LearningSchedulesBox } = require('../learningSchedules/LearningSchedulesBox');
    const { TextCategoryPage } = require('../TextCategoryPage');
    const ReaderTextTableOfContents = require('../ReaderTextTableOfContents').default;

    const widthSpy = jest.spyOn(RN, 'useWindowDimensions').mockReturnValue({ width: 800, height: 1280, scale: 2, fontScale: 1 });
    const dimSpy = jest.spyOn(RN.Dimensions, 'get').mockReturnValue({ width: 800, height: 1280, scale: 2, fontScale: 1 });
    const savedToc = Sefaria.toc;
    const savedCalendar = Sefaria.calendar;
    const savedGetCalendars = Sefaria.getCalendars;
    const savedCommentaryList = Sefaria.commentaryList;
    const savedIndex = Sefaria._index;

    Sefaria.toc = [
      { category: 'Tanakh', heCategory: 'תנ"ך', contents: [{ title: 'Genesis', heTitle: 'בראשית', categories: ['Tanakh', 'Torah'] }, { title: 'Exodus', heTitle: 'שמות', categories: ['Tanakh', 'Torah'] }] },
      { category: 'Talmud', heCategory: 'תלמוד', contents: [{ title: 'Berakhot', heTitle: 'ברכות', categories: ['Talmud', 'Bavli'] }] },
    ];
    Sefaria._index = {
      ...savedIndex,
      'Sample Book': { title: 'Sample Book', heTitle: 'ספר לדוגמה', categories: ['Halakhah'] },
    };
    Sefaria.calendar = {};
    Sefaria.getCalendars = jest.fn(() => [
      { title: { en: 'Parashat Hashavua', he: 'פרשת השבוע' }, displayValue: { en: 'Bereshit', he: 'בראשית' }, refs: ['Genesis 1'] },
      { title: { en: 'Haftarah', he: 'הפטרה' }, displayValue: { en: 'Isaiah 42', he: 'ישעיהו מ"ב' }, refs: ['Isaiah 42'] },
    ]);
    Sefaria.commentaryList = jest.fn(() => []);

    let tree;
    try {
      act(() => {
        tree = renderer.create(
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english', textLanguage: 'english', menuLanguage: 'english' }}>
            <ReaderAppContext.Provider value={{ readerTabs: { tabs: [] }, openScheduleItem: jest.fn() }}>
              <TextsPage categories={[]} setCategories={jest.fn()} openRef={jest.fn()} openLearningSchedules={jest.fn()} onBack={jest.fn()} openAbout={jest.fn()} openHistory={jest.fn()} />
            </ReaderAppContext.Provider>
          </GlobalStateContext.Provider>
        );
      });
      const flatList = tree.root.findByType(FlatList);
      expect(flatList.props.numColumns).toBe(2);
      act(() => { tree.unmount(); });

      act(() => {
        tree = renderer.create(
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english' }}>
            <ReaderAppContext.Provider value={{ readerTabs: { tabs: [] }, openScheduleItem: jest.fn() }}>
              <LearningSchedulesBox openRef={jest.fn()} desiredCalendarTitles={['Parashat Hashavua', 'Haftarah']} />
            </ReaderAppContext.Provider>
          </GlobalStateContext.Provider>
        );
      });
      const halfWidthSchedCols = tree.root.findAll(n => n.props && n.props.style && n.props.style.width === '48.5%');
      expect(halfWidthSchedCols.length).toBeGreaterThanOrEqual(2);
      act(() => { tree.unmount(); });

      act(() => {
        tree = renderer.create(
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english', textLanguage: 'english', menuLanguage: 'english' }}>
            <TextCategoryPage categories={['Tanakh']} setCategories={jest.fn()} openRef={jest.fn()} onBack={jest.fn()} />
          </GlobalStateContext.Provider>
        );
      });
      const halfWidthCatCols = tree.root.findAll(n => n.props && n.props.style && n.props.style.width === '48.5%');
      expect(halfWidthCatCols.length).toBeGreaterThanOrEqual(2);
      act(() => { tree.unmount(); });

      act(() => {
        tree = renderer.create(
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english', textLanguage: 'english', menuLanguage: 'english' }}>
            <ReaderTextTableOfContents
              title="Sample Book"
              textToc={{ schema: { nodes: [{ depth: 1, title: 'Part 1', heTitle: 'חלק א' }, { depth: 1, title: 'Part 2', heTitle: 'חלק ב' }] } }}
              openRef={jest.fn()}
              close={jest.fn()}
              openUri={jest.fn()}
              textUnavailableAlert={jest.fn()}
            />
          </GlobalStateContext.Provider>
        );
      });
      expect(tree.root.findAllByType(TwoBox).length).toBeGreaterThanOrEqual(1);
      act(() => { tree.unmount(); });
    } finally {
      widthSpy.mockRestore();
      dimSpy.mockRestore();
      Sefaria.toc = savedToc;
      Sefaria.calendar = savedCalendar;
      Sefaria.getCalendars = savedGetCalendars;
      Sefaria.commentaryList = savedCommentaryList;
      Sefaria._index = savedIndex;
    }
  });
});

describe('Extra commentary collectiveTitle strings and depth-3 1D content_counts TOC', () => {
  test('organizeRelatedBySegment preserves string collectiveTitle and heCollectiveTitle from extra books', () => {
    const savedBooksDict = Sefaria.booksDict;
    Sefaria.booksDict = { ...savedBooksDict, 'Rokeach on Song of Songs': 1, 'Siach HaShirah on Song of Songs': 1 };
    try {
      const out = Sefaria.links.organizeRelatedBySegment({
        links: [
          {
            category: 'Commentary',
            index_title: 'Rokeach on Song of Songs',
            collectiveTitle: 'Rokeach',
            heCollectiveTitle: 'רוקח',
            sourceRef: 'Rokeach on Song of Songs 1:1:1',
            sourceHeRef: 'רוקח על שיר השירים א:א:א',
            anchorRef: 'Song of Songs 1:1',
            sourceHasEn: false,
          },
          {
            category: 'Commentary',
            index_title: 'Siach HaShirah on Song of Songs',
            collectiveTitle: 'Siach HaShirah',
            heCollectiveTitle: 'שיח השירה',
            sourceRef: 'Siach HaShirah on Song of Songs 1:1:1',
            sourceHeRef: 'שיח השירה על שיר השירים א:א:א',
            anchorRef: 'Song of Songs 1:1',
            sourceHasEn: false,
          },
        ],
      });
      expect(out.links[0]).toHaveLength(2);
      expect(out.links[0][0].collectiveTitle).toBe('Rokeach');
      expect(out.links[0][0].heCollectiveTitle).toBe('רוקח');
      expect(out.links[0][1].collectiveTitle).toBe('Siach HaShirah');
      expect(out.links[0][1].heCollectiveTitle).toBe('שיח השירה');
    } finally {
      Sefaria.booksDict = savedBooksDict;
    }
  });

  test('ReaderTextTableOfContents renders depth-3 schema with 1D numeric content_counts without crashing', () => {
    const ReaderTextTableOfContents = require('../ReaderTextTableOfContents').default;
    const savedIndex = Sefaria._index;
    const savedCommentaryList = Sefaria.commentaryList;
    Sefaria._index = {
      ...savedIndex,
      'Derech HaShlemut on Proverbs': {
        title: 'Derech HaShlemut on Proverbs',
        heTitle: 'דרך השלמות על משלי',
        categories: ['Tanakh', 'Acharonim on Tanakh', 'Rabbi Eliezer Ben-David'],
      },
    };
    Sefaria.commentaryList = jest.fn(() => []);
    let tree;
    try {
      act(() => {
        tree = renderer.create(
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english', textLanguage: 'english', menuLanguage: 'english' }}>
            <ReaderTextTableOfContents
              title="Derech HaShlemut on Proverbs"
              textToc={{
                schema: {
                  nodeType: 'JaggedArrayNode',
                  depth: 3,
                  sectionNames: ['Chapter', 'Verse', 'Comment'],
                  addressTypes: ['Perek', 'Pasuk', 'Integer'],
                  content_counts: [33, 0, 35],
                },
              }}
              openRef={jest.fn()}
              close={jest.fn()}
              openUri={jest.fn()}
              textUnavailableAlert={jest.fn()}
            />
          </GlobalStateContext.Provider>
        );
      });
      const serialized = JSON.stringify(tree.toJSON());
      expect(serialized).toContain('Chapter 1');
      expect(serialized).toContain('Chapter 3');
      expect(serialized).not.toContain('Chapter 2');
      act(() => { tree.unmount(); });
    } finally {
      Sefaria._index = savedIndex;
      Sefaria.commentaryList = savedCommentaryList;
    }
  });

  test('offline.loadTextOffline reuses cached section across commentary segments in the same daf', async () => {
    const FS = require('expo-file-system/legacy');
    const md5 = require('md5');
    const { loadTextOffline } = require('../offline');
    FS.clear();
    const savedIndex = Sefaria._index;
    const savedBooksDict = Sefaria.booksDict;
    Sefaria._index = {
      ...savedIndex,
      'Rashi on Niddah': { title: 'Rashi on Niddah', heTitle: 'רש"י על נדה', categories: ['Talmud', 'Bavli', 'Rashi'] },
    };
    Sefaria.booksDict = { ...savedBooksDict, 'Rashi on Niddah': 1 };
    const stem = 'Rashi on Niddah 2a';
    const vTitle = 'Vilna Edition';
    const hash = md5(vTitle).substring(0, 8);
    try {
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/Rashi on Niddah_index.json`), JSON.stringify({
        title: 'Rashi on Niddah',
        versions: [{ language: 'he', versionTitle: vTitle, priority: 0, isSource: true }],
      }));
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${stem}.metadata.json`), JSON.stringify({
        sections: {
          'Rashi on Niddah 2a:1': {
            ref: 'Rashi on Niddah 2a:1',
            heRef: 'רש"י על נדה ב׳ א:א׳',
            indexTitle: 'Rashi on Niddah',
            sectionRef: 'Rashi on Niddah 2a:1',
            versions: [{ language: 'he', versionTitle: vTitle }],
            links: [[], []],
          },
        },
      }));
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${stem}.${hash}.he.json`), JSON.stringify({
        sections: { 'Rashi on Niddah 2a:1': ['ראשון', 'שני'] },
      }));

      Sefaria._jsonSectionData = {};
      const readsBefore = FS.readAsStringAsync.mock.calls.length;
      const first = await loadTextOffline('Rashi on Niddah 2a:1:1', {}, true);
      const readsAfterFirst = FS.readAsStringAsync.mock.calls.length;
      const second = await loadTextOffline('Rashi on Niddah 2a:1:2', {}, true);
      const readsAfterSecond = FS.readAsStringAsync.mock.calls.length;

      expect(first.textContent.requestedRef).toBe('Rashi on Niddah 2a:1:1');
      expect(second.textContent.requestedRef).toBe('Rashi on Niddah 2a:1:2');
      expect(readsAfterFirst).toBeGreaterThan(readsBefore);
      expect(readsAfterSecond).toBe(readsAfterFirst);
    } finally {
      Sefaria._index = savedIndex;
      Sefaria.booksDict = savedBooksDict;
    }
  });

  test('prewarmSection warms Rashi everywhere and Steinsaltz on Shas, current daf before next daf', async () => {
    const FS = require('expo-file-system/legacy');
    const md5 = require('md5');
    const { prewarmSection, _resetPrewarm, commentariesToPrewarm } = require('../reader/prewarm');
    _resetPrewarm();
    FS.clear();
    expect(commentariesToPrewarm('Genesis', ['Tanakh', 'Torah'])).toEqual([
      'Rashi on Genesis', 'Ibn Ezra on Genesis', 'Ramban on Genesis', 'Sforno on Genesis',
    ]);
    expect(commentariesToPrewarm('Niddah', ['Talmud', 'Bavli'])).toEqual(['Rashi on Niddah', 'Steinsaltz on Niddah']);
    expect(commentariesToPrewarm('Rashi on Niddah', ['Talmud'])).toEqual([]);

    const savedIndex = Sefaria._index;
    const savedBooksDict = Sefaria.booksDict;
    Sefaria._index = {
      ...savedIndex,
      Niddah: { title: 'Niddah', categories: ['Talmud', 'Bavli'] },
      'Rashi on Niddah': { title: 'Rashi on Niddah', categories: ['Talmud', 'Bavli', 'Rashi'] },
      'Steinsaltz on Niddah': { title: 'Steinsaltz on Niddah', categories: ['Talmud', 'Bavli', 'Steinsaltz'] },
    };
    Sefaria.booksDict = { ...savedBooksDict, Niddah: 1, 'Rashi on Niddah': 1, 'Steinsaltz on Niddah': 1 };
    const vTitle = 'Vilna';
    const hash = md5(vTitle).substring(0, 8);
    try {
      for (const comm of ['Rashi on Niddah', 'Steinsaltz on Niddah']) {
        await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${comm}_index.json`), JSON.stringify({
          title: comm, versions: [{ language: 'he', versionTitle: vTitle, priority: 0, isSource: true }],
        }));
        for (const daf of ['2a', '2b']) {
          const stem = `${comm} ${daf}`;
          await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${stem}.metadata.json`), JSON.stringify({
            sections: {
              [`${stem}:1`]: {
                ref: `${stem}:1`, heRef: stem, indexTitle: comm, sectionRef: `${stem}:1`,
                versions: [{ language: 'he', versionTitle: vTitle }], links: [[]],
              },
            },
          }));
          await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${stem}.${hash}.he.json`), JSON.stringify({
            sections: { [`${stem}:1`]: ['פירוש'] },
          }));
        }
      }
      Sefaria._jsonSectionData = {};
      await prewarmSection('Niddah 2a', 'Niddah 2b');
      expect(Sefaria._jsonSectionData['Rashi on Niddah 2a:1|']).toBeTruthy();
      expect(Sefaria._jsonSectionData['Steinsaltz on Niddah 2a:1|']).toBeTruthy();
      expect(Sefaria._jsonSectionData['Rashi on Niddah 2b:1|']).toBeTruthy();
      expect(Sefaria._jsonSectionData['Steinsaltz on Niddah 2b:1|']).toBeTruthy();
    } finally {
      Sefaria._index = savedIndex;
      Sefaria.booksDict = savedBooksDict;
    }
  });

  test('font options: defaults, state actions, Aa menu buttons, useHTMLViewStyles, and U+05C8/U+05C9 normalization', () => {
    const {
      HEBREW_FONTS, COMMENTARY_FONTS,
    } = require('../StateManager');
    expect(DEFAULT_STATE.hebrewFont).toBe('FrankSofer');
    expect(DEFAULT_STATE.commentaryFont).toBe('FrankSofer');
    expect(HEBREW_FONTS).toEqual(['FrankSofer', 'VilnaSofer', 'Hadassah']);
    expect(COMMENTARY_FONTS).toEqual(['FrankSofer', 'MekorotRashi', 'VilnaSofer', 'Hadassah']);

    let state = reducer(DEFAULT_STATE, { type: STATE_ACTIONS.setHebrewFont, value: 'VilnaSofer', fromAsync: true });
    expect(state.hebrewFont).toBe('VilnaSofer');
    state = reducer(state, { type: STATE_ACTIONS.setHebrewFont, value: 'Drugulin', fromAsync: true });
    expect(state.hebrewFont).toBe('VilnaSofer');
    state = reducer(state, { type: STATE_ACTIONS.setHebrewFont, value: 'UnknownFont', fromAsync: true });
    expect(state.hebrewFont).toBe('FrankSofer');
    state = reducer(state, { type: STATE_ACTIONS.setCommentaryFont, value: 'MekorotRashi', fromAsync: true });
    expect(state.commentaryFont).toBe('MekorotRashi');

    const ReaderDisplayOptionsMenu = require('../ReaderDisplayOptionsMenu').default;
    const { getTheme } = require('../StateManager');
    const setHebrewFont = jest.fn();
    const setCommentaryFont = jest.fn();
    strings.setLanguage('en');
    let tree;
    act(() => {
      tree = renderer.create(
        <ReaderDisplayOptionsMenu
          theme={getTheme('white')} themeStr="white" interfaceLanguage="english"
          textLanguage="hebrew" canHaveAliyot={false} canBeContinuous={false} showAliyot={false}
          hebrewFont="Hadassah" setHebrewFont={setHebrewFont}
          commentaryFont="MekorotRashi" setCommentaryFont={setCommentaryFont}
        />
      );
    });
    const fontSet = tree.root.findAll(n => n.props && n.props.label === 'Font')[0];
    expect(fontSet.props.content.map(b => b.props.option)).toEqual(['FrankSofer', 'VilnaSofer', 'Hadassah']);
    const commFontSet = tree.root.findAll(n => n.props && n.props.label === 'Commentary Font')[0];
    expect(commFontSet.props.content.map(b => b.props.option)).toEqual(['FrankSofer', 'MekorotRashi', 'VilnaSofer', 'Hadassah']);
    act(() => { tree.unmount(); });

    const { useHTMLViewStyles } = require('../useHTMLViewStyles');
    let stylesOut;
    const Probe = ({ fontOverride }) => {
      stylesOut = useHTMLViewStyles(false, 'hebrew', 20, fontOverride);
      return null;
    };
    act(() => {
      tree = renderer.create(
        <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, themeStr: 'white', fontSize: 20, hebrewFont: 'Hadassah' }}>
          <Probe />
        </GlobalStateContext.Provider>
      );
    });
    expect(stylesOut.classesStyles.hebrew.fontFamily).toBe('Hadassah');
    expect(stylesOut.classesStyles.hebrew.fontSize).toBe(20);
    act(() => {
      tree.update(
        <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, themeStr: 'white', fontSize: 20, hebrewFont: 'Hadassah' }}>
          <Probe fontOverride="MekorotRashi" />
        </GlobalStateContext.Provider>
      );
    });
    expect(stylesOut.classesStyles.hebrew.fontFamily).toBe('MekorotRashi');
    expect(stylesOut.classesStyles.hebrew.fontSize).toBeCloseTo(20 * 1.03, 5);
    act(() => { tree.unmount(); });

    expect(Sefaria.util.getDisplayableHTML('בְּ\u05c8רֵאשִׁית\u05c9', 'hebrew', false, false)).toContain('\u05b0');
    expect(Sefaria.util.getDisplayableHTML('בְּ\u05c8רֵאשִׁית\u05c9', 'hebrew', false, false)).toContain('\u05bc');
    expect(Sefaria.util.getDisplayableHTML('בְּ\u05c8רֵאשִׁית\u05c9', 'hebrew', false, false)).not.toMatch(/[\u05c8\u05c9]/);
    const { commentRuns } = require('../reader/InlineCommentary');
    expect(commentRuns(null, 'ש\u05c8ב\u05c9', false)[0].text).toBe('ש\u05b0ב\u05bc');
  });

  test('short Tanakh commentaries prewarm multiple chapters and all verses in each chapter', async () => {
    const FS = require('expo-file-system/legacy');
    const md5 = require('md5');
    const { prewarmSection, _resetPrewarm } = require('../reader/prewarm');
    _resetPrewarm();
    FS.clear();

    const savedIndex = Sefaria._index;
    const savedBooksDict = Sefaria.booksDict;
    Sefaria._index = {
      ...savedIndex,
      Genesis: { title: 'Genesis', categories: ['Tanakh', 'Torah'] },
      'Rashi on Genesis': { title: 'Rashi on Genesis', categories: ['Tanakh', 'Torah', 'Rashi'] },
    };
    Sefaria.booksDict = { ...savedBooksDict, Genesis: 1, 'Rashi on Genesis': 1 };
    const vTitle = 'Miqra';
    const hash = md5(vTitle).substring(0, 8);
    try {
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/Rashi on Genesis_index.json`), JSON.stringify({
        title: 'Rashi on Genesis', versions: [{ language: 'he', versionTitle: vTitle, priority: 0, isSource: true }],
      }));
      for (const ch of [1, 2, 3, 4]) {
        const stem = `Rashi on Genesis ${ch}`;
        await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${stem}.metadata.json`), JSON.stringify({
          sections: {
            [`${stem}:1`]: {
              ref: `${stem}:1`, heRef: stem, indexTitle: 'Rashi on Genesis', sectionRef: `${stem}:1`,
              versions: [{ language: 'he', versionTitle: vTitle }], links: [[]],
              next: `${stem}:2`,
            },
            [`${stem}:2`]: {
              ref: `${stem}:2`, heRef: stem, indexTitle: 'Rashi on Genesis', sectionRef: `${stem}:2`,
              versions: [{ language: 'he', versionTitle: vTitle }], links: [[]],
              next: ch < 4 ? `Rashi on Genesis ${ch + 1}:1` : null,
            },
          },
        }));
        await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${stem}.${hash}.he.json`), JSON.stringify({
          sections: { [`${stem}:1`]: ['פירוש א'], [`${stem}:2`]: ['פירוש ב'] },
        }));
      }
      Sefaria._jsonSectionData = {};
      await prewarmSection('Genesis 1', 'Genesis 2');
      for (const ch of [1, 2, 3, 4]) {
        expect(Sefaria._jsonSectionData[`Rashi on Genesis ${ch}:1|`]).toBeTruthy();
        expect(Sefaria._jsonSectionData[`Rashi on Genesis ${ch}:2|`]).toBeTruthy();
      }
    } finally {
      Sefaria._index = savedIndex;
      Sefaria.booksDict = savedBooksDict;
    }
  });

  test('menuLanguage follows textLanguage (bilingual -> hebrew) and tablet Browse the Library lays out RTL when Hebrew', () => {
    expect(Sefaria.util.get_menu_language('english', 'bilingual')).toBe('hebrew');
    expect(Sefaria.util.get_menu_language('english', 'hebrew')).toBe('hebrew');
    expect(Sefaria.util.get_menu_language('english', 'english')).toBe('english');
    expect(Sefaria.util.get_menu_language('hebrew', 'english')).toBe('english');

    const RN = require('react-native');
    const { FlatList } = RN;
    const ReaderAppContext = require('../context').default;
    const { TextsPage } = require('../TextsPage');
    const widthSpy = jest.spyOn(RN, 'useWindowDimensions').mockReturnValue({ width: 800, height: 1280, scale: 2, fontScale: 1 });
    const savedToc = Sefaria.toc;
    const savedCalendar = Sefaria.calendar;
    const savedGetCalendars = Sefaria.getCalendars;
    Sefaria.toc = [
      { category: 'Tanakh', heCategory: 'תנ"ך', contents: [{ title: 'Genesis', heTitle: 'בראשית', categories: ['Tanakh', 'Torah'] }] },
      { category: 'Talmud', heCategory: 'תלמוד', contents: [{ title: 'Berakhot', heTitle: 'ברכות', categories: ['Talmud', 'Bavli'] }] },
    ];
    Sefaria.calendar = {};
    Sefaria.getCalendars = jest.fn(() => []);
    let tree;
    try {
      act(() => {
        tree = renderer.create(
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english', textLanguage: 'bilingual', menuLanguage: 'hebrew' }}>
            <ReaderAppContext.Provider value={{ readerTabs: { tabs: [] }, openScheduleItem: jest.fn() }}>
              <TextsPage categories={[]} setCategories={jest.fn()} openRef={jest.fn()} openLearningSchedules={jest.fn()} onBack={jest.fn()} openAbout={jest.fn()} openHistory={jest.fn()} />
            </ReaderAppContext.Provider>
          </GlobalStateContext.Provider>
        );
      });
      const flatList = tree.root.findByType(FlatList);
      expect(flatList.props.numColumns).toBe(2);
      expect(flatList.props.columnWrapperStyle).toMatchObject({ flexDirection: 'row-reverse' });
      act(() => { tree.unmount(); });
    } finally {
      Sefaria.toc = savedToc;
      Sefaria.calendar = savedCalendar;
      Sefaria.getCalendars = savedGetCalendars;
      widthSpy.mockRestore();
    }
  });

  test('commentariesToPrewarm covers Mishnah, Halakhah, and Midrash; prewarmSection warms short base sections and commentaries across chapters', async () => {
    const FS = require('expo-file-system/legacy');
    const md5 = require('md5');
    const { prewarmSection, _resetPrewarm, commentariesToPrewarm } = require('../reader/prewarm');
    _resetPrewarm();
    FS.clear();

    expect(commentariesToPrewarm('Mishnah Berakhot', ['Mishnah', 'Seder Zeraim'])).toEqual([
      'Rashi on Mishnah Berakhot',
      'Bartenura on Mishnah Berakhot',
      'Tosafot Yom Tov on Mishnah Berakhot',
      'Rambam on Mishnah Berakhot',
    ]);
    expect(commentariesToPrewarm('Shulchan Arukh, Orach Chayim', ['Halakhah', 'Shulchan Arukh'])).toEqual([
      'Rashi on Shulchan Arukh, Orach Chayim',
      'Mishnah Berurah',
      "Be'er Heitev on Shulchan Arukh, Orach Chayim",
    ]);
    expect(commentariesToPrewarm('Bereishit Rabbah', ['Midrash'])).toEqual([
      'Rashi on Bereishit Rabbah',
      'Matnot Kehunah on Bereishit Rabbah',
      'Etz Yosef on Bereishit Rabbah',
    ]);

    const savedIndex = Sefaria._index;
    const savedBooksDict = Sefaria.booksDict;
    Sefaria._index = {
      ...savedIndex,
      'Mishnah Berakhot': { title: 'Mishnah Berakhot', categories: ['Mishnah', 'Seder Zeraim'] },
      'Bartenura on Mishnah Berakhot': { title: 'Bartenura on Mishnah Berakhot', categories: ['Mishnah', 'Commentary', 'Bartenura'] },
    };
    Sefaria.booksDict = { ...savedBooksDict, 'Mishnah Berakhot': 1, 'Bartenura on Mishnah Berakhot': 1 };
    const vTitle = 'Vilna';
    const hash = md5(vTitle).substring(0, 8);
    try {
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/Mishnah Berakhot_index.json`), JSON.stringify({
        title: 'Mishnah Berakhot', versions: [{ language: 'he', versionTitle: vTitle, priority: 0, isSource: true }],
      }));
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/Bartenura on Mishnah Berakhot_index.json`), JSON.stringify({
        title: 'Bartenura on Mishnah Berakhot', versions: [{ language: 'he', versionTitle: vTitle, priority: 0, isSource: true }],
      }));
      for (const ch of [1, 2, 3, 4]) {
        const baseStem = `Mishnah Berakhot ${ch}`;
        await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${baseStem}.metadata.json`), JSON.stringify({
          sections: {
            [baseStem]: {
              ref: baseStem, heRef: baseStem, indexTitle: 'Mishnah Berakhot', sectionRef: baseStem,
              versions: [{ language: 'he', versionTitle: vTitle }], links: [[]],
              next: ch < 4 ? `Mishnah Berakhot ${ch + 1}` : null,
            },
          },
        }));
        await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${baseStem}.${hash}.he.json`), JSON.stringify({
          sections: { [baseStem]: ['משנה קצרה'] },
        }));

        const commStem = `Bartenura on Mishnah Berakhot ${ch}`;
        await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${commStem}.metadata.json`), JSON.stringify({
          sections: {
            [`${commStem}:1`]: {
              ref: `${commStem}:1`, heRef: commStem, indexTitle: 'Bartenura on Mishnah Berakhot', sectionRef: `${commStem}:1`,
              versions: [{ language: 'he', versionTitle: vTitle }], links: [[]],
              next: ch < 4 ? `Bartenura on Mishnah Berakhot ${ch + 1}:1` : null,
            },
          },
        }));
        await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${commStem}.${hash}.he.json`), JSON.stringify({
          sections: { [`${commStem}:1`]: ['ברטנורא קצר'] },
        }));
      }

      Sefaria._jsonSectionData = {};
      await prewarmSection('Mishnah Berakhot 1', 'Mishnah Berakhot 2');
      for (const ch of [1, 2, 3, 4]) {
        expect(Sefaria._jsonSectionData[`Mishnah Berakhot ${ch}|`]).toBeTruthy();
        expect(Sefaria._jsonSectionData[`Bartenura on Mishnah Berakhot ${ch}:1|`]).toBeTruthy();
      }
    } finally {
      Sefaria._index = savedIndex;
      Sefaria.booksDict = savedBooksDict;
    }
  });

  test('prewarmLinkedCommentaries warms short linked commentaries across chapters (including depth-1 stem files)', async () => {
    const FS = require('expo-file-system/legacy');
    const md5 = require('md5');
    const { prewarmLinkedCommentaries, _resetPrewarm } = require('../reader/prewarm');
    _resetPrewarm();
    FS.clear();

    const savedIndex = Sefaria._index;
    const savedBooksDict = Sefaria.booksDict;
    Sefaria._index = {
      ...savedIndex,
      'Pirkei Avot': { title: 'Pirkei Avot', categories: ['Mishnah', 'Seder Nezikin'] },
      'Rabbeinu Yonah on Pirkei Avot': { title: 'Rabbeinu Yonah on Pirkei Avot', categories: ['Mishnah', 'Commentary'] },
    };
    Sefaria.booksDict = { ...savedBooksDict, 'Pirkei Avot': 1, 'Rabbeinu Yonah on Pirkei Avot': 1 };
    const vTitle = 'Vilna';
    const hash = md5(vTitle).substring(0, 8);
    try {
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/Rabbeinu Yonah on Pirkei Avot_index.json`), JSON.stringify({
        title: 'Rabbeinu Yonah on Pirkei Avot', versions: [{ language: 'he', versionTitle: vTitle, priority: 0, isSource: true }],
      }));
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/Rabbeinu Yonah on Pirkei Avot.metadata.json`), JSON.stringify({
        sections: {
          'Rabbeinu Yonah on Pirkei Avot 1:1': {
            ref: 'Rabbeinu Yonah on Pirkei Avot 1:1', heRef: 'רבינו יונה', indexTitle: 'Rabbeinu Yonah on Pirkei Avot',
            sectionRef: 'Rabbeinu Yonah on Pirkei Avot 1:1',
            versions: [{ language: 'he', versionTitle: vTitle }], links: [[]], next: 'Rabbeinu Yonah on Pirkei Avot 2:1',
          },
          'Rabbeinu Yonah on Pirkei Avot 2:1': {
            ref: 'Rabbeinu Yonah on Pirkei Avot 2:1', heRef: 'רבינו יונה', indexTitle: 'Rabbeinu Yonah on Pirkei Avot',
            sectionRef: 'Rabbeinu Yonah on Pirkei Avot 2:1',
            versions: [{ language: 'he', versionTitle: vTitle }], links: [[]], next: 'Rabbeinu Yonah on Pirkei Avot 3:1',
          },
          'Rabbeinu Yonah on Pirkei Avot 3:1': {
            ref: 'Rabbeinu Yonah on Pirkei Avot 3:1', heRef: 'רבינו יונה', indexTitle: 'Rabbeinu Yonah on Pirkei Avot',
            sectionRef: 'Rabbeinu Yonah on Pirkei Avot 3:1',
            versions: [{ language: 'he', versionTitle: vTitle }], links: [[]], next: null,
          },
        },
      }));
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/Rabbeinu Yonah on Pirkei Avot.${hash}.he.json`), JSON.stringify({
        sections: {
          'Rabbeinu Yonah on Pirkei Avot 1:1': ['פירוש פרק א'],
          'Rabbeinu Yonah on Pirkei Avot 2:1': ['פירוש פרק ב'],
          'Rabbeinu Yonah on Pirkei Avot 3:1': ['פירוש פרק ג'],
        },
      }));

      Sefaria._jsonSectionData = {};
      await prewarmLinkedCommentaries('Pirkei Avot 1', 'Pirkei Avot 2', [
        {
          links: [
            { category: 'Commentary', textTitle: 'Rabbeinu Yonah on Pirkei Avot', collectiveTitle: 'Rabbeinu Yonah', sourceRef: 'Rabbeinu Yonah on Pirkei Avot 1:1' },
          ],
        },
      ]);
      expect(Sefaria._jsonSectionData['Rabbeinu Yonah on Pirkei Avot 1:1|']).toBeTruthy();
      expect(Sefaria._jsonSectionData['Rabbeinu Yonah on Pirkei Avot 2:1|']).toBeTruthy();
      expect(Sefaria._jsonSectionData['Rabbeinu Yonah on Pirkei Avot 3:1|']).toBeTruthy();
    } finally {
      Sefaria._index = savedIndex;
      Sefaria.booksDict = savedBooksDict;
    }
  });

  test('Hadar Zekenim complex depth-3 verse sections skip missing chapters (15 -> 17, 20 -> 22) without crashing or duplicating', async () => {
    const FS = require('expo-file-system/legacy');
    const md5 = require('md5');
    const { prewarmSection, _resetPrewarm, commentariesToPrewarm } = require('../reader/prewarm');
    const { loadTextOffline } = require('../offline');
    _resetPrewarm();
    FS.clear();

    expect(commentariesToPrewarm('Hadar Zekenim on Torah', ['Tanakh', 'Rishonim on Tanakh'])).toEqual([]);

    const savedIndex = Sefaria._index;
    const savedBooksDict = Sefaria.booksDict;
    const vTitle = 'Livorno, 1840';
    const hash = md5(vTitle).substring(0, 8);
    const title = 'Hadar Zekenim on Torah';
    const hadarIndex = {
      title,
      heTitle: 'הדר זקנים על התורה',
      categories: ['Tanakh', 'Rishonim on Tanakh'],
      dependence: 'Commentary',
      versions: [{ language: 'he', versionTitle: vTitle, priority: 0, isSource: true }],
      schema: {
        nodes: [
          { nodeType: 'JaggedArrayNode', depth: 3, addressTypes: ['Integer', 'Integer', 'Integer'], sectionNames: ['Chapter', 'Verse', 'Paragraph'], title: 'Genesis', key: 'Genesis' },
          { nodeType: 'JaggedArrayNode', depth: 3, addressTypes: ['Integer', 'Integer', 'Integer'], sectionNames: ['Chapter', 'Verse', 'Paragraph'], title: 'Exodus', key: 'Exodus' },
        ],
      },
    };
    Sefaria._index = { ...savedIndex, [title]: hadarIndex };
    Sefaria.booksDict = { ...savedBooksDict, [title]: 1 };

    const chapters = {
      15: ['Genesis 15:3', 'Genesis 15:16'],
      // Chapter 16 intentionally missing (empty in Hadar Zekenim)
      17: ['Genesis 17:5'],
      20: ['Genesis 20:4', 'Genesis 20:16'],
      21: ['Genesis 21:7', 'Genesis 21:30'],
      22: ['Genesis 22:2'],
    };

    try {
      await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${title}_index.json`), JSON.stringify(hadarIndex));
      for (const [ch, verses] of Object.entries(chapters)) {
        const stem = `${title}, Genesis ${ch}`;
        const secMeta = {};
        const secHe = {};
        verses.forEach((v, idx) => {
          const full = `${title}, ${v}`;
          secMeta[full] = {
            ref: full,
            heRef: `הדר זקנים ${v}`,
            indexTitle: title,
            sectionRef: full,
            versions: [{ language: 'he', versionTitle: vTitle }],
            links: [[]],
            prev: idx > 0 ? `${title}, ${verses[idx - 1]}` : null,
            next: idx + 1 < verses.length ? `${title}, ${verses[idx + 1]}` : null,
          };
          secHe[full] = [`פירוש קצר ${v}`];
        });
        await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${stem}.metadata.json`), JSON.stringify({ sections: secMeta }));
        await FS.writeAsStringAsync(encodeURI(`${FS.documentDirectory}/${stem}.${hash}.he.json`), JSON.stringify({ sections: secHe }));
      }

      Sefaria._jsonSectionData = {};
      const ch15Last = await loadTextOffline(`${title}, Genesis 15:16`, {}, true);
      expect(ch15Last.textContent.next).toBe(`${title}, Genesis 17:5`);
      const ch17 = await loadTextOffline(`${title}, Genesis 17:5`, {}, true);
      expect(ch17.textContent.prev).toBe(`${title}, Genesis 15:16`);
      expect(ch17.textContent.next).toBe(`${title}, Genesis 20:4`);
      const ch21Last = await loadTextOffline(`${title}, Genesis 21:30`, {}, true);
      expect(ch21Last.textContent.next).toBe(`${title}, Genesis 22:2`);

      Sefaria._jsonSectionData = {};
      await prewarmSection(`${title}, Genesis 15:3`, `${title}, Genesis 15:16`);
      expect(Sefaria._jsonSectionData[`${title}, Genesis 15:3|`]).toBeTruthy();
      expect(Sefaria._jsonSectionData[`${title}, Genesis 15:16|`]).toBeTruthy();
      expect(Sefaria._jsonSectionData[`${title}, Genesis 17:5|`]).toBeTruthy();
      expect(Sefaria._jsonSectionData[`${title}, Genesis 20:4|`]).toBeTruthy();
      expect(Sefaria._jsonSectionData[`${title}, Genesis 22:2|`]).toBeTruthy();

      const TextColumn = require('../TextColumn');
      const tc = new TextColumn({
        theme: {},
        fontSize: 16,
        data: [[{ segmentNumber: '1', he: 'x', text: '', links: [] }]],
        sectionArray: [`${title}, Genesis 17:5`],
        sectionHeArray: ['בראשית יז:ה'],
        relatedBySectionRef: {},
        textTitle: title,
        textLanguage: 'hebrew',
        interfaceLanguage: 'english',
        showAliyot: false,
        handleOpenURL: jest.fn(),
        shareCurrentSegment: jest.fn(),
        getDisplayedText: jest.fn(),
        textUnavailableAlert: jest.fn(),
      });
      expect(tc.sectionsCoverScreen(0, 1)).toBe(false);
      expect(tc.getViewableSectionData([null, { item: undefined }, { item: { type: 1 }, section: null }])).toEqual({
        indexes: [], sections: [], sectionRefs: [],
      });
      Sefaria._index = {};
      expect(tc.inlineSectionHeader(`${title}, Genesis 17:5`)).toBe('Genesis 17:5');
    } finally {
      Sefaria._index = savedIndex;
      Sefaria.booksDict = savedBooksDict;
    }
  });
});

describe('single-word Hebrew alignment, copy support, and Great Neck Kollel credit', () => {
  test('useHTMLViewStyles enforces RTL writingDirection and selectable text', () => {
    const { useHTMLViewStyles } = require('../useHTMLViewStyles');
    let result;
    const Probe = () => {
      result = useHTMLViewStyles(false, 'hebrew');
      return null;
    };
    act(() => {
      renderer.create(
        <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, textLanguage: 'hebrew' }}>
          <Probe />
        </GlobalStateContext.Provider>
      );
    });
    expect(result.textStyle.selectable).toBe(true);
    expect(result.textStyle.style).toEqual(expect.arrayContaining([
      expect.objectContaining({ writingDirection: 'rtl' }),
    ]));
  });

  test('TextSegment disables bypassAnonymousTPhrasingNodes so 1-word Hebrew segments stay right-aligned', () => {
    const TextSegment = require('../TextSegment').default;
    let inst;
    act(() => {
      inst = renderer.create(
        <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, textLanguage: 'hebrew' }}>
          <TextSegment
            segmentRef="Yoma 48b:13"
            segmentKey="0:12"
            data='<div class="hebrew"><span class="clickableWord">בָּעֵי</span></div>'
            textType="hebrew"
            onTextPress={jest.fn()}
            showToast={jest.fn()}
            handleOpenURL={jest.fn()}
            setDictionaryLookup={jest.fn()}
            shareCurrentSegment={jest.fn()}
            getDisplayedText={jest.fn()}
            setHighlightedWord={jest.fn()}
          />
        </GlobalStateContext.Provider>
      );
    });
    const rhNodes = inst.root.findAll(n => n.props && 'bypassAnonymousTPhrasingNodes' in n.props);
    expect(rhNodes.length).toBeGreaterThan(0);
    expect(rhNodes[0].props.bypassAnonymousTPhrasingNodes).toBe(false);
    expect(rhNodes[0].props.defaultTextProps.selectable).toBe(true);
    act(() => { inst.unmount(); });
  });

  test('openLinkActionSheet includes Copy when copyText is provided', () => {
    strings.setLanguage('en');
    const spy = jest.spyOn(ActionSheet, 'showActionSheetWithOptions').mockImplementation(() => {});
    try {
      const copyText = jest.fn();
      openLinkActionSheet({
        refStr: 'Rashi on Yoma 37b:1',
        heRefStr: 'רש"י על יומא לז.',
        interfaceLanguage: 'english',
        openHere: jest.fn(),
        copyText,
      });
      const [opts, cb] = spy.mock.calls[0];
      expect(opts.options).toEqual(['Open here', 'Copy', 'Cancel']);
      cb(1);
      expect(copyText).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test('ConnectionsPanel exposes Copy button that copies current segment', () => {
    strings.setLanguage('en');
    const ConnectionsPanel = require('../ConnectionsPanel').default;
    const copyCurrentSegment = jest.fn();
    let inst;
    act(() => {
      inst = renderer.create(
        <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, textLanguage: 'hebrew' }}>
          <ConnectionsPanel
            theme={{}} themeStr="white" interfaceLanguage="english" textLanguage="hebrew"
            fontSize={16} openRef={jest.fn()} setConnectionsMode={jest.fn()}
            openFilter={jest.fn()} closeCat={jest.fn()} updateLinkCat={jest.fn()}
            updateVersionCat={jest.fn()} loadLinkContent={jest.fn()} loadVersionContent={jest.fn()}
            linkSummary={[]} loading={false} relatedHasError={false}
            sectionRef="Yoma 37b" segmentRef="Yoma 37b:13" heSegmentRef="יומא לז:"
            connectionsMode={null} recentFilters={[]} versionRecentFilters={[]}
            currVersionObjects={{}} versions={[]} versionsApiError={false}
            onDragStart={jest.fn()} onDragMove={jest.fn()} onDragEnd={jest.fn()}
            textTitle="Yoma" categories={['Talmud']} openUri={jest.fn()}
            handleOpenURL={jest.fn()} textListFlex={0.5} onStartShouldSetResponderCapture={jest.fn()}
            copyCurrentSegment={copyCurrentSegment} shareCurrentSegment={jest.fn()} viewOnSite={jest.fn()}
            reportError={jest.fn()} loadRelated={jest.fn()} relatedData={{}}
            translations={{ versions: [] }}
          />
        </GlobalStateContext.Provider>
      );
    });
    const copyBtn = inst.root.findAll(n => typeof n.props?.onPress === 'function' && n.findAll(c => typeof c.children?.[0] === 'string' && c.children.includes('Copy')).length > 0).pop();
    copyBtn.props.onPress();
    expect(copyCurrentSegment).toHaveBeenCalledTimes(1);
    act(() => { inst.unmount(); });
  });
});
