import {
  PRESETS, CHOICES, GROUPS, groupsFor, normalize, presetOf, configForPreset, toggleGroup,
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
    // apocrypha: shown in Centrist MO and RWMO, hidden from Yeshivish up (2026-11)
    expect(bookMatch(cfg('centrist_mo'), judith)).toBeNull();
    expect(bookMatch(cfg('rwmo'), judith)).toBeNull();
    expect(bookMatch(cfg('yeshivish'), judith)).toMatchObject({ group: 'sefarim_chitzoniim' });
    // Ben Sira: shown at every preset
    for (const p of CHOICES) { expect(bookMatch(cfg(p.id), benSira)).toBeNull(); }
    expect(bookMatch(cfg('yeshivish'), orot)).toBeNull();
    expect(bookMatch(cfg('strict_charedi'), orot)).not.toBeNull();
  });

  test('owner\'s ruling 2026-11: Ben Sira and Maccabees everywhere; other apocrypha from Yeshivish up', () => {
    const shown = ['Ben Sira', 'The Book of Maccabees I', 'The Book of Maccabees I (Kahana Translation)',
      'The Book of Maccabees II', 'The Book of Maccabees III', 'The Book of Maccabees IV', 'Megillat Antiochus'];
    for (const p of CHOICES) {
      for (const title of shown) { expect(bookMatch(cfg(p.id), { title })).toBeNull(); }
    }
    const apocrypha = ['Book of Jubilees', 'Book of Judith', 'Book of Tobit', 'Psalm 151', 'Psalm 154',
      'The Book of Susanna', 'The Testaments of the Twelve Patriarchs', 'The Wisdom of Solomon',
      'Prayer of Manasseh', 'Letter of Aristeas'];
    for (const title of apocrypha) {
      for (const p of ['off', 'centrist_mo', 'rwmo']) { expect(bookMatch(cfg(p), { title })).toBeNull(); }
      for (const p of ['yeshivish', 'strict_charedi']) {
        expect(bookMatch(cfg(p), { title })).toMatchObject({ group: 'sefarim_chitzoniim' });
      }
    }
    // the other level-1 exclusions stay hidden everywhere
    expect(bookMatch(cfg('centrist_mo'), { title: 'Toldot Yeshu' })).toMatchObject({ group: 'polemics' });
    expect(versionMatch(cfg('centrist_mo'), { versionTitle: 'King James Version' })).toMatchObject({ group: 'christian_translations' });
    expect(GROUPS.some(g => g.id === 'historical_apocrypha')).toBe(false);
  });

  test('exceptions: Abulafia\'s Gan Naul is kept, Wessely\'s is hidden', () => {
    expect(bookMatch(cfg('rwmo'), { title: 'Gan Naul' })).not.toBeNull();
    expect(bookMatch(cfg('rwmo'), { title: 'Gan Naul (Abulafia)' })).toBeNull();
  });

  test('the reader\'s own lists win', () => {
    const c = { ...cfg('yeshivish'), customWhitelist: ['judith'], customBlacklist: ['mishnah berurah'] };
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
    expect(Object.keys(hidden).sort()).toEqual(['Book of Judith']);
    expect(out[0].contents.map(n => n.title || n.category)).toEqual(['Genesis', 'Apocrypha']);
    expect(out[0].contents[1].contents.map(n => n.title)).toEqual(['Ben Sira']);
    expect(out[1].contents.map(n => n.title)).toEqual(['Orot', 'Kuzari']);
  });

  test('more hidden at each step of the ladder', () => {
    const sizes = PRESETS.map(p => { const h = {}; filterToc(cfg(p.id), toc, h); return Object.keys(h).length; });
    expect(sizes).toEqual([0, 0, 1, 2]);
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
    expect(shomer.isBookHidden('Book of Judith')).toBe(true);
    shomer.setConfig(cfg('rwmo'));
    expect(Sefaria.booksDict.Orot).toBe(1);
    expect(shomer.isBookHidden('Book of Judith')).toBe(false);   // apocrypha: from Yeshivish up
    expect(shomer.isBookHidden('Gan Naul')).toBe(true);
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

  test('History/Saved previews (bulktext, version unknown) keep only the Hebrew while the filter is on', () => {
    const previews = { 'Genesis 1:3': { en: 'God said, "Let there be light"', he: 'וַיֹּאמֶר', heRef: 'בראשית א:ג' } };
    const out = shomer.stripPreviewEnglish(previews);
    expect(out['Genesis 1:3']).toEqual({ en: '', he: 'וַיֹּאמֶר', heRef: 'בראשית א:ג' });
    expect(previews['Genesis 1:3'].en).toMatch(/light/);  // input untouched
    shomer.setConfig({ preset: 'off' });
    expect(shomer.stripPreviewEnglish(previews)).toBe(previews);
  });

  test('a single-ref preview (links panel) drops a hidden English, keeps an allowed one', () => {
    const hidden = { en: 'God said', he: 'וַיֹּאמֶר', versionTitle: 'Tanakh: The Holy Scriptures, published by JPS' };
    expect(shomer.stripHiddenPreviewEnglish(hidden)).toMatchObject({ en: '', he: 'וַיֹּאמֶר', versionTitle: null });
    const ok = { en: 'And God said', he: 'וַיֹּאמֶר', versionTitle: 'The Koren Jerusalem Bible' };
    expect(shomer.stripHiddenPreviewEnglish(ok)).toBe(ok);
    // English from an unknown version is not trusted while the filter is on
    expect(shomer.stripHiddenPreviewEnglish({ en: 'x', he: 'y' }).en).toBe('');
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
      .toEqual(['wikisource', 'soferbooks_extras']);
  });

  test('Dicta and Otzaria are extra sources the reader turns on (extras/), off by default', () => {
    expect(SOURCES.filter(s => s.extra && s.available).map(s => s.id)).toEqual(['dicta', 'otzaria']);
    expect(SOURCES.filter(s => s.extra).every(s => !s.enabled)).toBe(true);
  });
});

