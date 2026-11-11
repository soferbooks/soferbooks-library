'use strict';

/**
 * Nikud by computer: Dicta's Nakdan adds vowels to Hebrew that has none, as the owner's Sefaria
 * Customizer extension does on sefaria.org (sefaria-shomer-extension/nikud.js). The same endpoint,
 * key and request; the same rules:
 *
 * - Only a text with no nikud is sent (12+ Hebrew letters, vowels on under 15% of them), and only
 *   its text (footnotes left out); its tags stay as they were.
 * - Only the letters' marks are added: an answer whose letters differ from what was sent is not used.
 * - Dicta's terms: one request at a time, 12 seconds apart, under 25,000 letters each; the texts
 *   waiting are sent together (newest, i.e. what is on screen now, first).
 * - Every answer is kept on the phone (a file, the last 3,000 texts), so a text is asked for once
 *   and shows with its nikud offline afterwards.
 * - A request that fails or takes over 20 seconds leaves the plain text, and Dicta is not asked
 *   again for a minute.
 *
 * Used with Dicta's permission (given for the extension, 2026-11-11); Dicta is credited wherever
 * its nikud shows (reader/NakdanNotices.js).
 */

import { useEffect, useMemo, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';

// (the extension's dicta.js)
export const DICTA_NAKDAN = {
  url: 'https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud',
  key: '1b04b8ac-ac57-460c-b3bb-e2ced9b60273',
};
export const DICTA_SITE = 'https://dicta.org.il';

export const WAIT_MS = 12000;          // between requests
export const MAX_LETTERS = 25000;      // in one request
export const KEEP = 3000;              // answers kept on the phone
export const TIMEOUT_MS = 20000;       // then the plain text stays
export const PAUSE_MS = 60000;         // after a failed request
const SAVE_DELAY_MS = 1500;
export const CACHE_FILE = `${FileSystem.documentDirectory}nakdan-cache.json`;

export const SPLIT = '<!>';            // between the text pieces of one passage
export const BETWEEN = '<!!>';         // between passages in one request

const MARKS = /[֑-ׇ]/g;
const VOWELS = /[ְ-ׇ]/g;  // (as the extension counts them)
const LETTERS = /[א-ת]/g;
const METEG = 'ֽ';

const count = (s, re) => (s.match(re) || []).length;
export const bare = s => String(s || '').replace(MARKS, '');

/** Has no nikud: enough Hebrew letters, almost no vowels */
export const lacksNikud = text => {
  const letters = count(String(text || ''), LETTERS);
  return letters >= 12 && count(String(text || ''), VOWELS) / letters < 0.15;
};

// (two apostrophes or curly quotes in an abbreviation stop Dicta vowelling the word: " in their place)
export const forDicta = s => s.replace(/(?<=[א-ת֑-ׇ])''|''(?=[א-ת])|(?<=[א-ת֑-ׇ])[“”„‟](?=[א-ת])/g, '"');

/* ---------- a passage's text (its HTML tags and footnotes left as they are) ---------- */

const TAG = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/;
const isFootnoteOpen = (name, attrs) => name === 'sup' || (name === 'i' && /class\s*=\s*["'][^"']*footnote/i.test(attrs));

/**
 * What would be sent for a passage (HTML or plain text): {parts, send, text}, or null when it has
 * nikud already, is too short, or too long. `parts` is the HTML split into tags (odd) and text
 * (even); `send` the indices of the text parts sent (not those inside a footnote).
 */
export const prepareNakdan = html => {
  if (typeof html !== 'string' || !html) { return null; }
  const parts = html.split(/(<[^>]*>)/);
  const send = [];
  let skipName = null;
  let depth = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i % 2 === 1) {
      const m = TAG.exec(p);
      if (!m) { continue; }
      const name = m[2].toLowerCase();
      const selfClosing = /\/\s*>$/.test(p);
      if (skipName) {
        if (name === skipName && !selfClosing) { depth += m[1] ? -1 : 1; }
        if (depth === 0) { skipName = null; }
      } else if (!m[1] && !selfClosing && isFootnoteOpen(name, m[3])) {
        skipName = name;
        depth = 1;
      }
    } else if (!skipName && p) {
      send.push(i);
    }
  }
  if (!send.length) { return null; }
  if (!lacksNikud(send.map(i => parts[i]).join(''))) { return null; }
  const text = send.map(i => forDicta(parts[i])).join(SPLIT);
  return text.length < MAX_LETTERS ? { parts, send, text } : null;
};

/** The passage with Dicta's answer in place of its text pieces, or null if the answer does not fit */
export const mergeNakdan = (item, done) => {
  if (!item || typeof done !== 'string') { return null; }
  const pieces = done.split(SPLIT);
  if (pieces.length !== item.send.length) { return null; }
  const parts = item.parts.slice();
  item.send.forEach((idx, k) => { parts[idx] = pieces[k]; });
  return parts.join('');
};

/* ---------- Dicta's request and answer ---------- */

export const nakdanRequestBody = (texts, apiKey = DICTA_NAKDAN.key) => ({
  task: 'nakdan', useTokenization: true, genre: 'rabbinic',
  data: '\n' + texts.join('\n' + BETWEEN + '\n') + '\n',
  addmorph: false, matchpartial: true, keepmetagim: true, keepqq: false, apiKey,
});

/** Dicta's tokens back to text: each word with its first option, if its letters are the same */
export const joinTokens = tokens => (tokens || []).map(t => {
  const orig = (t && t.str) || '';
  const opts = (t && t.nakdan && t.nakdan.options) || [];
  if (t.sep || !opts.length) { return orig; }
  const w = String(opts[0].w || '').replace(/\|/g, '').split(METEG).join('');
  return bare(w) === bare(orig) ? w : orig;
}).join('');

/** Each text's answer (null where its letters came back different); throws on another shape */
export const parseNakdanAnswer = (json, texts) => {
  const parts = joinTokens((json && json.data) || []).split(BETWEEN);
  if (parts.length !== texts.length) { throw new Error('Dicta answered in a different shape'); }
  return parts.map((p, i) => {
    const got = p.replace(/^\n/, '').replace(/\n$/, '');
    return bare(got) === bare(texts[i]) ? got : null;
  });
};

/* ---------- answers kept on the phone ---------- */

export const fileCacheStorage = (path = CACHE_FILE) => ({
  read: async () => {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) { return {}; }
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  },
  write: obj => FileSystem.writeAsStringAsync(path, JSON.stringify(obj)),
});

