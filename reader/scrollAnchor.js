'use strict';

/**
 * Keeping the reader on the passage it was opened at.
 *
 * TextColumn jumps to its target segment using heights measured off-screen, but the real list then
 * keeps changing above the target: cells that were only estimated get measured, and the inline
 * "under each passage" commentary arrives asynchronously and grows each row. Without correction
 * the text slides away (Shulchan Arukh OC 447:11 ended up at 447:4) and the drifted top segment
 * was saved as the tab's place.
 *
 * So after a jump the target is "anchored": every time the layout changes, the list is scrolled
 * back so the target segment's top sits ANCHOR_TOP_INSET below the top of the list, until the user
 * scrolls or taps (or ANCHOR_MAX_MS passes). While anchored, programmatic scrolls do not count as
 * reading, so the place saved is the target. Pure logic, so it can be unit tested.
 */

export const ANCHOR_TOP_INSET = 100;   // same position the initial jump uses
export const ANCHOR_TOLERANCE = 3;     // px; ignore sub-pixel differences
export const ANCHOR_MAX_MS = 30000;    // give up eventually, even if the user never touches the screen
export const ANCHOR_MAX_SEEKS = 40;    // max blind scrolls while looking for an unrendered target
const SEEK_FRACTION = 0.8;

/**
 * `inset`: where the anchored cell's top is kept, in px below the top of the list (default
 * ANCHOR_TOP_INSET, as after a jump). A display change keeps the passage where it was on screen.
 */
export const createAnchor = (ref, now = Date.now(), inset = ANCHOR_TOP_INSET) => (
  ref ? { ref, startedAt: now, seeks: 0, inset } : null
);

/**
 * The passage the reader is looking at, to keep in place across a display change (language,
 * commentary under each passage, font size): the first cell whose top is in view, or the cell
 * that fills the top of the screen when it starts above it. `cells` is [{ref, y}] of the rendered
 * cells (y in the list content). `preferRef`: the reader's current passage, chosen whenever it is
 * on screen. Returns {ref, inset} (inset = its top relative to the viewport top), or null.
 */
export const pickVisibleAnchor = (cells, currentY, viewportHeight = 0, preferRef = null) => {
  const sorted = (cells || []).filter(c => c && c.ref && typeof c.y === 'number').sort((a, b) => a.y - b.y);
  if (!sorted.length) { return null; }
  // The passage the reader is on (opened at, or reached), when it is on screen: QA round 5 opened
  // Genesis 1:4, chose Talmud under each passage, and was kept at 1:1 - the first verse on its
  // (small-font) screen - as if it had been reading there
  if (preferRef && viewportHeight > 0) {
    const i = sorted.findIndex(c => c.ref === preferRef);
    if (i >= 0) {
      const c = sorted[i];
      const next = sorted[i + 1];
      const startsInView = c.y >= currentY - ANCHOR_TOLERANCE && c.y < currentY + viewportHeight - 40;
      const coversTop = c.y < currentY && (!next || next.y > currentY);
      if (startsInView || coversTop) { return { ref: c.ref, inset: c.y - currentY }; }
    }
  }
  const firstInView = sorted.find(c => c.y >= currentY - ANCHOR_TOLERANCE);
  let containing = null;
  for (const c of sorted) { if (c.y <= currentY) { containing = c; } }
  // a cell starting in the upper part of the screen is what the reader is on; otherwise the one
  // covering the top of the screen (a long passage that started above it)
  const limit = currentY + Math.max(120, (viewportHeight || 0) / 3);
  const pick = firstInView && (!containing || firstInView.y <= limit) ? firstInView : containing;
  return pick ? { ref: pick.ref, inset: pick.y - currentY } : null;
};

export const isAnchorActive = (anchor, now = Date.now()) => !!anchor && now - anchor.startedAt < ANCHOR_MAX_MS;

/**
 * Where to scroll to keep `anchor` in place, or null when nothing should move.
 *   cellY:          the anchor cell's y in the list content (null when it is not rendered)
 *   currentY:       current scroll offset
 *   targetIndex:    the anchor's flat index in the list
 *   renderedRange:  [minIndex, maxIndex] of the cells currently rendered (null if unknown)
 *   viewportHeight: height of the list's viewport
 *   inset:          the anchor's place below the top of the list (anchor.inset)
 *   renderedSpan:   [minY, maxY] of the rendered cells' tops (null if unknown)
 * Returns {offset, seek}: seek=true when the target is not rendered and we are only moving towards it.
 */
export const anchorCorrection = ({ cellY, currentY, targetIndex, renderedRange, viewportHeight, inset = ANCHOR_TOP_INSET, renderedSpan = null }) => {
  if (typeof cellY === 'number') {
    const offset = Math.max(0, cellY - inset);
    return Math.abs(offset - currentY) > ANCHOR_TOLERANCE ? { offset, seek: false } : null;
  }
  if (typeof targetIndex !== 'number' || !renderedRange) { return null; }
  const [lo, hi] = renderedRange;
  const step = Math.max(200, (viewportHeight || 0) * SEEK_FRACTION);
  // (at least past the cells already rendered: rows of Talmud under each verse can be tens of
  // screens long, more than ANCHOR_MAX_SEEKS screen-sized steps)
  const [minY, maxY] = renderedSpan || [null, null];
  if (targetIndex < lo) {
    const past = typeof minY === 'number' ? minY - (viewportHeight || 0) : Infinity;
    return { offset: Math.max(0, Math.min(currentY - step, past)), seek: true };
  }
  if (targetIndex > hi) {
    return { offset: Math.max(currentY + step, typeof maxY === 'number' ? maxY : -Infinity), seek: true };
  }
  return null;
};

/** [min, max] flat index of the rendered cells (refs looked up in jumpInfoMap), or null. */
export const renderedIndexRange = (mountedRefs, jumpInfoMap) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const ref of mountedRefs) {
    const i = jumpInfoMap && jumpInfoMap.get(ref);
    if (typeof i !== 'number') { continue; }
    if (i < lo) { lo = i; }
    if (i > hi) { hi = i; }
  }
  return lo === Infinity ? null : [lo, hi];
};
