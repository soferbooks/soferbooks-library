// The full library's background download of the extra sources' books (owner, 2026-11-11: when
// the reader downloads the whole library, the books of Dicta, Otzaria, Wikisource and the Sofer
// Library come too).
//
// A few books at a time (CONCURRENCY.queueBooks, downloadPool.js - owner, 2026-11-12: one at a
// time was too slow; extras.downloadBook: each from its own source's server, converted on the
// phone), each worker resting a moment between two books so the sources' servers are not hurried. Books the
// content filter hides are not downloaded; a book that fails twice is skipped. Pause, Resume and
// Cancel; on Wi-Fi only unless the reader turns that off (it then waits for Wi-Fi). What was
// chosen is kept (AsyncStorage), so the download goes on after the app is restarted
// (resumeIfRunning, from ReaderApp).
//
// Space (QA round 14: the download filled the phone): before each book the phone must have room
// for it and LOW_SPACE_BYTES to spare (storage.js); else the queue pauses itself
// (pausedBy 'low_space') until the reader makes room and taps Resume. Cancel deletes what was
// half downloaded (the work files); the books already downloaded stay.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as extras from './extras';
import { sizeOfEntry, ratioOf, partBooks } from './fullLibrary';
import { freeBytes, cleanWork, LOW_SPACE_BYTES, LowSpaceError } from './storage';
import { pruneSearchFilesIfOff } from './searchPrefs';
import { CONCURRENCY } from './downloadPool';

export const STORAGE_KEY = 'extrasQueue';
export const POLITE_MS = 1500;           // between two Wikisource books
export const INTER_BOOK_DELAY_MS = 20;   // let the UI / reader go first
export const NETWORK_RETRY_MS = 30000;   // waiting for Wi-Fi (or any network)
let timing = {polite: POLITE_MS, retry: NETWORK_RETRY_MS, books: CONCURRENCY.queueBooks};
export const MAX_TRIES = 2;

const politeDelayFor = sourceId => {
  if (!timing.polite || timing.polite <= 0) { return 0; }
  if (sourceId === 'sofer_library') { return 0; }
  if (sourceId === 'dicta' || sourceId === 'otzaria') { return Math.min(timing.polite, 100); }
  return timing.polite;
};

// {sources: [id], pausedSources: [id], running, paused, pausedBy ('user' | 'low_space'), wifiOnly, failed: {title: tries},
//  categories: {id: [category key]} - a source downloading only some of its books (Settings,
//  LibrariesSettings.js: "Some books"); a source not there downloads all its books}
let state = {sources: [], pausedSources: [], running: false, paused: false, pausedBy: null, wifiOnly: true, failed: {}, categories: {}};
let status = 'idle';                     // idle | downloading | waiting_network | paused | done
const inFlight = new Set();              // the titles downloading now
let freeAtPause = null;                  // bytes free when it paused for space
let loop = null;
let loaded = null;
const listeners = new Set();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.log(e); } });
const save = () => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});

export const getState = () => ({...state, status, current: inFlight.size ? [...inFlight][0] : null,
  downloading: [...inFlight], freeAtPause});

export const isQueueActive = () => !!(state.running && !state.paused && (inFlight.size || status === 'downloading'));

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

/** A book's category, as "Some books" lists them: its first category (Sefaria's top ones for the extra sources) */
export const categoryKeyOf = b => ((b && b.categories && b.categories[0]) || 'Other');

/** The categories chosen for a source ("Some books"), or null (all its books) */
export const chosenCategories = id => ((state.categories || {})[id] || null);

/** The books of a source the queue brings (fullLibrary.partBooks: its count is of the same books) */
export const booksOf = id => {
  const cats = chosenCategories(id);
  const all = partBooks(id);
  return cats ? all.filter(b => cats.includes(categoryKeyOf(b))) : all;
};

/** The books of one of a source's categories */
export const booksOfCategory = (id, key) => partBooks(id).filter(b => categoryKeyOf(b) === key);

