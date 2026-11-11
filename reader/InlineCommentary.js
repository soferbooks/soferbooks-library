'use strict';

import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { StyleSheet, Text, View } from 'react-native';
import pLimit from 'p-limit';
import { useGlobalState } from '../Hooks';
import { loadText } from '../offlineOnline';
import Sefaria from '../sefaria';
import { CSS_CLASS_STYLES } from '../Misc';
import { itemsForSource } from './inlineCommentaryPrefs';
import { NakdanText } from './NakdanNotices';
import { useNakdan } from './nakdan';
import { commentaryFontSize } from '../StateManager';
import { boldDibbur, plainWithBold, boldRuns, isCommentaryBook, isCommentaryCategory } from './dibbur';
import { commentaryTitles } from '../extras/links';

// ref -> {he, en}; shared by every segment so scrolling back does not reload.
const _cache = new Map();
const CACHE_LIMIT = 1500;
const _inFlight = new Map();
// A section of e.g. Shulchan Arukh with Mishnah Berurah asks for hundreds of comment refs at once.
// Loading a few at a time lets the first load of a commentary section fill the offline cache
// before the rest ask for it (instead of hundreds of parallel reads of the same file), and keeps
// the JS thread free for the reader's own rendering.
const _limit = pLimit(3);

const LRM = String.fromCharCode(0x200E);      // left-to-right mark: the paragraph's direction, whatever its first letter

const plain = html => (typeof html === 'string' ? Sefaria.util.stripHtml(html.replace(/<br\s*\/?>/gi, ' ')) : '');

const flatten = x => (Array.isArray(x) ? x.flat(Infinity).filter(s => typeof s === 'string').join(' ') : x);

export const loadCommentText = (ref, load = loadText) => {
  if (_cache.has(ref)) { return Promise.resolve(_cache.get(ref)); }
  if (_inFlight.has(ref)) { return _inFlight.get(ref); }
  // failSilently: a missing commentary must not pop the "no internet" alert for every line
  const p = _limit(() => load(ref, false, null, true, true))
    .then(({ result }) => {
      // (the Hebrew's bold words kept, with the dibbur hamaschil made bold as SoferBooks prints a
      //  commentary - reader/dibbur.js: shown when the source is a commentary)
      const heHtml = flatten(result?.he);
      const withDibbur = plainWithBold(typeof heHtml === 'string' ? boldDibbur(heHtml) : '');
      return { he: plain(heHtml), en: plain(flatten(result?.en)), heText: withDibbur.text, heDibburBold: withDibbur.bold };
    })
    .catch(() => ({ he: '', en: '' }))
    .then(texts => {
      _inFlight.delete(ref);
      if (_cache.size > CACHE_LIMIT) { _cache.delete(_cache.keys().next().value); }
      _cache.set(ref, texts);
      return texts;
    });
  _inFlight.set(ref, p);
  return p;
};

/** All of a segment's comment texts, resolved together so the row re-renders (and changes height) once. */
export const loadCommentTexts = (refs, load = loadText) => Promise.all(refs.map(r => loadCommentText(r, load)));

export const _clearInlineCommentaryCache = () => { _cache.clear(); _inFlight.clear(); };

/**
 * The chosen commentary/targum for one segment, shown under it like a translation, or the texts of
 * one kind of connection linked to it, each under its name ("@Tanakh": the pesukim quoted).
 * `links` is the segment's links (relatedBySectionRef[sectionRef][i].links); `sourceKey` the
 * chosen source (see reader/inlineCommentaryPrefs.js); `nakdan`: add Dicta's nikud to Hebrew
 * without it (reader/nakdanPrefs.js).
 */
/** The Hebrew of a comment as runs of bold and plain text: [{text, bold}] */
export const commentRuns = (t, he, dibbur) => {
  if (!he) { return []; }
  if (!t || !dibbur || !t.heDibburBold) { return [{ text: he, bold: false }]; }
  // (he: the text shown, with nikud Dicta added or not; its words are the stored text's)
  return boldRuns(he, t.heDibburBold);
};

const BoldRunsText = ({ runs, style }) => (
  <Text style={style}>
    {runs.map((r, i) => (r.bold ? <Text key={i} style={localStyles.bold}>{r.text}</Text> : r.text))}
  </Text>
);

const InlineCommentaryHe = ({ t, he, dibbur, nakdan, style }) => {
  // (bold only in a commentary's comment, as before for a targum or a connection's text)
  const flags = t && dibbur ? t.heDibburBold : null;
  if (!flags || !flags.some(Boolean)) {
    return <NakdanText text={he} on={!!nakdan} style={style} />;
  }
  return <NakdanBoldText t={t} he={he} dibbur={dibbur} nakdan={nakdan} style={style} />;
};

