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

export const createAnchor = (ref, now = Date.now()) => (ref ? { ref, startedAt: now, seeks: 0 } : null);

export const isAnchorActive = (anchor, now = Date.now()) => !!anchor && now - anchor.startedAt < ANCHOR_MAX_MS;

/**
 * Where to scroll to keep `anchor` in place, or null when nothing should move.
 *   cellY:          the anchor cell's y in the list content (null when it is not rendered)
 *   currentY:       current scroll offset
 *   targetIndex:    the anchor's flat index in the list
 *   renderedRange:  [minIndex, maxIndex] of the cells currently rendered (null if unknown)
 *   viewportHeight: height of the list's viewport
 * Returns {offset, seek}: seek=true when the target is not rendered and we are only moving towards it.
 */
export const anchorCorrection = ({ cellY, currentY, targetIndex, renderedRange, viewportHeight }) => {
  if (typeof cellY === 'number') {
    const offset = Math.max(0, cellY - ANCHOR_TOP_INSET);
    return Math.abs(offset - currentY) > ANCHOR_TOLERANCE ? { offset, seek: false } : null;
  }
  if (typeof targetIndex !== 'number' || !renderedRange) { return null; }
  const [lo, hi] = renderedRange;
  const step = Math.max(200, (viewportHeight || 0) * SEEK_FRACTION);
  if (targetIndex < lo) { return { offset: Math.max(0, currentY - step), seek: true }; }
  if (targetIndex > hi) { return { offset: currentY + step, seek: true }; }
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
