/**
 * Search-box autocomplete while offline: the library's own titles answer at once, and the
 * Name API is asked only after a pause in typing, only when online, and not again right
 * after it failed (QA: "Name API error" per keystroke while offline).
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import NetInfo from '@react-native-community/netinfo';
import {
  localNameResults, shouldCallNameApi, noteNameApiFailure, noteNameApiSuccess, NAME_DEBOUNCE_MS, NAME_RETRY_MS,
} from '../search/localAutocomplete';
import AutocompleteList from '../search/AutocompleteList';
import { GlobalStateContext, DEFAULT_STATE } from '../StateManager';

const inContext = el => <GlobalStateContext.Provider value={DEFAULT_STATE}>{el}</GlobalStateContext.Provider>;

// sefaria.js adds this to every array; AutocompleteList relies on it
if (!Array.prototype.stableSort) {
  // eslint-disable-next-line no-extend-native
  Array.prototype.stableSort = function(cmp) {
    return this.map((el, i) => [el, i]).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map(x => x[0]);
  };
}

const INDEX = {
  Genesis: {title: 'Genesis', heTitle: 'בראשית'},
  'Rashi on Genesis': {title: 'Rashi on Genesis', heTitle: 'רש"י על בראשית'},
  Berakhot: {title: 'Berakhot', heTitle: 'ברכות'},
};

beforeEach(() => {
  global.Sefaria = {
    booksDict: {Genesis: 1, 'Rashi on Genesis': 1, Berakhot: 1},
    index: t => INDEX[t],
    toc: [{category: 'Tanakh', heCategory: 'תנ"ך', contents: [
      {category: 'Torah', heCategory: 'תורה', contents: [{title: 'Genesis'}]}]}],
    recentQueries: [],
    shomer: null,
    addPageToWholeDafRef: ref => ref,
    saveRecentQuery: () => {},
    api: {name: jest.fn(() => Promise.resolve({completion_objects: [{title: 'Genesis (API)', key: 'Genesis', type: 'ref'}], lang: 'en'}))},
  };
  noteNameApiSuccess();
  NetInfo.fetch.mockResolvedValue({isConnected: true, isInternetReachable: true});
});

test('titles, Hebrew titles, categories and refs come from the library', () => {
  expect(localNameResults('gen').completion_objects.map(c => c.title)).toEqual(['Genesis', 'Rashi on Genesis']);
  expect(localNameResults('בראש').completion_objects.map(c => c.title)).toEqual(['בראשית', 'רש"י על בראשית']);
  expect(localNameResults('tor').completion_objects).toEqual([
    {title: 'Torah', key: ['Tanakh', 'Torah'], type: 'toc', is_primary: true}]);
  expect(localNameResults('Genesis 1:3')).toMatchObject({is_ref: true, ref: 'Genesis 1:3', index: 'Genesis', is_book: false});
  expect(localNameResults('genesis')).toMatchObject({is_ref: true, ref: 'Genesis', is_book: true});
  expect(localNameResults('Genesis rabbah').is_ref).toBe(false);
});

test('the Name API is skipped offline and for a while after it failed', async () => {
  expect(await shouldCallNameApi()).toBe(true);
  NetInfo.fetch.mockResolvedValueOnce({isConnected: false, isInternetReachable: false});
  expect(await shouldCallNameApi()).toBe(false);
  noteNameApiFailure(1000);
  expect(await shouldCallNameApi(1000 + NAME_RETRY_MS - 1)).toBe(false);
  expect(await shouldCallNameApi(1000 + NAME_RETRY_MS)).toBe(true);
});

describe('AutocompleteList', () => {
  const props = q => ({
    interfaceLanguage: 'english', theme: {}, themeStr: 'white', query: q,
    openRef: jest.fn(), openTextTocDirectly: jest.fn(), setCategories: jest.fn(),
    search: jest.fn(), openUri: jest.fn(), setQueryRef: jest.fn(),
  });
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  async function type(tree, queries) {
    for (const q of queries) {
      await act(async () => { tree.update(inContext(<AutocompleteList {...props(q)} />)); });
    }
  }

  test('typing shows local results at once and asks the API once, after the pause', async () => {
    let tree;
    await act(async () => { tree = renderer.create(inContext(<AutocompleteList {...props('')} />)); });
    await type(tree, ['gen', 'gene', 'genes']);
    const list = tree.root.findByType(AutocompleteList).instance;
    expect(list.state.completions.map(c => c.title)).toContain('Genesis');
    expect(Sefaria.api.name).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(NAME_DEBOUNCE_MS); });
    await act(async () => { await Promise.resolve(); });
    expect(Sefaria.api.name).toHaveBeenCalledTimes(1);
    expect(Sefaria.api.name).toHaveBeenCalledWith('genes', true);
    act(() => { tree.unmount(); });
  });

  test('offline: no Name API request at all, local results stay', async () => {
    NetInfo.fetch.mockResolvedValue({isConnected: false, isInternetReachable: false});
    let tree;
    await act(async () => { tree = renderer.create(inContext(<AutocompleteList {...props('')} />)); });
    await type(tree, ['ber', 'bera', 'berak']);
    await act(async () => { jest.advanceTimersByTime(NAME_DEBOUNCE_MS * 2); });
    await act(async () => { await Promise.resolve(); });
    expect(Sefaria.api.name).not.toHaveBeenCalled();
    expect(tree.root.findByType(AutocompleteList).instance.state.completions.map(c => c.title))
      .toEqual(['Berakhot', 'Search for: "berak"']);
    act(() => { tree.unmount(); });
  });

  test('a failed request keeps the local list and is not retried per keystroke', async () => {
    Sefaria.api.name.mockImplementation(() => Promise.reject(new Error('offline')));
    let tree;
    await act(async () => { tree = renderer.create(inContext(<AutocompleteList {...props('')} />)); });
    await type(tree, ['gen']);
    await act(async () => { jest.advanceTimersByTime(NAME_DEBOUNCE_MS); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(Sefaria.api.name).toHaveBeenCalledTimes(1);
    await type(tree, ['gene']);
    await act(async () => { jest.advanceTimersByTime(NAME_DEBOUNCE_MS); });
    await act(async () => { await Promise.resolve(); });
    expect(Sefaria.api.name).toHaveBeenCalledTimes(1);
    expect(tree.root.findByType(AutocompleteList).instance.state.completions.map(c => c.title)).toContain('Genesis');
    act(() => { tree.unmount(); });
  });
});
