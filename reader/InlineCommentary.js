'use strict';

import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Platform, StyleSheet, Text, View } from 'react-native';
import pLimit from 'p-limit';
import { useGlobalState } from '../Hooks';
import { loadText } from '../offlineOnline';
import Sefaria from '../sefaria';
import { CSS_CLASS_STYLES } from '../Misc';
import readerStyles from '../Styles';
import { itemsForSource } from './inlineCommentaryPrefs';
import { NakdanText } from './NakdanNotices';
import { useNakdan } from './nakdan';
import { commentaryFontSize } from '../StateManager';
import { boldDibbur, stripLeadingVerseMarker, plainWithBold, boldRuns, isCommentaryBook, isCommentaryCategory } from './dibbur';
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
      const cleanedHe = typeof heHtml === 'string' ? stripLeadingVerseMarker(heHtml) : '';
      const hasExplicitBold = /<(?:b|strong)\b[^>]*>[^<\s]/i.test(cleanedHe);
      const plainBold = plainWithBold(cleanedHe);
      const withDibbur = plainWithBold(cleanedHe ? boldDibbur(cleanedHe) : '');
      return {
        he: plain(cleanedHe || heHtml),
        en: plain(flatten(result?.en)),
        heText: withDibbur.text,
        heDibburBold: withDibbur.bold,
        hePlainText: plainBold.text,
        hePlainBold: plainBold.bold,
        hasExplicitBold,
      };
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
const plainShvaDagesh = s => (typeof s === 'string' ? s.replace(/\u05c8/g, '\u05b0').replace(/\u05c9/g, '\u05bc') : s);

/** The Hebrew of a comment as runs of bold and plain text: [{text, bold}] */
export const commentRuns = (t, he, dibbur) => {
  const displayHe = plainShvaDagesh(he);
  if (!displayHe) { return []; }
  if (!t || !dibbur || !t.heDibburBold) { return [{ text: displayHe, bold: false }]; }
  // (he: the text shown, with nikud Dicta added or not; its words are the stored text's)
  return boldRuns(displayHe, t.heDibburBold);
};

const BoldRunsText = ({ runs, style }) => (
  <Text selectable={Platform.OS !== 'android'} style={style}>
    {runs.map((r, i) => (r.bold ? <Text key={i} style={localStyles.bold}>{r.text}</Text> : r.text))}
  </Text>
);

const InlineCommentaryHe = ({ t, he, dibbur, nakdan, style }) => {
  const displayHe = plainShvaDagesh(he);
  // (bold only in a commentary's comment, as before for a targum or a connection's text)
  const flags = t && dibbur ? t.heDibburBold : null;
  if (!flags || !flags.some(Boolean)) {
    return <NakdanText text={displayHe} on={!!nakdan} style={style} />;
  }
  return <NakdanBoldText t={t} he={displayHe} dibbur={dibbur} nakdan={nakdan} style={style} />;
};

const NakdanBoldText = ({ t, he, dibbur, nakdan, style }) => {
  const vowelled = useNakdan(he, !!nakdan);
  return <BoldRunsText runs={commentRuns(t, vowelled || he, dibbur)} style={style} />;
};

