import AsyncStorage from '@react-native-async-storage/async-storage';
import * as storage from '../storage';
import { reportWanted, LOW_ROOM } from '../storageReport';

test('the storage report: only when the phone is short of space, at most once a day', async () => {
  await AsyncStorage.removeItem('storageReport.last');
  storage._setFreeBytes(5e9);
  expect(await reportWanted()).toBe(false);          // (plenty of room: no report)
  storage._setFreeBytes(LOW_ROOM - 1);
  expect(await reportWanted()).toBe(true);
  const now = Date.now();
  await AsyncStorage.setItem('storageReport.last', String(now - 3600 * 1000));
  expect(await reportWanted(now)).toBe(false);        // (one an hour ago)
  await AsyncStorage.setItem('storageReport.last', String(now - 25 * 3600 * 1000));
  expect(await reportWanted(now)).toBe(true);
  storage._setFreeBytes(null);
});
