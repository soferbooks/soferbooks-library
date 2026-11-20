import { uriName } from '../storage';
test('a title with ? # % is escaped in a file address, other titles are as they are', () => {
  expect(uriName('Will We Have Jewish Grandchildren? Jewish Continuity and How to Achieve It.zip'))
    .toBe('Will We Have Jewish Grandchildren%3F Jewish Continuity and How to Achieve It.zip');
  expect(uriName('A #1 100%')).toBe('A %231 100%25');
  expect(uriName('Genesis')).toBe('Genesis');
});
