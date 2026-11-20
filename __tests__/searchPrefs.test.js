import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { removeSearchFiles, setOfflineSearch, isOfflineSearchOn, _setOfflineSearchForTests } from '../searchPrefs';

afterEach(() => { _setOfflineSearchForTests(true); jest.restoreAllMocks(); });

test('turning offline search off deletes every search file and forgets the search shards', async () => {
  jest.spyOn(FileSystem, 'readDirectoryAsync').mockResolvedValue(['Genesis.zip', 'Genesis_search.txt', 'COMPLETE_search.idx', 'אור הישר_search.txt']);
  const del = jest.spyOn(FileSystem, 'deleteAsync').mockResolvedValue();
  await AsyncStorage.setItem('soferbooksPacks', JSON.stringify({ tag: 't', shards: { a: 'k' }, indexes: { x: {} }, corrections: 'c' }));
  await setOfflineSearch(false);
  expect(isOfflineSearchOn()).toBe(false);
  const deleted = del.mock.calls.map(c => c[0]);
  expect(deleted.some(p => p.endsWith('library/Genesis_search.txt'))).toBe(true);
  expect(deleted.some(p => p.endsWith('library/COMPLETE_search.idx'))).toBe(true);
  expect(deleted.some(p => p.endsWith('library/אור הישר_search.txt'))).toBe(true);
  expect(deleted.some(p => p.endsWith('Genesis.zip'))).toBe(false);
  expect(deleted.some(p => p.endsWith('local_search/'))).toBe(true);
  expect(JSON.parse(await AsyncStorage.getItem('soferbooksPacks'))).toEqual({ tag: 't', shards: {}, indexes: {}, corrections: 'c' });
  expect(await AsyncStorage.getItem('offlineSearch.v1')).toBe('off');
});

test('removeSearchFiles never throws', async () => {
  jest.spyOn(FileSystem, 'readDirectoryAsync').mockRejectedValue(new Error('no folder'));
  await expect(removeSearchFiles()).resolves.toEqual({ files: 0 });
});
