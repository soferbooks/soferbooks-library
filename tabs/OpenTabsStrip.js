'use strict';

import React, { useContext } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReaderAppContext from '../context';
import { useGlobalState } from '../Hooks';
import { CategoryColorLine } from '../Misc';
import styles from '../Styles';
import strings from '../LocalizedStrings';
import Sefaria from '../sefaria';
import { tabLabel } from './ReaderTabBar';
import { isPinned } from './tabState';

/**
 * Home page strip of the reader's open tabs: pinned ones first, then most recently used first.
 * Tapping one opens the reader on that tab at its place. Renders nothing when no tabs are open.
 * Data and the open handler come from ReaderApp through ReaderAppContext.
 * `Header`: the heading component (the home page passes its own section heading, in Cinzel).
 */
const OpenTabsStrip = ({ Header = null }) => {
  const { readerTabs, openReaderTab } = useContext(ReaderAppContext);
  const { theme, menuLanguage } = useGlobalState();
  const tabs = readerTabs?.tabs || [];
  if (!tabs.length || !openReaderTab) { return null; }
  const isHeb = menuLanguage === 'hebrew';
  // pinned tabs first, then most recently used first
  const ordered = [...tabs].sort((a, b) => (isPinned(b) - isPinned(a)) || ((b.lastUsed || 0) - (a.lastUsed || 0)));
  return (
    <View style={styles.homeSection}>
      {Header ? <Header /> :
        <Text style={[styles.homeSectionHeader, theme.brandColorText, isHeb ? localStyles.heHeader : null]}>{strings.tabs.open_tabs}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={isHeb ? localStyles.rtl : null}>
        {ordered.map(tab => (
          <TouchableOpacity key={tab.id} onPress={() => openReaderTab(tab.id)} style={[localStyles.card, theme.lighterGreyBorder, theme.mainTextPanel]}>
            <CategoryColorLine category={Sefaria.primaryCategoryForTitle(tab.title)} thickness={3} />
            <Text numberOfLines={2} style={[localStyles.cardText, theme.text, isHeb ? localStyles.heText : null]}>{isPinned(tab) ? '📌 ' : ''}{tabLabel(tab, isHeb, { passage: true })}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const localStyles = StyleSheet.create({
  rtl: { flexDirection: 'row-reverse' },
  heHeader: { textAlign: 'right' },
  card: { width: 140, minHeight: 56, marginEnd: 8, borderWidth: 1, borderRadius: 6, overflow: 'hidden' },
  cardText: { fontSize: 14, padding: 8 },
  heText: { writingDirection: 'rtl', textAlign: 'right', fontSize: 16 },
});

export default OpenTabsStrip;
