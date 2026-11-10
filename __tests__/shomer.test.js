import {
  PRESETS, GROUPS, groupsFor, normalize, presetOf, configForPreset, toggleGroup,
} from '../shomer/presets';
import {
  match, hasWord, filterToc, versionMatch, bookMatch, sheetMatch, filterVersions, RULES,
} from '../shomer/matcher';
import RULES_JSON from '../shomer/rules.json';
import * as shomer from '../shomer';
import { SOURCES, serverFor, exportPathFor, SCHEMA_VERSION } from '../sources';

const cfg = presetId => configForPreset(presetId);

describe('preset ladder', () => {
  test('presets are ordered Centrist MO < RWMO < Yeshivish < Strict Charedi', () => {
    expect(PRESETS.map(p => p.id)).toEqual(['centrist_mo', 'rwmo', 'yeshivish', 'strict_charedi']);
    expect(PRESETS.map(p => p.level)).toEqual([1, 2, 3, 4]);
  });

  test('each preset hides everything the one before it hides, and more', () => {
    for (let i = 1; i < PRESETS.length; i++) {
      const lower = groupsFor(PRESETS[i - 1].id);
      const higher = groupsFor(PRESETS[i].id);
      for (const g of GROUPS) {
        if (lower[g.id]) { expect(higher[g.id]).toBe(true); }
      }
      const count = gs => Object.values(gs).filter(Boolean).length;
      expect(count(higher)).toBeGreaterThan(count(lower));
    }
  });

  test('every group is hidden by Strict Charedi, and the README table holds', () => {
    expect(Object.values(groupsFor('strict_charedi')).every(Boolean)).toBe(true);
    expect(groupsFor('centrist_mo').reform).toBe(true);
    expect(groupsFor('centrist_mo').non_orthodox_translations).toBe(false);
    expect(groupsFor('rwmo').non_orthodox_translations).toBe(true);
    expect(groupsFor('rwmo').jps_1917).toBe(false);
    expect(groupsFor('yeshivish').jps_1917).toBe(true);
    expect(groupsFor('yeshivish').religious_zionist_thought).toBe(false);
    expect(groupsFor('strict_charedi').religious_zionist_thought).toBe(true);
  });

  test('every rule belongs to a known group', () => {
    const ids = new Set(GROUPS.map(g => g.id));
    expect(RULES_JSON.filter(r => !ids.has(r.group)).map(r => r.id)).toEqual([]);
    expect(RULES.length).toBe(RULES_JSON.length);
  });
});

describe('settings', () => {
  test('nothing is chosen silently: no saved setting stays null', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize(undefined)).toBeNull();
  });

  test('a preset round-trips through presetOf', () => {
    for (const p of PRESETS) { expect(presetOf(groupsFor(p.id))).toBe(p.id); }
  });

  test('switching one group by hand gives "custom", switching it back gives the preset', () => {
    const c = toggleGroup(cfg('rwmo'), 'jps_1917', true);
    expect(c.preset).toBe('custom');
    expect(c.groups.jps_1917).toBe(true);
    expect(normalize(c).groups.jps_1917).toBe(true);  // custom groups survive a save/load
    const back = toggleGroup(c, 'jps_1917', false);
    expect(back.preset).toBe('rwmo');
  });

  test('custom with every Yeshivish group equals the Yeshivish preset', () => {
    let c = cfg('rwmo');
    for (const g of GROUPS.filter(g => g.level === 3)) { c = toggleGroup(c, g.id, true); }
    expect(c.preset).toBe('yeshivish');
  });
});

