/**
 * "Order a printed copy": a link to the sefer's page on soferbooks.com, shown only for books
 * Sofer can sell.
 *
 * How the app knows: soferbooks.com's public library search (GET /api/library/search?q=...,
 * the one the site's own "New book" search uses) lists only books a customer can order -
 * Sofer's catalog.orderable: a Hebrew edition whose licence allows selling, and not on
 * not_offered.py. So a book is sellable when the search for its title finds it. Sofer's
 * catalogue uses Sefaria's titles; a book Sofer splits (Ben Ish Hai into its Derashos and
 * Halachos, the Tur into its four parts) is found by the name it answers to ("matched"); an
 * extra source's book (Dicta, Otzaria, Wikisource) by its Hebrew name.
 *
 * The answer is kept on the phone (AsyncStorage): a book Sofer sells for a week, a "not sold" for
 * a day only, so a book Sofer adds (or a moment the site answered nothing) is not hidden for a
 * week. Offline or on any error nothing is kept and the link is simply not shown. (v2: answers
 * kept by the first builds, which kept a "not sold" for a week, are dropped.)
 *
 * The link: https://soferbooks.com/?tab=new&book=<Sofer's title> opens the site's book editor
 * with that sefer chosen (web/src/components/HomeTabs.tsx in Sofer).
 */
import {useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {normTitle} from './extras/tree';

export const SOFER_SITE = 'https://soferbooks.com';
const CACHE_KEY = 'soferPrintable:v2';
const KEEP_MS = 7 * 24 * 3600 * 1000;
const KEEP_NOT_SOLD_MS = 24 * 3600 * 1000;

/** The site's address that opens its book editor on this sefer */
export const orderUrl = soferTitle => `${SOFER_SITE}/?tab=new&book=${encodeURIComponent(soferTitle)}`;

const low = s => String(s || '').trim().toLowerCase();

/**
 * Which of the site's search results is this book (pure; tested). Returns Sofer's title or null.
 * In order: the same title; a result that answered to this title (a book Sofer splits or
 * renamed); the same Hebrew name; the first of the parts Sofer split it into ("Tur, Orach Chayim").
 */
export function pickMatch(results, title, heTitle) {
  const list = (results || []).filter(r => r && r.title && !r.shnayim_mikra);
  const t = low(title);
  const he = heTitle ? normTitle(heTitle) : '';
  const found = list.find(r => low(r.title) === t)
    || list.find(r => t && low(r.matched) === t)
    || (he && list.find(r => normTitle(r.he_title) === he))
    || list.find(r => t && low(r.title).startsWith(`${t}, `));
  return found ? found.title : null;
}

async function searchSite(q) {
  const res = await fetch(`${SOFER_SITE}/api/library/search?q=${encodeURIComponent(q)}&limit=10`,
    {headers: {Accept: 'application/json'}});
  if (!res.ok) { throw new Error(`soferbooks.com search: ${res.status}`); }
  return ((await res.json()) || {}).results || [];
}

/** Sofer's title for this book, or null when Sofer does not sell it. Throws when the site can't be reached. */
export async function lookUp(title, heTitle) {
  let found = pickMatch(await searchSite(title), title, heTitle);
  if (!found && heTitle && normTitle(heTitle) !== normTitle(title)) {
    found = pickMatch(await searchSite(heTitle), title, heTitle);
  }
  return found;
}

let memory = null;
async function cache() {
  if (memory) { return memory; }
  try { memory = JSON.parse(await AsyncStorage.getItem(CACHE_KEY)) || {}; } catch (e) { memory = {}; }
  AsyncStorage.removeItem('soferPrintable:v1').catch(() => {});   // (the first builds' answers)
  return memory;
}

const pending = {};
/** lookUp, kept on the phone (a week; a "not sold" a day). null: not sold, or unknown (offline). */
export async function printableTitle(title, heTitle, now = Date.now()) {
  if (!title) { return null; }
  const kept = (await cache())[title];
  if (kept && now - kept.at < (kept.sofer ? KEEP_MS : KEEP_NOT_SOLD_MS)) { return kept.sofer; }
  if (!pending[title]) {
    pending[title] = lookUp(title, heTitle).then(async sofer => {
      (await cache())[title] = {sofer, at: now};
      try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memory)); } catch (e) { /* kept in memory */ }
      return sofer;
    }).catch(() => (kept ? kept.sofer : null)).finally(() => { delete pending[title]; });
  }
  return pending[title];
}

/** For tests: forget what was kept in memory */
export const _reset = () => { memory = null; };

/** Sofer's title for the book (once known), or null */
export function usePrintableTitle(title, heTitle) {
  const [sofer, setSofer] = useState(null);
  useEffect(() => {
    let live = true;
    setSofer(null);
    if (title) {
      printableTitle(title, heTitle).then(s => { if (live) { setSofer(s); } }).catch(() => {});
    }
    return () => { live = false; };
  }, [title, heTitle]);
  return sofer;
}
