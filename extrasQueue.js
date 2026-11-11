// The full library's background download of the extra sources' books (owner, 2026-11-11: when
// the reader downloads the whole library, the books of Dicta, Otzaria, Wikisource and the Sofer
// Library come too).
//
// One book at a time (extras.downloadBook: each from its own source's server, converted on the
// phone), with a pause between two books so the sources' servers are not hurried. Books the
// content filter hides are not downloaded; a book that fails twice is skipped. Pause, Resume and
// Cancel; on Wi-Fi only unless the reader turns that off (it then waits for Wi-Fi). What was
// chosen is kept (AsyncStorage), so the download goes on after the app is restarted
// (resumeIfRunning, from ReaderApp).
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as extras from './extras';
import * as shomer from './shomer';
import { sizeOfEntry } from './fullLibrary';

export const STORAGE_KEY = 'extrasQueue';
export const POLITE_MS = 1500;           // between two books
export const NETWORK_RETRY_MS = 30000;   // waiting for Wi-Fi (or any network)
let timing = {polite: POLITE_MS, retry: NETWORK_RETRY_MS};
export const MAX_TRIES = 2;

// {sources: [id], running, paused, wifiOnly, failed: {title: tries}}
let state = {sources: [], running: false, paused: false, wifiOnly: true, failed: {}};
let status = 'idle';                     // idle | downloading | waiting_network | paused | done
let current = null;                      // the title downloading now
let loop = null;
let loaded = null;
const listeners = new Set();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.log(e); } });
const save = () => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});

export const getState = () => ({...state, status, current});

async function load() {
  if (!loaded) {
    loaded = (async () => {
      try {
        const saved = JSON.parse(await AsyncStorage.getItem(STORAGE_KEY));
        if (saved) { state = {...state, ...saved, failed: saved.failed || {}}; }
      } catch (e) { /* nothing saved */ }
    })();
  }
  return loaded;
}

/** The books of a source the queue brings: in the library, shown by the filter (not the notes books) */
export function booksOf(id) {
  const main = new Set(extras.downloadedBooks(id));
  const notes = new Set(extras.installedTitles(id).filter(t => !main.has(t)));   // (they come with their book)
  return Object.values(extras.getBooks())
    .filter(b => b.source === id && !notes.has(b.title) && !shomer.isBookHidden(b.title));
}

/** {done, total, doneKB, totalKB} of a source's books */
export function progressOf(id) {
  const books = booksOf(id);
  const done = books.filter(b => extras.isDownloaded(b.title));
  const kB = list => list.reduce((n, b) => n + sizeOfEntry(b), 0);
  return {done: done.length, total: books.length, doneKB: kB(done), totalKB: kB(books)};
}

function nextBook() {
  for (const id of state.sources) {
    const b = booksOf(id).find(x => !extras.isDownloaded(x.title) && (state.failed[x.title] || 0) < MAX_TRIES);
    if (b) { return b.title; }
  }
  return null;
}

async function networkAllows() {
  try {
    const net = NetInfo.fetch ? await NetInfo.fetch() : {type: 'wifi', isConnected: true};
    if (net.isConnected === false || net.type === 'none') { return false; }
    return !state.wifiOnly || net.type === 'wifi' || net.type === 'ethernet';
  } catch (e) {
    return false;
  }
}

async function run() {
  while (state.running && !state.paused) {
    if (!(await networkAllows())) {
      status = 'waiting_network';
      notify();
      await wait(timing.retry);
      continue;
    }
    const title = nextBook();
    if (!title) {
      state = {...state, running: false};
      status = 'done';
      await save();
      notify();
      return;
    }
    current = title;
    status = 'downloading';
    notify();
    try {
      await extras.downloadBook(title);
    } catch (e) {
      if (e instanceof extras.DownloadCancelledError) { break; }       // (paused or cancelled)
      if (!(e instanceof extras.RestrictedBookError)) {               // (that one leaves the library)
        state.failed = {...state.failed, [title]: (state.failed[title] || 0) + 1};
        console.log('full library: could not download', title, e);
      }
      await save();
    }
    current = null;
    notify();
    await wait(timing.polite);
  }
  current = null;
  if (state.paused) { status = 'paused'; }
  notify();
}

function startLoop() {
  if (!loop) {
    loop = run().catch(e => console.log('full library: download', e)).finally(() => { loop = null; });
  }
  return loop;
}

/** Download every book of these extra sources (turned on first), in the background */
export async function start(sources) {
  await load();
  await extras.loadExtras();
  for (const id of sources) {
    if (!extras.isEnabled(id)) {
      try { await extras.setSourceEnabled(id, true); } catch (e) { console.log(`full library: ${id}`, e); }
    }
  }
  state = {...state, sources: [...sources], running: true, paused: false, failed: {}};
  await save();
  notify();
  startLoop();
}

export async function pause() {
  await load();
  state = {...state, paused: true};
  await save();
  if (current) { extras.cancelDownload(current); }
  status = 'paused';
  notify();
}

export async function resume() {
  await load();
  if (!state.sources.length) { return; }
  state = {...state, running: true, paused: false};
  await save();
  notify();
  startLoop();
}

/** Stop and forget the queue (the books downloaded so far stay) */
export async function cancel() {
  await load();
  const was = current;
  state = {...state, sources: [], running: false, paused: false, failed: {}};
  await save();
  if (was) { extras.cancelDownload(was); }
  status = 'idle';
  notify();
}

export async function setWifiOnly(on) {
  await load();
  state = {...state, wifiOnly: !!on};
  await save();
  notify();
}

/** At startup: go on with a download the app was closed during */
export async function resumeIfRunning() {
  await load();
  if (state.running && !state.paused && state.sources.length) {
    await extras.loadExtras();
    startLoop();
  } else if (state.running && state.paused) {
    status = 'paused';
  }
  return getState();
}

// (tests)
export function _reset(next = {}, t = {polite: 0, retry: 0}) {
  timing = t;
  state = {sources: [], running: false, paused: false, wifiOnly: true, failed: {}, ...next};
  status = 'idle';
  current = null;
  loop = null;
  loaded = Promise.resolve();
}
export const _loop = () => loop;
export function _resetLoaded() { loaded = null; return load(); }