/* ---------- the queue: one request at a time, a batch of what is waiting ---------- */

export const createNakdan = ({
  fetchImpl = (...a) => fetch(...a),
  storage = fileCacheStorage(),
  now = () => Date.now(),
  url = DICTA_NAKDAN.url,
  apiKey = DICTA_NAKDAN.key,
  wait = WAIT_MS,
  timeout = TIMEOUT_MS,
  pause = PAUSE_MS,
  maxLetters = MAX_LETTERS,
  keep = KEEP,
  saveDelay = SAVE_DELAY_MS,
} = {}) => {
  const cache = new Map();           // text sent -> text with nikud
  const failed = new Set();          // texts Dicta changed (not asked again while the app runs)
  const waiting = new Map();         // text -> Set of callbacks
  const busyListeners = new Set();
  let loading = null;
  let busy = false;
  let lastSent = 0;
  let pausedUntil = 0;
  let timer = null;
  let saveTimer = null;
  let requests = 0;

  const load = () => {
    if (!loading) {
      loading = Promise.resolve().then(() => storage.read()).then(obj => {
        for (const [k, v] of Object.entries(obj || {})) {
          if (!cache.has(k) && typeof v === 'string') { cache.set(k, v); }
        }
      }).catch(() => {});
    }
    return loading;
  };

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      Promise.resolve().then(() => storage.write(Object.fromEntries(cache))).catch(() => {});
    }, saveDelay);
  };

  const remember = (text, done) => {
    cache.delete(text);
    cache.set(text, done);
    while (cache.size > keep) { cache.delete(cache.keys().next().value); }
    save();
  };

  const setBusy = on => { busy = on; busyListeners.forEach(fn => fn(on)); };

  /** The text with nikud, null (Dicta could not), or undefined (not asked yet) */
  const cached = text => (cache.has(text) ? cache.get(text) : failed.has(text) ? null : undefined);

  const deliver = text => {
    const done = cached(text);
    if (done === undefined) { return false; }
    const fns = waiting.get(text);
    waiting.delete(text);
    if (fns) { fns.forEach(fn => fn(done)); }
    return true;
  };

  const later = ms => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; pump(); }, Math.max(0, ms));
  };

  const ask = async texts => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeoutId = null;
    const timedOut = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        if (controller) { controller.abort(); }
        reject(new Error('Dicta took too long'));
      }, timeout);
    });
    try {
      const res = await Promise.race([
        fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(nakdanRequestBody(texts, apiKey)),
          signal: controller ? controller.signal : undefined,
        }),
        timedOut,
      ]);
      if (!res || !res.ok) { throw new Error('Dicta answered ' + (res && res.status)); }
      const json = await Promise.race([res.json(), timedOut]);
      return parseNakdanAnswer(json, texts);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const pump = async () => {
    if (busy || timer) { return; }
    await load();
    for (const text of [...waiting.keys()]) { deliver(text); }
    if (!waiting.size || busy || timer) { return; }
    const t = now();
    if (t < pausedUntil) { later(pausedUntil - t); return; }
    if (lastSent && t < lastSent + wait) { later(lastSent + wait - t); return; }
    // newest first: what the reader has just scrolled to
    const texts = [];
    let size = 0;
    for (const text of [...waiting.keys()].reverse()) {
      if (texts.length && size + text.length + 8 > maxLetters) { break; }
      size += text.length + 8;
      texts.push(text);
    }
    setBusy(true);
    lastSent = now();
    requests++;
    try {
      const got = await ask(texts);
      texts.forEach((text, i) => { if (got[i]) { remember(text, got[i]); } else { failed.add(text); } });
      texts.forEach(deliver);
    } catch (e) {
      pausedUntil = now() + pause;
    } finally {
      lastSent = now();
      setBusy(false);
      if (waiting.size) { later(0); }
    }
  };

  /** Ask for `text`; `onDone(textWithNikud | null)` once known. Returns a function that stops waiting. */
  const want = (text, onDone) => {
    if (!waiting.has(text)) { waiting.set(text, new Set()); }
    // (asked again: it moves to the end, as the newest)
    const fns = waiting.get(text);
    waiting.delete(text);
    waiting.set(text, fns);
    fns.add(onDone);
    if (!busy) { later(0); }
    return () => {
      const set = waiting.get(text);
      if (!set) { return; }
      set.delete(onDone);
      if (!set.size) { waiting.delete(text); }
    };
  };

  return {
    load,
    cached,
    want,
    isBusy: () => busy,
    subscribeBusy: fn => { busyListeners.add(fn); return () => busyListeners.delete(fn); },
    _requests: () => requests,
    /** Stop waiting and drop the timers (tests) */
    _dispose: () => { waiting.clear(); clearTimeout(timer); timer = null; clearTimeout(saveTimer); },
    _waiting: () => [...waiting.keys()],
  };
};

export const nakdan = createNakdan();

/**
 * A passage (HTML or plain text) with Dicta's nikud when `on` and it has none: the vowelled text
 * once known (from the phone or from Dicta), else null (show the text as it is).
 */
export const useNakdan = (html, on, queue = nakdan) => {
  const item = useMemo(() => (on ? prepareNakdan(html) : null), [html, on]);
  const [done, setDone] = useState(() => (item ? queue.cached(item.text) : undefined));
  useEffect(() => {
    if (!item) { setDone(undefined); return undefined; }
    const known = queue.cached(item.text);
    setDone(known);
    if (known !== undefined) { return undefined; }
    let alive = true;
    const stop = queue.want(item.text, d => { if (alive) { setDone(d); } });
    return () => { alive = false; stop(); };
  }, [item, queue]);
  return item && done ? mergeNakdan(item, done) : null;
};

/** Whether a request to Dicta is under way (for "Adding nikud…") */
export const useNakdanBusy = (queue) => {
  queue = queue || nakdan;
  const [busy, setBusyState] = useState(queue.isBusy());
  useEffect(() => queue.subscribeBusy(setBusyState), [queue]);
  return busy;
};