/** A source's categories: [{key, en, he, books, kB}] (most books first) */
export function categoriesOf(id) {
  const by = new Map();
  for (const b of partBooks(id)) {
    const key = categoryKeyOf(b);
    if (!by.has(key)) {
      by.set(key, {key, en: key, he: (b.heCategories && b.heCategories[0]) || key, books: 0, kB: 0});
    }
    const c = by.get(key);
    c.books += 1;
    c.kB += sizeOfEntry(b);
  }
  return [...by.values()].sort((a, b) => b.books - a.books);
}

/** {done, total, doneKB, totalKB} of a source's books */
export function progressOf(id) {
  const books = booksOf(id);
  const done = books.filter(b => extras.isDownloaded(b.title));
  const kB = list => list.reduce((n, b) => n + sizeOfEntry(b), 0);
  return {done: done.length, total: books.length, doneKB: kB(done), totalKB: kB(books)};
}

/** {done, total, doneKB, totalKB} of all the queue's sources */
export function overallProgress() {
  const out = {done: 0, total: 0, doneKB: 0, totalKB: 0};
  for (const id of state.sources) {
    const p = progressOf(id);
    Object.keys(out).forEach(k => { out[k] += p[k]; });
  }
  return out;
}

function nextBook() {
  for (const id of state.sources) {
    const b = booksOf(id).find(x => !extras.isDownloaded(x.title) && !inFlight.has(x.title)
      && (state.failed[x.title] || 0) < MAX_TRIES);
    if (b) { return b; }
  }
  return null;
}

/** The bytes a book needs: its download made into the library's files, twice over (it is zipped beside itself) */
export const bytesFor = b => 2 * sizeOfEntry(b) * 1024 * ratioOf(b.source);

async function networkAllows() {
  try {
    const net = NetInfo.fetch ? await NetInfo.fetch() : {type: 'wifi', isConnected: true};
    if (net.isConnected === false || net.type === 'none') { return false; }
    return !state.wifiOnly || net.type === 'wifi' || net.type === 'ethernet';
  } catch (e) {
    return false;
  }
}

async function pauseForSpace(free) {
  freeAtPause = free;
  state = {...state, paused: true, pausedBy: 'low_space'};
  status = 'paused';
  await save();
  notify();
  // (Sefaria's part of the full library pauses with it: DownloadControl.js)
  try {
    const {Tracker} = require('./DownloadControl');
    if (Tracker && Tracker.downloadInProgress() && !Tracker.pausedBy) { Tracker.pause('low_space'); }
  } catch (e) { /* not loaded */ }
}

/** The phone ran low on space (Sefaria's download noticed it): pause, the book under way too */
export async function pauseForLowSpace(free) {
  await load();
  if (!state.running || state.paused) { return; }
  const was = [...inFlight];
  await pauseForSpace(free);
  was.forEach(t => extras.cancelDownload(t));
}

/** One worker: books one after another while the queue runs (several work at once: run) */
async function worker() {
  while (state.running && !state.paused) {
    if (!(await networkAllows())) {
      status = 'waiting_network';
      notify();
      await wait(timing.retry);
      continue;
    }
    if (!state.running || state.paused) { break; }
    const book = nextBook();
    if (!book) { return; }
    // (room for this book and the ones downloading beside it, and LOW_SPACE_BYTES to spare)
    const free = await freeBytes();
    const busy = [...inFlight].reduce((n, t) => n + bytesFor(extras.getBooks()[t] || {source: ''}), 0);
    if (free !== null && free < busy + bytesFor(book) + LOW_SPACE_BYTES) {
      await pauseForSpace(free);
      break;
    }
    if (!state.running || state.paused || inFlight.has(book.title)) { continue; }
    if (timing.polite > 0 && INTER_BOOK_DELAY_MS > 0) {
      await wait(INTER_BOOK_DELAY_MS);
      if (!state.running || state.paused || inFlight.has(book.title)) { continue; }
    }
    const title = book.title;
    inFlight.add(title);
    status = 'downloading';
    notify();
    try {
      await extras.downloadBook(title);
    } catch (e) {
      if (e instanceof extras.DownloadCancelledError) { inFlight.delete(title); break; }   // (paused or cancelled)
      if (e instanceof LowSpaceError || (e && e.name === 'LowSpaceError')) {
        inFlight.delete(title);
        await pauseForSpace(e.free);
        break;
      }
      if (!(e instanceof extras.RestrictedBookError)) {               // (that one leaves the library)
        state.failed = {...state.failed, [title]: (state.failed[title] || 0) + 1};
        console.log('full library: could not download', title, e);
      }
      await save();
    }
    inFlight.delete(title);
    notify();
    const politeDelay = politeDelayFor(book.source);
    if (politeDelay > 0) { await wait(politeDelay); }
  }
}

