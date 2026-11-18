/**
 * Background pre-warming for offline commentaries:
 * - Always prewarms Rashi (`Rashi on <Book>`) everywhere as soon as a book opens.
 * - On Shas (`Talmud`), also prewarms Steinsaltz (`Steinsaltz on <Masechta>`).
 * - On Tanakh, also prewarms Ibn Ezra, Ramban, and Sforno.
 * - Warms the current daf/chapter first, then the next daf/chapter, and for short
 *   commentaries (< SHORT_COMMENTARY_CHAR_TARGET), continues advancing through subsequent
 *   chapters up to MAX_PREWARM_SECTIONS.
 * Never hits the network: checks `offlineTitleExists` before loading.
 */
import { offlineTitleExists, warmOfflineCommentaryChapter } from '../offline';

export const SHORT_COMMENTARY_CHAR_TARGET = 25000;
export const MAX_PREWARM_SECTIONS = 8;

const _warmed = new Set();
const _warmedMeta = new Map();
const _inFlight = new Set();

export function commentariesToPrewarm(title, categories) {
  if (!title || /^(?:Rashi|Steinsaltz|Tosafot|Ibn Ezra|Ramban|Sforno)\s+on\s+/i.test(title)) {
    return [];
  }
  const out = [`Rashi on ${title}`];
  if (Array.isArray(categories) && categories.some(c => /^Talmud$/i.test(c))) {
    out.push(`Steinsaltz on ${title}`);
  }
  if (Array.isArray(categories) && categories.some(c => /^Tanakh$/i.test(c))) {
    out.push(`Ibn Ezra on ${title}`, `Ramban on ${title}`, `Sforno on ${title}`);
  }
  return out;
}

export function commentaryRefForSection(sectionRef, commTitle, baseTitle) {
  if (!sectionRef || !commTitle || !baseTitle) { return null; }
  if (!sectionRef.startsWith(baseTitle)) { return null; }
  const suffix = sectionRef.slice(baseTitle.length);
  return `${commTitle}${suffix}`;
}

function nextNumberedSection(commSectionRef) {
  const m = commSectionRef && commSectionRef.match(/^(.*\s)(\d+)$/);
  return m ? `${m[1]}${parseInt(m[2], 10) + 1}` : null;
}

async function warmSingleCommSection(commTitle, commSectionRef) {
  if (!commSectionRef) { return { chars: 0, nextRef: null }; }
  if (_warmed.has(commSectionRef)) { return _warmedMeta.get(commSectionRef) || { chars: 0, nextRef: null }; }
  if (_inFlight.has(commSectionRef)) { return { chars: 0, nextRef: null }; }
  let exists = false;
  try { exists = await offlineTitleExists(commTitle); } catch (e) { exists = false; }
  if (!exists) { return { chars: 0, nextRef: null, missingTitle: true }; }
  _inFlight.add(commSectionRef);
  try {
    const res = await warmOfflineCommentaryChapter(commSectionRef);
    if (res && (res.chars > 0 || res.nextRef)) {
      _warmed.add(commSectionRef);
      _warmedMeta.set(commSectionRef, res);
    }
    return res || { chars: 0, nextRef: null };
  } catch (e) {
    // Section may not exist in that commentary (e.g., an empty chapter or non-matching ref); skip quietly.
    return { chars: 0, nextRef: null };
  } finally {
    _inFlight.delete(commSectionRef);
  }
}

async function warmShortContinuation(progress) {
  while (
    !progress.missingTitle &&
    !progress.exhausted &&
    progress.warmedCount < MAX_PREWARM_SECTIONS &&
    progress.totalChars < SHORT_COMMENTARY_CHAR_TARGET
  ) {
    const candidate = (progress.lastNextRef && !_warmed.has(progress.lastNextRef))
      ? progress.lastNextRef
      : nextNumberedSection(progress.lastSection);
    if (!candidate || candidate === progress.lastSection || _warmed.has(candidate) || _inFlight.has(candidate)) {
      progress.exhausted = true;
      break;
    }
    const res = await warmSingleCommSection(progress.commTitle, candidate);
    if (res.missingTitle || (res.chars === 0 && !res.nextRef)) {
      progress.exhausted = true;
      break;
    }
    progress.totalChars += res.chars;
    progress.warmedCount += 1;
    progress.lastSection = candidate;
    progress.lastNextRef = res.nextRef;
  }
}

