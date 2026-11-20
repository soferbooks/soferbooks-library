import * as links from '../extras/links';

const link = (a, t, r = 'commentary') => ({ a, ah: a, t, th: t, r });

test('the links index is kept on the phone: made, a downloaded book added to it, made again after a deletion', async () => {
  links._reset();
  await links.saveLinks('Book A', { links: [link('Genesis 1:1', 'Book A, S1:1')] });
  let map = await links.sectionIndex(['Book A'], 'Genesis 1');
  expect(map.get('Genesis 1').map(r => r.other)).toEqual(['Book A, S1:1']);

  // a book downloaded since: added to the index, not a whole rebuild
  await links.saveLinks('Book B', { links: [link('Genesis 1:2', 'Book B, S1:3')] });
  map = await links.sectionIndex(['Book A', 'Book B'], 'Genesis 1');
  expect(map.get('Genesis 1').map(r => r.other).sort()).toEqual(['Book A, S1:1', 'Book B, S1:3']);
  // both ends: the extra book's own section has its link back to Genesis
  map = await links.sectionIndex(['Book A', 'Book B'], 'Book B, S1');
  expect(map.get('Book B, S1').map(r => r.other)).toEqual(['Genesis 1:2']);
  expect([...links.commentaryTitles()]).toEqual([]);

  // a book deleted: made again without it
  await links.removeLinks('Book A');
  map = await links.sectionIndex(['Book B'], 'Genesis 1');
  expect(map.get('Genesis 1').map(r => r.other)).toEqual(['Book B, S1:3']);
});

test('a deleted book\'s records come out of the index alone (no rebuild: 20 minutes on the 32-bit tablet)', async () => {
  links._reset();
  await links.saveLinks('Book A', { title: 'Book A', links: [link('Genesis 1:1', 'Book A, S1:1', 'base')] });
  await links.saveLinks('Book B', { title: 'Book B', links: [link('Genesis 1:1', 'Book B, S1:3', 'base')] });
  let map = await links.sectionIndex(['Book A', 'Book B'], 'Genesis 1');
  expect(map.get('Genesis 1').map(r => r.other).sort()).toEqual(['Book A, S1:1', 'Book B, S1:3']);

  await links.removeLinks('Book A');
  map = await links.sectionIndex(['Book B'], 'Genesis 1');
  expect(map.get('Genesis 1').map(r => r.other)).toEqual(['Book B, S1:3']);
  // (taken out of the index as it was: no whole rebuild; the deleted book no longer a commentary)
  expect(links._lastIndexWork()).toBe('incremental');
  expect([...links.commentaryTitles()]).toEqual(['Book B']);
  // the book's own section: its records gone too
  map = await links.sectionIndex(['Book B'], 'Book A, S1');
  expect(map.get('Book A, S1')).toEqual([]);
});

test('a section is kept in its book\'s file', () => {
  expect(links.shardOf('Niddah 2b')).toBe('Niddah');
  expect(links.shardOf('Shulchan Arukh, Orach Chayim 447')).toBe('Shulchan Arukh, Orach Chayim');
  expect(links.shardOf('Book B, S1')).toBe('Book B');
});
