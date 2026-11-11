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
