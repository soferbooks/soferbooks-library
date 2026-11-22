import { parseCatalog, sefariaJsonTree, APP_BOOKS, convert } from '../extras/sofer';
import soferLibrary from '../extras/sofer';

const catalog = { format: 1, books: [] };

test('the app adds SoferBooks\' Sephardi siddur to the Sofer Library, in place of Sefaria\'s', () => {
  const entries = parseCatalog({ ...catalog, format: require('../extras/sofer').CATALOG_FORMAT || 1 });
  const siddur = entries.find(e => e.title === APP_BOOKS[0].title);
  expect(siddur).toMatchObject({ preferred: true, kind: 'sefaria-json', heTitle: 'סידור נוסח עדות המזרח' });
  expect(siddur.replaces).toContain('Siddur Edot HaMizrach');
});

test('its JSON (Sefaria\'s format) becomes the library\'s tree: each tefillah a section of its paragraphs', () => {
  const json = {
    schema: { nodes: [
      { key: 'S1', titles: [{ lang: 'he', text: 'סדר השכמת הבוקר', primary: true }] },
      { key: 'S2', titles: [{ lang: 'he', text: 'תפילת שחרית', primary: true }] },
    ] },
    text: { S1: ['מוֹדֶה אֲנִי ל׈פָנֶיךָ', ''], S2: ['בָּרוּךְ'] },
  };
  const [root] = sefariaJsonTree(json);
  const kids = root.children || root.nodes || [];
  expect(kids.length).toBe(2);
  expect(JSON.stringify(root)).toContain('ל׈פָנֶיךָ');
  expect(convert(APP_BOOKS[0], { json })).toBeNull();
  expect(soferLibrary.toTree({ json })[0]).toBeTruthy();
});

test('the siddur\'s contents: its parts, each prayer in its part, the headings inside it - the refs as they were', () => {
  const { convertBook } = require('../extras/index');
  const json = {
    schema: { nodes: [
      { key: 'S1', titles: [{ lang: 'he', text: 'סדר השכמת הבוקר', primary: true }] },
      { key: 'S2', titles: [{ lang: 'he', text: 'תפילת שחרית', primary: true }] },
      { key: 'S3', titles: [{ lang: 'he', text: 'קידוש', primary: true }] },
    ] },
    text: { S1: ['<b>מוֹדֶה</b> אֲנִי'], S2: ['<small>ציצית</small>', 'בָּרוּךְ', 'הוֹדוּ'], S3: ['<big>ויכלו</big>'] },
    sofer_contents: [
      { he: 'סדר ימי החול', secs: [{ i: 0, he: 'סדר השכמת הבוקר', subs: [] },
        { i: 1, he: 'תפילת שחרית', subs: [['סדר עטיפת ציצית', 1], ['הודו', 3]] }] },
      { he: 'סדר יום השבת', secs: [{ i: 2, he: 'קידוש', subs: [] }] },
    ],
  };
  const { files, firstSection } = convertBook(APP_BOOKS[0], { json });
  const t = APP_BOOKS[0].title;
  expect(firstSection).toBe(`${t}, S1`);
  const index = files[`${t}_index.json`];
  // (the sections as before: one list, the refs unchanged)
  expect(index.schema.nodes.map(n => n.key)).toEqual(['S1', 'S2', 'S3']);
  expect(index.default_struct).toBe('Contents');
  expect(index.exclude_structs).toEqual(['schema']);
  const [weekday, shabbat] = index.alts.Contents.nodes;
  expect(weekday.heTitle).toBe('סדר ימי החול');
  expect(weekday.nodes[0]).toMatchObject({ nodeType: 'ArrayMapNode', heTitle: 'סדר השכמת הבוקר', wholeRef: `${t}, S1` });
  expect(weekday.nodes[1].heTitle).toBe('תפילת שחרית');
  expect(weekday.nodes[1].nodes.map(n => [n.heTitle, n.wholeRef])).toEqual([
    ['תפילת שחרית', `${t}, S2`], ['סדר עטיפת ציצית', `${t}, S2`], ['הודו', `${t}, S2 3`]]);
  expect(shabbat.nodes[0].wholeRef).toBe(`${t}, S3`);
  // (the page's look kept in the text)
  const s1 = Object.keys(files).find(n => n.startsWith(`${t}, S1.`) && n.endsWith('.he.json'));
  expect(files[s1]).toEqual(['<b>מוֹדֶה</b> אֲנִי']);
});
