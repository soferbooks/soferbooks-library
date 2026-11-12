/**
 * Several downloads at a time, not one after another (owner, 2026-11-12: Dicta's books and their
 * pages came one request at a time). p-limit (MIT, sindresorhus/p-limit) keeps how many run at
 * once bounded; withRetry tries a failed request again after a growing wait.
 *
 * How many at once, per server:
 *   Dicta (files.dicta.org.il: static files)      5 page files of a book, 3 books in the queue
 *   GitHub releases / raw (Sofer Library, Otzaria) 3 files of a book
 *   Wikisource (MediaWiki API)                     2 pages - Wikimedia asks API clients to keep
 *                                                  requests few at a time
 */
import pLimit from 'p-limit';

export const CONCURRENCY = {dictaPages: 5, files: 3, wikisource: 2, queueBooks: 3};

export {pLimit};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let backoffScale = 1;    // (tests: 0)

/**
 * fn() tried up to `tries` times, waiting `base`, 2x`base`, ... between (with some jitter).
 * shouldRetry(error) false: thrown at once (a cancel, a 404). Throws the last error.
 */
export async function withRetry(fn, {tries = 3, base = 500, shouldRetry = () => true} = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (i === tries - 1 || !shouldRetry(e)) { break; }
      await sleep(backoffScale * base * 2 ** i * (0.75 + Math.random() / 2));
    }
  }
  throw last;
}

/** fn over items with at most `limit` at once; results in the items' order */
export function mapLimit(items, limit, fn) {
  const run = pLimit(Math.max(1, limit));
  return Promise.all(items.map((item, i) => run(() => fn(item, i))));
}

// (tests)
export function _setBackoffScale(n) { backoffScale = n; }