const NakdanBoldText = ({ t, he, dibbur, nakdan, style }) => {
  const vowelled = useNakdan(he, !!nakdan);
  return <BoldRunsText runs={commentRuns(t, vowelled || he, dibbur)} style={style} />;
};

const InlineCommentary = ({ links, sourceKey, nakdan = false }) => {
  const { theme, textLanguage, fontSize: readerFontSize, commentaryFontScale } = useGlobalState();
  // (the commentary's own text size: the Aa menu's "Commentary Size")
  const scale = commentaryFontSize(1, commentaryFontScale);
  const items = useMemo(() => itemsForSource(links, sourceKey), [links, sourceKey]);
  const refs = useMemo(() => items.map(x => x.ref), [items]);
  const refsKey = refs.join('|');
  const [texts, setTexts] = useState(() => refs.map(r => _cache.get(r) || null));

  useEffect(() => {
    let alive = true;
    const cached = refs.map(r => _cache.get(r) || null);
    setTexts(cached);
    if (cached.every(Boolean)) { return undefined; }
    loadCommentTexts(refs).then(loaded => { if (alive) { setTexts(loaded); } });
    return () => { alive = false; };
  }, [refsKey]);

  if (!refs.length) { return null; }
  const showHe = textLanguage !== 'english';
  const showEn = textLanguage !== 'hebrew';
  const size = Math.max(14, readerFontSize * 0.72) * scale;
  const parts = [];
  texts.forEach((t, i) => {
    if (!t) { return; }
    // fall back to whichever language exists, so a Hebrew-only commentary still shows in English mode
    // (the Hebrew as its words were counted for their bold: heText)
    const he = (showHe || !t.en) ? (t.heText != null ? t.heText : t.he) : '';
    const en = (showEn || !t.he) ? t.en : '';
    const name = items[i] && items[i].he;
    if (name && (he || en)) {
      // (a connection: its name first, in the language shown)
      const heName = textLanguage !== 'english';
      parts.push(<Text key={`name${i}`} style={[heName ? localStyles.nameHe : localStyles.nameEn, theme.tertiaryText, { fontSize: size * 0.85 }]}>{heName ? name : items[i].ref}</Text>);
    }
    // (a commentary's comment: its dibbur hamaschil in bold, as SoferBooks prints it)
    const dibbur = !name && !!items[i] && isCommentaryItem(items[i].ref, links);
    if (he) { parts.push(<InlineCommentaryHe key={`he${i}`} t={t} he={he} dibbur={dibbur} nakdan={nakdan} style={[localStyles.he, theme.tertiaryText, { fontSize: size * 1.1, lineHeight: size * 1.6 }]} />); }
    // (LRM first: English Rashi opens with the Hebrew words it explains, and Android then laid the
    // whole paragraph out right to left - its closing period at the start of the line, ".daytime")
    if (en) { parts.push(<Text key={`en${i}`} style={[localStyles.en, theme.tertiaryText, { fontSize: size, lineHeight: size * 1.45 }]}>{LRM + en}</Text>); }
  });
  if (!parts.length) { return null; }
  return (
    <View style={[localStyles.box, theme.lighterGreyBorder]}>
      {parts}
    </View>
  );
};
InlineCommentary.propTypes = {
  links:     PropTypes.array,
  sourceKey: PropTypes.string,
  nakdan:    PropTypes.bool,
};

/** Is an item under the passage a commentary's comment? (its link's category, else its book) */
const isCommentaryItem = (ref, links) => {
  const link = (links || []).find(l => l && l.sourceRef === ref);
  return isCommentaryCategory(link && link.category) || isCommentaryBook(Sefaria.textTitleForRef(ref), commentaryTitles());
};

const localStyles = StyleSheet.create({
  bold: { fontWeight: 'bold' },
  box: { marginHorizontal: 32, marginBottom: 10, paddingTop: 4, borderTopWidth: 1 },
  he: { writingDirection: 'rtl', textAlign: 'right', fontFamily: CSS_CLASS_STYLES.hebrew.fontFamily },
  // the reader's own English text font (serif, as in the main text), not the system sans
  en: { textAlign: 'left', marginTop: 2, fontFamily: CSS_CLASS_STYLES.english.fontFamily },
  nameHe: { writingDirection: 'rtl', textAlign: 'right', fontWeight: 'bold', marginTop: 4 },
  nameEn: { textAlign: 'left', fontWeight: 'bold', marginTop: 4 },
});

export default React.memo(InlineCommentary);
