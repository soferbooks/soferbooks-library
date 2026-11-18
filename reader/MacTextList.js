'use strict';

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import Clipboard from '@react-native-clipboard/clipboard';
import Sefaria from '../sefaria';
import strings from '../LocalizedStrings';
import { GlobalStateContext, commentaryFontSize } from '../StateManager';
import { CSS_CLASS_STYLES, openActionSheet, openLinkActionSheet } from '../Misc';
import { boldDibbur, stripLeadingVerseMarker, isCommentaryBook, isCommentaryCategory } from './dibbur';
import { commentaryTitles } from '../extras/links';
import { MAC_THEME_PALETTES, escapeHtml, loadFontFaceCSS, toJsLiteral } from './macWebFonts';

const fastHash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${str.length}:${(h >>> 0).toString(36)}`;
};

const isCommentaryEntry = (category, refStr) =>
  isCommentaryCategory(category) || isCommentaryBook(Sefaria.textTitleForRef(refStr), commentaryTitles());

/**
 * Build pure HTML item payloads for the Mac continuous commentary WebView.
 */
export function buildMacListItemsPayload({ dataSource, textLanguage, interfaceLanguage }) {
  const list = Array.isArray(dataSource) ? dataSource : [];
  const isMenuHeb = Sefaria.util.get_menu_language(interfaceLanguage, textLanguage) === 'hebrew';
  const items = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const loading = item.content == null;
    const noContent = !loading && item.content.he.length === 0 && item.content.en.length === 0;
    const lco = loading
      ? { en: strings.common.loading, he: '' }
      : (item.content.error
          ? { en: strings.errors.failed_to_load_text, he: '' }
          : (noContent ? { en: strings.errors.no_content, he: '' } : item.content));

    const lang = Sefaria.util.getTextLanguageWithContent(textLanguage, lco.en, lco.he);
    const isComm = isCommentaryEntry(item.category, item.ref);

    let heHtmlRaw = lco.he;
    if (!loading && isComm) {
      const cleaned = stripLeadingVerseMarker(lco.he);
      heHtmlRaw = item.noAutoDibbur ? cleaned : boldDibbur(cleaned);
    }
    const he = Sefaria.util.getDisplayableHTML(heHtmlRaw, 'hebrew');
    const en = Sefaria.util.getDisplayableHTML(lco.en, 'english');

    const titleText = isMenuHeb ? (item.heRef || item.ref) : item.ref;
    const citationHtml = item.displayRef
      ? ''
      : `<div class="item-citation ${isMenuHeb ? 'cit-he' : 'cit-en'}" data-open-item="1">${escapeHtml(titleText)}</div>`;

    const bilingualCls = lang === 'bilingual' ? ' bilingual' : '';
    const textParts = [];
    if ((lang === 'hebrew' || lang === 'bilingual') && he) {
      textParts.push(`<div class="he-wrap ${isComm ? 'is-comm' : 'is-main'}">${he}</div>`);
    }
    if ((lang === 'english' || lang === 'bilingual') && en) {
      textParts.push(`<div class="en-wrap">${en}</div>`);
    }

    const html = `${citationHtml}<div class="item-body${bilingualCls}">${textParts.join('')}</div>`;
    items.push({
      key: item.key || `${item.ref}|${i}`,
      pos: i,
      hash: fastHash(html),
      html,
    });
  }

  return {
    items,
    emptyText: strings.connections.no_connections_message,
  };
}

const MAC_LIST_SHELL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
<style id="sofer-fonts"></style>
<style>
  :root {
    --bg: #ffffff;
    --fg: #000000;
    --secondary: #999999;
    --tertiary: #666666;
    --border: #666666;
    --bi-en: #666666;
    --font-size: 16px;
    --he-font: 'FrankSofer';
    --he-scale: 1;
    --comm-font: 'FrankSofer';
    --comm-he-scale: 1;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    -webkit-font-smoothing: antialiased;
  }
  body {
    padding-bottom: 70vh;
    cursor: auto;
  }
  .empty-msg {
    text-align: center;
    padding: 40px 24px;
    color: var(--secondary);
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans', sans-serif;
    font-size: 16px;
  }
  .list-item {
    margin: 20px 60px 0 60px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border);
    cursor: text;
    -webkit-user-select: text;
    user-select: text;
  }
  .item-citation {
    font-size: 13px;
    color: var(--secondary);
    margin-bottom: 4px;
    cursor: pointer;
  }
  .cit-he {
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans Hebrew', sans-serif;
    direction: rtl;
    text-align: right;
  }
  .cit-en {
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans', sans-serif;
    direction: ltr;
    text-align: left;
  }
  .he-wrap {
    width: 100%;
    direction: rtl;
    text-align: right;
    unicode-bidi: isolate;
  }
  .is-main .hebrew {
    direction: rtl;
    text-align: right;
    unicode-bidi: isolate;
    font-family: var(--he-font), 'Times New Roman', serif;
    font-size: calc(var(--font-size) * var(--he-scale));
    line-height: 1.3;
    color: var(--fg);
  }
  .is-comm .hebrew {
    direction: rtl;
    text-align: right;
    unicode-bidi: isolate;
    font-family: var(--comm-font), 'Times New Roman', serif;
    font-size: calc(var(--font-size) * var(--comm-he-scale));
    line-height: 1.3;
    color: var(--fg);
  }
  .hebrew i, .hebrew em { font-style: normal; }
  .en-wrap {
    width: 100%;
    direction: ltr;
    text-align: left;
    unicode-bidi: isolate;
  }
  .english {
    direction: ltr;
    text-align: left;
    unicode-bidi: isolate;
    font-family: 'Amiri', Georgia, serif;
    font-size: calc(var(--font-size) * 0.8);
    line-height: 1.3;
    color: var(--fg);
  }
  .bilingual .english { color: var(--bi-en); padding-top: 4px; }
  small { font-size: 0.8em; }
  big { font-size: 1em; }
  sup, sub { font-size: 0.6em; }
</style>
</head>
<body>
  <div id="items"></div>
<script>
(function() {
  var post = function(obj) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  };
  var lastFontCss = '';

  window.__soferSetFonts = function(css) {
    if (css === lastFontCss) { return; }
    lastFontCss = css || '';
    var el = document.getElementById('sofer-fonts');
    if (el) { el.textContent = lastFontCss; }
  };

  window.__soferSetStyle = function(vars) {
    if (!vars) { return; }
    var root = document.documentElement.style;
    var keys = Object.keys(vars);
    for (var i = 0; i < keys.length; i++) {
      root.setProperty(keys[i], String(vars[keys[i]]));
    }
  };

  window.__soferSetItems = function(payload, resetScroll) {
    if (!payload) { return; }
    var container = document.getElementById('items');
    var incoming = payload.items || [];
    if (!incoming.length) {
      container.innerHTML = '';
      var empty = document.createElement('div');
      empty.className = 'empty-msg';
      empty.textContent = payload.emptyText || '';
      container.appendChild(empty);
      if (resetScroll) { window.scrollTo(0, 0); }
      return;
    }

    var emptyEls = container.querySelectorAll('.empty-msg');
    for (var e = 0; e < emptyEls.length; e++) { container.removeChild(emptyEls[e]); }

    var existingMap = {};
    for (var i = 0; i < container.children.length; i++) {
      var ch = container.children[i];
      var k = ch.getAttribute('data-item-key');
      if (k) { existingMap[k] = ch; }
    }

    for (var j = 0; j < incoming.length; j++) {
      var item = incoming[j];
      var node = existingMap[item.key];
      if (!node) {
        node = document.createElement('div');
        node.className = 'list-item';
        node.setAttribute('data-item-key', item.key);
        node.setAttribute('data-item-pos', String(item.pos));
        node.__soferHash = item.hash;
        node.innerHTML = item.html;
      } else {
        delete existingMap[item.key];
        node.setAttribute('data-item-pos', String(item.pos));
        if (node.__soferHash !== item.hash) {
          node.__soferHash = item.hash;
          node.innerHTML = item.html;
        }
      }
      var cur = container.children[j];
      if (cur !== node) { container.insertBefore(node, cur || null); }
    }

    var rem = Object.keys(existingMap);
    for (var r = 0; r < rem.length; r++) {
      container.removeChild(existingMap[rem[r]]);
    }

    if (resetScroll) { window.scrollTo(0, 0); }
    reportVisible();
  };

  var downX = 0, downY = 0, hadSel = false;
  document.addEventListener('mousedown', function(e) {
    downX = e.clientX;
    downY = e.clientY;
    var sel = window.getSelection();
    hadSel = !!(sel && !sel.isCollapsed && sel.toString().length > 0);
  }, true);

  document.addEventListener('click', function(e) {
    var itemEl = e.target.closest('[data-item-pos]');
    if (!itemEl) { return; }
    var pos = parseInt(itemEl.getAttribute('data-item-pos'), 10);
    if (e.target.closest('[data-open-item]')) {
      post({ type: 'itemPress', pos: pos });
      return;
    }
    var sel = window.getSelection();
    var hasSel = !!(sel && !sel.isCollapsed && sel.toString().length > 0);
    var moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 5;
    if (hasSel || hadSel || moved || e.detail > 1) { return; }
    post({ type: 'itemPress', pos: pos });
  });

  var reportVisible = function() {
    var vh = window.innerHeight || 0;
    var els = document.querySelectorAll('[data-item-pos]');
    var positions = [];
    for (var i = 0; i < els.length; i++) {
      var rect = els[i].getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= vh) {
        positions.push(parseInt(els[i].getAttribute('data-item-pos'), 10));
      } else if (rect.top > vh) {
        break;
      }
    }
    post({ type: 'visible', positions: positions });
  };

  var scrollTimer = null;
  window.addEventListener('scroll', function() {
    if (scrollTimer) { return; }
    scrollTimer = setTimeout(function() {
      scrollTimer = null;
      reportVisible();
    }, 180);
  }, { passive: true });

  document.addEventListener('DOMContentLoaded', function() { post({ type: 'ready' }); });
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    post({ type: 'ready' });
  }
})();
</script>
</body>
</html>`;

