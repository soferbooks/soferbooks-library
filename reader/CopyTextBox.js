'use strict';

import PropTypes from 'prop-types';
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { GlobalStateContext, getTheme } from '../StateManager';
import { CSS_CLASS_STYLES } from '../Misc';
import strings from '../LocalizedStrings';
import Sefaria from '../sefaria';

const buildEntries = ({ sectionSegments, sectionRef, sectionIndex, segmentIndex, segmentRef, getDisplayedText, textLanguage }) => {
  if (Array.isArray(sectionSegments) && sectionSegments.length > 0) {
    const out = [];
    for (let i = 0; i < sectionSegments.length; i++) {
      const seg = sectionSegments[i];
      if (!seg || (!seg.text && !seg.he)) { continue; }
      const segNum = seg.segmentNumber != null ? seg.segmentNumber : (i + 1);
      const segRef = sectionRef ? `${sectionRef}:${segNum}` : segmentRef;
      let text = '';
      if (typeof getDisplayedText === 'function') {
        text = getDisplayedText(false, sectionIndex, i, segRef) || '';
      } else {
        const hePlain = Sefaria.util.htmlToTextCanonical(typeof seg.he === 'string' ? seg.he : '') || '';
        const enPlain = Sefaria.util.htmlToTextCanonical(typeof seg.text === 'string' ? seg.text : '') || '';
        const showHe = textLanguage !== 'english' && !!hePlain;
        const showEn = textLanguage !== 'hebrew' && !!enPlain;
        text = [showHe ? hePlain : '', showEn ? enPlain : ''].filter(Boolean).join('\n');
      }
      if (!text) { continue; }
      const label = textLanguage === 'hebrew' && Number(segNum) > 0
        ? (Sefaria.hebrew.encodeHebrewNumeral(segNum) || String(segNum))
        : String(segNum);
      out.push({ rawIndex: i, label, text });
    }
    if (out.length > 0) { return out; }
  }
  const fallbackText = typeof getDisplayedText === 'function' ? (getDisplayedText(false) || '') : '';
  return [{ rawIndex: Math.max(0, segmentIndex || 0), label: '1', text: fallbackText }];
};

const findEntryPos = (entries, rawIndex) => {
  const idx = entries.findIndex(e => e.rawIndex === rawIndex);
  return idx >= 0 ? idx : 0;
};

/**
 * Interactive text-selection & multi-passage copy view for Mac, iOS, and Android.
 * Combines selected passages into one native selectable text box (for dragging any partial phrase
 * or multi-passage range and pressing Cmd+C) and offers one-click range adjustment + Copy.
 */
