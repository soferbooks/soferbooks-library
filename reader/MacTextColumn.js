'use strict';

import React, {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import Sefaria from '../sefaria';
import strings from '../LocalizedStrings';
import { GlobalStateContext, commentaryFontSize } from '../StateManager';
import { CSS_CLASS_STYLES } from '../Misc';
import ReaderAppContext from '../context';
import {
  isCommentaryBook,
  isCommentaryCategory,
  boldDibbur as withBoldDibbur,
  stripLeadingVerseMarker,
} from './dibbur';
import { commentaryTitles } from '../extras/links';
import { refHasSectionKeys } from '../extras/schema7';
import { editionNotesFor, editionNoteText, sectionsAreChapters } from './editionNotes';
import { itemsForSource } from './inlineCommentaryPrefs';
import { loadCommentTexts, commentRuns } from './InlineCommentary';
import { nakdan as defaultNakdanQueue, prepareNakdan, mergeNakdan } from './nakdan';
import { SCHEDULE_TITLE } from '../learningSchedules/chokDay';
import { ANCHOR_TOP_INSET } from './scrollAnchor';
import { VOCALIZATION } from '../VocalizationEnum';
import { MAC_THEME_PALETTES, escapeHtml, loadFontFaceCSS, toJsLiteral } from './macWebFonts';

const LRM = String.fromCharCode(0x200E);
const plainShvaDagesh = s => (typeof s === 'string' ? s.replace(/\u05c8/g, '\u05b0').replace(/\u05c9/g, '\u05bc') : s);

export const standardizeOffsetRef = (ref) => {
  if (ref && ref.indexOf(':') === -1) {
    const lastSpace = ref.lastIndexOf(' ');
    if (lastSpace !== -1) {
      return ref.substring(0, lastSpace) + ':' + ref.substring(lastSpace + 1);
    }
  }
  return ref;
};

const fastHash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${str.length}:${(h >>> 0).toString(36)}`;
};

const resolveNakdan = (html, enabled, queue = defaultNakdanQueue) => {
  if (!enabled || !html) { return null; }
  const item = prepareNakdan(html);
  if (!item) { return null; }
  const done = queue.cached(item.text);
  return done ? mergeNakdan(item, done) : null;
};

const isInlineCommentaryItem = (ref, links) => {
  const link = (links || []).find(l => l && l.sourceRef === ref);
  return isCommentaryCategory(link && link.category) || isCommentaryBook(Sefaria.textTitleForRef(ref), commentaryTitles());
};

const buildInlineCommentaryHtml = ({
  links,
  sourceKey,
  nakdanEnabled,
  nakdanQueue,
  inlineCache,
  textLanguage,
}) => {
  if (!sourceKey || !Array.isArray(links) || !links.length) { return ''; }
  const items = itemsForSource(links, sourceKey);
  if (!items.length) { return ''; }
  const texts = items.map(it => (inlineCache && inlineCache.get(it.ref)) || null);
  if (!texts.some(Boolean)) { return ''; }

  const showHe = textLanguage !== 'english';
  const showEn = textLanguage !== 'hebrew';
  const sourceUsesExplicitBold = texts.filter(t => t && t.hasExplicitBold).length >= 2;
  const parts = [];

  texts.forEach((t, i) => {
    if (!t) { return; }
    const item = items[i];
    const dibbur = !(item && item.he) && !!item && isInlineCommentaryItem(item.ref, links);
    const activeT = (sourceUsesExplicitBold && !t.hasExplicitBold && t.hePlainText != null)
      ? { ...t, heText: t.hePlainText, heDibburBold: t.hePlainBold }
      : t;
    const rawHe = (showHe || !t.en) ? (activeT.heText != null ? activeT.heText : activeT.he) : '';
    const en = (showEn || !t.he) ? t.en : '';
    const name = item && item.he;

    if (name && (rawHe || en)) {
      const heName = textLanguage !== 'english';
      parts.push(
        `<div class="inline-comm-name ${heName ? 'inline-rtl' : 'inline-ltr'}">${escapeHtml(heName ? name : item.ref)}</div>`
      );
    }
    if (rawHe) {
      const displayHe = plainShvaDagesh(rawHe);
      const flags = activeT && dibbur ? activeT.heDibburBold : null;
      const resolvedHe = resolveNakdan(displayHe, !!nakdanEnabled, nakdanQueue) || displayHe;
      if (!flags || !flags.some(Boolean)) {
        parts.push(`<div class="inline-comm-he">${escapeHtml(resolvedHe)}</div>`);
      } else {
        const runs = commentRuns(activeT, resolvedHe, dibbur);
        const runHtml = runs.map(r => (r.bold ? `<b>${escapeHtml(r.text)}</b>` : escapeHtml(r.text))).join('');
        parts.push(`<div class="inline-comm-he">${runHtml}</div>`);
      }
    }
    if (en) {
      parts.push(`<div class="inline-comm-en">${escapeHtml(LRM + en)}</div>`);
    }
  });

  if (!parts.length) { return ''; }
  return `<div class="inline-comm">${parts.join('')}</div>`;
};

const defaultInlineSectionHeader = (ref, textTitle) => {
  const safeRef = String(ref || '');
  const heTitle = Sefaria.index(textTitle)?.heTitle;
  const esc = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trimmer = new RegExp(`^(${esc(textTitle)}|${esc(heTitle)}),? `);
  return safeRef.replace(trimmer, '');
};

/**
 * Build pure HTML section payloads for the Mac continuous WebView reader.
 * Dictionary clickable-word wrapping is always disabled (`clickableWords = false`).
 */
export function buildMacSectionsPayload({
  data,
  sectionArray,
  sectionHeArray,
  relatedBySectionRef,
  textToc,
  textTitle,
  textLanguage,
  interfaceLanguage,
  textFlow,
  biLayout,
  vocalization,
  vowelToggleAvailable,
  nakdan = false,
  commentaryNakdan = false,
  nakdanQueue = defaultNakdanQueue,
  isCommentary = false,
  showAliyot = false,
  parashaDict = {},
  readingEditions = null,
  inlineCommentary = null,
  inlineCache = null,
  showSegmentNumbers = true,
  segmentRef = null,
  textListVisible = false,
  offsetRef = null,
  prev = null,
  next = null,
  loadingTextHead = false,
  loadingTextTail = false,
  scheduleEnd = null,
  inlineSectionHeader = null,
}) {
  const sections = [];
  const safeData = Array.isArray(data) ? data : [];
  const safeSecArr = Array.isArray(sectionArray) ? sectionArray : [];
  const safeSecHeArr = Array.isArray(sectionHeArray) ? sectionHeArray : [];
  const isContinuous = textFlow === 'continuous' && Sefaria.canBeContinuous(textTitle);
  const isMenuHeb = Sefaria.util.get_menu_language(interfaceLanguage, textLanguage) === 'hebrew';
  const isIntHeb = interfaceLanguage === 'hebrew';
  const chapters = sectionsAreChapters(textToc || Sefaria.index(textTitle));
  const trimHeader = ref => (inlineSectionHeader ? inlineSectionHeader(ref) : defaultInlineSectionHeader(ref, textTitle));

  for (let sectionIndex = 0; sectionIndex < safeData.length; sectionIndex++) {
    const segList = safeData[sectionIndex] || [];
    const sectionRef = safeSecArr[sectionIndex] || '';
    const sectionHeRef = safeSecHeArr[sectionIndex] || sectionRef;
    const keyed = !isMenuHeb && refHasSectionKeys(sectionRef) && !!sectionHeRef;
    const headerTitle = (isMenuHeb || keyed) ? trimHeader(sectionHeRef) : trimHeader(sectionRef);
    const headerCls = (isMenuHeb || keyed) ? 'sec-header-text sec-header-he' : 'sec-header-text';

    let headerHtml = `<div class="sec-header"><div class="sec-header-inner"><span class="${headerCls}">${escapeHtml(headerTitle)}</span></div></div>`;
    if (readingEditions) {
      const notes = editionNotesFor(sectionRef, readingEditions, textLanguage);
      if (notes.length) {
        headerHtml += `<div class="edition-note ${isIntHeb ? 'rtl-dir' : 'ltr-dir'}">${notes
          .map(n => `<div>${escapeHtml(editionNoteText(n, { hebrew: isIntHeb, chapters }))}</div>`)
          .join('')}</div>`;
      }
    }

    const sectionHasExplicitBold = isCommentary && segList.filter(s => s && typeof s.he === 'string' && /<(?:b|strong)\b/i.test(s.he)).length >= 2;
    const isEmpty = seg => !seg || (!seg.text && !seg.he);
    const keepFirst = segList.length > 0 && segList.every(isEmpty);
    const bodyParts = [];

    if (isContinuous) {
      const inlineSegs = [];
      for (let segmentIndex = 0; segmentIndex < segList.length; segmentIndex++) {
        const seg = segList[segmentIndex];
        if (!seg || (!seg.text && !seg.he)) { continue; }
        const segRef = `${sectionRef}:${seg.segmentNumber}`;
        const heRaw = (isCommentary ? withBoldDibbur(seg.he) : seg.he) || '';
        const enRaw = seg.text || '';
        const dictaHe = resolveNakdan(heRaw, !!nakdan, nakdanQueue);
        const heVocalized = Sefaria.util.applyVocalizationSettings(dictaHe || heRaw, vocalization, vowelToggleAvailable) || '';
        const heHtml = Sefaria.util.getDisplayableHTML(heVocalized, 'hebrew', false, false);
        const enHtml = Sefaria.util.getDisplayableHTML(enRaw, 'english', false, false);
        const segLang = Sefaria.util.getTextLanguageWithContent(textLanguage, enHtml, heHtml);
        const numLabel = showSegmentNumbers
          ? (segLang === 'hebrew' ? Sefaria.hebrew.encodeHebrewNumeral(seg.segmentNumber) : String(seg.segmentNumber))
          : '';
        const numHtml = numLabel
          ? `<span class="cont-seg-num" data-open-connections="1">${escapeHtml(numLabel)}</span>`
          : '';
        const textBits = [];
        if ((segLang === 'hebrew' || segLang === 'bilingual') && heHtml) { textBits.push(heHtml); }
        if ((segLang === 'english' || segLang === 'bilingual') && enHtml) { textBits.push(enHtml); }
        inlineSegs.push(
          `<span class="seg-inline${segLang === 'bilingual' ? ' bilingual' : ''}" data-seg-ref="${escapeHtml(segRef)}" data-sec-idx="${sectionIndex}" data-row-idx="${segmentIndex}">${numHtml}${textBits.join(' ')}</span>`
        );
      }
      const contDir = textLanguage === 'english' ? 'ltr-dir' : 'rtl-dir';
      bodyParts.push(`<div class="continuous-section ${contDir}">${inlineSegs.join(' ')}</div>`);
    } else {
      for (let segmentIndex = 0; segmentIndex < segList.length; segmentIndex++) {
        const seg = segList[segmentIndex];
        if ((segmentIndex !== 0 || !keepFirst) && isEmpty(seg)) { continue; }
        const segRef = `${sectionRef}:${seg.segmentNumber}`;
        const aliya = parashaDict[segRef];
        if (aliya && (aliya.type !== 2 || showAliyot)) {
          const isParasha = aliya.type === 3;
          const aliyaTitle = isMenuHeb ? aliya.data.he : aliya.data.en;
          bodyParts.push(
            `<div class="aliya-header${isParasha ? ' parasha' : ''}"><span class="${isMenuHeb ? 'he-int' : 'en-int'}">${escapeHtml(aliyaTitle)}</span></div>`
          );
        }

        const relatedObj = relatedBySectionRef?.[sectionRef]?.[segmentIndex];
        const numLinks = relatedObj?.links?.length || 0;
        let bulletOpacity = (numLinks - 20) / (70 - 20);
        if (numLinks === 0) { bulletOpacity = 0; }
        else if (bulletOpacity < 0.3) { bulletOpacity = 0.3; }
        else if (bulletOpacity > 0.8) { bulletOpacity = 0.8; }

        const dictaHe = resolveNakdan(seg.he, !!nakdan, nakdanQueue);
        let heProcessed = Sefaria.util.applyVocalizationSettings(dictaHe || seg.he, vocalization, vowelToggleAvailable) || '';
        if (isCommentary && !sectionHasExplicitBold) { heProcessed = withBoldDibbur(heProcessed); }
        // Dictionary word wrapping disabled on Mac (`clickableWords = false`) so mouse drag selects freely.
        const heHtml = Sefaria.util.getDisplayableHTML(heProcessed, 'hebrew', false, false);
        const enHtml = Sefaria.util.getDisplayableHTML(seg.text || '', 'english', false, false);
        const segLang = Sefaria.util.getTextLanguageWithContent(textLanguage, enHtml, heHtml);
        const showHe = segLang === 'hebrew' || segLang === 'bilingual';
        const showEn = segLang === 'english' || segLang === 'bilingual';

        const segNum = showSegmentNumbers
          ? (segLang === 'hebrew' ? Sefaria.hebrew.encodeHebrewNumeral(seg.segmentNumber) : String(seg.segmentNumber))
          : '';
        const holderDir = segLang === 'english' ? 'row-ltr' : 'row-rtl';
        const layoutCls = biLayout === 'sidebyside'
          ? 'bi-sidebyside'
          : biLayout === 'sidebysiderev'
            ? 'bi-sidebysiderev'
            : 'bi-stacked';
        const bilingualCls = segLang === 'bilingual' ? 'bilingual' : '';

        const heBlock = showHe ? `<div class="he-wrap">${heHtml}</div>` : '';
        const enBlock = showEn ? `<div class="en-wrap">${enHtml}</div>` : '';
        const inlineHtml = inlineCommentary
          ? buildInlineCommentaryHtml({
              links: relatedObj?.links,
              sourceKey: inlineCommentary,
              nakdanEnabled: commentaryNakdan,
              nakdanQueue,
              inlineCache,
              textLanguage,
            })
          : '';

        bodyParts.push(
          `<div class="seg-outer" data-seg-ref="${escapeHtml(segRef)}" data-sec-idx="${sectionIndex}" data-row-idx="${segmentIndex}">` +
            `<div class="seg-row ${holderDir}">` +
              `<div class="seg-num" data-open-connections="1">${escapeHtml(segNum)}</div>` +
              `<div class="seg-text-box ${layoutCls} ${bilingualCls}">${heBlock}${enBlock}</div>` +
              `<div class="seg-dot" data-open-connections="1" style="opacity:${bulletOpacity}">●</div>` +
            `</div>` +
            inlineHtml +
          `</div>`
        );
      }
    }

    const html = `${headerHtml}${bodyParts.join('')}`;
    sections.push({
      ref: sectionRef,
      heRef: sectionHeRef,
      sectionIndex,
      hash: fastHash(html),
      html,
    });
  }

  let scheduleHtml = '';
  if (!next && scheduleEnd) {
    const name = scheduleEnd.key === SCHEDULE_TITLE.en ? SCHEDULE_TITLE : (scheduleEnd.title || SCHEDULE_TITLE);
    const done = strings.formatString(strings.learning_schedules.day_done, { title: isIntHeb ? name.he : name.en });
    const doneText = Array.isArray(done) ? done.join('') : String(done);
    const label = scheduleEnd.tabLabel ? (isIntHeb ? scheduleEnd.tabLabel.he : scheduleEnd.tabLabel.en) : '';
    const day = label.split(' — ').slice(1).join(' — ');
    scheduleHtml = `<div class="schedule-end ${isIntHeb ? 'rtl-dir' : 'ltr-dir'}"><div class="schedule-mark">✓</div><div class="schedule-done">${escapeHtml(doneText)}</div>${day ? `<div class="schedule-day">${escapeHtml(day)}</div>` : ''}</div>`;
  }

  const activeRef = standardizeOffsetRef(offsetRef) || (textListVisible ? segmentRef : null) || null;
  const prevLabel = prev ? trimHeader(prev) : '';

  return {
    sections,
    activeRef,
    prev: prev || null,
    prevLabel,
    loadingTextHead: !!loadingTextHead,
    next: next || null,
    loadingTextTail: !!loadingTextTail,
    loadingLabel: strings.common.loading,
    scheduleHtml,
  };
}

const MAC_READER_SHELL_HTML = `<!DOCTYPE html>
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
    --quaternary: #bebebe;
    --border: #e6e5e6;
    --highlight: #f0f7ff;
    --bullet: #000000;
    --bi-en: #666666;
    --link: #1F3366;
    --font-size: 25px;
    --he-font: 'FrankSofer';
    --he-scale: 1;
    --comm-font: 'FrankSofer';
    --comm-font-size: 18px;
    --comm-he-scale: 1;
    --margin-w: 60px;
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
  #prev-slot {
    padding: 10px 30px 0 30px;
    text-align: center;
    -webkit-user-select: none;
    user-select: none;
  }
  .prev-btn {
    display: inline-block;
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--secondary);
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans', sans-serif;
    font-size: 13px;
    cursor: pointer;
    background: transparent;
  }
  .prev-btn:hover { color: var(--fg); border-color: var(--tertiary); }
  .loading-status {
    color: var(--secondary);
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans', sans-serif;
    font-size: 13px;
    padding: 14px;
    text-align: center;
    -webkit-user-select: none;
    user-select: none;
  }
  .sec-header {
    display: flex;
    justify-content: center;
    margin: 0 30px;
    -webkit-user-select: none;
    user-select: none;
  }
  .sec-header-inner {
    margin: 25px 0;
    padding: 5px;
    border-bottom: 4px solid var(--border);
  }
  .sec-header-text {
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans', sans-serif;
    font-size: 22px;
    color: var(--secondary);
    text-align: center;
  }
  .sec-header-he { font-size: 26px; }
  .edition-note {
    margin: -6px 30px 14px 30px;
    font-size: 14px;
    line-height: 20px;
    color: var(--tertiary);
    text-align: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans', sans-serif;
    -webkit-user-select: none;
    user-select: none;
  }
  .aliya-header {
    text-align: center;
    margin: 18px 30px 25px 30px;
    color: var(--quaternary);
    font-size: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans', sans-serif;
    -webkit-user-select: none;
    user-select: none;
  }
  .rtl-dir { direction: rtl; }
  .ltr-dir { direction: ltr; }
  .seg-outer {
    margin: 10px 0;
  }
  .seg-row {
    display: flex;
    align-items: flex-start;
  }
  .row-ltr { flex-direction: row; }
  .row-rtl { flex-direction: row-reverse; }
  .seg-num, .seg-dot {
    width: var(--margin-w);
    flex: 0 0 var(--margin-w);
    text-align: center;
    cursor: pointer;
    -webkit-user-select: none;
    user-select: none;
  }
  .seg-num {
    padding-top: 5px;
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans', sans-serif;
    font-size: calc(var(--font-size) * 0.44);
    color: var(--secondary);
  }
  .seg-dot {
    padding-top: 7px;
    font-size: 9px;
    color: var(--bullet);
  }
  .seg-text-box {
    flex: 1 1 0%;
    min-width: 0;
    display: flex;
    -webkit-user-select: text;
    user-select: text;
    cursor: text;
    border-radius: 4px;
  }
  .seg-text-box.bi-stacked { flex-direction: column; }
  .seg-text-box.bi-sidebyside { flex-direction: row; }
  .seg-text-box.bi-sidebysiderev { flex-direction: row-reverse; }
  .seg-highlighted .seg-text-box,
  .seg-inline.seg-highlighted {
    background-color: var(--highlight);
  }
  .he-wrap {
    width: 100%;
    direction: rtl;
    text-align: right;
    unicode-bidi: isolate;
  }
  .bi-sidebyside .he-wrap { flex: 4.5 1 0%; padding-right: 10px; }
  .bi-sidebysiderev .he-wrap { flex: 4.5 1 0%; padding-left: 10px; }
  .en-wrap {
    width: 100%;
    direction: ltr;
    text-align: left;
    unicode-bidi: isolate;
  }
  .bilingual.bi-stacked .en-wrap { padding-top: 5px; }
  .bi-sidebyside .en-wrap { flex: 5.5 1 0%; padding-left: 10px; }
  .bi-sidebysiderev .en-wrap { flex: 5.5 1 0%; padding-right: 10px; }
  .hebrew {
    direction: rtl;
    text-align: right;
    unicode-bidi: isolate;
    font-family: var(--he-font), 'Times New Roman', serif;
    font-size: calc(var(--font-size) * var(--he-scale));
    line-height: 1.3;
    color: var(--fg);
  }
  .hebrew i, .hebrew em { font-style: normal; }
  .english {
    direction: ltr;
    text-align: left;
    unicode-bidi: isolate;
    font-family: 'Amiri', Georgia, serif;
    font-size: calc(var(--font-size) * 0.8);
    line-height: 1.3;
    color: var(--fg);
  }
  .bilingual .english { color: var(--bi-en); }
  small { font-size: 0.8em; }
  big { font-size: 1em; }
  sup, sub { font-size: 0.6em; }
  .info-text { font-family: 'MiriamLibre-Regular', sans-serif; font-size: 0.9em; }
  a { color: var(--link); text-decoration: underline; cursor: pointer; }
  .continuous-section {
    padding: 10px 30px;
    line-height: 1.5;
    -webkit-user-select: text;
    user-select: text;
    cursor: text;
  }
  .continuous-section .hebrew,
  .continuous-section .english { display: inline; }
  .cont-seg-num {
    font-family: -apple-system, BlinkMacSystemFont, 'Open Sans', sans-serif;
    font-size: 11px;
    color: var(--secondary);
    margin: 0 4px;
    cursor: pointer;
    -webkit-user-select: none;
    user-select: none;
  }
  .inline-comm {
    margin: 4px 32px 10px 32px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
    -webkit-user-select: text;
    user-select: text;
    cursor: text;
  }
  .inline-comm-name {
    font-weight: bold;
    color: var(--tertiary);
    font-size: calc(var(--comm-font-size) * 0.85);
    margin-top: 4px;
  }
  .inline-rtl { direction: rtl; text-align: right; }
  .inline-ltr { direction: ltr; text-align: left; }
  .inline-comm-he {
    direction: rtl;
    text-align: right;
    color: var(--tertiary);
    font-family: var(--comm-font), 'Times New Roman', serif;
    font-size: calc(var(--comm-font-size) * 1.1 * var(--comm-he-scale));
    line-height: 1.45;
  }
  .inline-comm-en {
    direction: ltr;
    text-align: left;
    color: var(--tertiary);
    font-family: 'Amiri', Georgia, serif;
    font-size: var(--comm-font-size);
    line-height: 1.45;
    margin-top: 2px;
  }
  .schedule-end {
    text-align: center;
    margin: 24px 24px 80px 24px;
    padding: 20px 0;
    border-top: 1px solid var(--border);
    -webkit-user-select: none;
    user-select: none;
  }
  .schedule-mark { font-size: 28px; color: var(--tertiary); }
  .schedule-done { font-size: 18px; font-weight: bold; margin-top: 6px; color: var(--fg); }
  .schedule-day { font-size: 14px; margin-top: 4px; color: var(--tertiary); }
