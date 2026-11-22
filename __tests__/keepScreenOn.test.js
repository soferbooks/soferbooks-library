import { wantOn, minutesOf } from '../reader/keepScreenOn';

test('the screen kept on: never, for minutes after the last touch, or always while the app is open', () => {
  expect(minutesOf('off')).toBe(0);
  expect(minutesOf('5')).toBe(5);
  expect(minutesOf('10')).toBe(10);
  expect(wantOn('5', true, 6 * 60000)).toBe(false);
  expect(minutesOf('always')).toBe(Infinity);
  expect(wantOn('off', true, 0)).toBe(false);
  expect(wantOn('10', true, 9 * 60000)).toBe(true);
  expect(wantOn('10', true, 11 * 60000)).toBe(false);
  expect(wantOn('30', true, 11 * 60000)).toBe(true);
  expect(wantOn('always', true, 10 * 3600000)).toBe(true);
  // (in the background: the phone's own)
  expect(wantOn('always', false, 0)).toBe(false);
});
