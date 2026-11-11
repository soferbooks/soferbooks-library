'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import { StyleSheet, Text, View } from 'react-native';
import strings from '../LocalizedStrings';
import { useGlobalState } from '../Hooks';
import { SCHEDULE_TITLE } from './chokDay';

/**
 * The end of a day read as one unit (Chok LeYisrael: learningSchedules/chokDay.js), under its
 * last reading: "Today's Chok LeYisrael — done", and the day ("Toldot, Wednesday").
 */
const ScheduleEndMarker = ({ schedule }) => {
  const { theme, menuLanguage } = useGlobalState();
  const isHeb = menuLanguage === 'hebrew';
  const name = schedule.key === SCHEDULE_TITLE.en ? SCHEDULE_TITLE : (schedule.title || SCHEDULE_TITLE);
  const done = strings.formatString(strings.learning_schedules.day_done, { title: isHeb ? name.he : name.en });
  const label = schedule.tabLabel ? (isHeb ? schedule.tabLabel.he : schedule.tabLabel.en) : '';
  const day = label.split(' — ').slice(1).join(' — ');
  return (
    <View style={[localStyles.box, theme.lighterGreyBorder]} accessibilityRole="summary">
      <Text style={[localStyles.mark, theme.tertiaryText]}>{'✓'}</Text>
      <Text style={[localStyles.done, theme.text, isHeb ? localStyles.he : null]}>{done}</Text>
      {day ? <Text style={[localStyles.day, theme.tertiaryText, isHeb ? localStyles.he : null]}>{day}</Text> : null}
    </View>
  );
};
ScheduleEndMarker.propTypes = {
  schedule: PropTypes.shape({ key: PropTypes.string, title: PropTypes.object, tabLabel: PropTypes.object }).isRequired,
};

const localStyles = StyleSheet.create({
  box: { alignItems: 'center', marginTop: 24, marginBottom: 80, marginHorizontal: 24, paddingVertical: 20, borderTopWidth: 1 },
  mark: { fontSize: 28 },
  done: { fontSize: 18, fontWeight: 'bold', marginTop: 6, textAlign: 'center' },
  day: { fontSize: 14, marginTop: 4, textAlign: 'center' },
  he: { writingDirection: 'rtl' },
});

export default ScheduleEndMarker;
