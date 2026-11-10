'use strict';

import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { StyleSheet, Text, View } from 'react-native';
import { useGlobalState } from '../Hooks';
import { loadText } from '../offlineOnline';
import Sefaria from '../sefaria';
import { refsForSource } from './inlineCommentaryPrefs';

// ref -> {he, en}; shared by every segment so scrolling back does not reload.
const _cache = new Map();
const CACHE_LIMIT = 1500;
const _inFlight = new Map();

const plain = html => (typeof html === 'string' ? Sefaria.util.stripHtml(html.replace(/<br\s*\/?>/gi, ' ')) : '');

const flatten = x => (Array.isArray(x) ? x.flat(Infinity).filter(s => typeof s === 'string').join(' ') : x);

const loadCommentText = ref => {
  if (_cache.has(ref)) { return Promise.resolve(_cache.get(ref)); }
  if (_inFlight.has(ref)) { return _inFlight.get(ref); }
  // failSilently: a missing commentary must not pop the "no internet" alert for every line
  const p = loadText(ref, false, null, true, true)
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

/**
 * The chosen commentary/targum for one segment, shown under it like a translation.
 * `links` is the segment's links (relatedBySectionRef[sectionRef][i].links); `sourceKey` the
 * chosen source (see reader/inlineCommentaryPrefs.js).
 */
const InlineCommentary = ({ links, sourceKey }) => {
  const { theme, textLanguage, fontSize } = useGlobalState();
  const refs = useMemo(() => refsForSource(links, sourceKey), [links, sourceKey]);
  const refsKey = refs.join('|');
  const [texts, setTexts] = useState(() => refs.map(r => _cache.get(r) || null));

  useEffect(() => {
    let alive = true;
    setTexts(refs.map(r => _cache.get(r) || null));
    refs.forEach((ref, i) => {
      if (_cache.has(ref)) { return; }
      loadCommentText(ref).then(t => {
        if (!alive) { return; }
        setTexts(prev => {
          const next = [...prev];
          next[i] = t;
          return next;
        });
      });
    });
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
    if (he) { parts.push(<Text key={`he${i}`} style={[localStyles.he, theme.tertiaryText, { fontSize: size * 1.1, lineHeight: size * 1.6 }]}>{he}</Text>); }
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
};

const localStyles = StyleSheet.create({
  box: { marginHorizontal: 32, marginBottom: 10, paddingTop: 4, borderTopWidth: 1 },
  he: { writingDirection: 'rtl', textAlign: 'right', fontFamily: 'Taamey Frank Taamim Fix' },
  en: { textAlign: 'left', marginTop: 2 },
});

export default React.memo(InlineCommentary);
