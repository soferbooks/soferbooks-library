/**
 * A Sofer Library book's own connections (extras/sofer.js linksOf): the links in its sections'
 * metadata (build_sofer_library.py add_links) - each piece of Chashukei Chemed tied to the Gemara
 * line it is on (owner, 2026-11-12: "lay it out by the word, so mikraos look prints and connections
 * in app") - kept with the extra books' links (extras/links.js), so the piece shows under its
 * Gemara line: in the passage's Commentary and "Under each passage".
 * (SYNTHETIC TEST FIXTURE texts - not real texts.)
 */
import * as FileSystem from 'expo-file-system/legacy';
import {ownLinks, linksOf} from '../extras/sofer';
import {collect, readLinks, buildIndex, relatedFromIndex} from '../extras/links';
import {refsForSource} from '../reader/inlineCommentaryPrefs';

const TITLE = 'Chashukei Chemed on Berakhot';
const ENTRY = {title: TITLE, heTitle: 'חשוקי חמד על ברכות', base_text_titles: ['Berakhot']};
const L = 'SYNTHETIC TEST FIXTURE - not a real text';
const meta = (amud, he, links) => ({ref: `${TITLE} ${amud}`, heRef: `חשוקי חמד על ברכות ${he}`, links});
const FILES = {
  [`${TITLE}_index.json`]: {title: TITLE},
  [`${TITLE} 2a.metadata.json`]: meta('2a', 'ב׳ א', [
    [{sourceRef: 'Berakhot 2a:1', sourceHeRef: 'ברכות ב׳ א:א'}],
    [{sourceRef: 'Berakhot 2a:1', sourceHeRef: 'ברכות ב׳ א:א'}],
    null,
    [{sourceRef: 'Berakhot 2a:5', sourceHeRef: 'ברכות ב׳ א:ה'}, {sourceRef: 'Shabbat 2a:1'}],
  ]),
  [`${TITLE} 2a.b2011bc0.he.json`]: [`<b>מאימתי</b> ${L}`, `<b>שאלה</b> ${L}`, L, L],
  [`${TITLE} 2b.metadata.json`]: meta('2b', 'ב׳ ב', []),
};

describe('the Sofer Library\'s own connections', () => {
  test('each piece tied to its Gemara line, as its sections\' metadata say', () => {
    expect(ownLinks(ENTRY, FILES)).toEqual([
      {a: `${TITLE} 2a:1`, ah: 'חשוקי חמד על ברכות ב׳ א 1', t: 'Berakhot 2a:1', th: 'ברכות ב׳ א:א', r: 'base'},
      {a: `${TITLE} 2a:2`, ah: 'חשוקי חמד על ברכות ב׳ א 2', t: 'Berakhot 2a:1', th: 'ברכות ב׳ א:א', r: 'base'},
      {a: `${TITLE} 2a:4`, ah: 'חשוקי חמד על ברכות ב׳ א 4', t: 'Berakhot 2a:5', th: 'ברכות ב׳ א:ה', r: 'base'},
      // (a link to a book it is not on: a citation)
      {a: `${TITLE} 2a:4`, ah: 'חשוקי חמד על ברכות ב׳ א 4', t: 'Shabbat 2a:1', th: 'Shabbat 2a:1', r: 'cite'},
    ]);
    // (the catalogue's base_text_titles as Sofer's schema has them too: {en, he})
    expect(ownLinks({...ENTRY, base_text_titles: [{en: 'Berakhot', he: 'ברכות'}]}, FILES)[0].r).toBe('base');
    expect(linksOf(ENTRY, {book: {files: FILES}}).ownLinks).toHaveLength(4);
    expect(linksOf(ENTRY, {book: {files: {[`${TITLE} 2b.metadata.json`]: meta('2b', 'ב׳ ב', [])}}})).toEqual({});
  });

  test('kept when the book is downloaded, though it comes ready made (no tree)', async () => {
    const {data} = await collect({title: TITLE, heTitle: ENTRY.heTitle, tree: undefined,
      where: linksOf(ENTRY, {book: {files: FILES}})});
    expect(data.links).toHaveLength(4);
    expect((await readLinks(TITLE)).links).toEqual(data.links);
    expect(FileSystem).toBeTruthy();
  });

  describe('shown under the Gemara\'s line', () => {
    beforeAll(() => {
      global.Sefaria = {
        textTitleForRef: ref => [TITLE, 'Berakhot', 'Shabbat'].find(t => ref.startsWith(`${t} `)) || null,
        primaryCategoryForTitle: t => (t === TITLE ? 'Talmud' : 'Talmud'),
        categoriesForTitle: () => ['Talmud'],
      };
    });
    afterAll(() => { delete global.Sefaria; });

    test('in the Gemara passage\'s Commentary, and "Under each passage"', () => {
      const map = buildIndex([{title: TITLE, heTitle: ENTRY.heTitle, links: ownLinks(ENTRY, FILES), pending: []}]);
      const related = relatedFromIndex(map, 'Berakhot 2a');
      expect(related).toEqual([
        expect.objectContaining({sourceRef: `${TITLE} 2a:1`, anchorRef: 'Berakhot 2a:1', category: 'Commentary',
          index_title: TITLE, sourceHeRef: 'חשוקי חמד על ברכות ב׳ א 1'}),
        expect.objectContaining({sourceRef: `${TITLE} 2a:2`, anchorRef: 'Berakhot 2a:1', category: 'Commentary'}),
        expect.objectContaining({sourceRef: `${TITLE} 2a:4`, anchorRef: 'Berakhot 2a:5', category: 'Commentary'}),
      ]);
      // ("Under each passage": the segment's links as Sefaria.links.organizeRelatedBySegment makes them)
      const line1 = related.filter(l => l.anchorRef === 'Berakhot 2a:1')
        .map(l => ({category: l.category, sourceRef: l.sourceRef, textTitle: l.index_title}));
      expect(refsForSource(line1, TITLE)).toEqual([`${TITLE} 2a:1`, `${TITLE} 2a:2`]);
      // (the piece's own passage shows its Gemara line; the book counts as a commentary - its
      //  dibbur hamaschil in bold)
      expect(relatedFromIndex(map, `${TITLE} 2a`)).toEqual(expect.arrayContaining([
        expect.objectContaining({sourceRef: 'Berakhot 2a:5', anchorRef: `${TITLE} 2a:4`})]));
      expect(map.commentaries.has(TITLE)).toBe(true);
      // (the citation is not a commentary on Shabbat)
      expect(relatedFromIndex(map, 'Shabbat 2a')).toEqual([
        expect.objectContaining({sourceRef: `${TITLE} 2a:4`, category: 'Talmud'})]);
    });
  });
});
