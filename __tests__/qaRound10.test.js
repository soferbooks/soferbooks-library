/**
 * Emulator QA round 10 (2026-11-11): a book's contents page showed the reader's previous place
 * ("תוספות על שבת ב׳ א:א׳") under "Order a printed copy" just after the book was downloaded; the
 * home page's open tabs were in another order than the tab bar's; the connections panel's back
 * chevron had no label for a screen reader.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import Sefaria from '../sefaria';
import ReaderApp from '../ReaderApp';
import ReaderAppContext from '../context';
import OpenTabsStrip from '../tabs/OpenTabsStrip';
import ConnectionsPanelHeader from '../ConnectionsPanelHeader';
import TestContextWrapper from '../TestContextWrapper';
import strings from '../LocalizedStrings';
import * as extras from '../extras';

const makeApp = state => {
  const app = new ReaderApp({ textLanguage: 'hebrew', dispatch: jest.fn(), showErrorBoundary: jest.fn(),
    theme: {}, themeStr: 'white', biLayout: 'stacked', fontSize: 20, interfaceLanguage: 'english' });
  app.setState = (u, cb) => {
    const part = typeof u === 'function' ? u(app.state, app.props) : u;
    if (part) { app.state = { ...app.state, ...part }; }
    if (cb) { cb(); }
  };
  app.forceUpdate = () => {};
  app.loadTextToc = jest.fn(() => Promise.resolve());
  app.state = { ...app.state, footerTab: 'Texts', menuOpen: null, loaded: true, data: [[{}]],
    textTitle: 'Tosafot on Shabbat', textReference: 'Tosafot on Shabbat 2a:1', heRef: 'תוספות על שבת ב׳ א:א׳',
    sectionArray: ['Tosafot on Shabbat 2a:1'], sectionIndexRef: 0, ...state };
  return app;
};

afterEach(() => { jest.restoreAllMocks(); });

describe("a book's contents page opened from the reader", () => {
  const BOOK = 'Igeret Rabban Yochanan ben Zakkai';

  beforeEach(() => {
    jest.spyOn(extras, 'needsDownload').mockReturnValue(false);
    Sefaria.booksDict = { ...(Sefaria.booksDict || {}), [BOOK]: 1 };
    jest.spyOn(Sefaria.history, 'saveHistoryItem').mockImplementation(() => {});
  });

  test('shows no place of the book that was being read', () => {
    const app = makeApp();
    app.openTextTocDirectly(BOOK);
    expect(app.state.menuOpen).toBe('text toc');
    expect(app.state.textTitle).toBe(BOOK);
    expect(app.state.textReference).toBe('');
    expect(app.state.heRef).toBe('');
    // the reader's text column reporting its place once more (as it did while it was still shown)
    app.updateTitle('Tosafot on Shabbat 2a:1', 'תוספות על שבת ב׳ א:א׳', 0);
    expect(app.state.textReference).toBe('');
    expect(app.state.heRef).toBe('');
  });

  test('Back returns to the reader as it was', () => {
    const app = makeApp();
    app.openTextTocDirectly(BOOK);
    app.manageBack();
    expect(app.state.menuOpen).toBe(null);
    expect(app.state.textTitle).toBe('Tosafot on Shabbat');
    expect(app.state.textReference).toBe('Tosafot on Shabbat 2a:1');
  });

  test('the reader still records its place while it is shown', () => {
    const app = makeApp();
    app.updateTitle('Tosafot on Shabbat 2b:1', 'תוספות על שבת ב׳ ב:א׳', 0);
    expect(app.state.textReference).toBe('Tosafot on Shabbat 2b:1');
  });
});

describe('the home page lists the open tabs in the tab bar\'s order', () => {
  test('pinned first, then as in the tab bar (not by last use)', () => {
    const tabs = [
      { id: 'p', title: 'Genesis', ref: 'Genesis 1', pinned: true, lastUsed: 1 },
      { id: 'a', title: 'Exodus', ref: 'Exodus 1', lastUsed: 5 },
      { id: 'b', title: 'Leviticus', ref: 'Leviticus 1', lastUsed: 9 },
      { id: 'c', title: 'Numbers', ref: 'Numbers 1', lastUsed: 2 },
    ];
    let inst;
    act(() => {
      inst = renderer.create(
        <ReaderAppContext.Provider value={{ readerTabs: { tabs, activeTabId: 'a', archived: [] }, openReaderTab: jest.fn() }}>
          <TestContextWrapper child={OpenTabsStrip} childProps={{}} />
        </ReaderAppContext.Provider>);
    });
    const order = inst.root.findAll(n => typeof n.props.onPress === 'function' && n.props.style && n.props.children)
      .map(n => n.findAllByType(Text).map(t => [].concat(t.props.children).join('')).join(''))
      .filter((s, i, all) => s && s !== all[i - 1]);   // (a touchable and the view under it: once)
    expect(order.map(s => s.replace(/^📌 /, '').split(' ')[0])).toEqual(['Genesis', 'Exodus', 'Leviticus', 'Numbers']);
    act(() => { inst.unmount(); });
  });
});

describe("the connections panel's back chevron", () => {
  test('is a button a screen reader calls "Back"', () => {
    const filter = { toString: () => 'Rashi', listKey: () => 'Rashi', category: 'Commentary' };
    let inst;
    act(() => {
      inst = renderer.create(<TestContextWrapper child={ConnectionsPanelHeader} childProps={{
        theme: {}, themeStr: 'white', textLanguage: 'hebrew', interfaceLanguage: 'english',
        setConnectionsMode: jest.fn(), closeCat: jest.fn(), updateCat: jest.fn(),
        category: 'Commentary', filterIndex: 0, recentFilters: [filter], connectionsMode: 'filter',
      }} />);
    });
    const back = inst.root.findAll(n => n.props.accessibilityLabel === strings.common.back && n.props.onPress);
    expect(back.length).toBeGreaterThan(0);
    expect(back[0].props.accessibilityRole).toBe('button');
    act(() => { inst.unmount(); });
  });
});
