'use strict';

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import strings from '../LocalizedStrings';
import { useGlobalState } from '../Hooks';
import { currentReading } from './scheduleSequence';

/**
 * Shown above the text in a learning schedule's tab when the day has several readings (Chok
 * LeYisrael): previous / "Chok LeYisrael · 2 of 7, Isaiah 1:1-5" / next. Tapping the middle opens
 * the day's list; each reading opens in the same tab (learningSchedules/scheduleSequence.js).
 */
const ScheduleSequenceBar = ({ sequence, onGo }) => {
  const { theme, menuLanguage } = useGlobalState();
  const [listOpen, setListOpen] = useState(false);
  const isHeb = menuLanguage === 'hebrew';
  const items = sequence.items;
  const index = sequence.index || 0;
  const reading = currentReading(sequence);
  const label = r => (isHeb ? r.he : r.en);
  const title = (isHeb ? sequence.title.he : sequence.title.en) || '';
  const position = strings.formatString(strings.learning_schedules.reading_n_of_m, { n: index + 1, m: items.length });
  const arrow = (delta, enabled, a11y, glyph) => (
    <TouchableOpacity
      onPress={() => enabled && onGo(index + delta)}
      disabled={!enabled}
      accessibilityLabel={a11y}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={localStyles.arrow}
    >
      <Text style={[localStyles.arrowText, enabled ? theme.text : theme.tertiaryText, enabled ? null : localStyles.disabled]}>{glyph}</Text>
    </TouchableOpacity>
  );
  // in Hebrew the row is mirrored, so "previous" stays on the right (where reading starts)
  const prevGlyph = isHeb ? '›' : '‹';
  const nextGlyph = isHeb ? '‹' : '›';
  return (
    <View style={[localStyles.bar, theme.header, theme.lighterGreyBorder, isHeb ? localStyles.rtl : null]}>
      {arrow(-1, index > 0, strings.learning_schedules.previous_reading, prevGlyph)}
      <TouchableOpacity style={localStyles.middle} onPress={() => setListOpen(true)} accessibilityLabel={strings.learning_schedules.todays_readings}>
        <Text numberOfLines={1} style={[localStyles.title, theme.tertiaryText, isHeb ? localStyles.heText : null]}>{`${title} · ${position}`}</Text>
        <Text numberOfLines={1} style={[localStyles.reading, theme.text, isHeb ? localStyles.heText : null]}>{reading ? label(reading) : ''}</Text>
      </TouchableOpacity>
      {arrow(1, index < items.length - 1, strings.learning_schedules.next_reading, nextGlyph)}
      <Modal visible={listOpen} animationType={'slide'} transparent onRequestClose={() => setListOpen(false)}>
        <View style={localStyles.mask}>
          <View style={[localStyles.box, theme.mainTextPanel]}>
            <View style={[localStyles.boxHeader, theme.lighterGreyBorder, isHeb ? localStyles.rtl : null]}>
              <Text style={[localStyles.boxTitle, theme.text]}>{`${title} · ${strings.learning_schedules.todays_readings}`}</Text>
              <TouchableOpacity onPress={() => setListOpen(false)} accessibilityLabel={strings.common.cancel} style={localStyles.close}>
                <Text style={[localStyles.arrowText, theme.tertiaryText]}>{'×'}</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={items}
              keyExtractor={(item, i) => `${i}|${item.ref}`}
              renderItem={({ item, index: i }) => (
                <TouchableOpacity
                  onPress={() => { setListOpen(false); if (i !== index) { onGo(i); } }}
                  style={[localStyles.row, theme.lighterGreyBorder, isHeb ? localStyles.rtl : null, i === index ? theme.lighterGreyBackground : null]}
                >
                  <Text style={[localStyles.rowNum, theme.tertiaryText]}>{`${i + 1}.`}</Text>
                  <View style={localStyles.rowBody}>
                    {item.section && !isHeb ? <Text style={[localStyles.section, theme.tertiaryText]}>{item.section}</Text> : null}
                    <Text style={[localStyles.rowText, theme.text, isHeb ? localStyles.heText : null]}>{label(item)}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};
ScheduleSequenceBar.propTypes = {
  sequence: PropTypes.shape({
    title: PropTypes.object,
    items: PropTypes.array.isRequired,
    index: PropTypes.number,
  }).isRequired,
  onGo: PropTypes.func.isRequired,  // (index) => open reading `index`
};

const localStyles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 4, borderBottomWidth: 1 },
  rtl: { flexDirection: 'row-reverse' },
  arrow: { width: 40, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 26, lineHeight: 30 },
  disabled: { opacity: 0.35 },
  middle: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  title: { fontSize: 12 },
  reading: { fontSize: 15 },
  heText: { writingDirection: 'rtl' },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  box: { maxHeight: '75%', minHeight: 200, borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingBottom: 20 },
  boxHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  boxTitle: { fontSize: 17, fontWeight: 'bold', flexShrink: 1 },
  close: { paddingHorizontal: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  rowNum: { width: 28, fontSize: 15 },
  rowBody: { flex: 1 },
  section: { fontSize: 12 },
  rowText: { fontSize: 16 },
});

export default ScheduleSequenceBar;
