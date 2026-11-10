import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  INLINE_COMMENTARY_STORAGE_KEY,
  getInlineCommentary,
  setInlineCommentary,
  loadInlineCommentaryPrefs,
  saveInlineCommentaryPrefs,
  availableInlineSources,
  refsForSource,
} from '../reader/inlineCommentaryPrefs';
import {
  createAnchor, isAnchorActive, anchorCorrection, renderedIndexRange, ANCHOR_TOP_INSET, ANCHOR_MAX_MS,
} from '../reader/scrollAnchor';
import { loadCommentTexts, _clearInlineCommentaryCache } from '../reader/InlineCommentary';
import { panelFlexForTouch, panelReleaseAction, loadPanelFlexPreference, savePanelFlexPreference, DEFAULT_PANEL_FLEX } from '../reader/panelLayout';

const link = (category, textTitle, sourceRef, collectiveTitle = null, heCollectiveTitle = null) =>
  ({ category, textTitle, sourceRef, collectiveTitle, heCollectiveTitle });

describe('"show under each passage" preference is per sefer', () => {
  beforeEach(() => AsyncStorage.clear());

  test('set, get and clear for one book without touching others', () => {
    let prefs = {};
    prefs = setInlineCommentary(prefs, 'Genesis', 'Onkelos Genesis');
    prefs = setInlineCommentary(prefs, 'Berakhot', 'Rashi');
    expect(getInlineCommentary(prefs, 'Genesis')).toBe('Onkelos Genesis');
    expect(getInlineCommentary(prefs, 'Berakhot')).toBe('Rashi');
    expect(getInlineCommentary(prefs, 'Exodus')).toBeNull();
    const cleared = setInlineCommentary(prefs, 'Genesis', null);
    expect(getInlineCommentary(cleared, 'Genesis')).toBeNull();
    expect(getInlineCommentary(cleared, 'Berakhot')).toBe('Rashi');
    expect(getInlineCommentary(prefs, 'Genesis')).toBe('Onkelos Genesis');  // not mutated
    expect(setInlineCommentary(prefs, null, 'Rashi')).toBe(prefs);
  });

  test('persisted across restarts', async () => {
    expect(await loadInlineCommentaryPrefs()).toEqual({});
    await saveInlineCommentaryPrefs({ 'Mishnah Berakhot': 'Bartenura' });
    expect(JSON.parse(await AsyncStorage.getItem(INLINE_COMMENTARY_STORAGE_KEY))).toEqual({ 'Mishnah Berakhot': 'Bartenura' });
    expect(await loadInlineCommentaryPrefs()).toEqual({ 'Mishnah Berakhot': 'Bartenura' });
    await AsyncStorage.setItem(INLINE_COMMENTARY_STORAGE_KEY, '[1,2]');
    expect(await loadInlineCommentaryPrefs()).toEqual({});
  });
});

describe('inline sources come from the links the reader already loaded', () => {
  const related = {
    'Genesis 1': [
      { links: [
        link('Commentary', 'Rashi on Genesis', 'Rashi on Genesis 1:1:1', 'Rashi', 'רש"י'),
        link('Commentary', 'Rashi on Genesis', 'Rashi on Genesis 1:1:2', 'Rashi', 'רש"י'),
        link('Targum', 'Onkelos Genesis', 'Onkelos Genesis 1:1'),
        link('Talmud', 'Chagigah', 'Chagigah 12a:1'),
        link('Commentary', 'Abarbanel on Torah', 'Abarbanel on Torah, Genesis 1:1:1'),
      ] },
      { links: [
        link('Targum', 'Onkelos Genesis', 'Onkelos Genesis 1:2'),
        link('Commentary', 'Abarbanel on Torah', 'Abarbanel on Torah, Genesis 1:2:1'),
        link('Commentary', 'Abarbanel on Torah', 'Abarbanel on Torah, Genesis 1:2:2'),
      ] },
    ],
  };

  test('lists commentaries and targumim only, targum first, then well-known names', () => {
    const sources = availableInlineSources(related, t => (t === 'Onkelos Genesis' ? 'אונקלוס בראשית' : null));
    expect(sources.map(s => s.key)).toEqual(['Onkelos Genesis', 'Rashi', 'Abarbanel on Torah']);
    expect(sources[0]).toMatchObject({ he: 'אונקלוס בראשית', category: 'Targum', count: 2 });
    expect(sources[1]).toMatchObject({ he: 'רש"י', count: 2 });
    expect(availableInlineSources({})).toEqual([]);
    expect(availableInlineSources(undefined)).toEqual([]);
  });

  test("a segment's text refs for the chosen source", () => {
    const seg0 = related['Genesis 1'][0].links;
    expect(refsForSource(seg0, 'Rashi')).toEqual(['Rashi on Genesis 1:1:1', 'Rashi on Genesis 1:1:2']);
    expect(refsForSource(seg0, 'Onkelos Genesis')).toEqual(['Onkelos Genesis 1:1']);
    expect(refsForSource(seg0, 'Ramban')).toEqual([]);
    expect(refsForSource(undefined, 'Rashi')).toEqual([]);
    expect(refsForSource(seg0, null)).toEqual([]);
  });
});

