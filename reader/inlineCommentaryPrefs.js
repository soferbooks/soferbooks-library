'use strict';

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Show under each passage": a commentary or targum shown inline under every segment, like a
 * translation (Onkelos under each pasuk, Rashi under each line of Gemara, Bartenura under each
 * Mishnah). The choice is remembered per sefer (book title).
 *
 * The data comes from the links the reader already loads for each section
 * (relatedBySectionRef[sectionRef][segmentIndex].links, from the offline link files or the API).
 * A source is identified by its key: the link's collectiveTitle (e.g. "Rashi") or, when there is
 * none, the commentary's own index title (e.g. "Onkelos Genesis").
 */

export const INLINE_COMMENTARY_STORAGE_KEY = 'inlineCommentaryByBook.v1';
export const INLINE_CATEGORIES = ['Targum', 'Commentary'];

// Shown first in the menu, in this order, when present.
const PREFERRED = ['Onkelos', 'Targum Jonathan', 'Rashi', 'Bartenura', 'Tosafot', 'Ibn Ezra', 'Ramban', 'Sforno'];

export const linkSourceKey = link => (link && (link.collectiveTitle || link.textTitle)) || null;

/* ---------- per-book preference (pure) ---------- */

export const getInlineCommentary = (prefs, bookTitle) => (bookTitle && prefs && prefs[bookTitle]) || null;

export const setInlineCommentary = (prefs, bookTitle, key) => {
  if (!bookTitle) { return prefs || {}; }
  const next = { ...(prefs || {}) };
  if (key) { next[bookTitle] = key; } else { delete next[bookTitle]; }
  return next;
};

/* ---------- a choice for this session only (from a learning schedule) ---------- */

// A learning schedule item can ask for a commentary beside its text (Mishnah Berurah Yomi opens the
// Shulchan Arukh with the Mishnah Berurah under each se'if). That choice lasts until the app is
// closed or the reader picks something else for the book in the display menu; the reader's saved
// per-book choice is not changed.
const sessionChoices = {};

export const setSessionInlineCommentary = (bookTitle, key) => {
  if (!bookTitle) { return; }
  if (key) { sessionChoices[bookTitle] = key; } else { delete sessionChoices[bookTitle]; }
};

export const clearSessionInlineCommentary = bookTitle => setSessionInlineCommentary(bookTitle, null);

/** What is shown under each passage of `bookTitle`: this session's choice, else the saved one. */
export const effectiveInlineCommentary = (prefs, bookTitle) => (
  (bookTitle && sessionChoices[bookTitle]) || getInlineCommentary(prefs, bookTitle)
);

/**
 * Open a calendar item's nth ref, first applying the item's inline commentary, if any.
 * openScheduleItem(calendarItem, n), when given (ReaderApp, via ReaderAppContext), opens it in the
 * schedule's own tab (learningSchedules/scheduleSequence.js); otherwise openRef(ref) is used.
 */
export const openScheduleRef = (calendarItem, n, openRef, openScheduleItem = null) => {
  const ic = calendarItem && calendarItem.inlineCommentary;
  if (ic && ic.book && ic.key) { setSessionInlineCommentary(ic.book, ic.key); }
  if (openScheduleItem) { return openScheduleItem(calendarItem, n); }
  return openRef(calendarItem.refs[n]);
};

export const loadInlineCommentaryPrefs = async () => {
  try {
    const raw = await AsyncStorage.getItem(INLINE_COMMENTARY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
};

export const saveInlineCommentaryPrefs = prefs => AsyncStorage.setItem(INLINE_COMMENTARY_STORAGE_KEY, JSON.stringify(prefs || {})).catch(() => {});

/* ---------- what can be shown (pure) ---------- */

/**
 * List the commentaries/targumim linked anywhere in the loaded sections.
 * relatedBySectionRef: { [sectionRef]: [ {links: [...]}, ... ] }
 * heTitleFor(textTitle): optional resolver for a Hebrew name when the link has no heCollectiveTitle.
 * Returns [{key, en, he, category, count}]: targumim first, then well-known names, then by count.
 */
export const availableInlineSources = (relatedBySectionRef, heTitleFor = () => null) => {
  const byKey = {};
  for (const related of Object.values(relatedBySectionRef || {})) {
    if (!Array.isArray(related)) { continue; }
    for (const seg of related) {
      for (const link of (seg && seg.links) || []) {
        if (INLINE_CATEGORIES.indexOf(link.category) === -1) { continue; }
        const key = linkSourceKey(link);
        if (!key) { continue; }
        if (!byKey[key]) {
          byKey[key] = {
            key,
            en: key,
            he: link.heCollectiveTitle || heTitleFor(link.textTitle) || key,
            category: link.category,
            count: 0,
          };
        }
        byKey[key].count++;
      }
    }
  }
  const rank = s => {
    const p = PREFERRED.findIndex(name => s.key === name || s.key.startsWith(name + ' '));
    return p === -1 ? PREFERRED.length : p;
  };
  const catRank = s => (s.category === 'Targum' ? 0 : 1);
  return Object.values(byKey).sort((a, b) => (
    (catRank(a) - catRank(b)) || (rank(a) - rank(b)) || (b.count - a.count) || (a.key < b.key ? -1 : 1)
  ));
};

/** The source refs (unique, in order) that a segment's links give for source `key`. */
export const refsForSource = (links, key) => {
  if (!key) { return []; }
  const out = [];
  for (const link of links || []) {
    if (linkSourceKey(link) === key && link.sourceRef && out.indexOf(link.sourceRef) === -1) {
      out.push(link.sourceRef);
    }
  }
  return out;
};
