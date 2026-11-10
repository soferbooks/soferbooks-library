'use strict';

/**
 * Reading a learning schedule's day as a sequence (Chok LeYisrael has 5-8 readings a day, across
 * Torah, Prophets, Writings, Mishnah, Talmud, Zohar...).
 *
 * A schedule item is opened in its own reader tab, marked with the schedule (tab.schedule), so it
 * never moves the place of a tab the reader opened for that book himself (opening Chok's Genesis
 * 25:29 used to take over the reader's Genesis 1 tab). Opening the same schedule again reuses its
 * tab. When the day has several readings, the tab keeps the list and the reader shows a bar with
 * the current reading, previous/next, and the whole list.
 *
 * Pure, so it is unit tested (__tests__/learningSchedules.test.js).
 *
 *   ScheduleSequence = { key, title: {en, he}, items: [{ref, en, he, section}], index }
 */

/** The sequence for opening reading `n` of `calendarItem` (one entry per ref). */
export const makeScheduleSequence = (calendarItem, n = 0) => {
  if (!calendarItem || !Array.isArray(calendarItem.refs) || !calendarItem.refs.length) { return null; }
  const subs = calendarItem.subs || [];
  const items = calendarItem.refs.map((ref, i) => ({
    ref,
    en: (subs[i] && subs[i].en) || ref,
    he: (subs[i] && subs[i].he) || (subs[i] && subs[i].en) || ref,
    section: (subs[i] && subs[i].section) || null,
  }));
  const index = Math.min(Math.max(0, n | 0), items.length - 1);
  return { key: scheduleKey(calendarItem), title: calendarItem.title || { en: '', he: '' }, items, index };
};

/** Identifies a schedule (one tab per schedule): its English title. */
export const scheduleKey = calendarItem => (calendarItem && calendarItem.title && calendarItem.title.en) || null;

/** True when the sequence is worth showing (more than one reading). */
export const hasSequence = seq => !!seq && Array.isArray(seq.items) && seq.items.length > 1;

/** The sequence at reading `index`, or null when out of range. */
export const sequenceAt = (seq, index) => {
  if (!seq || !Array.isArray(seq.items) || index < 0 || index >= seq.items.length) { return null; }
  return { ...seq, index };
};

/** One step forward (+1) or back (-1); null at either end. */
export const stepSequence = (seq, delta) => (seq ? sequenceAt(seq, (seq.index || 0) + delta) : null);

export const currentReading = seq => (seq && seq.items ? seq.items[seq.index || 0] || null : null);