const InlineCommentary = ({ links, sourceKey, nakdan = false, asText = false }) => {
  const { theme, textLanguage, fontSize: readerFontSize, commentaryFontScale, commentaryFont } = useGlobalState();
  // (the commentary's own text size: the Aa menu's "Commentary Size")
  const scale = commentaryFontSize(1, commentaryFontScale);
  const hebFont = commentaryFont || CSS_CLASS_STYLES.hebrew.fontFamily;
  const hebScale = hebFont === 'MekorotRashi' ? 1.03 : 1;
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
  // (asText: set as part of the text - its colour, no line above: the Chok's targum)
  const color = asText ? theme.text : theme.tertiaryText;
  const sourceUsesExplicitBold = texts.filter(t => t && t.hasExplicitBold).length >= 2;
  texts.forEach((t, i) => {
    if (!t) { return; }
    // fall back to whichever language exists, so a Hebrew-only commentary still shows in English mode
    // (the Hebrew as its words were counted for their bold: heText)
    const dibbur = !(items[i] && items[i].he) && !!items[i] && isCommentaryItem(items[i].ref, links);
    // (the edition's own bold kept where it has some - Onkelos in the Sifsei Chachomim Chumash bolds
    //  the words it adds to the verse's: owner, 2026-11-22; a commentary's comment as before)
    const ownBold = !dibbur && t.hasExplicitBold && t.hePlainText != null;
    const activeT = ((sourceUsesExplicitBold && !t.hasExplicitBold) || ownBold) && t.hePlainText != null
      ? { ...t, heText: t.hePlainText, heDibburBold: t.hePlainBold }
      : t;
    const he = (showHe || !t.en) ? (activeT.heText != null ? activeT.heText : activeT.he) : '';
    const en = (showEn || !t.he) ? t.en : '';
    const name = items[i] && items[i].he;
    if (name && (he || en)) {
      // (a connection: its name first, in the language shown)
      const heName = textLanguage !== 'english';
      parts.push(<Text key={`name${i}`} style={[heName ? localStyles.nameHe : localStyles.nameEn, color, { fontSize: size * 0.85 }]}>{heName ? name : items[i].ref}</Text>);
    }
    // (a commentary's comment: its dibbur hamaschil in bold, as SoferBooks prints it)
    if (he) { parts.push(<InlineCommentaryHe key={`he${i}`} t={activeT} he={he} dibbur={dibbur || ownBold} nakdan={nakdan} style={[localStyles.he, { fontFamily: hebFont }, color, { fontSize: size * 1.1 * hebScale, lineHeight: size * 1.6 }]} />); }
    // (LRM first: English Rashi opens with the Hebrew words it explains, and Android then laid the
    // whole paragraph out right to left - its closing period at the start of the line, ".daytime")
    if (en) { parts.push(<Text selectable={Platform.OS !== 'android'} key={`en${i}`} style={[localStyles.en, color, { fontSize: size, lineHeight: size * 1.45 }]}>{LRM + en}</Text>); }
  });
  if (!parts.length) { return null; }
  return (
    // (asText: within the verse's own margins - the number column either side - so it starts where
    //  the verse's line does: owner, 2026-11-22)
    <View style={asText ? [readerStyles.readerSideMargin, localStyles.textBox] : [localStyles.box, theme.lighterGreyBorder]}>
      {parts}
    </View>
  );
};
InlineCommentary.propTypes = {
  links:     PropTypes.array,
  sourceKey: PropTypes.string,
  nakdan:    PropTypes.bool,
  asText:    PropTypes.bool,
};

/** Is an item under the passage a commentary's comment? (its link's category, else its book) */
const isCommentaryItem = (ref, links) => {
  const link = (links || []).find(l => l && l.sourceRef === ref);
  return isCommentaryCategory(link && link.category) || isCommentaryBook(Sefaria.textTitleForRef(ref), commentaryTitles());
};

const localStyles = StyleSheet.create({
  bold: { fontWeight: 'bold' },
  box: { marginHorizontal: 32, marginBottom: 10, paddingTop: 4, borderTopWidth: 1 },
  textBox: { marginBottom: 10 },
  he: { writingDirection: 'rtl', textAlign: 'right', fontFamily: CSS_CLASS_STYLES.hebrew.fontFamily },
  // the reader's own English text font (serif, as in the main text), not the system sans
  en: { textAlign: 'left', marginTop: 2, fontFamily: CSS_CLASS_STYLES.english.fontFamily },
  nameHe: { writingDirection: 'rtl', textAlign: 'right', fontWeight: 'bold', marginTop: 4 },
  nameEn: { textAlign: 'left', fontWeight: 'bold', marginTop: 4 },
});

export default React.memo(InlineCommentary);
