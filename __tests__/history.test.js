import AsyncStorage from '@react-native-async-storage/async-storage';
import Sefaria from '../sefaria';

describe('history', () => {
  test('historyToLastPlace', () => {
    const history = [
      {
        book: "Genesis",
        ref: "Genesis 1:1"
      },
      {
        book: "Exodus",
        ref: "Exodus 1:1"
      },
      {
        book: "Genesis",
        ref: "Genesis 1:2"
      },
      {
        book: "Leviticus",
        ref: "Leviticus 1:1"
      },
      {
        book: "Leviticus",
        ref: "Leviticus 1:2"
      },
    ];
    const lastPlace = [
      {
        book: "Genesis",
        ref: "Genesis 1:1"
      },
      {
        book: "Exodus",
        ref: "Exodus 1:1"
      },
      {
        book: "Leviticus",
        ref: "Leviticus 1:1"
      },
    ];
    expect(Sefaria.history.historyToLastPlace(history)).toEqual(lastPlace);
  });

  test('getHistoryObject', () => {
    const state = {

    };
  });

  test('saveHistoryItemUnchanged', async () => {
    const historyItem = {
      ref: "Genesis 1:5",
      he_ref: "בראשית א:א",
      versions: {},
      book: "Genesis",
      language: "english",
    };
    const getHistoryObject = jest.fn()
      .mockReturnValueOnce(historyItem)
      .mockReturnValueOnce(historyItem);
    Sefaria.history.lastPlace = [];
    Sefaria.history.lastSync = [];
    await Sefaria.history.setItem('lastSyncItems', '');
    await AsyncStorage.setItem('readingHistory', 'true');
    await Sefaria.history.saveHistoryItem(getHistoryObject, true, null, 1);
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe(JSON.stringify([historyItem]));
    expect((await Sefaria.history.getItem('lastPlace'))).toBe(JSON.stringify([historyItem]));
    await AsyncStorage.removeItem('readingHistory');
  });

  test('saveHistoryItemDuplicate', async () => {
    const historyItem = {
      ref: "Genesis 1:5",
      he_ref: "בראשית א:א",
      versions: {},
      book: "Genesis",
      language: "english",
    };
    await AsyncStorage.setItem('readingHistory', 'true');
    let getHistoryObject = jest.fn()
      .mockReturnValueOnce(historyItem)
      .mockReturnValueOnce(historyItem);
    Sefaria.history.lastPlace = [];
    Sefaria.history.lastSync = [{...historyItem, time_stamp: Sefaria.util.epoch_time()}];
    await Sefaria.history.setItem('lastSyncItems', '');
    await Sefaria.history.saveHistoryItem(getHistoryObject, true, null, 1);
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe('');

    // test that if the item is old enough it will save
    getHistoryObject = jest.fn()
      .mockReturnValueOnce(historyItem)
      .mockReturnValueOnce(historyItem);
    Sefaria.history.lastPlace = [];
    const oldHistoryItem = {...historyItem, time_stamp: Sefaria.util.epoch_time() - 61};
    Sefaria.history.lastSync = [oldHistoryItem];
    await Sefaria.history.setItem('lastSyncItems', '');
    await Sefaria.history.saveHistoryItem(getHistoryObject, true, null, 1);
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe(JSON.stringify([historyItem, oldHistoryItem]));
  });

  test('saveHistoryItemChanged', async () => {
    const historyItem = {
      ref: "Genesis 1:5",
      he_ref: "בראשית א:א",
      versions: {},
      book: "Genesis",
      language: "english",
    };
    const historyItem2 = {...historyItem, ref: "Genesis 1:6", he_ref: "Genesis 1:7"};
    const getHistoryObject = jest.fn()
      .mockReturnValueOnce(historyItem)
      .mockReturnValueOnce(historyItem2);
    Sefaria.history.lastPlace = [];
    Sefaria.history.lastSync = [];
    await Sefaria.history.setItem('lastSyncItems', '');
    await Sefaria.history.saveHistoryItem(getHistoryObject, true, null, 1);
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe('');
  });

  test('saveHistoryItemVersionChanged', async () => {
    const historyItem = {
      ref: "Genesis 1:5",
      he_ref: "בראשית א:א",
      versions: {},
      book: "Genesis",
      language: "english",
    };
    const historyItem2 = {...historyItem, versions: {en: "Version Yo"}};
    const getHistoryObject = jest.fn()
      .mockReturnValueOnce(historyItem)
      .mockReturnValueOnce(historyItem2);
    Sefaria.history.lastPlace = [];
    Sefaria.history.lastSync = [];
    await Sefaria.history.setItem('lastSyncItems', '');
    await Sefaria.history.saveHistoryItem(getHistoryObject, true, null, 1);
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe('');
  });

  test('saveHistorySecondary', async () => {
    const historyItem = {
      ref: "Genesis 1:5",
      he_ref: "בראשית א:א",
      versions: {},
      book: "Genesis",
      language: "english",
      secondary: true,
    };
    const getHistoryObject = jest.fn()
      .mockReturnValueOnce(historyItem)
      .mockReturnValueOnce(historyItem);
    Sefaria.history.lastPlace = [];
    Sefaria.history.lastSync = [];
    await Sefaria.history.setItem('lastSyncItems', '');
    await Sefaria.history.setItem('lastPlace', '');
    await Sefaria.history.saveHistoryItem(getHistoryObject, true, null, 1);
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe(JSON.stringify([historyItem]));
    expect((await Sefaria.history.getItem('lastPlace'))).toBe('');
  });

  test('saveHistoryItemReadingHistoryOff', async () => {
    const getHistoryObject = jest.fn()
      .mockReturnValueOnce({})
      .mockReturnValueOnce({});
    Sefaria.history.lastPlace = [];
    Sefaria.history.lastSync = [];
    await Sefaria.history.setItem('lastSyncItems', '');
    await AsyncStorage.setItem('readingHistory', 'false');
    await Sefaria.history.saveHistoryItem(getHistoryObject, true, null, 1);
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe('');
    expect((await Sefaria.history.getItem('lastPlace'))).toBe('');
    await AsyncStorage.removeItem('readingHistory');
  });

  test('getHistoryRefForTitle', async () => {
    Sefaria.history.lastPlace = [
      {
        ref: "Genesis 1:5",
        he_ref: "בראשית א:ה",
        versions: {},
        book: "Genesis",
        language: "english",
      },
      {
        ref: "Exodus 1:5",
        he_ref: "שמות א:ה",
        versions: {},
        book: "Exodus",
        language: "english",
      },
      {
        ref: "Genesis 1:6",
        he_ref: "בראשית א:ו",
        versions: {},
        book: "Genesis",
        language: "english",
      },
    ];
    Sefaria.textTitleForRef = jest.fn()
      .mockReturnValueOnce("Genesis")
      .mockReturnValueOnce("Genesis")
      .mockReturnValueOnce("Exodus");
    expect(Sefaria.history.getHistoryRefForTitle("Genesis")).toEqual(Sefaria.history.lastPlace[0]);
    expect(Sefaria.history.getHistoryRefForTitle("Exodus")).toEqual(Sefaria.history.lastPlace[1]);
  });

  test('_loadHistoryItems', async () => {
    // empty
    await AsyncStorage.removeItem('recent');
    await Sefaria.history.removeItem('lastPlace');
    await Sefaria.history.removeItem('lastSyncItems');
    await Sefaria.history._loadHistoryItems();
    expect(Sefaria.history.lastPlace).toEqual([]);
    expect(Sefaria.history.lastSync).toEqual([]);

    // with an item
    const historyItem = {
      ref: "Genesis 1:5",
      he_ref: "בראשית א:א",
      versions: {},
      book: "Genesis",
      language: "english",
      secondary: true,
    };
    await Sefaria.history.setItem('lastPlace', JSON.stringify([historyItem]));
    await Sefaria.history._loadHistoryItems();
    expect(Sefaria.history.lastPlace).toEqual([historyItem]);

    // with an error
    await Sefaria.history.setItem('lastPlace', "ERROR");
    await Sefaria.history._loadHistoryItems();
    expect(Sefaria.history.lastPlace).toEqual([]);
  });

  test('loadLocalHistory folds new reads into the on-device history, offline', async () => {
    const older = { ref: "Genesis 1:5", he_ref: "בראשית א:ה", versions: {}, book: "Genesis", language: "english", time_stamp: 0 };
    const pending = [
      { ref: "Genesis 1:7", he_ref: "בראשית א:ז", versions: {}, book: "Genesis", language: "english", time_stamp: 2 },
      { ref: "Genesis 1:7", book: "Genesis", time_stamp: 3, action: 'add_saved' },
      { ref: "Genesis 1:6", he_ref: "בראשית א:ו", versions: {}, book: "Genesis", language: "english", time_stamp: 1 },
    ];
    await Sefaria.history.setItem('history', JSON.stringify([older]));
    await Sefaria.history.setItem('lastSyncItems', JSON.stringify(pending));
    fetch = jest.fn();

    const history = await Sefaria.history.loadLocalHistory();

    const expected = [pending[0], pending[2], older];  // saved/unsaved actions are not reads
    expect(history).toEqual(expected);
    expect(Sefaria.history.getLocalHistoryArray('history')).toEqual(expected);
    expect((await Sefaria.history.getItem('history'))).toBe(JSON.stringify(expected));
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe('[]');
    expect(fetch).not.toHaveBeenCalled();  // nothing leaves the phone
  });

  test('loadLocalHistory caps the history length', async () => {
    const items = [1, 2, 3].map(i => ({ ref: `Genesis 1:${i}`, book: "Genesis", time_stamp: i }));
    await Sefaria.history.setItem('history', JSON.stringify(items));
    await Sefaria.history.setItem('lastSyncItems', '[]');
    expect(await Sefaria.history.loadLocalHistory(2)).toEqual(items.slice(0, 2));
  });

  test('loadLocalHistory with nothing stored', async () => {
    await Sefaria.history.removeItem('history');
    await Sefaria.history.removeItem('lastSyncItems');
    expect(await Sefaria.history.loadLocalHistory()).toEqual([]);
    expect((await Sefaria.history.getItem('history'))).toBe('[]');
  });

  test('deleteHistory deleteSaved true', async () => {
    const history = [
      {
        ref: "Genesis 1:5",
        he_ref: "בראשית א:ה",
        versions: {},
        book: "Genesis",
        language: "english",
        time_stamp: 0,
      }
    ];
    const lastSyncItems = [
      {
        ref: "Genesis 1:7",
        he_ref: "בראשית א:ו",
        versions: {},
        book: "Genesis",
        language: "english",
        time_stamp: 3,
        saved: false,
        action: 'delete_saved',
      },
    ];
    await Sefaria.history.setItem('history', JSON.stringify(history));
    await Sefaria.history.setItem('lastPlace', JSON.stringify(history));
    await Sefaria.history.setItem('lastSyncItems', JSON.stringify(lastSyncItems));
    await Sefaria.history.setItem('savedItems', JSON.stringify(lastSyncItems));

    await Sefaria.history.deleteHistory(true);
    expect((await Sefaria.history.getItem('savedItems'))).toBe(null);
    expect((await Sefaria.history.getItem('lastPlace'))).toBe(null);
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe(null);
    expect((await Sefaria.history.getItem('history'))).toBe(null);
  });

  test('deleteHistory deleteSaved false', async () => {
    const history = [
      {
        ref: "Genesis 1:5",
        he_ref: "בראשית א:ה",
        versions: {},
        book: "Genesis",
        language: "english",
        time_stamp: 0,
      }
    ];
    const lastSyncItems = [
      {
        ref: "Genesis 1:6",
        he_ref: "בראשית א:ו",
        versions: {},
        book: "Genesis",
        language: "english",
        time_stamp: 0,
      },
      {
        ref: "Genesis 1:7",
        he_ref: "בראשית א:ו",
        versions: {},
        book: "Genesis",
        language: "english",
        time_stamp: 3,
        saved: false,
        action: 'delete_saved',
      },
      {
        ref: "Genesis 1:8",
        he_ref: "בראשית א:ח",
        versions: {},
        book: "Genesis",
        language: "english",
        time_stamp: 3,
        saved: true,
        action: 'add_saved',
      },
    ];
    const savedItems = lastSyncItems.filter(x => !!x.action);
    await Sefaria.history.setItem('history', JSON.stringify(history));
    await Sefaria.history.setItem('lastPlace', JSON.stringify(history));
    await Sefaria.history.setItem('lastSyncItems', JSON.stringify(lastSyncItems));
    await Sefaria.history.setItem('savedItems', JSON.stringify(savedItems));

    await Sefaria.history.deleteHistory(false);
    expect((await Sefaria.history.getItem('savedItems'))).toBe(JSON.stringify(savedItems));
    expect((await Sefaria.history.getItem('lastPlace'))).toBe(null);
    expect((await Sefaria.history.getItem('lastSyncItems'))).toBe(JSON.stringify(savedItems));
    expect((await Sefaria.history.getItem('history'))).toBe(null);
  });
});
