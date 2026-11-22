import { segmentOffsetOf } from '../offline';

const zohar = {
  title: 'Zohar',
  schema: { nodes: [
    { title: 'Introduction', depth: 2, index_offsets_by_depth: { 2: [0, 3, 6] } },
    { title: 'Achrei Mot', depth: 2, index_offsets_by_depth: { 2: [0, 4, 9] } },
  ] },
};

test('a section\'s segments counted on through the chapter, as Sefaria numbers them (the Zohar)', () => {
  expect(segmentOffsetOf(zohar, 'Zohar, Achrei Mot 3')).toBe(9);
  expect(segmentOffsetOf(zohar, 'Zohar, Achrei Mot 1')).toBe(0);
  expect(segmentOffsetOf(zohar, 'Zohar, Introduction 2')).toBe(3);
  expect(segmentOffsetOf(zohar, 'Zohar, Vayishlach 2')).toBe(0);
  expect(segmentOffsetOf({ title: 'Genesis', schema: { depth: 2 } }, 'Genesis 3')).toBe(0);
  expect(segmentOffsetOf({ title: 'X', schema: { depth: 2, index_offsets_by_depth: { 2: [0, 5] } } }, 'X 2')).toBe(5);
});
