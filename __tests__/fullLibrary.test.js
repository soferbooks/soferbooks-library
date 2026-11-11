/**
 * "Full library" (owner, 2026-11-11): its parts with their sizes (fullLibrary.js), the extra
 * sources' books downloaded in the background one at a time (extrasQueue.js), and the Settings
 * panel (FullLibraryPanel.js). The extra sources are a made-up stand-in here (SYNTHETIC TEST
 * FIXTURE: not real books); extras/ itself is tested in extras.test.js and soferLibrary.test.js.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as extras from '../extras';
import * as shomer from '../shomer';
import * as queue from '../extrasQueue';
import {
  estimate, estimateAll, formatSize, sizeOfEntry, fullLibraryParts, fullLibrarySources, onPackageChosen, FULL_LIBRARY,
} from '../fullLibrary';
import SIZES from '../fullLibrarySizes.json';
import { FullLibraryPanel, partLines } from '../FullLibraryPanel';
import TestContextWrapper from '../TestContextWrapper';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ type: 'wifi', isConnected: true })), addEventListener: jest.fn() },
}));

jest.mock('../extras', () => {
  const fake = {
    __esModule: true,
    books: {}, enabled: {}, installed: {}, downloads: [], fail: new Set(),
    subscribe: jest.fn(() => () => {}),
    getBooks: () => fake.books,
    isEnabled: id => !!fake.enabled[id],
    isDownloaded: t => t in fake.installed,
    downloadedBooks: id => Object.keys(fake.installed).filter(t => fake.installed[t] === id),
    installedTitles: id => Object.keys(fake.installed).filter(t => fake.installed[t] === id),
    loadExtras: jest.fn(async () => {}),
    setSourceEnabled: jest.fn(async (id, on) => { fake.enabled[id] = on; }),
    cancelDownload: jest.fn(),
    downloadBook: jest.fn(async title => {
      fake.downloads.push(title);
      if (fake.fail.has(title)) { throw new Error('server error'); }
      fake.installed[title] = fake.books[title].source;
      return title;
    }),
    DownloadCancelledError: class extends Error {},
    RestrictedBookError: class extends Error {},
  };
  return fake;
});

jest.mock('../shomer', () => ({ __esModule: true, isBookHidden: jest.fn(() => false), subscribe: jest.fn(() => () => {}) }));

const book = (title, source, extra = {}) => ({ title, heTitle: title, source, id: title, ...extra });

function library() {
  extras.books = {
    'Otz A': book('Otz A', 'otzaria', { heTitle: 'ספר א' }),
    'Otz B': book('Otz B', 'otzaria', { heTitle: 'ספר ב' }),
    'Hidden': book('Hidden', 'otzaria'),
    'Dicta A': book('Dicta A', 'dicta'),
    'Sofer A': book('Sofer A', 'sofer_library', { size: 2 * 1024 * 1024, companions: [{ size: 1024 * 1024 }] }),
  };
  extras.enabled = {};
  extras.installed = {};
  extras.downloads = [];
  extras.fail = new Set();
  shomer.isBookHidden.mockImplementation(t => t === 'Hidden');
}

const sizes = {
  ratios: { otzaria: 1.5, dicta: 4, sofer_library: 3 },
  totals: { dicta: { books: 1156, downloadKB: 1000000, phoneKB: 4000000 } },
  otzaria: { 'ספר א': 100, 'ספר ב': 300 },
  dicta: { 'Dicta A': 50 },
};

beforeEach(async () => {
  library();
  queue._reset();
  await AsyncStorage.clear();
  NetInfo.fetch.mockImplementation(async () => ({ type: 'wifi', isConnected: true }));
});

describe('the parts and their sizes', () => {
  test('Sefaria\'s library and every extra source', () => {
    expect(fullLibraryParts()).toEqual(['sefaria', 'dicta', 'otzaria', 'wikisource', 'sofer_library']);
    expect(fullLibrarySources()).toEqual(['dicta', 'otzaria', 'wikisource', 'sofer_library']);
  });

  test('a book\'s download: the table\'s size (Otzaria by Hebrew name, Dicta by file), the Sofer Library\'s own, else the average', () => {
    expect(sizeOfEntry(extras.books['Otz A'], sizes)).toBe(100);
    expect(sizeOfEntry(book('x', 'otzaria', { heTitle: 'unknown' }), sizes)).toBe(200);
    expect(sizeOfEntry(extras.books['Dicta A'], sizes)).toBe(50);
    expect(sizeOfEntry(extras.books['Sofer A'], sizes)).toBe(3072);      // (the book and its notes)
  });

  test('a source turned on is counted from its catalogue, without the books the filter hides', () => {
    extras.enabled = { otzaria: true };
    expect(estimate('otzaria', { sizes })).toEqual({ books: 2, downloadKB: 400, phoneKB: 600, measured: true });
  });

  test('a source still off uses the table\'s totals (made the same way)', () => {
    expect(estimate('dicta', { sizes })).toEqual({ books: 1156, downloadKB: 1000000, phoneKB: 4000000, measured: false });
  });

  test('Sefaria\'s part is its COMPLETE LIBRARY package; the total adds the parts chosen', () => {
    const { parts, total } = estimateAll(['sefaria', 'dicta'], { sefariaBytes: 2 * 1024 * 1024 * 1024, sizes });
    expect(parts.sefaria.downloadKB).toBe(2 * 1024 * 1024);
    expect(total.downloadKB).toBe(2 * 1024 * 1024 + 1000000);
  });

  test('sizes are shown as MB / GB', () => {
    expect(formatSize(300 * 1000 / 1.024)).toBe('300 MB');
    expect(formatSize(2.8e6 / 1.024)).toBe('2.8 GB');
  });

  test('the bundled table has every source\'s measured ratio and totals', () => {
    for (const id of ['otzaria', 'dicta', 'wikisource', 'sofer_library']) {
      expect(SIZES.ratios[id]).toBeGreaterThan(0);
      expect(SIZES.totals[id].books).toBeGreaterThan(0);
      expect(SIZES.totals[id].downloadKB).toBeGreaterThan(0);
    }
  });
});

describe('the background download', () => {
  const run = async () => { await queue._loop(); };

  test('choosing the whole library turns every extra source on and downloads their books, one at a time, not the hidden ones', async () => {
    expect(await onPackageChosen('TANAKH')).toEqual([]);
    expect(extras.downloadBook).not.toHaveBeenCalled();
    await onPackageChosen(FULL_LIBRARY, queue);
    await run();
    expect(Object.keys(extras.enabled).sort()).toEqual(['dicta', 'otzaria', 'sofer_library', 'wikisource']);
    expect(extras.downloads).toEqual(['Dicta A', 'Otz A', 'Otz B', 'Sofer A']);
    expect(extras.downloads).not.toContain('Hidden');
    expect(queue.getState()).toMatchObject({ running: false, status: 'done' });
    expect(queue.progressOf('otzaria')).toEqual({ done: 2, total: 2, doneKB: expect.any(Number), totalKB: expect.any(Number) });
  });

  test('only the sources ticked', async () => {
    await queue.start(['dicta']);
    await run();
    expect(extras.downloads).toEqual(['Dicta A']);
  });

  test('a book that fails is tried again once, then skipped', async () => {
    extras.fail.add('Otz A');
    await queue.start(['otzaria']);
    await run();
    expect(extras.downloads).toEqual(['Otz A', 'Otz A', 'Otz B']);
    expect(queue.getState().failed).toEqual({ 'Otz A': 2 });
  });

  test('on Wi-Fi only it waits on a mobile network; with the switch off it goes on', async () => {
    NetInfo.fetch.mockImplementation(async () => ({ type: 'cellular', isConnected: true }));
    const seen = [];
    const off = queue.subscribe(() => {
      const s = queue.getState();
      seen.push(s.status);
      if (s.status === 'waiting_network') { queue.pause(); }
    });
    await queue.start(['dicta']);
    await run();
    off();
    expect(seen).toContain('waiting_network');
    expect(extras.downloads).toEqual([]);
    await queue.setWifiOnly(false);
    await queue.resume();
    await run();
    expect(extras.downloads).toEqual(['Dicta A']);
  });

  test('Pause stops after the book under way; Resume goes on; Cancel forgets the queue', async () => {
    const off = queue.subscribe(() => { if (extras.downloads.length === 1 && !queue.getState().paused) { queue.pause(); } });
    await queue.start(['otzaria']);
    await run();
    off();
    expect(extras.downloads).toEqual(['Otz A']);
    expect(queue.getState()).toMatchObject({ paused: true, running: true });
    await queue.resume();
    await run();
    expect(extras.downloads).toEqual(['Otz A', 'Otz B']);
    await queue.cancel();
    expect(queue.getState()).toMatchObject({ sources: [], running: false });
  });

  test('after a restart it goes on where it was', async () => {
    await AsyncStorage.setItem(queue.STORAGE_KEY, JSON.stringify({ sources: ['otzaria'], running: true, paused: false, wifiOnly: true, failed: {} }));
    extras.installed = { 'Otz A': 'otzaria' };
    queue._reset({}, { polite: 0, retry: 0 });
    await queue._resetLoaded();
    await queue.resumeIfRunning();
    await run();
    expect(extras.downloads).toEqual(['Otz B']);
  });
});

describe('the Settings panel', () => {
  test('every part ticked, with its sizes, and the total', () => {
    let inst;
    act(() => { inst = renderer.create(<TestContextWrapper child={FullLibraryPanel} childProps={{ langStyle: {} }} />); });
    const parts = fullLibraryParts();
    for (const id of parts) {
      const row = inst.root.findByProps({ testID: `full-library-part-${id}` });
      expect(row.props.accessibilityState).toEqual({ checked: true });
    }
    const text = node => [].concat(node.props.children).join('');
    const total = inst.root.findByProps({ testID: 'full-library-total' });
    expect(text(total)).toBe(partLines(parts, false).totalLine);
    act(() => { inst.root.findByProps({ testID: 'full-library-part-dicta' }).props.onPress(); });
    expect(inst.root.findByProps({ testID: 'full-library-part-dicta' }).props.accessibilityState).toEqual({ checked: false });
    expect(text(inst.root.findByProps({ testID: 'full-library-total' })))
      .toBe(partLines(parts.filter(p => p !== 'dicta'), false).totalLine);
  });
});
