import otzaria, { inBundle, hostedOtzariaIndex, _resetHostedIndex } from '../extras/otzaria';

const index = { format: 1, file: 'otzaria-all.zip', size: 10, books: {
  'A/ספרים/אוצריא/x/a.txt': { hash: 'h1', text: 'o-1.txt', links: 'o-1_links.json' },
  'A/ספרים/אוצריא/x/b.txt': { hash: 'h2', text: 'o-2.txt' },
} };

test('a book is taken from the release only while Otzaria has not changed it', () => {
  const got = inBundle([
    { id: 'A/ספרים/אוצריא/x/a.txt', hash: 'h1' },
    { id: 'A/ספרים/אוצריא/x/b.txt', hash: 'CHANGED' },
    { id: 'A/ספרים/אוצריא/x/c.txt', hash: 'h3' },
  ], index);
  expect(got.map(e => e.id)).toEqual(['A/ספרים/אוצריא/x/a.txt']);
});

test('a book from the release is converted like one from Otzaria, its links from the zip', () => {
  const text = '<h1>ספר</h1>\n<h2>פרק א</h2>\nשורה אחת';
  const doc = { text, links: '[]' };
  expect(JSON.stringify(otzaria.toTree(doc))).toEqual(JSON.stringify(otzaria.toTree(text)));
  expect(otzaria.linksOf({ id: 'p', links: true }, doc)).toEqual({ otzariaPath: 'p', otzariaLinks: '[]' });
  expect(otzaria.linksOf({ id: 'p', links: true }, text)).toEqual({ otzariaPath: 'p' });
  expect(otzaria.isRestricted(doc)).toBe(false);
});

test('the release index is read once and must be its format', async () => {
  _resetHostedIndex();
  const fetchFn = jest.fn(async () => ({ ok: true, json: async () => index }));
  expect(await hostedOtzariaIndex(fetchFn)).toBe(index);
  _resetHostedIndex();
  expect(await hostedOtzariaIndex(async () => ({ ok: true, json: async () => ({ format: 9 }) }))).toBeNull();
  _resetHostedIndex();
});
