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