describe('connections panel divider', () => {
  beforeEach(() => AsyncStorage.clear());

  test('panel share follows the finger within the reader body', () => {
    // body from y=100 to y=900
    expect(panelFlexForTouch(500, 100, 800)).toBeCloseTo(0.5);
    expect(panelFlexForTouch(300, 100, 800)).toBeCloseTo(0.75);
    expect(panelFlexForTouch(300, 100, 800, -0.05)).toBeCloseTo(0.7);
    expect(panelFlexForTouch(0, 100, 800)).toBeCloseTo(0.999);
    expect(panelFlexForTouch(2000, 100, 800)).toBeCloseTo(0.001);
  });

  test('release snaps to full / closed or keeps the height', () => {
    expect(panelReleaseAction(0.95)).toBe('full');
    expect(panelReleaseAction(0.1)).toBe('close');
    expect(panelReleaseAction(0.45)).toBe('keep');
  });

  test('chosen height is remembered', async () => {
    expect(await loadPanelFlexPreference()).toBe(DEFAULT_PANEL_FLEX);
    await savePanelFlexPreference(0.42);
    expect(await loadPanelFlexPreference()).toBeCloseTo(0.42);
  });
});

describe('the reader keeps the opened passage in place while the list settles', () => {
  test('the anchor segment is scrolled back to its spot when content above it changes height', () => {
    // opened at 447:11, whose top is at y=5000: the list sits ANCHOR_TOP_INSET above it
    expect(anchorCorrection({ cellY: 5000, currentY: 5000 - ANCHOR_TOP_INSET })).toBeNull();
    // the inline Mishnah Berurah above arrived and pushed it down 1200px: follow it
    expect(anchorCorrection({ cellY: 6200, currentY: 4900 })).toEqual({ offset: 6100, seek: false });
    // sub-pixel noise is ignored
    expect(anchorCorrection({ cellY: 5001, currentY: 4900 })).toBeNull();
    // near the top of the text
    expect(anchorCorrection({ cellY: 40, currentY: 300 })).toEqual({ offset: 0, seek: false });
  });

  test('when the target is not rendered, it moves towards it', () => {
    const base = { cellY: null, currentY: 3000, viewportHeight: 1000 };
    expect(anchorCorrection({ ...base, targetIndex: 5, renderedRange: [10, 20] })).toEqual({ offset: 2200, seek: true });
    expect(anchorCorrection({ ...base, targetIndex: 30, renderedRange: [10, 20] })).toEqual({ offset: 3800, seek: true });
    expect(anchorCorrection({ ...base, targetIndex: 15, renderedRange: [10, 20] })).toBeNull();
    expect(anchorCorrection({ ...base, targetIndex: 15, renderedRange: null })).toBeNull();
  });

  test('rendered range and expiry', () => {
    const map = new Map([['A 1', 0], ['A 1:1', 1], ['A 1:2', 2], ['A 1:3', 3]]);
    expect(renderedIndexRange(new Set(['A 1:2', 'A 1:1', 'unknown']), map)).toEqual([1, 2]);
    expect(renderedIndexRange(new Set(), map)).toBeNull();
    const a = createAnchor('A 1:3', 1000);
    expect(isAnchorActive(a, 1000 + ANCHOR_MAX_MS - 1)).toBe(true);
    expect(isAnchorActive(a, 1000 + ANCHOR_MAX_MS)).toBe(false);
    expect(createAnchor(null)).toBeNull();
    expect(isAnchorActive(null)).toBe(false);
  });
});

describe('inline commentary loads in batches', () => {
  beforeEach(() => _clearInlineCommentaryCache());

  test("a segment's comments resolve together, each ref loaded once, a few at a time", async () => {
    let running = 0;
    let maxRunning = 0;
    const load = jest.fn(ref => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      return new Promise(resolve => setTimeout(() => { running--; resolve({ result: { he: ref + ' he', en: [ref + ' en'] } }); }, 1));
    });
    const refs = Array.from({ length: 12 }, (_, i) => `Mishnah Berurah 447:${i + 1}`);
    const [a, b] = await Promise.all([loadCommentTexts(refs, load), loadCommentTexts(refs.slice(0, 3), load)]);
    expect(a.map(t => t.en)).toEqual(refs.map(r => r + ' en'));
    expect(b.map(t => t.he)).toEqual(refs.slice(0, 3).map(r => r + ' he'));
    expect(load).toHaveBeenCalledTimes(12);
    expect(maxRunning).toBeLessThanOrEqual(3);
    await loadCommentTexts(refs, load);  // cached
    expect(load).toHaveBeenCalledTimes(12);
  });

  test('a failed load shows nothing rather than failing the segment', async () => {
    const texts = await loadCommentTexts(['Bad 1'], () => Promise.reject(new Error('x')));
    expect(texts).toEqual([{ he: '', en: '' }]);
  });
});