async function run() {
  for (const id of [...(state.sources || [])]) {
    if (!state.running || state.paused) { break; }
    if (!(await networkAllows())) { break; }
    // (a ready-made bundle is the whole source: only when all its books are wanted)
    if (typeof extras.installHostedBundle === 'function' && !chosenCategories(id)) {
      try {
        status = 'downloading';
        notify();
        await extras.installHostedBundle(id, {
          isCancelled: () => !state.running || state.paused || !(state.sources || []).includes(id),
        });
        // (a ready-made bundle brings its books' search lines: not kept while offline search is off)
        await pruneSearchFilesIfOff();
      } catch (e) {
        if (e instanceof LowSpaceError || (e && e.name === 'LowSpaceError')) {
          await pauseForSpace(e.free);
          break;
        }
      }
    }
  }
  if (state.running && !state.paused) {
    await Promise.all(Array.from({length: Math.max(1, timing.books || 1)}, () => worker()));
  }
  if (state.running && !state.paused && !nextBook() && !inFlight.size) {
    state = {...state, running: false};
    status = 'done';
    await save();
  } else if (state.paused) {
    status = 'paused';
  }
  notify();
}

function startLoop() {
  if (!loop) {
    loop = run().catch(e => console.log('full library: download', e)).finally(() => { loop = null; });
  }
  return loop;
}

/**
 * What Settings chose for a source (LibrariesSettings.js): 'all' its books, 'some' (`categories`),
 * or 'open' (each book when it is opened: the queue leaves it). Downloads in the background.
 */
export async function choose(id, mode, categories = null) {
  await load();
  const cats = {...(state.categories || {})};
  if (mode === 'some') { cats[id] = [...(categories || [])]; } else { delete cats[id]; }
  state = {...state, categories: cats};
  if (mode === 'open') {
    await save();
    await removeSources([id]);
    return;
  }
  await extras.loadExtras();
  if (!extras.isEnabled(id)) {
    try { await extras.setSourceEnabled(id, true); } catch (e) { console.log(`full library: ${id}`, e); }
  }
  const sources = state.sources.includes(id) ? state.sources : [...state.sources, id];
  state = {...state, sources, pausedSources: (state.pausedSources || []).filter(x => x !== id),
    running: true, paused: false, pausedBy: null};
  freeAtPause = null;
  await save();
  notify();
  startLoop();
}

/** 'all' | 'some' | 'open' for a source, as chosen in Settings */
export const choiceOf = id => (!(state.sources || []).includes(id) ? 'open' : chosenCategories(id) ? 'some' : 'all');

/** Download every book of these extra sources (turned on first), in the background */
export async function start(sources) {
  await load();
  await extras.loadExtras();
  for (const id of sources) {
    if (!extras.isEnabled(id)) {
      try { await extras.setSourceEnabled(id, true); } catch (e) { console.log(`full library: ${id}`, e); }
    }
  }
  state = {...state, sources: [...sources], pausedSources: [], running: true, paused: false, pausedBy: null, failed: {}};
  freeAtPause = null;
  await save();
  notify();
  startLoop();
}