describe('"Off"', () => {
  test('is offered beside the four presets, last, and hides nothing', () => {
    expect(CHOICES.map(p => p.id)).toEqual(['centrist_mo', 'rwmo', 'yeshivish', 'strict_charedi', 'off']);
    const off = cfg('off');
    expect(off).toMatchObject({ preset: 'off', active: false });
    expect(Object.values(off.groups).some(Boolean)).toBe(false);
    expect(match(off, 'King James Version')).toBeNull();
    expect(bookMatch(off, { title: 'Book of Judith' })).toBeNull();
    const toc = [{ title: 'Book of Judith' }];
    expect(filterToc(off, toc)).toBe(toc);
  });

  test('is a choice, not "not chosen yet", and survives a save/load', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize(JSON.parse(JSON.stringify(cfg('off'))))).toEqual(cfg('off'));
    expect(normalize({ preset: 'rwmo', active: false }).preset).toBe('off');
  });

  test('switching a group on from Off turns the filter on; switching it back is Off again', () => {
    const on = toggleGroup(cfg('off'), 'reform', true);
    expect(on).toMatchObject({ preset: 'custom', active: true });
    expect(match(on, 'Gunther Plaut')).not.toBeNull();
    expect(toggleGroup(on, 'reform', false)).toMatchObject({ preset: 'off', active: false });
  });

  test('every choice and group has an English and a Hebrew name', () => {
    const en = require('../i18n/en.json');
    const he = require('../i18n/he.json');
    const ids = CHOICES.map(p => `filter.preset_${p.id}`)
      .concat(GROUPS.map(g => `filter.group_${g.id}`), GROUPS.map(g => `filter.group_${g.id}_short`));
    const hebrew = s => /[֐-׿]/.test(s) || s === 'JPS 1917';
    expect(ids.filter(id => !en[id] || !he[id] || !hebrew(he[id]))).toEqual([]);
  });
});