describe('matcher', () => {
  test('whole words only', () => {
    expect(hasWord('maharatz on shas', 'maharat')).toBe(false);
    expect(hasWord('yeshivat maharat', 'maharat')).toBe(true);
    expect(hasWord('torot', 'orot')).toBe(false);
    expect(hasWord('orot hakodesh', 'orot')).toBe(true);
  });

  test('null or inactive config hides nothing', () => {
    expect(match(null, 'King James Version')).toBeNull();
    expect(match({ ...cfg('strict_charedi'), active: false }, 'King James Version')).toBeNull();
  });

  test('Bible translations are "translation" matches: hidden from lists, book kept', () => {
    const m = match(cfg('centrist_mo'), 'King James Version');
    expect(m).toMatchObject({ translation: true, group: 'christian_translations' });
    expect(bookMatch(cfg('centrist_mo'), { title: 'Genesis', heTitle: 'בראשית' })).toBeNull();
  });

  test('versions follow the ladder', () => {
    const njps = { versionTitle: 'Tanakh: The Holy Scriptures, published by JPS' };
    const jps1917 = { versionTitle: 'The Holy Scriptures: A New Translation (JPS 1917)' };
    const koren = { versionTitle: 'The Koren Jerusalem Bible' };
    expect(versionMatch(cfg('centrist_mo'), njps)).toBeNull();
    expect(versionMatch(cfg('rwmo'), njps)).not.toBeNull();
    expect(versionMatch(cfg('rwmo'), jps1917)).toBeNull();
    expect(versionMatch(cfg('yeshivish'), jps1917)).not.toBeNull();
    expect(versionMatch(cfg('strict_charedi'), koren)).toBeNull();
    expect(filterVersions(cfg('yeshivish'), [njps, jps1917, koren])).toEqual([koren]);
  });

  test('books follow the ladder', () => {
    const orot = { title: 'Orot', heTitle: 'אורות' };
    const benSira = { title: 'Ben Sira', heTitle: 'בן סירא' };
    const judith = { title: 'Book of Judith', heTitle: 'יהודית' };
    expect(bookMatch(cfg('centrist_mo'), judith)).not.toBeNull();
    expect(bookMatch(cfg('rwmo'), benSira)).toBeNull();
    expect(bookMatch(cfg('yeshivish'), benSira)).not.toBeNull();
    expect(bookMatch(cfg('yeshivish'), orot)).toBeNull();
    expect(bookMatch(cfg('strict_charedi'), orot)).not.toBeNull();
  });

  test('exceptions: Abulafia\'s Gan Naul is kept, Wessely\'s is hidden', () => {
    expect(bookMatch(cfg('rwmo'), { title: 'Gan Naul' })).not.toBeNull();
    expect(bookMatch(cfg('rwmo'), { title: 'Gan Naul (Abulafia)' })).toBeNull();
  });

  test('the reader\'s own lists win', () => {
    const c = { ...cfg('centrist_mo'), customWhitelist: ['judith'], customBlacklist: ['mishnah berurah'] };
    expect(match(c, 'Book of Judith')).toBeNull();
    expect(match(c, 'Mishnah Berurah')).toMatchObject({ reason: 'your list: mishnah berurah' });
  });

  test('community sheets: hidden from Yeshivish up, except known Orthodox sources', () => {
    expect(sheetMatch(cfg('rwmo'), { title: 'My sheet', id: 5 })).toBeNull();
    expect(sheetMatch(cfg('yeshivish'), { title: 'My sheet', id: 5 })).not.toBeNull();
    expect(sheetMatch(cfg('yeshivish'), { title: 'Shiur', ownerName: 'Orthodox Union', id: 6 })).toBeNull();
  });
});

describe('filterToc', () => {
  const toc = [
    { category: 'Tanakh', heCategory: 'תנ"ך', contents: [
      { title: 'Genesis', heTitle: 'בראשית' },
      { category: 'Apocrypha', heCategory: 'ספרים חיצוניים', contents: [
        { title: 'Book of Judith', heTitle: 'יהודית' },
        { title: 'Ben Sira', heTitle: 'בן סירא' },
      ] },
    ] },
    { category: 'Jewish Thought', contents: [{ title: 'Orot', heTitle: 'אורות' }, { title: 'Kuzari' }] },
  ];

  test('takes out hidden books, drops emptied categories, never changes the input', () => {
    const before = JSON.stringify(toc);
    const hidden = {};
    const out = filterToc(cfg('yeshivish'), toc, hidden);
    expect(JSON.stringify(toc)).toBe(before);
    expect(Object.keys(hidden).sort()).toEqual(['Ben Sira', 'Book of Judith']);
    expect(out[0].contents.map(n => n.title || n.category)).toEqual(['Genesis']);
    expect(out[1].contents.map(n => n.title)).toEqual(['Orot', 'Kuzari']);
  });

  test('more hidden at each step of the ladder', () => {
    const sizes = PRESETS.map(p => { const h = {}; filterToc(cfg(p.id), toc, h); return Object.keys(h).length; });
    expect(sizes).toEqual([1, 1, 2, 3]);
  });

  test('no filter returns the same array', () => {
    expect(filterToc(null, toc)).toBe(toc);
  });
});