const CopyTextBox = ({
  sectionSegments,
  sectionRef,
  sectionIndex = 0,
  initialSegmentIndex = 0,
  segmentRef = '',
  getDisplayedText,
  onCopyText,
}) => {
  const { themeStr, interfaceLanguage, textLanguage, fontSize, hebrewFont } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  const isHei = interfaceLanguage === 'hebrew';
  const isHebText = textLanguage !== 'english';

  const entries = useMemo(() => buildEntries({
    sectionSegments,
    sectionRef,
    sectionIndex,
    segmentIndex: initialSegmentIndex,
    segmentRef,
    getDisplayedText,
    textLanguage,
  }), [sectionSegments, sectionRef, sectionIndex, initialSegmentIndex, segmentRef, getDisplayedText, textLanguage]);

  const initialPos = useMemo(() => findEntryPos(entries, initialSegmentIndex), [entries, initialSegmentIndex]);
  const [startPos, setStartPos] = useState(initialPos);
  const [endPos, setEndPos] = useState(initialPos);
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  useEffect(() => {
    setStartPos(initialPos);
    setEndPos(initialPos);
    setSelection({ start: 0, end: 0 });
  }, [initialPos, entries]);

  const clampedStart = Math.max(0, Math.min(startPos, entries.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min(endPos, entries.length - 1));

  const combinedText = useMemo(() => (
    entries.slice(clampedStart, clampedEnd + 1).map(e => e.text).filter(Boolean).join('\n\n')
  ), [entries, clampedStart, clampedEnd]);

  const hasSelection = selection && selection.end > selection.start && selection.start >= 0 && selection.end <= combinedText.length;

  const setRange = (nextStart, nextEnd) => {
    const s = Math.max(0, Math.min(nextStart, entries.length - 1));
    const e = Math.max(s, Math.min(nextEnd, entries.length - 1));
    setStartPos(s);
    setEndPos(e);
    setSelection({ start: 0, end: 0 });
  };

  const handleCopy = () => {
    const chosen = hasSelection ? combinedText.slice(selection.start, selection.end) : combinedText;
    if (!chosen) { return; }
    if (typeof onCopyText === 'function') {
      onCopyText(chosen);
    } else {
      Clipboard.setString(chosen);
    }
  };

  const fontFamily = isHebText ? (hebrewFont || CSS_CLASS_STYLES.hebrew.fontFamily) : CSS_CLASS_STYLES.english.fontFamily;
  const maxPos = Math.max(0, entries.length - 1);
  const rowDir = isHei ? localStyles.rowRtl : localStyles.rowLtr;

  return (
    <View style={[localStyles.container, theme.mainTextPanel]}>
      <Text style={[localStyles.hint, isHei ? localStyles.textRight : localStyles.textLeft, theme.secondaryText]}>
        {strings.copy.hint}
      </Text>

      <View style={[localStyles.controlsRow, rowDir]}>
        <View style={[localStyles.stepperGroup, theme.lighterGreyBorder]}>
          <Text style={[localStyles.label, theme.tertiaryText]}>{`${strings.copy.start_passage}: ${entries[clampedStart]?.label || ''}`}</Text>
          <View style={localStyles.stepButtons}>
            <TouchableOpacity
              testID="copyStartMinus"
              disabled={clampedStart <= 0}
              onPress={() => setRange(clampedStart - 1, clampedEnd)}
              style={[localStyles.stepBtn, theme.lighterGreyBorder, clampedStart <= 0 && localStyles.disabled]}
            >
              <Text style={[localStyles.stepBtnText, theme.text]}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="copyStartPlus"
              disabled={clampedStart >= maxPos}
              onPress={() => setRange(clampedStart + 1, Math.max(clampedEnd, clampedStart + 1))}
              style={[localStyles.stepBtn, theme.lighterGreyBorder, clampedStart >= maxPos && localStyles.disabled]}
            >
              <Text style={[localStyles.stepBtnText, theme.text]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[localStyles.stepperGroup, theme.lighterGreyBorder]}>
          <Text style={[localStyles.label, theme.tertiaryText]}>{`${strings.copy.end_passage}: ${entries[clampedEnd]?.label || ''}`}</Text>
          <View style={localStyles.stepButtons}>
            <TouchableOpacity
              testID="copyEndMinus"
              disabled={clampedEnd <= 0}
              onPress={() => setRange(Math.min(clampedStart, clampedEnd - 1), clampedEnd - 1)}
              style={[localStyles.stepBtn, theme.lighterGreyBorder, clampedEnd <= 0 && localStyles.disabled]}
            >
              <Text style={[localStyles.stepBtnText, theme.text]}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="copyEndPlus"
              disabled={clampedEnd >= maxPos}
              onPress={() => setRange(clampedStart, clampedEnd + 1)}
              style={[localStyles.stepBtn, theme.lighterGreyBorder, clampedEnd >= maxPos && localStyles.disabled]}
            >
              <Text style={[localStyles.stepBtnText, theme.text]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={[localStyles.actionsRow, rowDir]}>
        <TouchableOpacity
          testID="copySingleSegment"
          onPress={() => setRange(initialPos, initialPos)}
          style={[localStyles.actionPill, theme.lighterGreyBorder]}
        >
          <Text style={[localStyles.actionPillText, theme.tertiaryText]}>{strings.copy.single_segment}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="copyWholeSection"
          onPress={() => setRange(0, maxPos)}
          style={[localStyles.actionPill, theme.lighterGreyBorder]}
        >
          <Text style={[localStyles.actionPillText, theme.tertiaryText]}>{strings.copy.whole_section}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="copyPrimaryButton"
          onPress={handleCopy}
          style={[localStyles.primaryButton, theme.lighterGreyBorder]}
        >
          <Text style={[localStyles.primaryButtonText, theme.brandColorText]}>
            {hasSelection ? strings.copy.copy_selected : strings.copy.copy_range}
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        testID="copyTextInput"
        multiline
        editable={false}
        selectTextOnFocus={false}
        scrollEnabled
        value={combinedText}
        onSelectionChange={e => setSelection((e && e.nativeEvent && e.nativeEvent.selection) || { start: 0, end: 0 })}
        style={[
          localStyles.textInput,
          theme.text,
          theme.lighterGreyBorder,
          {
            fontFamily,
            fontSize: Math.max(15, Math.min(fontSize || 18, 26)),
            lineHeight: Math.max(22, Math.min((fontSize || 18) * 1.45, 38)),
            textAlign: isHebText ? 'right' : 'left',
            writingDirection: isHebText ? 'rtl' : 'ltr',
          },
        ]}
      />
    </View>
  );
};

CopyTextBox.propTypes = {
  sectionSegments:     PropTypes.array,
  sectionRef:          PropTypes.string,
  sectionIndex:        PropTypes.number,
  initialSegmentIndex: PropTypes.number,
  segmentRef:          PropTypes.string,
  getDisplayedText:    PropTypes.func,
  onCopyText:          PropTypes.func,
};

const localStyles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  hint: { fontSize: 13, marginBottom: 8 },
  textLeft: { textAlign: 'left' },
  textRight: { textAlign: 'right' },
  controlsRow: { flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' },
  actionsRow: { flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' },
  rowLtr: { flexDirection: 'row' },
  rowRtl: { flexDirection: 'row-reverse' },
  stepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
  },
  label: { fontSize: 13, fontWeight: '600' },
  stepButtons: { flexDirection: 'row', gap: 4 },
  stepBtn: {
    minWidth: 26,
    height: 26,
    borderWidth: 1,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 16, fontWeight: 'bold', lineHeight: 18 },
  disabled: { opacity: 0.35 },
  actionPill: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  actionPillText: { fontSize: 13 },
  primaryButton: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  primaryButtonText: { fontSize: 13, fontWeight: 'bold' },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    textAlignVertical: 'top',
  },
});

export default CopyTextBox;