describe('rule fixes (checked against Sefaria\'s real toc.json, 2026-11)', () => {
  const visible = (presetId, entry) => bookMatch(cfg(presetId), entry) === null;

  test('"Jewish Legal Writings by Women" is not Haskalah: hidden only as a work by women (Yeshivish up)', () => {
    const book = { title: 'Jewish Legal Writings by Women', heTitle: 'נשים בדיון הלכתי' };
    expect(visible('centrist_mo', book)).toBe(true);
    expect(visible('rwmo', book)).toBe(true);
    expect(bookMatch(cfg('yeshivish'), book)).toMatchObject({ group: 'women_authors' });
  });

  test('the Haskalah rule still hides what it should from RWMO up', () => {
    const books = ['Words of Peace and Truth', 'Moreh Nevukhei HaZeman', 'Revealment and Concealment in Language',
      'Talks of Yeshayahu Leibowitz on the Parasha'].map(title => ({ title }));
    books.push({ title: 'A New Israeli Commentary on Pirkei Avot', collectiveTitle: 'Avigdor Shinan' });
    books.push({ title: 'x', heTitle: 'פירוש', heCommentator: 'אביגדור שנאן' });  // Sefaria's Hebrew spelling
    for (const book of books) {
      expect(visible('centrist_mo', book)).toBe(true);
      expect(visible('rwmo', book)).toBe(false);
    }
  });

  test('"Orot" hides only Rav Kook\'s Orot, not other titles containing the word', () => {
    for (const title of ['Orot Chaim', 'Orot Elim', 'Sefer Orot HaGra', 'Torot Emet']) {
      expect(visible('strict_charedi', { title })).toBe(true);
    }
    expect(visible('strict_charedi', { title: 'Orot Chaim', heTitle: 'אורות חיים' })).toBe(true);
    for (const title of ['Orot', 'Orot HaKodesh', 'Orot HaTeshuvah', 'Orot HaTorah', 'Olat Reiyah', 'Ein Ayah', 'Shemonah Kevatzim']) {
      expect(visible('yeshivish', { title })).toBe(true);
      expect(visible('strict_charedi', { title })).toBe(false);
    }
    expect(visible('strict_charedi', { title: 'Orot', heTitle: 'אורות' })).toBe(false);
  });

  test('"Orot" as a reference, a link or a Hebrew title', () => {
    const c = cfg('strict_charedi');
    expect(match(c, 'Orot 1:2')).not.toBeNull();
    expect(match(c, 'Orot, Lights from Darkness 3')).not.toBeNull();
    expect(match(c, '', '/Orot.1.2?lang=bi')).not.toBeNull();
    expect(match(c, 'אורות')).not.toBeNull();
    expect(match(c, 'Orot Chaim 1:2')).toBeNull();
    expect(match(c, '', '/Orot_Chaim.1')).toBeNull();
  });

  test('books the old list missed are hidden at the intended level', () => {
    const level1 = ["The Torah; A Women's Commentary", "Rereading the Rabbis; A Woman's Voice",
      'Standing Again at Sinai; Judaism from a Feminist Perspective'];
    for (const title of level1) { expect(visible('centrist_mo', { title })).toBe(false); }
    // apocrypha moved to Yeshivish (2026-11)
    expect(visible('rwmo', { title: 'The Testaments of the Twelve Patriarchs' })).toBe(true);
    expect(visible('yeshivish', { title: 'The Testaments of the Twelve Patriarchs' })).toBe(false);
    for (const title of ['The Five Books of Moses, by Everett Fox', 'The Early Prophets, by Everett Fox']) {
      expect(visible('centrist_mo', { title })).toBe(true);
      expect(visible('rwmo', { title })).toBe(false);
    }
    // Fox's translation is still hidden as a version from RWMO up
    expect(versionMatch(cfg('rwmo'), { versionTitle: 'The Five Books of Moses, by Everett Fox' })).not.toBeNull();
  });

  test('ordinary Orthodox works stay visible under Strict Charedi', () => {
    for (const title of ['Mishnah Berurah', 'Kuzari', 'Gray Matter I', "Peninei Halakhah, Women's Prayer"]) {
      expect(visible('strict_charedi', { title })).toBe(true);
    }
  });
});

