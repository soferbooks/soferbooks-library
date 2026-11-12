/**
 * Fixes from the third emulator QA round (2026-11-11): the Commentary count, a commentary's
 * subtitle, one tap to open the panel after Back, a Wikisource book's name shown twice, and
 * Everett Fox listed under two filter groups.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import Sefaria from '../sefaria';
import { getLibraryNavButtonPropsList } from '../ConnectionsPanel';
import ReaderApp, { isOtherPassage } from '../ReaderApp';
import { CategoryAttribution } from '../Misc';
import TestContextWrapper from '../TestContextWrapper';
import { displayRef, displayHeRef, dedupeHeRef } from '../extras/schema7';
import { RULES, match, bookMatch } from '../shomer/matcher';
import { GROUPS } from '../shomer/presets';
import GROUP_EXAMPLES from '../shomer/groupExamples.json';

const refs = (book, n) => Array.from({ length: n }, (_, i) => `${book} ${i + 1}`);
const cat = (category, books) => {
  const all = books.flatMap(b => b.refList);
  return { category, count: all.length, refList: all, heRefList: all, hasEn: false, books };
};
const book = (title, n) => ({ title, heTitle: title, count: n, refList: refs(title, n), heRefList: refs(title, n) });

describe('the Commentary count is the same in the menu and in the opened list', () => {
  // Niddah 2a:1: 15 commentaries, plus quoting (6) and modern (5) ones listed under Commentary
  const summary = () => {
    const commentary = cat('Commentary', [book('Rashi on Niddah', 9), book('Tosafot on Niddah', 6)]);
    const quoting = cat('Quoting Commentary', [book('Mishnah Berurah', 6)]);
    const modern = cat('Modern Commentary', [book('Steinsaltz on Niddah', 5)]);
    commentary.totalCount = commentary.count + quoting.count + modern.count;
    return [commentary, quoting, modern, cat('Talmud', [book('Shabbat', 2)])];
  };

  test('the menu and the opened list both say 26, and the opened header lists all 26', () => {
    const openFilter = jest.fn();
    const menu = getLibraryNavButtonPropsList(summary(), null, openFilter, jest.fn());
    expect(menu.find(p => p.key === 'Commentary').count).toBe(26);
    const opened = getLibraryNavButtonPropsList(summary(), 'Commentary', openFilter, jest.fn());
    const header = opened.find(p => p.key === 'Commentary');
    expect(header.enText).toBe('COMMENTARY');
    expect(header.count).toBe(26);
    header.onPress();
    expect(openFilter.mock.calls[0][0].refList).toHaveLength(26);
    // (each sub-list keeps its own count)
    expect(opened.find(p => p.key === 'Quoting Commentary').count).toBe(6);
    expect(opened.find(p => p.key === 'Modern Commentary').count).toBe(5);
  });

  test('other categories are unchanged', () => {
    const opened = getLibraryNavButtonPropsList(summary(), 'Talmud', jest.fn(), jest.fn());
    expect(opened.find(p => p.key === 'Talmud').count).toBe(2);
  });
});

describe("a commentary's subtitle is its own edition, not the Gemara's", () => {
  const BAVLI = ['Talmud', 'Bavli', 'Seder Tahorot'];
  const TOSAFOT = ['Talmud', 'Bavli', 'Rishonim on Talmud', 'Tosafot', 'Seder Tahorot'];

  test('the William Davidson attribution is for the Gemara only', () => {
    expect(Sefaria.categoryAttribution(BAVLI, 'Niddah').english).toBe('The William Davidson Talmud');
    expect(Sefaria.categoryAttribution(TOSAFOT, 'Tosafot on Niddah')).toBeNull();
    expect(Sefaria.isCommentaryTitle('Tosafot on Niddah', TOSAFOT)).toBe(true);
    expect(Sefaria.isCommentaryTitle('Niddah', BAVLI)).toBe(false);
  });

  const texts = tree => tree.root.findAllByType(Text).map(t => t.props.children);
  test('the header shows the commentary version', () => {
    const versions = { he: { versionTitle: 'Vilna Edition', versionTitleInHebrew: 'דפוס וילנא' }, en: null };
    let tree;
    act(() => {
      tree = renderer.create(<TestContextWrapper child={CategoryAttribution}
        childProps={{ categories: TOSAFOT, title: 'Tosafot on Niddah', versions, context: 'header', linked: false }} />);
    });
    const shown = texts(tree);
    expect(shown.join(' ')).not.toMatch(/William Davidson|ויליאם דוידסון/);
    expect(shown.some(s => s === 'Vilna Edition' || s === 'דפוס וילנא')).toBe(true);
    act(() => {
      tree = renderer.create(<TestContextWrapper child={CategoryAttribution}
        childProps={{ categories: BAVLI, title: 'Niddah', versions, context: 'header', linked: false }} />);
    });
    expect(texts(tree).some(s => /William Davidson|ויליאם דוידסון/.test(s))).toBe(true);
  });
});

describe('after Back, one tap on a passage opens the panel on it', () => {
  const makeApp = state => {
    const app = new ReaderApp({ textLanguage: 'hebrew', dispatch: jest.fn(), showErrorBoundary: jest.fn(),
      theme: {}, themeStr: 'white', biLayout: 'stacked', fontSize: 20 });
    app.setState = (u, cb) => {
      const part = typeof u === 'function' ? u(app.state, app.props) : u;
      app.state = { ...app.state, ...part };
      if (cb) { cb(); }
    };
    app.forceUpdate = () => {};
    app.animateTextList = jest.fn();
    app.updateLinkSummary = jest.fn();
    app.updateVersionCat = jest.fn();
    app.loadRelated = jest.fn();
    app._getTranslationForSegment = () => null;
    app.state = { ...app.state, footerTab: 'Texts', data: [[{}, {}, {}]], sectionArray: ['Niddah 2a'],
      linksLoaded: [true], linkRecentFilters: [], versionRecentFilters: [], textListFlex: 0.5,
      textListAnimating: false, textListVisible: true, segmentIndexRef: 0, sectionIndexRef: 0,
      segmentRef: 'Niddah 2a:1', menuOpen: null, ...state };
    return app;
  };
  beforeEach(() => { jest.spyOn(Sefaria.history, 'saveHistoryItem').mockImplementation(() => {}); });
  afterEach(() => { jest.restoreAllMocks(); });
  // (opening animates on the next frame: let it run before the environment is torn down)
  afterAll(() => new Promise(resolve => setTimeout(resolve, 100)));

  test('isOtherPassage', () => {
    expect(isOtherPassage({ segmentIndexRef: 0, sectionIndexRef: 0 }, 0, 0)).toBe(false);
    expect(isOtherPassage({ segmentIndexRef: 0, sectionIndexRef: 0 }, 0, 2)).toBe(true);
    expect(isOtherPassage({ segmentIndexRef: 0, sectionIndexRef: 0 }, 1, 0)).toBe(true);
  });

  test('the panel open on one passage: a tap on another moves it there (it does not close)', () => {
    const app = makeApp();
    app.textSegmentPressed(0, 2, 'Niddah 2a:3', true);
    expect(app.state.textListVisible).toBe(true);
    expect(app.state.segmentRef).toBe('Niddah 2a:3');
    expect(app.state.segmentIndexRef).toBe(2);
    expect(app.animateTextList).not.toHaveBeenCalled();
    expect(app.updateLinkSummary).toHaveBeenCalledWith(0, 2);
  });

  test('a tap on the passage it is open on still closes it, once', () => {
    const app = makeApp();
    const back = jest.spyOn(app.tabHistory, 'back');
    app.textSegmentPressed(0, 0, 'Niddah 2a:1', true);
    expect(app.animateTextList).toHaveBeenCalledWith(0.5, 0.0001, 200);
    expect(back).toHaveBeenCalledTimes(1);
    // (a second tap while it is closing does not close it again and drop another Back step)
    app.state.textListAnimating = true;
    app.textSegmentPressed(0, 0, 'Niddah 2a:1', true);
    expect(app.animateTextList).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  test('with the panel closed one tap opens it', () => {
    const app = makeApp({ textListVisible: false });
    app.textSegmentPressed(0, 1, 'Niddah 2a:2', true);
    expect(app.state.textListVisible).toBe(true);
    expect(app.state.segmentRef).toBe('Niddah 2a:2');
  });

  test('Back does not bring back an animating panel or an open display menu', () => {
    const app = makeApp({ textListVisible: false });
    app._applyPreviousState({ menuOpen: null, textListVisible: true, textListAnimating: true,
      ReaderDisplayOptionsMenuVisible: true, segmentRef: 'Niddah 2a:1', sectionArray: ['Niddah 2a'],
      linksLoaded: [true] });
    expect(app.state.textListVisible).toBe(true);
    expect(app.state.textListAnimating).toBe(false);
    expect(app.state.ReaderDisplayOptionsMenuVisible).toBe(false);
    expect(app.loadRelated).toHaveBeenCalledWith('Niddah 2a');
  });
});

describe("a book's name is not shown twice", () => {
  test('a section named as the book is left out of the Hebrew ref', () => {
    expect(dedupeHeRef('שאר ישראל, שאר ישראל')).toBe('שאר ישראל');
    expect(dedupeHeRef('שאר ישראל, שאר ישראל 3')).toBe('שאר ישראל 3');
    expect(dedupeHeRef('ספר בדיקה, חלק ראשון, חלק ראשון, פרק ב')).toBe('ספר בדיקה, חלק ראשון, פרק ב');
    expect(dedupeHeRef('ספר בדיקה, חלק שני, סימן א')).toBe('ספר בדיקה, חלק שני, סימן א');
    expect(dedupeHeRef('בראשית א')).toBe('בראשית א');
    expect(dedupeHeRef(undefined)).toBeUndefined();
  });

  test('the reader header and the tab show it once (Wikisource S1, and an unnamed S0)', () => {
    expect(displayRef('שאר ישראל, S1', 'שאר ישראל, שאר ישראל')).toBe('שאר ישראל');
    expect(displayRef('שאר ישראל, S1 4', 'שאר ישראל, שאר ישראל')).toBe('שאר ישראל 4');
    expect(displayHeRef('חבור, S0', 'חבור, חבור')).toBe('חבור');
    // (Sefaria's refs are left as they are)
    expect(displayHeRef('Genesis 1', 'בראשית, בראשית')).toBe('בראשית, בראשית');
  });
});

describe('Everett Fox is listed under one filter group', () => {
  const FOX_BOOK = 'The Five Books of Moses, by Everett Fox | חמשה חומשי תורה, מהדורת אוורט פוקס';
  const examplesOf = id => ((GROUP_EXAMPLES.groups[id] || {}).examples || []).map(e => e[0]);

  test('his books are hidden as books by Haskalah & secular; the translation group hides only editions', () => {
    const all = { active: true, groups: Object.fromEntries(GROUPS.map(g => [g.id, true])) };
    expect(bookMatch(all, { title: 'The Five Books of Moses, by Everett Fox' }).group).toBe('haskalah_secular');
    const onlyTranslations = { active: true, groups: { non_orthodox_translations: true } };
    expect(match(onlyTranslations, FOX_BOOK).translation).toBe(true);
    expect(bookMatch(onlyTranslations, { title: 'The Five Books of Moses, by Everett Fox' })).toBeNull();
    expect(RULES.find(r => r.id === 'everett_fox_books').group).toBe('haskalah_secular');
  });

  test('the Settings examples list each Fox book under one group only', () => {
    const groupsWithFox = Object.keys(GROUP_EXAMPLES.groups)
      .filter(id => examplesOf(id).some(n => /Everett Fox/.test(n)));
    expect(groupsWithFox).toEqual(['haskalah_secular']);
  });

  test('no translation group lists a whole book from the table of contents', () => {
    for (const g of GROUPS.filter(x => x.translation)) {
      for (const n of examplesOf(g.id)) {
        expect(n).not.toMatch(/, by Everett Fox$/);
      }
    }
  });
});
