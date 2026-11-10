'use strict';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TABS_STORAGE_KEY, serializeTabs, deserializeTabs, emptyTabsState } from './tabState';

/** Load the saved tabs (open + archived). Resolves to an empty state on any problem. */
export const loadTabs = async () => {
  try {
    const raw = await AsyncStorage.getItem(TABS_STORAGE_KEY);
    return raw ? deserializeTabs(raw) : emptyTabsState();
  } catch (e) {
    return emptyTabsState();
  }
};

export const saveTabs = state => AsyncStorage.setItem(TABS_STORAGE_KEY, serializeTabs(state)).catch(() => {});

/**
 * Returns a save(state) function that writes at most once per `delay` ms (the last state wins).
 * Scrolling updates the active tab's place often; this keeps storage writes cheap.
 */
export const makeDebouncedTabSaver = (delay = 800, save = saveTabs) => {
  let timer = null;
  let pending = null;
  const flush = () => {
    timer = null;
    const s = pending;
    pending = null;
    return s ? save(s) : Promise.resolve();
  };
  const debounced = state => {
    pending = state;
    if (!timer) { timer = setTimeout(flush, delay); }
  };
  debounced.flush = () => {
    if (timer) { clearTimeout(timer); }
    return flush();
  };
  return debounced;
};