</style>
</head>
<body>
  <div id="prev-slot"></div>
  <div id="sections"></div>
  <div id="footer-slot"></div>
<script>
(function() {
  var post = function(obj) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  };
  var activeRef = null;
  var lastFontCss = '';

  window.__soferSetFonts = function(css) {
    if (css === lastFontCss) { return; }
    lastFontCss = css || '';
    var el = document.getElementById('sofer-fonts');
    if (el) { el.textContent = lastFontCss; }
  };

  window.__soferSetStyle = function(vars, scrollTo) {
    if (!vars) { return; }
    var root = document.documentElement.style;
    var keys = Object.keys(vars);
    for (var i = 0; i < keys.length; i++) {
      root.setProperty(keys[i], String(vars[keys[i]]));
    }
    if (scrollTo && scrollTo.ref) {
      window.__soferScrollTo(scrollTo.ref, scrollTo.inset);
    }
  };

  window.__soferSetHighlight = function(nextRef) {
    activeRef = nextRef || null;
    var highlighted = document.querySelectorAll('.seg-highlighted');
    for (var i = 0; i < highlighted.length; i++) {
      highlighted[i].classList.remove('seg-highlighted');
    }
    if (!activeRef) { return; }
    var targets = document.querySelectorAll('[data-seg-ref]');
    for (var j = 0; j < targets.length; j++) {
      if (targets[j].getAttribute('data-seg-ref') === activeRef) {
        targets[j].classList.add('seg-highlighted');
        break;
      }
    }
  };

  window.__soferScrollTo = function(ref, inset) {
    if (!ref) { return false; }
    var el = null;
    var segs = document.querySelectorAll('[data-seg-ref]');
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].getAttribute('data-seg-ref') === ref) { el = segs[i]; break; }
    }
    if (!el) {
      var secs = document.querySelectorAll('[data-sec-ref]');
      for (var j = 0; j < secs.length; j++) {
        if (secs[j].getAttribute('data-sec-ref') === ref) { el = secs[j]; break; }
      }
    }
    if (!el) { return false; }
    var y = Math.max(0, el.getBoundingClientRect().top + window.scrollY - (typeof inset === 'number' ? inset : 100));
    window.scrollTo(0, y);
    return true;
  };

  var makeSectionEl = function(sec) {
    var el = document.createElement('section');
    el.setAttribute('data-sec-ref', sec.ref);
    el.setAttribute('data-sec-idx', String(sec.sectionIndex));
    el.setAttribute('data-sec-he-ref', sec.heRef || sec.ref);
    el.__soferHash = sec.hash;
    el.innerHTML = sec.html;
    return el;
  };

  window.__soferSetSections = function(payload) {
    if (!payload) { return; }
    var prevSlot = document.getElementById('prev-slot');
    if (payload.loadingTextHead) {
      prevSlot.innerHTML = '<div class="loading-status">' + (payload.loadingLabel || 'Loading...') + '</div>';
    } else if (payload.prev) {
      var btn = document.createElement('button');
      btn.id = 'prev-btn';
      btn.className = 'prev-btn';
      btn.type = 'button';
      btn.textContent = '▲ ' + (payload.prevLabel || payload.prev);
      prevSlot.innerHTML = '';
      prevSlot.appendChild(btn);
    } else {
      prevSlot.innerHTML = '';
    }

    var footerSlot = document.getElementById('footer-slot');
    if (payload.next) {
      footerSlot.innerHTML = '<div class="loading-status">' + (payload.loadingLabel || 'Loading...') + '</div>';
    } else {
      footerSlot.innerHTML = payload.scheduleHtml || '';
    }

    var container = document.getElementById('sections');
    var incoming = payload.sections || [];
    var existingMap = {};
    var oldFirstRef = container.firstElementChild ? container.firstElementChild.getAttribute('data-sec-ref') : null;
    for (var i = 0; i < container.children.length; i++) {
      var ch = container.children[i];
      existingMap[ch.getAttribute('data-sec-ref')] = ch;
    }

    var prepended = oldFirstRef && incoming.length > 0 && incoming[0].ref !== oldFirstRef;
    var oldHeight = container.scrollHeight;
    var oldFirstEl = existingMap[oldFirstRef];
    var oldFirstTop = oldFirstEl ? oldFirstEl.getBoundingClientRect().top : 0;

    for (var k = 0; k < incoming.length; k++) {
      var sec = incoming[k];
      var node = existingMap[sec.ref];
      if (!node) {
        node = makeSectionEl(sec);
      } else {
        delete existingMap[sec.ref];
        node.setAttribute('data-sec-idx', String(sec.sectionIndex));
        if (node.__soferHash !== sec.hash) {
          node.__soferHash = sec.hash;
          node.innerHTML = sec.html;
        }
        var segsInNode = node.querySelectorAll('[data-seg-ref]');
        for (var s = 0; s < segsInNode.length; s++) {
          segsInNode[s].setAttribute('data-sec-idx', String(sec.sectionIndex));
        }
      }
      var currentAtK = container.children[k];
      if (currentAtK !== node) {
        container.insertBefore(node, currentAtK || null);
      }
    }

    var remainingKeys = Object.keys(existingMap);
    for (var r = 0; r < remainingKeys.length; r++) {
      container.removeChild(existingMap[remainingKeys[r]]);
    }

    if (prepended && oldFirstEl && oldFirstEl.parentNode === container) {
      var newFirstTop = oldFirstEl.getBoundingClientRect().top;
      if (Math.abs(newFirstTop - oldFirstTop) > 1) {
        window.scrollBy(0, newFirstTop - oldFirstTop);
      } else {
        var newHeight = container.scrollHeight;
        if (newHeight > oldHeight) { window.scrollBy(0, newHeight - oldHeight); }
      }
    }

    if (payload.scrollTo && payload.scrollTo.ref) {
      window.__soferScrollTo(payload.scrollTo.ref, payload.scrollTo.inset);
    }
    window.__soferSetHighlight(payload.activeRef);

    // If short content doesn't overflow viewport, notify RN so next section preloads
    var nearBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - Math.max(400, window.innerHeight * 1.5));
    if (nearBottom && payload.next && !payload.loadingTextTail) {
      post({ type: 'loadNext' });
    }
  };

  var downX = 0, downY = 0, hadSel = false;
  document.addEventListener('mousedown', function(e) {
    downX = e.clientX;
    downY = e.clientY;
    var sel = window.getSelection();
    hadSel = !!(sel && !sel.isCollapsed && sel.toString().length > 0);
  }, true);

  document.addEventListener('click', function(e) {
    var prevBtn = e.target.closest('#prev-btn');
    if (prevBtn) {
      post({ type: 'loadPrev' });
      return;
    }
    var segEl = e.target.closest('[data-seg-ref]');
    if (!segEl) { return; }
    var secIdx = parseInt(segEl.getAttribute('data-sec-idx'), 10);
    var rowIdx = parseInt(segEl.getAttribute('data-row-idx'), 10);
    var segRef = segEl.getAttribute('data-seg-ref');

    if (e.target.closest('[data-open-connections]')) {
      post({ type: 'segmentPress', sectionIndex: secIdx, rowIndex: rowIdx, segmentRef: segRef });
      return;
    }

    var linkEl = e.target.closest('a[href]');
    var sel = window.getSelection();
    var hasSel = !!(sel && !sel.isCollapsed && sel.toString().length > 0);
    var moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 5;
    if (hasSel || hadSel || moved || e.detail > 1) {
      if (linkEl) { e.preventDefault(); }
      return;
    }
    if (linkEl) {
      e.preventDefault();
      post({ type: 'link', href: linkEl.getAttribute('href'), newTab: !!(e.metaKey || e.ctrlKey) });
      return;
    }
    post({ type: 'segmentPress', sectionIndex: secIdx, rowIndex: rowIdx, segmentRef: segRef });
  });

  var reportScroll = function() {
    var vh = window.innerHeight || 0;
    var segs = document.querySelectorAll('[data-seg-ref]');
    var firstInView = null;
    var containing = null;
    for (var i = 0; i < segs.length; i++) {
      var rect = segs[i].getBoundingClientRect();
      if (rect.top <= 0 && rect.bottom > 0) { containing = { el: segs[i], top: rect.top }; }
      if (!firstInView && rect.top >= -3 && rect.top < vh - 20) {
        firstInView = { el: segs[i], top: rect.top };
      }
      if (rect.top > vh) { break; }
    }
    var limit = Math.max(120, vh / 3);
    var picked = (firstInView && (!containing || firstInView.top <= limit)) ? firstInView : containing;
    var topSeg = null;
    if (picked) {
      topSeg = {
        ref: picked.el.getAttribute('data-seg-ref'),
        sectionIndex: parseInt(picked.el.getAttribute('data-sec-idx'), 10),
        rowIndex: parseInt(picked.el.getAttribute('data-row-idx'), 10),
        inset: picked.top,
      };
    }

    var secs = document.querySelectorAll('#sections > section');
    var visibleSec = null;
    var bestVisible = 0;
    for (var j = 0; j < secs.length; j++) {
      var sRect = secs[j].getBoundingClientRect();
      var overlap = Math.min(vh, sRect.bottom) - Math.max(0, sRect.top);
      if (overlap > bestVisible) {
        bestVisible = overlap;
        visibleSec = {
          sectionIndex: parseInt(secs[j].getAttribute('data-sec-idx'), 10),
          ref: secs[j].getAttribute('data-sec-ref'),
          heRef: secs[j].getAttribute('data-sec-he-ref'),
        };
      }
    }

    var sel = window.getSelection();
    var hasSelection = !!(sel && !sel.isCollapsed && sel.toString().length > 0);
    var nearBottom = (vh + window.scrollY) >= (document.documentElement.scrollHeight - Math.max(400, vh * 1.5));
    post({ type: 'scroll', topSeg: topSeg, visibleSection: visibleSec, nearBottom: nearBottom, hasSelection: hasSelection });
  };

  var scrollTimer = null;
  window.addEventListener('scroll', function() {
    if (scrollTimer) { return; }
    scrollTimer = setTimeout(function() {
      scrollTimer = null;
      reportScroll();
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

const MacTextColumn = React.forwardRef((props, ref) => {
  const {
    fontSize,
    themeStr,
    data,
    relatedBySectionRef,
    sectionArray,
    sectionHeArray,
    offsetRef,
    offsetPlace,
    segmentRef,
    textTitle,
    textReference,
    textFlow,
    textLanguage,
    interfaceLanguage,
    textListVisible,
    next,
    prev,
    loadingTextTail,
    loadingTextHead,
    showAliyot,
    biLayout,
    vowelToggleAvailable,
    inlineCommentary,
    nakdan,
    readingEditions,
    textToc,
    scheduleEnd,
    isCommentary,
    parashaDict,
    inlineSectionHeader,
    updateData,
    updateTitle,
    textSegmentPressed,
    handleOpenURL,
    textUnavailableAlert,
  } = props;

  const { vocalization, hebrewFont, commentaryFont, commentaryFontScale } = useContext(GlobalStateContext);
  const { openURLInNewTab } = useContext(ReaderAppContext) || {};
  const webViewRef = useRef(null);
  const readyRef = useRef(false);
  const latestScrollPlaceRef = useRef(null);
  const initialJumpDoneRef = useRef(false);
  const lastNextRequestedRef = useRef(null);
  const inlineCacheRef = useRef(new Map());
  const prevLayoutKeyRef = useRef(null);
  const [fontCss, setFontCss] = useState('');
  const [nakdanRev, setNakdanRev] = useState(0);
  const [inlineRev, setInlineRev] = useState(0);

  useImperativeHandle(ref, () => ({
    getScrollPlace: () => latestScrollPlaceRef.current,
  }), []);

  const activeHebFont = hebrewFont || CSS_CLASS_STYLES.hebrew.fontFamily;
  const activeCommFont = commentaryFont || CSS_CLASS_STYLES.hebrew.fontFamily;

  useEffect(() => {
    let alive = true;
    const needed = [activeHebFont, activeCommFont, 'Amiri', 'MiriamLibre-Regular'];
    loadFontFaceCSS(needed).then(css => {
      if (alive && css) { setFontCss(css); }
    });
    return () => { alive = false; };
  }, [activeHebFont, activeCommFont]);

  // Queue Dicta Nakdan for any uncached Hebrew passages when `nakdan` is toggled on
  useEffect(() => {
    if (!nakdan || !Array.isArray(data)) { return undefined; }
    let alive = true;
    const unsubs = [];
    for (let s = 0; s < data.length; s++) {
      const segs = data[s] || [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (!seg || !seg.he) { continue; }
        const item = prepareNakdan(seg.he);
        if (!item) { continue; }
        if (defaultNakdanQueue.cached(item.text) === undefined) {
          unsubs.push(defaultNakdanQueue.want(item.text, () => {
            if (alive) { setNakdanRev(v => v + 1); }
          }));
        }
      }
    }
    return () => {
      alive = false;
      unsubs.forEach(fn => fn && fn());
    };
  }, [data, nakdan]);

  // Load inline commentaries asynchronously into cache for Mac WebView
  useEffect(() => {
    if (!inlineCommentary || !Array.isArray(data) || !Array.isArray(sectionArray)) { return undefined; }
    let alive = true;
    const missingRefs = [];
    for (let s = 0; s < sectionArray.length; s++) {
      const secLinksBySeg = relatedBySectionRef?.[sectionArray[s]];
      if (!secLinksBySeg) { continue; }
      const segKeys = Object.keys(secLinksBySeg);
      for (let k = 0; k < segKeys.length; k++) {
        const links = secLinksBySeg[segKeys[k]]?.links;
        for (const item of itemsForSource(links, inlineCommentary)) {
          if (item?.ref && !inlineCacheRef.current.has(item.ref)) {
            missingRefs.push(item.ref);
          }
        }
      }
    }
    if (!missingRefs.length) { return undefined; }
    const uniqueMissing = [...new Set(missingRefs)];
    loadCommentTexts(uniqueMissing).then(loaded => {
      if (!alive) { return; }
      uniqueMissing.forEach((r, idx) => {
        if (loaded[idx]) { inlineCacheRef.current.set(r, loaded[idx]); }
      });
      setInlineRev(v => v + 1);
    });
    return () => { alive = false; };
  }, [inlineCommentary, data, sectionArray, relatedBySectionRef]);

  const palette = MAC_THEME_PALETTES[themeStr] || MAC_THEME_PALETTES.white;
  const heScale = activeHebFont === 'MekorotRashi' ? 1.03 : 1;
  const commHeScale = activeCommFont === 'MekorotRashi' ? 1.03 : 1;
  const commFontPx = Math.max(14, fontSize * 0.72) * commentaryFontSize(1, commentaryFontScale);

  const styleVars = useMemo(() => ({
    '--bg': palette.bg,
    '--fg': palette.text,
    '--secondary': palette.secondary,
    '--tertiary': palette.tertiary,
    '--quaternary': palette.quaternary,
    '--border': palette.border,
    '--highlight': palette.highlight,
    '--bullet': palette.bullet,
    '--bi-en': palette.biEn,
    '--link': palette.link,
    '--font-size': `${fontSize}px`,
    '--he-font': `'${activeHebFont}'`,
    '--he-scale': heScale,
    '--comm-font': `'${activeCommFont}'`,
    '--comm-font-size': `${commFontPx}px`,
    '--comm-he-scale': commHeScale,
  }), [palette, fontSize, activeHebFont, heScale, activeCommFont, commFontPx, commHeScale]);

  const payload = useMemo(() => buildMacSectionsPayload({
    data,
    sectionArray,
    sectionHeArray,
    relatedBySectionRef,
    textToc,
    textTitle,
    textLanguage,
    interfaceLanguage,
    textFlow,
    biLayout,
    vocalization,
    vowelToggleAvailable,
    nakdan,
    nakdanQueue: defaultNakdanQueue,
    isCommentary,
    showAliyot,
    parashaDict,
    readingEditions,
    inlineCommentary,
    inlineCache: inlineCacheRef.current,
    showSegmentNumbers: Sefaria.showSegmentNumbers(textTitle),
    segmentRef,
    textListVisible,
    offsetRef,
    prev,
    next,
    loadingTextHead,
    loadingTextTail,
    scheduleEnd,
    inlineSectionHeader,
  }), [
    data,
    sectionArray,
    sectionHeArray,
    relatedBySectionRef,
    textToc,
    textTitle,
    textLanguage,
    interfaceLanguage,
    textFlow,
    biLayout,
    vocalization,
    vowelToggleAvailable,
    nakdan,
    nakdanRev,
    isCommentary,
    showAliyot,
    parashaDict,
    readingEditions,
    inlineCommentary,
    inlineRev,
    segmentRef,
    textListVisible,
    offsetRef,
    prev,
    next,
    loadingTextHead,
    loadingTextTail,
    scheduleEnd,
    inlineSectionHeader,
  ]);

  const [readySeq, setReadySeq] = useState(0);
  const prevFontSizeRef = useRef(null);
  const latestStateRef = useRef(null);
  const inject = useCallback((js) => {
    if (!readyRef.current || !webViewRef.current) { return; }
    webViewRef.current.injectJavaScript(`${js}; true;`);
  }, []);

  latestStateRef.current = {
    fontCss,
    styleVars,
    payload,
    offsetRef,
    offsetPlace,
    layoutKey: `${textLanguage}|${inlineCommentary}|${!!nakdan}|${fontSize}|${biLayout}`,
  };

  const pushFullState = useCallback(() => {
    if (!readyRef.current || !latestStateRef.current) { return; }
    const cur = latestStateRef.current;
    let scrollTo = null;
    const prevLayoutKey = prevLayoutKeyRef.current;
    prevLayoutKeyRef.current = cur.layoutKey;

    if (!initialJumpDoneRef.current && cur.offsetRef && cur.payload.sections.length > 0) {
      initialJumpDoneRef.current = true;
      const targetRef = standardizeOffsetRef(cur.offsetRef);
      const inset = cur.offsetPlace && cur.offsetPlace.ref === targetRef && typeof cur.offsetPlace.inset === 'number'
        ? cur.offsetPlace.inset
        : ANCHOR_TOP_INSET;
      scrollTo = { ref: targetRef, inset };
    } else if (prevLayoutKey && prevLayoutKey !== cur.layoutKey && latestScrollPlaceRef.current) {
      scrollTo = latestScrollPlaceRef.current;
    }

    const fullPayload = scrollTo ? { ...cur.payload, scrollTo } : cur.payload;
    inject(
      `window.__soferSetFonts(${toJsLiteral(cur.fontCss)});` +
      `window.__soferSetStyle(${toJsLiteral(cur.styleVars)});` +
      `window.__soferSetSections(${toJsLiteral(fullPayload)});`
    );
  }, [inject]);

  // Fast-path highlight update without re-running section patching when only activeRef changes
  useEffect(() => {
    inject(`window.__soferSetHighlight(${toJsLiteral(payload.activeRef)});`);
  }, [payload.activeRef, inject]);

  useEffect(() => {
    inject(`window.__soferSetFonts(${toJsLiteral(fontCss)});`);
  }, [fontCss, inject]);

  useEffect(() => {
    const anchor = prevFontSizeRef.current !== null && prevFontSizeRef.current !== fontSize
      ? latestScrollPlaceRef.current
      : null;
    prevFontSizeRef.current = fontSize;
    inject(`window.__soferSetStyle(${toJsLiteral(styleVars)}, ${toJsLiteral(anchor)});`);
  }, [styleVars, fontSize, inject]);

  useEffect(() => {
    pushFullState();
  }, [
    readySeq,
    payload.sections,
    payload.prev,
    payload.prevLabel,
    payload.next,
    payload.loadingTextHead,
    payload.loadingTextTail,
    payload.scheduleHtml,
    pushFullState,
  ]);

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
    if (msg.type === 'segmentPress') {
      if (msg.segmentRef && Number.isInteger(msg.sectionIndex) && Number.isInteger(msg.rowIndex)) {
        textSegmentPressed(msg.sectionIndex, msg.rowIndex, msg.segmentRef, true);
      }
      return;
    }
    if (msg.type === 'link' && msg.href) {
      if (msg.newTab && openURLInNewTab) { openURLInNewTab(msg.href); }
      else if (handleOpenURL) { handleOpenURL(msg.href); }
      return;
    }
    if (msg.type === 'loadPrev') {
      if (prev && !loadingTextHead) { updateData('prev'); }
      return;
    }
    if (msg.type === 'loadNext') {
      if (next && !loadingTextTail && lastNextRequestedRef.current !== next) {
        lastNextRequestedRef.current = next;
        updateData('next');
      }
      return;
    }
    if (msg.type === 'scroll') {
      if (msg.topSeg && msg.topSeg.ref) {
        latestScrollPlaceRef.current = { ref: msg.topSeg.ref, inset: msg.topSeg.inset };
      }
      if (msg.visibleSection && msg.visibleSection.ref && msg.visibleSection.ref !== textReference) {
        updateTitle(msg.visibleSection.ref, msg.visibleSection.heRef || msg.visibleSection.ref, msg.visibleSection.sectionIndex);
      }
      if (msg.nearBottom && next && !loadingTextTail && lastNextRequestedRef.current !== next) {
        lastNextRequestedRef.current = next;
        updateData('next');
      }
      if (!msg.hasSelection && msg.topSeg && msg.topSeg.ref && msg.topSeg.ref !== segmentRef) {
        textSegmentPressed(msg.topSeg.sectionIndex, msg.topSeg.rowIndex, msg.topSeg.ref, false);
      }
    }
  }, [
    handleReady,
    textSegmentPressed,
    openURLInNewTab,
    handleOpenURL,
    prev,
    next,
    loadingTextHead,
    loadingTextTail,
    updateData,
    updateTitle,
    textReference,
    segmentRef,
  ]);

  // Reset next-request guard when a new `next` pointer arrives
  useEffect(() => {
    if (lastNextRequestedRef.current && lastNextRequestedRef.current !== next) {
      lastNextRequestedRef.current = null;
    }
  }, [next]);

  const source = useMemo(() => ({ html: MAC_READER_SHELL_HTML }), []);

  const handleShouldStart = useCallback((req) => {
    if (!req?.url || req.url.startsWith('about:')) { return true; }
    handleOpenURL && handleOpenURL(req.url);
    return false;
  }, [handleOpenURL]);

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={source}
        javaScriptEnabled={true}
        onLoadEnd={handleReady}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={handleShouldStart}
        onError={() => { textUnavailableAlert && textUnavailableAlert(textTitle); }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
      />
    </View>
  );
});

MacTextColumn.propTypes = {
  fontSize:             PropTypes.number.isRequired,
  themeStr:             PropTypes.string,
  data:                 PropTypes.array,
  relatedBySectionRef:  PropTypes.object,
  sectionArray:         PropTypes.array,
  sectionHeArray:       PropTypes.array,
  offsetRef:            PropTypes.string,
  offsetPlace:          PropTypes.object,
  segmentRef:           PropTypes.string,
  textTitle:            PropTypes.string,
  textReference:        PropTypes.string,
  textFlow:             PropTypes.string,
  textLanguage:         PropTypes.string,
  interfaceLanguage:    PropTypes.string,
  textListVisible:      PropTypes.bool,
  next:                 PropTypes.string,
  prev:                 PropTypes.string,
  loadingTextTail:      PropTypes.bool,
  loadingTextHead:      PropTypes.bool,
  showAliyot:           PropTypes.bool,
  biLayout:             PropTypes.string,
  vowelToggleAvailable: PropTypes.number,
  inlineCommentary:     PropTypes.string,
  nakdan:               PropTypes.bool,
  readingEditions:      PropTypes.object,
  textToc:              PropTypes.object,
  scheduleEnd:          PropTypes.object,
  isCommentary:         PropTypes.bool,
  parashaDict:          PropTypes.object,
  inlineSectionHeader:  PropTypes.func,
  updateData:           PropTypes.func,
  updateTitle:          PropTypes.func,
  textSegmentPressed:   PropTypes.func,
  handleOpenURL:        PropTypes.func,
  textUnavailableAlert: PropTypes.func,
};

export default MacTextColumn;
