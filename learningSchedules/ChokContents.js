/**
 * Chok LeYisrael's table of contents: every parsha, and each of its days (Thursday night - ליל
 * שישי - among them); a day opens in the same tab (ReaderApp.openChokDayFromPicker). The day page
 * is the reader's sheet mode, which has no book contents of its own: the contents page showed only
 * a spinner (owner, 2026-11-22: "make it that u can go to any parsha and day from there").
 */
import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { CloseButton } from '../Misc';
import styles from '../Styles';
import strings from '../LocalizedStrings';
import { useGlobalState } from '../Hooks';
import { PARSHIOT_HE, DAYS, THURSDAY_NIGHT } from './chokDay';
import { WEEK_DAY_KEYS, chokSheetRef, keysOfChokRef, parseKey } from './chokSheet';

const dayOf = key => (key === THURSDAY_NIGHT.key ? THURSDAY_NIGHT : DAYS.find(d => d.key === key));

const ChokContents = ({ currentRef, close, openDay }) => {
  const { theme, interfaceLanguage } = useGlobalState();
  const current = useMemo(() => new Set(keysOfChokRef(currentRef || '')), [currentRef]);
  const currentParsha = useMemo(() => {
    const k = [...current][0];
    const p = k && parseKey(k);
    return p ? p.parshaHe : null;
  }, [current]);
  const start = Math.max(0, PARSHIOT_HE.indexOf(currentParsha));
  const langStyle = interfaceLanguage === 'hebrew' ? styles.heInt : styles.enInt;
  const renderItem = ({ item: parsha }) => (
    <View style={[local.parsha, theme.lighterGreyBorder]}>
      <Text style={[styles.he, local.parshaName, theme.text]}>{`פרשת ${parsha}`}</Text>
      <View style={local.days}>
        {WEEK_DAY_KEYS.map(k => {
          const key = `${parsha}|${k}`;
          const active = current.has(key);
          return (
            <TouchableOpacity
              key={k}
              onPress={() => openDay(chokSheetRef([key]))}
              style={[local.day, active ? local.dayActive : null]}
              accessibilityRole="button"
              testID={`chok-day-${key}`}
            >
              <Text style={[local.dayText, theme.text, active ? local.dayTextActive : null]}>{dayOf(k).he}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
  return (
    <View style={[styles.menu, theme.menu]}>
      <View style={[styles.header, theme.header]}>
        <CloseButton onPress={close} />
        <Text style={[langStyle, styles.textTocHeaderTitle, styles.textCenter, theme.text]}>{strings.reader.table_of_contents}</Text>
        <View style={{ width: 40 }} />
      </View>
      <FlatList
        data={PARSHIOT_HE}
        keyExtractor={p => p}
        renderItem={renderItem}
        initialScrollIndex={start}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
};

const ROW_HEIGHT = 112;
const local = StyleSheet.create({
  parsha: { height: ROW_HEIGHT, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1 },
  parshaName: { fontSize: 22, textAlign: 'right', writingDirection: 'rtl' },
  days: { flexDirection: 'row-reverse', flexWrap: 'wrap', marginTop: 6 },
  // (as the day page's own day buttons: TextColumn dayStyles)
  day: { borderWidth: 1, borderColor: '#C49A3C', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 3, marginLeft: 6, marginBottom: 6 },
  dayActive: { backgroundColor: '#1F3366', borderColor: '#1F3366' },
  dayText: { fontFamily: 'FrankSofer', fontSize: 16 },
  dayTextActive: { color: '#FFFFFF' },
});

ChokContents.propTypes = {
  currentRef: PropTypes.string,
  close: PropTypes.func.isRequired,
  openDay: PropTypes.func.isRequired,
};

export default ChokContents;
