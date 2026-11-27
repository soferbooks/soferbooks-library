'use strict';
import PropTypes from 'prop-types';
import React, { useContext, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Platform,
  Linking,
} from 'react-native';
import { GlobalStateContext, getTheme } from './StateManager';
import TextSegment from './TextSegment';
import styles from './Styles';
import iPad from "./isIPad";
import isMac from './isMac';
import { useNakdan } from './reader/nakdan';
import { boldDibbur as withBoldDibbur } from './reader/dibbur';
import InlineCommentary from './reader/InlineCommentary';


const TextRange = React.memo(({
  displayRef,
  showToast,
  rowData,
  segmentRef,
  showSegmentNumbers,
  textSegmentPressed,
  setRowRef,
  setRowRefInitY,
  handleOpenURL,
  setDictionaryLookup,
  shareCurrentSegment,
  getDisplayedText,
  vowelToggleAvailable,
  isSheet,
  setHighlightedWord,
  nakdan,
  boldDibbur,
  inlineCommentary,
  commentaryNakdan,
}) => {
  const { themeStr, textLanguage, biLayout, fontSize, vocalization } = useContext(GlobalStateContext);

  const theme = getTheme(themeStr);
  const _setRef = ref => {
    setRowRef(segmentRef, ref);
  };

  // nikud by computer (Dicta) for a text without nikud, when switched on (reader/nakdanPrefs.js)
  const dictaHe = useNakdan(rowData.content.he, !!nakdan && !isSheet);
  // (worked out once per text, not at every redraw of the row: the Hebrew is parsed and each word
  //  wrapped for the dictionary - QA round 16 saw redraws of a Hebrew-only Gemara page stall)
  const enText = useMemo(() => Sefaria.util.getDisplayableHTML(rowData.content.text || "", 'english', isSheet, false),
    [rowData.content.text, isSheet]);
  // No word is a tap target for the dictionary (owner, 2026-11-22: "completely remove the word
  // wrapping dictionary ... then people can copy and paste too"): every word of every passage made
  // one took about 0.3 s a paragraph to draw on the 32-bit tablet - the siddur opened in 4 s, under 2
  // without. The text is selectable instead (TextSegment), and the dictionary has its own search box
  // in the connections panel (LexiconBox).
  const heText = useMemo(() => {
    let he = Sefaria.util.applyVocalizationSettings(dictaHe || rowData.content.he, vocalization, vowelToggleAvailable) || "";
    // a commentary: its dibbur hamaschil in bold, as SoferBooks prints it (reader/dibbur.js; at display, not stored)
    if (boldDibbur && !isSheet) { he = withBoldDibbur(he); }
    return Sefaria.util.getDisplayableHTML(he, 'hebrew', isSheet, false);
  }, [dictaHe, rowData.content.he, vocalization, vowelToggleAvailable, boldDibbur, isSheet]);
  let numLinks = rowData.related?.links?.length || 0;

  const textLanguageWithContent = Sefaria.util.getTextLanguageWithContent(textLanguage, enText, heText);
  const ratiobasedFontSize = (fontSize) => {
    // The sizes were taken from styles.verseNumber.fontSize/hebrewVerseNumber and StateManager.fontSize
    return iPad ? 11/25*fontSize : textLanguageWithContent === "hebrew" ? 11/20*fontSize : 9/20*fontSize}

  let refSection = rowData.sectionIndex + ":" + rowData.rowIndex;
  let numberMargin = (<Text
                        style={[styles.verseNumber, theme.verseNumber, {fontSize: ratiobasedFontSize(fontSize)}]}
                        key={segmentRef + "|segment-number"}>
                      {showSegmentNumbers ? (textLanguageWithContent == "hebrew" ?
                       Sefaria.hebrew.encodeHebrewNumeral(rowData.content.segmentNumber) :
                       rowData.content.segmentNumber) : ""}
                    </Text>);

  let bulletOpacity = (numLinks-20) / (70-20);
  if (numLinks == 0) { bulletOpacity = 0; }
  else if (bulletOpacity < 0.3) { bulletOpacity = 0.3; }
  else if (bulletOpacity > 0.8) { bulletOpacity = 0.8; }

  var bulletMargin = (<Text
                        style={[styles.verseBullet, theme.verseBullet, {opacity:bulletOpacity}]}
                        key={segmentRef + "|segment-dot"}>
                      {"●"}
                    </Text>);

  // (inside the highlight box, which takes styles.textSegment's flex: 1)
  let textStyle = [{ flexDirection: 'column', flexWrap: 'nowrap' }];
  if (biLayout === 'sidebyside') {
    textStyle.push({flexDirection: "row"})
  } else if (biLayout === 'sidebysiderev') {
    textStyle.push({flexDirection: "row-reverse"})
  }
  const showHe = textLanguageWithContent == "hebrew" || textLanguageWithContent == "bilingual";
  const showEn = textLanguageWithContent == "english" || textLanguageWithContent == "bilingual";
  const onTextPress = useCallback((onlyOpen) => {
    let key = refSection;
    let section = parseInt(key.split(":")[0]);
    let segment = parseInt(key.split(":")[1]);
    textSegmentPressed(section, segment, segmentRef, onlyOpen);
  }, [refSection, segmentRef]);
  return (
    <View
      style={styles.verseContainer}
      ref={_setRef}
    >
      <View
        style={[styles.numberSegmentHolderEn, {flexDirection: textLanguageWithContent === 'english' ? 'row' : 'row-reverse'}]}
        key={`${segmentRef}|${biLayout}|inner-box`}
      >
        { numberMargin }
        {/* (the selected passage's highlight covers its commentary under it too: owner, 2026-11-27 "the segment
             selector should cover both, not just the main text") */}
        <View style={[styles.textSegment, rowData.highlight ? theme.segmentHighlight : null]} key={segmentRef+"|highlight-box"}>
        <View style={textStyle} key={segmentRef+"|text-box"}>
          {
            showHe ? (
              <View style={{flex: 4.5, paddingRight: biLayout == 'stacked' ? 0 : (biLayout == 'sidebyside' ? 10 : 0), paddingLeft: biLayout == 'stacked' ? 0 : (biLayout == 'sidebysiderev' ? 10 : 0)}}>
                {displayRef && rowData.content.sourceHeRef ? <Text style={[styles.he, styles.textListCitation, {marginBottom: 6}, theme.textListCitation]}>{rowData.content.sourceHeRef}</Text> : null}
                <TextSegment
                  fontSize={fontSize}
                  themeStr={themeStr}
                  segmentRef={segmentRef}
                  segmentKey={refSection}
                  data={heText}
                  textType="hebrew"
                  onTextPress={onTextPress}
                  showToast={showToast}
                  setDictionaryLookup={setDictionaryLookup}
                  handleOpenURL={handleOpenURL}
                  shareCurrentSegment={shareCurrentSegment}
                  getDisplayedText={getDisplayedText}
                  setHighlightedWord={setHighlightedWord}
                  highlightedWordID={rowData.highlightedWordID}
                />
              </View>
            ) : null
          }
          {
            showEn ? (
              <View style={{flex: 5.5, paddingTop: showHe ? biLayout == 'stacked' ? 5 : 0 : 0, paddingRight: biLayout == 'stacked' ? 0 : (biLayout == 'sidebyside' ? 0 : 10), paddingLeft: biLayout == 'stacked' ? 0 : (biLayout == 'sidebysiderev' ? 0 : 10)}}>
                {displayRef && rowData.content.sourceHeRef ? <Text style={[styles.en, styles.textListCitation, theme.textListCitation, {marginBottom: 6}]}>{rowData.content.sourceRef}</Text> : null}
                <TextSegment
                  fontSize={fontSize}
                  themeStr={themeStr}
                  segmentRef={segmentRef}
                  segmentKey={refSection}
                  data={enText}
                  textType="english"
                  bilingual={textLanguageWithContent === "bilingual"}
                  onTextPress={onTextPress}
                  showToast={showToast}
                  setDictionaryLookup={setDictionaryLookup}
                  handleOpenURL={handleOpenURL}
                  shareCurrentSegment={shareCurrentSegment}
                  getDisplayedText={getDisplayedText}
                  setHighlightedWord={setHighlightedWord}
                  highlightedWordID={rowData.highlightedWordID}
                />
              </View>
            ) : null
          }
        </View>
        {inlineCommentary ?
          <InlineCommentary links={rowData.related?.links} sourceKey={inlineCommentary} nakdan={!!commentaryNakdan} inside /> : null}
        </View>
        { bulletMargin }
      </View>
    </View>
  );
});
TextRange.whyDidYouRender = {customName: 'TextRange'};
TextRange.propTypes = {
  showToast:          PropTypes.func.isRequired,
  rowData:            PropTypes.object.isRequired,
  segmentRef:         PropTypes.string.isRequired,
  segmentHeRef:       PropTypes.string,
  showSegmentNumbers: PropTypes.bool.isRequired,
  textSegmentPressed: PropTypes.func.isRequired,
  setRowRef:          PropTypes.func.isRequired,
  setRowRefInitY:     PropTypes.func.isRequired,
  shareCurrentSegment:PropTypes.func.isRequired,
  getDisplayedText:   PropTypes.func.isRequired,
  nakdan:             PropTypes.bool,   // add Dicta's nikud to a text without nikud
  boldDibbur:         PropTypes.bool,   // a commentary: its dibbur hamaschil in bold (reader/dibbur.js)
  inlineCommentary:   PropTypes.string, // the source shown under the passage (reader/InlineCommentary.js)
  commentaryNakdan:   PropTypes.bool,   // ... with Dicta's nikud where it has none
};

export default TextRange;