const MacTextList = ({
  dataSource,
  loadContent,
  openRef,
  openRefHere,
  openRefInNewTab,
  showInline,
  inlineCommentary,
  inlineKeyFor,
  fontSize: readerFontSize,
  themeStr,
  textLanguage,
  interfaceLanguage,
  onVisiblePositions,
}) => {
  const { commentaryFontScale, hebrewFont, commentaryFont } = useContext(GlobalStateContext);
  const webViewRef = useRef(null);
  const readyRef = useRef(false);
  const prevFirstKeyRef = useRef(null);
  const requestedPosRef = useRef(new Set());
  const [fontCss, setFontCss] = useState('');
  const [readySeq, setReadySeq] = useState(0);

  const fontSize = commentaryFontSize(readerFontSize, commentaryFontScale);
  const activeHebFont = hebrewFont || CSS_CLASS_STYLES.hebrew.fontFamily;
  const activeCommFont = commentaryFont || CSS_CLASS_STYLES.hebrew.fontFamily;

  useEffect(() => {
    let alive = true;
    loadFontFaceCSS([activeHebFont, activeCommFont, 'Amiri']).then(css => {
      if (alive && css) { setFontCss(css); }
    });
    return () => { alive = false; };
  }, [activeHebFont, activeCommFont]);

  const palette = MAC_THEME_PALETTES[themeStr] || MAC_THEME_PALETTES.white;
  const styleVars = useMemo(() => ({
    '--bg': palette.bg,
    '--fg': palette.text,
    '--secondary': palette.secondary,
    '--tertiary': palette.tertiary,
    '--border': palette.border,
    '--bi-en': palette.biEn,
    '--font-size': `${fontSize}px`,
    '--he-font': `'${activeHebFont}'`,
    '--he-scale': activeHebFont === 'MekorotRashi' ? 1.03 : 1,
    '--comm-font': `'${activeCommFont}'`,
    '--comm-he-scale': activeCommFont === 'MekorotRashi' ? 1.03 : 1,
  }), [palette, fontSize, activeHebFont, activeCommFont]);

  const payload = useMemo(() => buildMacListItemsPayload({
    dataSource,
    textLanguage,
    interfaceLanguage,
  }), [dataSource, textLanguage, interfaceLanguage]);

  const firstKey = dataSource?.[0]?.key || null;

  // Trigger initial loadContent for the first 15 unloaded items when list changes
  useEffect(() => {
    if (prevFirstKeyRef.current !== firstKey) {
      requestedPosRef.current.clear();
    }
    const list = Array.isArray(dataSource) ? dataSource : [];
    for (let i = 0; i < Math.min(list.length, 15); i++) {
      const item = list[i];
      if (item && item.content === null && !requestedPosRef.current.has(item.key)) {
        requestedPosRef.current.add(item.key);
        loadContent(item.ref, item.pos, item.versionTitle, item.versionLanguage);
      }
    }
  }, [dataSource, firstKey, loadContent]);

  const inject = useCallback((js) => {
    if (!readyRef.current || !webViewRef.current) { return; }
    webViewRef.current.injectJavaScript(`${js}; true;`);
  }, []);

  useEffect(() => {
    inject(`window.__soferSetFonts(${toJsLiteral(fontCss)});`);
  }, [fontCss, readySeq, inject]);

  useEffect(() => {
    inject(`window.__soferSetStyle(${toJsLiteral(styleVars)});`);
  }, [styleVars, readySeq, inject]);

  useEffect(() => {
    const resetScroll = prevFirstKeyRef.current !== null && prevFirstKeyRef.current !== firstKey;
    prevFirstKeyRef.current = firstKey;
    inject(`window.__soferSetItems(${toJsLiteral(payload)}, ${resetScroll ? 'true' : 'false'});`);
  }, [payload, firstKey, readySeq, inject]);

  const handleReady = useCallback(() => {
    readyRef.current = true;
    setReadySeq(v => v + 1);
  }, []);

  const handleMessage = useCallback((event) => {
    let msg;
    try {
      msg = JSON.parse(event?.nativeEvent?.data);
    } catch (e) {
      return;
    }
    if (!msg || !msg.type) { return; }
    if (msg.type === 'ready') {
      handleReady();
      return;
    }
    if (msg.type === 'visible' && Array.isArray(msg.positions)) {
      const list = Array.isArray(dataSource) ? dataSource : [];
      const maxPos = msg.positions.length ? Math.max(...msg.positions) : 0;
      const toCheck = [...new Set([...msg.positions, maxPos + 1, maxPos + 2, maxPos + 3, maxPos + 4, maxPos + 5])];
      for (const p of toCheck) {
        const item = list[p];
        if (item && item.content === null && !requestedPosRef.current.has(item.key)) {
          requestedPosRef.current.add(item.key);
          loadContent(item.ref, item.pos, item.versionTitle, item.versionLanguage);
        }
      }
      onVisiblePositions && onVisiblePositions(msg.positions);
      return;
    }
    if (msg.type === 'itemPress' && Number.isInteger(msg.pos)) {
      const item = dataSource?.[msg.pos];
      if (!item) { return; }
      const loading = item.content == null;
      const noContent = !loading && item.content.he.length === 0 && item.content.en.length === 0;
      const lco = loading
        ? { en: strings.common.loading, he: '' }
        : (item.content.error ? { en: strings.errors.failed_to_load_text, he: '' } : (noContent ? { en: strings.errors.no_content, he: '' } : item.content));
      const lang = Sefaria.util.getTextLanguageWithContent(textLanguage, lco.en, lco.he);
      const versions = item.versionLanguage ? { [item.versionLanguage]: item.versionTitle } : null;
      const asLink = !versions && !!openRefHere;
      const copyText = !loading ? () => {
        const hePlain = Sefaria.util.htmlToTextCanonical(typeof lco.he === 'string' ? lco.he : '') || '';
        const enPlain = Sefaria.util.htmlToTextCanonical(typeof lco.en === 'string' ? lco.en : '') || '';
        const parts = [];
        if ((lang === 'hebrew' || lang === 'bilingual') && hePlain) { parts.push(hePlain); }
        if ((lang === 'english' || lang === 'bilingual') && enPlain) { parts.push(enPlain); }
        Clipboard.setString(parts.join('\n'));
      } : null;

      if (asLink) {
        openLinkActionSheet({
          refStr: item.ref,
          heRefStr: item.heRef,
          interfaceLanguage,
          openHere: () => openRefHere(item.ref),
          openInNewTab: openRefInNewTab ? () => openRefInNewTab(item.ref) : null,
          showUnderneath: showInline ? () => showInline(item.ref) : null,
          shownUnderneath: !!showInline && !!inlineCommentary && !!inlineKeyFor && inlineKeyFor(item.ref) === inlineCommentary,
          copyText,
        });
      } else {
        openActionSheet(item.ref, versions, openRef, interfaceLanguage, item.heRef, item.category);
      }
    }
  }, [
    handleReady,
    dataSource,
    loadContent,
    onVisiblePositions,
    textLanguage,
    interfaceLanguage,
    openRef,
    openRefHere,
    openRefInNewTab,
    showInline,
    inlineCommentary,
    inlineKeyFor,
  ]);

  const source = useMemo(() => ({ html: MAC_LIST_SHELL_HTML }), []);

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={source}
        javaScriptEnabled={true}
        onLoadEnd={handleReady}
        onMessage={handleMessage}
        style={{ flex: 1, backgroundColor: 'transparent' }}
      />
    </View>
  );
};

MacTextList.propTypes = {
  dataSource:         PropTypes.array.isRequired,
  loadContent:        PropTypes.func.isRequired,
  openRef:            PropTypes.func.isRequired,
  openRefHere:        PropTypes.func,
  openRefInNewTab:    PropTypes.func,
  showInline:         PropTypes.func,
  inlineCommentary:   PropTypes.string,
  inlineKeyFor:       PropTypes.func,
  fontSize:           PropTypes.number.isRequired,
  themeStr:           PropTypes.string.isRequired,
  textLanguage:       PropTypes.string.isRequired,
  interfaceLanguage:  PropTypes.string.isRequired,
  onVisiblePositions: PropTypes.func,
};

export default MacTextList;
