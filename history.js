'use strict';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

// History lives only on the phone (no account, no server sync). Cap it so the file stays small.
const MAX_HISTORY_LEN = 1000;

const History = {
  saved: [],
  lastPlace: [],
  lastSync: [],
  _hasSwipeDeleted: false,
  migrateFromAsyncStorageHistory: async function() {
    const hasMigrated = await AsyncStorage.getItem('hasMigratedToHistoryJSONFiles');
    if (hasMigrated) { return; }
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}history`, { intermediates: true });
    try {
      const lastPlace = await AsyncStorage.getItem('lastPlace');
      Sefaria.history.setItem('lastPlace', lastPlace);
      await AsyncStorage.removeItem('lastPlace');
    } catch (e) {
      console.warn(new Error("Failed to migrate lastPlace"));
    }

    try {
      const savedItems = await AsyncStorage.getItem('savedItems');
      Sefaria.history.setItem('savedItems', savedItems);
      await AsyncStorage.removeItem('savedItems');
    } catch (e) {
      console.warn(new Error("Failed to migrate savedItems"));
    }

    try {
      const lastSyncItems = await AsyncStorage.getItem('lastSyncItems');
      Sefaria.history.setItem('lastSyncItems', lastSyncItems);
      await AsyncStorage.removeItem('lastSyncItems');
    } catch (e) {
      console.warn(new Error("Failed to migrate lastSyncItems"));
    }

    try {
      const history = await AsyncStorage.getItem('history');
      Sefaria.history.setItem('history', history)
      await AsyncStorage.removeItem('history');
    } catch (e) {
      console.warn(new Error("Failed to migrate history"));
    }

    await AsyncStorage.setItem('hasMigratedToHistoryJSONFiles', 'true');
  },
  getFilename: key => `${FileSystem.documentDirectory}history/${key}.json`,
  getItem: key => FileSystem.readAsStringAsync(Sefaria.history.getFilename(key)).catch(e => null),
  setItem: (key, value) => FileSystem.writeAsStringAsync(Sefaria.history.getFilename(key), value),
  removeItem: key => FileSystem.deleteAsync(Sefaria.history.getFilename(key)).catch((e)=>{}),
  historyToLastPlace: function(history_item_array) {
    const seenBooks = {};
    const lastPlace = [];
    for (let history_item of history_item_array) {
      if (seenBooks[history_item.book]) { continue; }
      seenBooks[history_item.book] = true;
      lastPlace.push(history_item);
    }
    return lastPlace;
  },
  historyToSaved: function(history_item_array) {
    return history_item_array.filter(h => h.saved);
  },
  saveHistoryItem: async function(getHistoryObject, withIntent, onSave, intentTime=3000) {
    // getHistoryObject: dependent on state of whatever component called this func. it is `getHistoryObject`'s responsibility to return empty object if readingHistory is off
    // onSave: optional function which is called with the list of history items to actually save
    let history_item = getHistoryObject();
    if (!history_item.ref) { return; }
    if (withIntent) {
      await Sefaria.util.timeoutPromise(intentTime);
      const new_history_item = getHistoryObject();
      if (history_item.ref !== new_history_item.ref || !Sefaria.util.object_equals(history_item.versions, new_history_item.versions)) { return; /* didn't spend enough time reading */ }
    }
    history_item.time_stamp = Sefaria.util.epoch_time();
    const lSync = Sefaria.history.lastSync;
    // remove items that are the same and saved recently
    if (
      lSync.length > 0 &&
      history_item.ref === lSync[0].ref &&
      history_item.time_stamp - lSync[0].time_stamp <= 60
    ) { return; }
    if (onSave) { onSave(history_item); }
    Sefaria.history.lastSync = [history_item].concat(lSync);
    Sefaria.history.setItem("lastSyncItems", JSON.stringify(Sefaria.history.lastSync));
    if (!history_item.secondary) {
      // secondary items should not be saved in lastPlace
      Sefaria.history.lastPlace = Sefaria.history.historyToLastPlace([history_item].concat(Sefaria.history.lastPlace));
      Sefaria.history.setItem("lastPlace", JSON.stringify(Sefaria.history.lastPlace));
    }
  },
  getHistoryRefForTitle: function(title) {
    //given an index title, return the ref of that title in Sefaria.history.
    //if it doesn't exist, return null
    for (let item of Sefaria.history.lastPlace) {
      if (Sefaria.textTitleForRef(item.ref) === title) { return item; }
    }
    return null;
  },
  _loadHistoryItems: async function() {
    await Sefaria.history.migrateFromAsyncStorageHistory();
    const lastPlace = await Sefaria.history.getItem('lastPlace');
    const lastSync = await Sefaria.history.getItem('lastSyncItems');
    const saved = await Sefaria.history.getItem('savedItems');
    const hasSwipeDeleted = await AsyncStorage.getItem("hasSwipeDeleted");
    try { Sefaria.history.lastPlace = JSON.parse(lastPlace) || []; }
    catch(e) { Sefaria.history.lastPlace = []; }
    try { Sefaria.history.lastSync = JSON.parse(lastSync) || []; }
    catch(e) { Sefaria.history.lastSync = []; }
    try { Sefaria.history.saved = JSON.parse(saved) || []; }
    catch(e) { Sefaria.history.saved = []; }
    Sefaria.history._hasSwipeDeleted = JSON.parse(hasSwipeDeleted) || false;
  },
  loadLocalHistory: async function(max_history_len=MAX_HISTORY_LEN) {
    /*
    Folds the items recorded since the last call (`lastSyncItems`: reads, plus saved/unsaved
    actions) into the on-device `history` file, newest first, and returns the full history.
    Saved items are kept separately in `savedItems` by saveSavedItem().
    */
    const currHistory = JSON.parse(await Sefaria.history.getItem('history') || '[]');
    const pending = JSON.parse(await Sefaria.history.getItem('lastSyncItems') || '[]');
    const history = pending.filter(h => !h.action).concat(currHistory).slice(0, max_history_len);
    Sefaria.history.history = history;
    Sefaria.history.lastSync = [];
    await Sefaria.history.setItem('history', JSON.stringify(history));
    await Sefaria.history.setItem('lastSyncItems', '[]');
    return history;
  },
  getLocalHistoryArray: function(bucket){
    if(Sefaria.history.hasOwnProperty(bucket)){
      return [...Sefaria.history[bucket]];
    }
    return [];
  },
  saveSavedItem: function(item, action) {
    /* action: can be either 'add_saved' or 'delete_saved'
     */
    const lastSyncItem = {
      ...item,
      action,
      time_stamp: Sefaria.util.epoch_time(),
    };
    Sefaria.history.lastSync = [lastSyncItem].concat(Sefaria.history.lastSync);
    if (action === 'add_saved') {
      Sefaria.history.saved = [item].concat(Sefaria.history.saved);
    } else {
      Sefaria.history.saved = Sefaria.history.saved.filter(s => s.ref !== item.ref);
    }
    Sefaria.history.setItem("lastSyncItems", JSON.stringify(Sefaria.history.lastSync));
    Sefaria.history.setItem("savedItems", JSON.stringify(Sefaria.history.saved));
  },
  indexOfSaved: function(ref) {
    return Sefaria.history.saved.findIndex(existing => ref === existing.ref);
  },

  deleteHistory: async function(deleteSaved) {
    await Sefaria.history.removeItem('lastPlace');
    await Sefaria.history.removeItem('history');
    Sefaria.history.lastPlace = [];
    if (deleteSaved) {
      await Sefaria.history.removeItem('savedItems');
      await Sefaria.history.removeItem('lastSyncItems');
      Sefaria.history.saved = [];
      Sefaria.history.lastSync = [];
    } else {
      let lastSyncItems = JSON.parse(await Sefaria.history.getItem('lastSyncItems'));
      lastSyncItems = lastSyncItems.filter(item => typeof item.saved != 'undefined' && item.action)  // want to keep any items that have saved field, even if false to sync
      Sefaria.history.lastSync = lastSyncItems;
      await Sefaria.history.setItem('lastSyncItems', JSON.stringify(lastSyncItems));
    }
  },
};

export default History;