/** Pause at once: the books downloading now are stopped (Resume downloads them again) */
export async function pause() {
  await load();
  state = {...state, paused: true, pausedBy: 'user'};
  status = 'paused';
  notify();
  [...inFlight].forEach(t => extras.cancelDownload(t));
  await save();
}

export async function resume() {
  await load();
  if (!state.sources.length) { return; }
  state = {...state, running: true, paused: false, pausedBy: null};
  freeAtPause = null;
  await save();
  notify();
  startLoop();
}

/**
 * Stop and forget the queue. The books downloaded so far stay; the book half downloaded and the
 * work files are deleted. Returns how many books of the queue's sources are on the phone.
 */
export async function cancel() {
  await load();
  const was = [...inFlight];
  const sources = state.sources;
  const kept = sources.reduce((n, id) => n + progressOf(id).done, 0);
  state = {...state, sources: [], pausedSources: [], running: false, paused: false, pausedBy: null, failed: {}};
  freeAtPause = null;
  await save();
  was.forEach(t => extras.cancelDownload(t));
  status = 'idle';
  notify();
  if (loop) { await Promise.race([loop, wait(5000)]); }    // (the book under way stops and cleans up first)
  await cleanWork('extras');
  return kept;
}

export async function setWifiOnly(on) {
  await load();
  state = {...state, wifiOnly: !!on};
  await save();
  notify();
}

/** Remove `sourceIds` from the queue and cancel any in-flight downloads for them. */
export async function removeSources(sourceIds) {
  await load();
  const drop = new Set(sourceIds || []);
  if (!drop.size) { return; }
  const current = state.sources || [];
  const dropped = current.filter(id => drop.has(id));
  const pausedSources = Array.from(new Set([...(state.pausedSources || []), ...dropped]));
  state = { ...state, sources: current.filter(id => !drop.has(id)), pausedSources };
  if (!state.sources.length) {
    state = { ...state, running: false, paused: false, pausedBy: null };
    status = 'idle';
  }
  await save();
  for (const title of [...inFlight]) {
    const info = extras.extraBook ? extras.extraBook(title) : (extras.getBooks && extras.getBooks()[title]);
    if (info && drop.has(info.source)) {
      extras.cancelDownload(title);
    }
  }
  notify();
  if (loop && !state.sources.length) { await Promise.race([loop, wait(3000)]); }
}

/** Re-add a source that was previously toggled off while queued, and resume downloading it. */
export async function restoreSource(id) {
  await load();
  const paused = state.pausedSources || [];
  if (!paused.includes(id)) { return false; }
  const nextSources = state.sources.includes(id) ? state.sources : [...state.sources, id];
  state = {
    ...state,
    sources: nextSources,
    pausedSources: paused.filter(x => x !== id),
    running: true,
    paused: false,
    pausedBy: null,
  };
  freeAtPause = null;
  await save();
  notify();
  startLoop();
  return true;
}

/** At startup: go on with a download the app was closed during */
export async function resumeIfRunning() {
  await load();
  // (nothing downloads yet: what a download left half done is of no use - storage.js)
  await cleanWork('extras');
  if (state.running && !state.paused && state.sources.length) {
    await extras.loadExtras();
    startLoop();
  } else if (state.running && state.paused) {
    status = 'paused';
  }
  return getState();
}

// (tests)
export function _reset(next = {}, t = {polite: 0, retry: 0, books: 1}) {
  timing = {books: 1, ...t};
  state = {sources: [], pausedSources: [], running: false, paused: false, pausedBy: null, wifiOnly: true, failed: {}, ...next};
  status = 'idle';
  inFlight.clear();
  freeAtPause = null;
  loop = null;
  loaded = Promise.resolve();
}
export const _loop = () => loop;
export function _resetLoaded() { loaded = null; return load(); }
