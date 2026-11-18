/**
 * Background pre-warming for offline texts and commentaries:
 * - Always prewarms Rashi (`Rashi on <Book>`) everywhere as soon as a book opens.
 * - On Shas (`Talmud`), also prewarms Steinsaltz (`Steinsaltz on <Masechta>`).
 * - On Tanakh, also prewarms Ibn Ezra, Ramban, and Sforno.
 * - On Mishnah, Halakhah, and Midrash, also prewarms their classic commentaries.
 * - When links load for any section (`prewarmLinkedCommentaries`), also warms the top
 *   linked commentaries/targumim for that section.
 * - Warms the current daf/chapter first, then the next daf/chapter, and for ANY short
 *   section/commentary (< SHORT_COMMENTARY_CHAR_TARGET), continues advancing through
 *   subsequent sections up to MAX_PREWARM_SECTIONS (for both commentaries and the base book).
 * Never hits the network: checks `offlineTitleExists` before loading.
 */
import { offlineTitleExists, warmOfflineCommentaryChapter } from '../offline';

export const SHORT_COMMENTARY_CHAR_TARGET = 25000;
export const MAX_PREWARM_SECTIONS = 8;

const PREFERRED_INLINE = [
  'Onkelos', 'Targum Jonathan', 'Rashi', 'Bartenura', 'Tosafot',
  'Ibn Ezra', 'Ramban', 'Sforno', 'Steinsaltz', 'Mishnah Berurah',
];

const _warmed = new Set();
const _warmedMeta = new Map();
const _inFlight = new Set();

export function commentariesToPrewarm(title, categories) {
  const cats = Array.isArray(categories) ? categories : [];
  if (
    !title ||
    /\son\s/i.test(title) ||
    /^Mishnah Berurah$/i.test(title) ||
    cats.some(c => /^(?:Commentary|Targum|Rishonim on Tanakh|Acharonim on Tanakh)$/i.test(c))
  ) {
    return [];
  }
  const out = [`Rashi on ${title}`];
  if (cats.some(c => /^Talmud$/i.test(c))) {
    out.push(`Steinsaltz on ${title}`);
  }
  if (cats.some(c => /^Tanakh$/i.test(c))) {
    out.push(`Ibn Ezra on ${title}`, `Ramban on ${title}`, `Sforno on ${title}`);
  }
  if (cats.some(c => /^Mishnah$/i.test(c))) {
    out.push(`Bartenura on ${title}`, `Tosafot Yom Tov on ${title}`, `Rambam on ${title}`);
  }
  if (cats.some(c => /^Halakhah$/i.test(c))) {
    if (title === 'Shulchan Arukh, Orach Chayim') {
      out.push('Mishnah Berurah', `Be'er Heitev on ${title}`);
    } else if (title.startsWith('Shulchan Arukh,')) {
      out.push(`Siftei Kohen on ${title}`, `Turei Zahav on ${title}`, `Be'er Heitev on ${title}`);
    } else if (title.startsWith('Mishneh Torah,')) {
      out.push(`Kesef Mishneh on ${title}`, `Maggid Mishneh on ${title}`);
    }
  }
  if (cats.some(c => /^Midrash$/i.test(c))) {
    out.push(`Matnot Kehunah on ${title}`, `Etz Yosef on ${title}`);
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

  // Also warm the base book's own sections ahead when sections are short.
  const baseRes1 = await warmSingleCommSection(baseTitle, sectionRef);
  if (!baseRes1.missingTitle) {
    states.push({
      commTitle: baseTitle,
      totalChars: baseRes1.chars,
      warmedCount: 1,
      lastSection: sectionRef,
      lastNextRef: baseRes1.nextRef,
      missingTitle: false,
      exhausted: baseRes1.chars === 0 && !baseRes1.nextRef && !nextSectionRef,
    });
  }

  if (nextSectionRef && nextSectionRef !== sectionRef) {
    for (const st of states) {
      if (st.missingTitle) { continue; }
      const nextComm = st.commTitle === baseTitle
        ? nextSectionRef
        : commentaryRefForSection(nextSectionRef, st.commTitle, baseTitle);
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

export async function prewarmLinkedCommentaries(sectionRef, nextSectionRef = null, relatedObj = null) {
  if (!sectionRef || !Array.isArray(relatedObj) || !relatedObj.length) { return; }
  const counts = new Map();
  for (const seg of relatedObj) {
    for (const link of (seg && seg.links) || []) {
      if (link.category !== 'Commentary' && link.category !== 'Targum') { continue; }
      const title = link.textTitle;
      if (!title) { continue; }
      const existing = counts.get(title);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(title, {
          title,
          key: link.collectiveTitle || title,
          count: 1,
        });
      }
    }
  }
  if (!counts.size) { return; }
  const preferredRank = entry => {
    const idx = PREFERRED_INLINE.findIndex(p => p === entry.key || entry.title === p || entry.title.startsWith(`${p} `));
    return idx === -1 ? PREFERRED_INLINE.length : idx;
  };
  const topTitles = [...counts.values()]
    .sort((a, b) => (preferredRank(a) - preferredRank(b)) || (b.count - a.count))
    .slice(0, 5)
    .map(entry => entry.title);
  for (const commTitle of topTitles) {
    await prewarmCommentary(commTitle, sectionRef, nextSectionRef);
  }
}

export function _resetPrewarm() {
  _warmed.clear();
  _warmedMeta.clear();
  _inFlight.clear();
}
