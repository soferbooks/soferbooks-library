/**
 * SoferBooks Library collects no analytics. Sefaria's Firebase Analytics was removed.
 *
 * This no-op remains only because sefaria.js (being changed by other work in flight)
 * still imports `trackEvent`. Do not add callers; once that import is gone, delete this
 * file and the analytics/ folder.
 */
export const trackEvent = () => {};
