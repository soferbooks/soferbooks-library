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

// ref -> {he, en}; shared by every segment so scrolling back does not reload.
const _cache = new Map();
const CACHE_LIMIT = 1500;
const _inFlight = new Map();
// A section of e.g. Shulchan Arukh with Mishnah Berurah asks for hundreds of comment refs at once.
// Loading a few at a time lets the first load of a commentary section fill the offline cache
// before the rest ask for it (instead of hundreds of parallel reads of the same file), and keeps
// the JS thread free for the reader's own rendering.
const _limit = pLimit(3);

const plain = html => (typeof html === 'string' ? Sefaria.util.stripHtml(html.replace(/<br\s*\/?>/gi, ' ')) : '');

const flatten = x => (Array.isArray(x) ? x.flat(Infinity).filter(s => typeof s === 'string').join(' ') : x);

export const loadCommentText = (ref, load = loadText) => {
  if (_cache.has(ref)) { return Promise.resolve(_cache.get(ref)); }
  if (_inFlight.has(ref)) { return _inFlight.get(ref); }
  // failSilently: a missing commentary must not pop the "no internet" alert for every line
  const p = _limit(() => load(ref, false, null, true, true))
    .then(({ result }) => ({ he: plain(flatten(result?.he)), en: plain(flatten(result?.en)) }))
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
const InlineCommentary = ({ links, sourceKey, nakdan = false }) => {
  const { theme, textLanguage, fontSize } = useGlobalState();
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
  const size = Math.max(14, fontSize * 0.72);
  const parts = [];
  texts.forEach((t, i) => {
    if (!t) { return; }
    // fall back to whichever language exists, so a Hebrew-only commentary still shows in English mode
    const he = (showHe || !t.en) ? t.he : '';
    const en = (showEn || !t.he) ? t.en : '';
    const name = items[i] && items[i].he;
    if (name && (he || en)) {
      // (a connection: its name first, in the language shown)
      const heName = textLanguage !== 'english';
      parts.push(<Text key={`name${i}`} style={[heName ? localStyles.nameHe : localStyles.nameEn, theme.tertiaryText, { fontSize: size * 0.85 }]}>{heName ? name : items[i].ref}</Text>);
    }
    if (he) { parts.push(<NakdanText key={`he${i}`} text={he} on={!!nakdan} style={[localStyles.he, theme.tertiaryText, { fontSize: size * 1.1, lineHeight: size * 1.6 }]} />); }
    if (en) { parts.push(<Text key={`en${i}`} style={[localStyles.en, theme.tertiaryText, { fontSize: size, lineHeight: size * 1.45 }]}>{en}</Text>); }
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

const localStyles = StyleSheet.create({
  box: { marginHorizontal: 32, marginBottom: 10, paddingTop: 4, borderTopWidth: 1 },
  he: { writingDirection: 'rtl', textAlign: 'right', fontFamily: CSS_CLASS_STYLES.hebrew.fontFamily },
  // the reader's own English text font (serif, as in the main text), not the system sans
  en: { textAlign: 'left', marginTop: 2, fontFamily: CSS_CLASS_STYLES.english.fontFamily },
  nameHe: { writingDirection: 'rtl', textAlign: 'right', fontWeight: 'bold', marginTop: 4 },
  nameEn: { textAlign: 'left', fontWeight: 'bold', marginTop: 4 },
});

export default React.memo(InlineCommentary);