describe('runtime helpers (shomer/index.js)', () => {
  const toc = [{ category: 'Thought', contents: [
    { title: 'Orot', heTitle: 'אורות' }, { title: 'Gan Naul' }, { title: 'Gan Naul (Abulafia)' },
    { title: 'Book of Judith' }, { title: 'Genesis' },
  ] }];

  beforeEach(() => {
    global.Sefaria = { booksDict: {}, _cacheIndexFromToc: jest.fn(t => {
      global.Sefaria.booksDict = {};
      const walk = l => l.forEach(n => (n.contents ? walk(n.contents) : (global.Sefaria.booksDict[n.title] = 1)));
      walk(t);
    }) };
    shomer.setConfig(null);
    global.Sefaria.toc = shomer.applyToToc(toc);
    global.Sefaria._cacheIndexFromToc(global.Sefaria.toc, true);
    shomer.setConfig(cfg('strict_charedi'));
  });

  test('changing the setting re-filters the TOC', () => {
    expect(Sefaria.booksDict.Orot).toBeUndefined();
    expect(Sefaria.booksDict['Gan Naul (Abulafia)']).toBe(1);
    shomer.setConfig(cfg('centrist_mo'));
    expect(Sefaria.booksDict.Orot).toBe(1);
    expect(shomer.isBookHidden('Book of Judith')).toBe(true);
    expect(shomer.allBookTitles().sort()).toEqual(['Book of Judith', 'Gan Naul', 'Gan Naul (Abulafia)', 'Genesis', 'Orot']);
  });

  test('hiddenBookForRef takes the longest title, like textTitleForRef', () => {
    expect(shomer.hiddenBookForRef('Orot 1:2')).toMatchObject({ title: 'Orot' });
    expect(shomer.hiddenBookForRef('Gan Naul (Abulafia) 3')).toBeNull();
    expect(shomer.hiddenBookForRef('Gan Naul 3')).toMatchObject({ title: 'Gan Naul' });
    expect(shomer.hiddenBookForRef('Genesis 1')).toBeNull();
    expect(shomer.hiddenBookForRef(undefined)).toBeNull();
  });

  test('search hits and path filters of hidden books and translations are dropped', () => {
    const data = {
      hits: { total: 4, hits: [
        { _id: 'a', _source: { ref: 'Orot 1:1', version: 'x' } },
        { _id: 'b', _source: { ref: 'Genesis 1:1', version: 'The Koren Jerusalem Bible' } },
        { _id: 'c', _source: { ref: 'Genesis 1:1', version: 'Tanakh: The Holy Scriptures, published by JPS' } },
        { _id: 'd', _source: { ref: 'Gan Naul (Abulafia) 1', version: 'y' } },
      ] },
      aggregations: { path: { buckets: [{ key: 'Thought/Orot' }, { key: 'Tanakh/Genesis' }] } },
    };
    const out = shomer.filterSearchResponse('text', data);
    expect(out.hits.hits.map(h => h._id)).toEqual(['b', 'd']);
    expect(out.hits.total).toBe(2);
    expect(out.aggregations.path.buckets.map(b => b.key)).toEqual(['Tanakh/Genesis']);
    expect(data.hits.hits.length).toBe(4);  // input untouched
  });

  test('autocomplete drops hidden books, authors and refs', () => {
    const out = shomer.filterNameResponse({
      is_ref: true, ref: 'Orot 1', book: 'Orot',
      completion_objects: [
        { title: 'Orot', key: 'Orot', type: 'ref' },
        { title: 'Rav Kook', key: 'rav-kook', type: 'AuthorTopic' },
        { title: 'Genesis', key: 'Genesis', type: 'ref' },
      ],
      completions: ['Orot', 'Genesis'],
    });
    expect(out.completion_objects.map(c => c.title)).toEqual(['Genesis']);
    expect(out.completions).toEqual(['Genesis']);
    expect(out.is_ref).toBe(false);
  });

  test('a hidden English translation is taken out of a loaded section, Hebrew kept', () => {
    const tc = { versionTitle: 'King James Version', content: [{ text: 'In the beginning', he: 'בראשית' }] };
    const out = shomer.stripHiddenEnglish(tc);
    expect(out.content[0]).toEqual({ text: '', he: 'בראשית' });
    expect(out.shomerHiddenTranslation).toBe('King James Version');
    expect(tc.content[0].text).toBe('In the beginning');
    const ok = { versionTitle: 'The Koren Jerusalem Bible', content: [] };
    expect(shomer.stripHiddenEnglish(ok)).toBe(ok);
  });

  test('translations and related sheets', () => {
    expect(shomer.filterTranslations({ versions: [{ versionTitle: 'King James Version' }, { versionTitle: 'Metsudah Chumash' }] }).versions)
      .toEqual([{ versionTitle: 'Metsudah Chumash' }]);
    expect(shomer.filterRelated({ links: [1], sheets: [{ id: 1, title: 'x' }] }).sheets).toEqual([]);
  });
});

describe('library sources', () => {
  test('Sefaria is the one working source, on Sefaria\'s own mobile download server', () => {
    const working = SOURCES.filter(s => s.enabled && s.available);
    expect(working.map(s => s.id)).toEqual(['sefaria']);
    expect(serverFor('sefaria')).toBe('https://readonly.sefaria.org');
    expect(exportPathFor('sefaria')).toBe(`https://readonly.sefaria.org/static/ios-export/${SCHEMA_VERSION}`);
  });

  test('the others are registered as coming soon', () => {
    expect(SOURCES.filter(s => !s.available).map(s => s.id))
      .toEqual(['dicta', 'otzaria', 'wikisource', 'soferbooks_extras']);
  });
});
