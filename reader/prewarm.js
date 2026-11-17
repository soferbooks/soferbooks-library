/**
 * Background pre-warming for offline commentaries:
 * - Always prewarms Rashi (`Rashi on <Book>`) everywhere as soon as a book opens.
 * - On Shas (`Talmud`), also prewarms Steinsaltz (`Steinsaltz on <Masechta>`).
 * - Warms the current daf/chapter first, then the next daf/chapter.
 * Never hits the network: checks `offlineTitleExists` before loading.
 */
import { offlineTitleExists, loadTextOffline } from '../offline';

const _warmed = new Set();
const _inFlight = new Set();

export function commentariesToPrewarm(title, categories) {
  if (!title || /^(?:Rashi|Steinsaltz|Tosafot)\s+on\s+/i.test(title)) {
    return [];
  }
  const out = [`Rashi on ${title}`];
  if (Array.isArray(categories) && categories.some(c => /^Talmud$/i.test(c))) {
    out.push(`Steinsaltz on ${title}`);
  }
  return out;
}

export function commentaryRefForSection(sectionRef, commTitle, baseTitle) {
  if (!sectionRef || !commTitle || !baseTitle) { return null; }
  if (!sectionRef.startsWith(baseTitle)) { return null; }
  const suffix = sectionRef.slice(baseTitle.length);
  return `${commTitle}${suffix}`;
}

async function prewarmOneSection(sectionRef) {
  if (!sectionRef || typeof Sefaria === 'undefined' || !Sefaria.textTitleForRef) { return; }
  const baseTitle = Sefaria.textTitleForRef(sectionRef);
  if (!baseTitle) { return; }
  let categories = null;
  try { categories = Sefaria.categoriesForTitle ? Sefaria.categoriesForTitle(baseTitle) : null; } catch (e) { categories = null; }
  const comms = commentariesToPrewarm(baseTitle, categories);
  for (const commTitle of comms) {
    const commSectionRef = commentaryRefForSection(sectionRef, commTitle, baseTitle);
    if (!commSectionRef || _warmed.has(commSectionRef) || _inFlight.has(commSectionRef)) { continue; }
    let exists = false;
    try { exists = await offlineTitleExists(commTitle); } catch (e) { exists = false; }
    if (!exists) { continue; }
    _inFlight.add(commSectionRef);
    try {
      await loadTextOffline(`${commSectionRef}:1`, {}, true);
      _warmed.add(commSectionRef);
    } catch (e) {
      // Section may not exist in that commentary (e.g., an empty chapter or non-matching ref); skip quietly.
    } finally {
      _inFlight.delete(commSectionRef);
    }
  }
}

export async function prewarmSection(sectionRef, nextSectionRef = null) {
  if (!sectionRef) { return; }
  await new Promise(resolve => setTimeout(resolve, 0));
  await prewarmOneSection(sectionRef);
  if (nextSectionRef && nextSectionRef !== sectionRef) {
    await prewarmOneSection(nextSectionRef);
  }
}

export function _resetPrewarm() {
  _warmed.clear();
  _inFlight.clear();
}
