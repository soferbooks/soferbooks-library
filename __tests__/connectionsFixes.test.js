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
      expect(opts.options.length).toBe(4);
      expect(opts.options[2]).toBe(strings.connections.stop_showing_underneath);
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
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english', menuLanguage: 'english' }}>
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
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english', menuLanguage: 'english' }}>
            <TextCategoryPage categories={['Tanakh']} setCategories={jest.fn()} openRef={jest.fn()} onBack={jest.fn()} />
          </GlobalStateContext.Provider>
        );
      });
      const halfWidthCatCols = tree.root.findAll(n => n.props && n.props.style && n.props.style.width === '48.5%');
      expect(halfWidthCatCols.length).toBeGreaterThanOrEqual(2);
      act(() => { tree.unmount(); });

      act(() => {
        tree = renderer.create(
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english', menuLanguage: 'english' }}>
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
          <GlobalStateContext.Provider value={{ ...DEFAULT_STATE, interfaceLanguage: 'english', menuLanguage: 'english' }}>
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
    expect(commentariesToPrewarm('Genesis', ['Tanakh', 'Torah'])).toEqual(['Rashi on Genesis']);
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
});