describe('works by women authors (owner, 2026-11: hidden from Yeshivish up; borderline stays visible)', () => {
  const visible = (presetId, entry) => bookMatch(cfg(presetId), entry) === null;
  const books = [
    { title: 'Dirshuni I', heTitle: 'דרשוני כרך א' }, { title: 'Dirshuni II' },
    { title: 'Jewish Legal Writings by Women' }, { title: 'Torah of the Mothers' },
    { title: "She Is Life; Halakha and Women at Life's Crossroads" }, { title: 'Karati Bekhol Lev' },
    { title: 'Moses; A Human Life' }, { title: 'Learning to Read Midrash' },
    { title: 'A Lifetime Companion to the Laws of Jewish Family Life' },
    { title: 'Return; Daily Inspiration for the Days of Awe' }, { title: 'Nishmat HaBayit' }, { title: 'Tribal Lands' },
    { title: 'x', heTitle: 'דרשוני כרך ב' },
  ];

  test('the group sits at Yeshivish on the ladder, with English and Hebrew names', () => {
    expect(GROUPS.find(g => g.id === 'women_authors')).toMatchObject({ level: 3 });
    expect(RULES_JSON.find(r => r.id === 'women_authors').group).toBe('women_authors');
    expect(groupsFor('rwmo').women_authors).toBe(false);
    expect(groupsFor('yeshivish').women_authors).toBe(true);
  });

  test('hidden at Yeshivish and Strict Charedi, visible at RWMO, Centrist MO and Off', () => {
    for (const book of books) {
      for (const p of ['off', 'centrist_mo', 'rwmo']) { expect(visible(p, book)).toBe(true); }
      for (const p of ['yeshivish', 'strict_charedi']) { expect(visible(p, book)).toBe(false); }
    }
    expect(filterToc(cfg('yeshivish'), [{ category: 'Modern', contents: books }]))
      .toEqual([]);
  });

  test('translations that use Nechama Leibowitz\'s work are not works by women (owner, 2026-11)', () => {
    // Sefaria's real versions: Ramban on Genesis, Shemot Rabbah
    const versions = [{ versionTitle: 'Nehama Leibowitz', versionSource: 'New Studies in Bereshit' },
      { versionTitle: 'Nechama Liebowitz', versionSource: 'book' }, { versionTitle: 'x', versionSource: 'New Studies in Shemot' }];
    for (const v of versions) {
      for (const p of ['off', 'centrist_mo', 'rwmo', 'yeshivish']) { expect(versionMatch(cfg(p), v)).toBeNull(); }
      const m = versionMatch(cfg('strict_charedi'), v);
      expect(m === null || m.group === 'religious_zionist_thought').toBe(true);  // never as a work by women
    }
    // her own thought stays with the Religious Zionist group at Strict Charedi
    expect(match(cfg('strict_charedi'), 'Nechama Leibowitz')).toMatchObject({ group: 'religious_zionist_thought' });
  });

  test('Psalm 154: the Eshels\' edition and translation are not works by women', () => {
    const versions = [
      { versionTitle: 'Qumran composition of Ps. 154; recon. by Hanan and Esther Eshel; vocalized by Isaac Mayer ', language: 'he' },
      { versionTitle: 'Translated by Hanan and Esther Eshel', versionSource: 'the Journal of Biblical Literature', language: 'en' },
    ];
    for (const p of CHOICES) {
      for (const v of versions) { expect(versionMatch(cfg(p.id), v)).toBeNull(); }
    }
    // the book itself is a sefer chitzoni (its own rule, from Yeshivish up); with that group switched off it shows at every level
    expect(bookMatch(cfg('rwmo'), { title: 'Psalm 154' })).toBeNull();
    expect(bookMatch(cfg('yeshivish'), { title: 'Psalm 154' })).toMatchObject({ group: 'sefarim_chitzoniim' });
    const lenient = toggleGroup(cfg('strict_charedi'), 'sefarim_chitzoniim', false);
    expect(bookMatch(lenient, { title: 'Psalm 154', heTitle: 'תהלים קנ"ד' })).toBeNull();
    expect(filterVersions(lenient, versions)).toEqual(versions);
  });

  test('women\'s / feminist translations are hidden at every preset; the book itself stays', () => {
    expect(GROUPS.find(g => g.id === 'feminist_translations')).toMatchObject({ level: 1, translation: true });
    const feminist = ['Dena Weiss translation', 'debra robbins adapted vayikra rabba 2;7 first paragraph',
      'Debra J. Robbins', 'Keset HaSofer, trans. Jen Taylor Friedman'];
    for (const versionTitle of feminist) {
      expect(versionMatch(cfg('off'), { versionTitle })).toBeNull();
      for (const p of ['centrist_mo', 'rwmo', 'yeshivish', 'strict_charedi']) {
        expect(versionMatch(cfg(p), { versionTitle })).toMatchObject({ group: 'feminist_translations', translation: true });
      }
    }
    for (const title of ['Shemot Rabbah', 'Vayikra Rabbah', 'Keset HaSofer']) {
      expect(visible('strict_charedi', { title })).toBe(true);
    }
    const versions = [{ versionTitle: 'Dena Weiss translation' }, { versionTitle: 'The Sefaria Midrash Rabbah, 2022' }];
    expect(filterVersions(cfg('rwmo'), versions)).toEqual([versions[1]]);
    // The Torah: A Women's Commentary (Women of Reform Judaism) is Reform: hidden at every preset, also as a siddur version
    expect(versionMatch(cfg('centrist_mo'), { versionTitle: "The Torah, A Women's Commentary JPS" })).toMatchObject({ group: 'reform' });
  });

  test('neutral translations that happen to be by women are hidden from Yeshivish up only', () => {
    const byWomen = ['The Targum of Samuel; trans. E. van Staalduine-Sulman. Leiden: Brill, 2002',
      'Translated from German by Ruth Morris, Jerusalem, 2013', 'Dr. Tziporah Lifshitz',
      'From Sinai to Ethiopia, the halakhic and conceptual world of Ethiopian Jewry. Dr. Sharon Shalom. Trans. by Jessica Setbon. Jerusalem, Gefen, 2016',
      'Idra Zuta, The Small Gathering, trans. Michal Ricardo', 'Translated by Vital Transformation and Michal Ricardo, 2023',
      'Translated by Vital Transformation and Rachel Grundman, Spanish Edition, 2023 [es]', 'Nelly Altenburger'];
    for (const versionTitle of byWomen) {
      for (const p of ['off', 'centrist_mo', 'rwmo']) { expect(versionMatch(cfg(p), { versionTitle })).toBeNull(); }
      for (const p of ['yeshivish', 'strict_charedi']) {
        expect(versionMatch(cfg(p), { versionTitle })).toMatchObject({ group: 'women_authors' });
      }
    }
    for (const title of ['Targum Jonathan on I Samuel', 'What is the Talmud', 'Idra Zuta', 'Rashi on Berakhot']) {
      expect(visible('strict_charedi', { title })).toBe(true);
    }
  });

  test('borderline books stay visible under every preset (lenient)', () => {
    const borderline = ['Cassuto on Genesis', 'Cassuto on Exodus', 'Jewish Women in Time and Torah', 'Tenai BeNissuin Uveget',
      'Rabbi Sacks on Siddur', 'The Jonathan Sacks Haggadah', 'Reshimot Shiurim on Berakhot', 'Shabbat HaAretz',
      'The Midrash of Philo', 'The Antiquities of the Jews', 'Against Apion', "Peninei Halakhah, Women's Prayer",
      'Mishnah Berurah', 'Kuzari'];
    for (const title of borderline) {
      for (const p of CHOICES) { expect(visible(p.id, { title })).toBe(true); }
    }
    // a co-edited Sefaria translation with women copy-editors is not a translation by women
    expect(versionMatch(cfg('strict_charedi'), { versionTitle: 'The Sefaria Midrash Rabbah, 2022' })).toBeNull();
  });
});