export async function prewarmCommentary(commTitle, sectionRef, nextSectionRef = null) {
  if (!commTitle || !sectionRef || typeof Sefaria === 'undefined' || !Sefaria.textTitleForRef) { return; }
  const baseTitle = Sefaria.textTitleForRef(sectionRef);
  if (!baseTitle) { return; }
  const firstComm = commentaryRefForSection(sectionRef, commTitle, baseTitle);
  if (!firstComm) { return; }
  await new Promise(resolve => setTimeout(resolve, 0));
  const res1 = await warmSingleCommSection(commTitle, firstComm);
  if (res1.missingTitle) { return; }
  const progress = {
    commTitle,
    totalChars: res1.chars,
    warmedCount: 1,
    lastSection: firstComm,
    lastNextRef: res1.nextRef,
    missingTitle: false,
    exhausted: res1.chars === 0 && !res1.nextRef,
  };
  if (nextSectionRef && nextSectionRef !== sectionRef) {
    const nextComm = commentaryRefForSection(nextSectionRef, commTitle, baseTitle);
    if (nextComm && nextComm !== firstComm) {
      const res2 = await warmSingleCommSection(commTitle, nextComm);
      progress.totalChars += res2.chars;
      progress.warmedCount += 1;
      progress.lastSection = nextComm;
      progress.lastNextRef = res2.nextRef;
      if (res2.chars === 0 && !res2.nextRef) { progress.exhausted = true; }
    }
  }
  await warmShortContinuation(progress);
}

export async function prewarmSection(sectionRef, nextSectionRef = null) {
  if (!sectionRef || typeof Sefaria === 'undefined' || !Sefaria.textTitleForRef) { return; }
  const baseTitle = Sefaria.textTitleForRef(sectionRef);
  if (!baseTitle) { return; }
  let categories = null;
  try { categories = Sefaria.categoriesForTitle ? Sefaria.categoriesForTitle(baseTitle) : null; } catch (e) { categories = null; }
  const comms = commentariesToPrewarm(baseTitle, categories);
  if (!comms.length) { return; }
  await new Promise(resolve => setTimeout(resolve, 0));

  const states = [];
  for (const commTitle of comms) {
    const firstComm = commentaryRefForSection(sectionRef, commTitle, baseTitle);
    if (!firstComm) { continue; }
    const res1 = await warmSingleCommSection(commTitle, firstComm);
    states.push({
      commTitle,
      totalChars: res1.chars,
      warmedCount: 1,
      lastSection: firstComm,
      lastNextRef: res1.nextRef,
      missingTitle: !!res1.missingTitle,
      exhausted: res1.chars === 0 && !res1.nextRef,
    });
  }

  if (nextSectionRef && nextSectionRef !== sectionRef) {
    for (const st of states) {
      if (st.missingTitle) { continue; }
      const nextComm = commentaryRefForSection(nextSectionRef, st.commTitle, baseTitle);
      if (nextComm && nextComm !== st.lastSection) {
        const res2 = await warmSingleCommSection(st.commTitle, nextComm);
        st.totalChars += res2.chars;
        st.warmedCount += 1;
        st.lastSection = nextComm;
        st.lastNextRef = res2.nextRef;
        if (res2.chars === 0 && !res2.nextRef) { st.exhausted = true; }
      }
    }
  }

  for (const st of states) {
    await warmShortContinuation(st);
  }
}

export function _resetPrewarm() {
  _warmed.clear();
  _warmedMeta.clear();
  _inFlight.clear();
}
