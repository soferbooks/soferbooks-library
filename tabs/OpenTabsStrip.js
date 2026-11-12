'use strict';

import React, { useContext, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReaderAppContext from '../context';
import { useGlobalState } from '../Hooks';
import { CategoryColorLine } from '../Misc';
import styles from '../Styles';
import strings from '../LocalizedStrings';
import Sefaria from '../sefaria';
import { tabLabel } from './ReaderTabBar';
import { isPinned, pinnedFirst } from './tabState';

/**
 * Home page strip of the reader's open tabs, in the tab bar's order (pinned ones first).
 * Tapping one opens the reader on that tab at its place. Renders nothing when no tabs are open.
 * Data and the open handler come from ReaderApp through ReaderAppContext.
 * `Header`: the heading component (the home page passes its own section heading, in Cinzel).
 */
const OpenTabsStrip = ({ Header = null }) => {
  const { readerTabs, openReaderTab } = useContext(ReaderAppContext);
  const { theme, menuLanguage } = useGlobalState();
  const scrollRef = useRef(null);
  const tabs = readerTabs?.tabs || [];
  if (!tabs.length || !openReaderTab) { return null; }
  const isHeb = menuLanguage === 'hebrew';
  // the tab bar's order (tabs/ReaderTabBar.js): pinned tabs first, each group in its own order
  const ordered = pinnedFirst(tabs);
  return (
    <View style={styles.homeSection}>
      {Header ? <Header /> :
        <Text style={[styles.homeSectionHeader, theme.brandColorText, isHeb ? localStyles.heHeader : null]}>{strings.tabs.open_tabs}</Text>}
      {/* (right to left in Hebrew, starting at the right: the first tab is the one seen first, as in
           the tab bar - it opened at the left end, showing the last tabs first) */}
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={isHeb ? localStyles.rtl : null}
        onContentSizeChange={() => { if (isHeb && scrollRef.current) { scrollRef.current.scrollToEnd({ animated: false }); } }}>
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
