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
