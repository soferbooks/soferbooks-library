'use strict';

/**
 * When nikud by computer (Dicta, reader/nakdan.js) is added, as in the owner's Sefaria Customizer
 * extension (nikud.js, popup.js):
 *
 * - only while the vowel display setting shows vowels (not "א", no vowels), and
 *   - the sefer's own switch (in the Aa menu: "Vowels" where the text has none, or "Commentary
 *     vowels" beside its own) is on, or
 *   - "Always add nikud" (Settings) is on and that sefer's switch was not turned off.
 * - Otherwise, on a text without nikud, a card asks: Add nikud / Always / Not now / Never show
 *   this again ("Ask on texts without nikud" in Settings).
 * Both settings start off, as in the extension, so nothing is sent to Dicta until the reader says so.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VOCALIZATION } from '../VocalizationEnum';
import { lacksNikud } from './nakdan';

export const NAKDAN_SETTINGS_KEY = 'nakdanSettings.v1';   // {always, neverAsk}
export const NAKDAN_BOOKS_KEY = 'nakdanByBook.v1';        // {"Book": true | false} (the extension's name)
export const DEFAULT_NAKDAN_SETTINGS = { always: false, neverAsk: false };

/* ---------- pure ---------- */

const vowelsShown = vocalization => vocalization !== VOCALIZATION.NONE;

/** Is nikud by computer added to `book`'s texts without nikud? */
export const nakdanWanted = (prefs, book, vocalization) => {
  if (!book || !vowelsShown(vocalization)) { return false; }
  const books = (prefs && prefs.books) || {};
  if (Object.prototype.hasOwnProperty.call(books, book)) { return books[book] === true; }
  return !!(prefs && prefs.settings && prefs.settings.always);
};

/** Should the card asking about nikud show for `book`? `textLacksNikud`: the text on screen has none */
export const shouldAskNakdan = (prefs, book, vocalization, textLacksNikud) => {
  if (!book || !textLacksNikud || !vowelsShown(vocalization) || nakdanWanted(prefs, book, vocalization)) { return false; }
  const books = (prefs && prefs.books) || {};
  const settings = (prefs && prefs.settings) || DEFAULT_NAKDAN_SETTINGS;
  return !Object.prototype.hasOwnProperty.call(books, book) && !settings.neverAsk && !(prefs && prefs.notNow && prefs.notNow.has(book));
};

/** A section's segments ([{he}]) have no nikud (the first few looked at, as the reader shows them) */
export const sectionLacksNikud = (segments, sample = 12) => {
  if (!Array.isArray(segments) || !segments.length) { return false; }
  const text = segments.slice(0, sample).map(s => (s && typeof s.he === 'string' ? s.he.replace(/<[^>]*>/g, '') : '')).join(' ');
  return lacksNikud(text);
};

/* ---------- the store (Settings and the reader share it) ---------- */

let state = { settings: { ...DEFAULT_NAKDAN_SETTINGS }, books: {}, notNow: new Set() };
const listeners = new Set();
let loading = null;

const emit = () => listeners.forEach(fn => fn(state));
const update = changes => { state = { ...state, ...changes }; emit(); };

const readJson = async key => {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
};
const writeJson = (key, value) => AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});

export const getNakdanPrefs = () => state;

export const loadNakdanPrefs = () => {
  if (!loading) {
    loading = Promise.all([readJson(NAKDAN_SETTINGS_KEY), readJson(NAKDAN_BOOKS_KEY)]).then(([settings, books]) => {
      update({ settings: { ...DEFAULT_NAKDAN_SETTINGS, ...settings }, books });
      return state;
    });
  }
  return loading;
};

export const setNakdanSettings = changes => {
  const settings = { ...state.settings, ...changes };
  update({ settings });
  return writeJson(NAKDAN_SETTINGS_KEY, settings);
};

export const setNakdanForBook = (book, on) => {
  if (!book) { return Promise.resolve(); }
  const books = { ...state.books, [book]: !!on };
  update({ books });
  return writeJson(NAKDAN_BOOKS_KEY, books);
};

/** "Not now": not asked again about `book` until the app is closed */
export const notNowNakdan = book => {
  if (!book) { return; }
  const notNow = new Set(state.notNow);
  notNow.add(book);
  update({ notNow });
};

export const subscribeNakdanPrefs = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export const useNakdanPrefs = () => {
  const [prefs, setPrefs] = useState(state);
  useEffect(() => {
    const stop = subscribeNakdanPrefs(setPrefs);
    loadNakdanPrefs().then(() => setPrefs(state)).catch(() => {});
    return stop;
  }, []);
  return prefs;
};

export const _resetNakdanPrefs = () => {
  state = { settings: { ...DEFAULT_NAKDAN_SETTINGS }, books: {}, notNow: new Set() };
  loading = null;
  listeners.clear();
};
