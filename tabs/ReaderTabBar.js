'use strict';

import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ActionSheet from 'react-native-action-sheet';
import strings from '../LocalizedStrings';
import { displayRef } from '../extras/schema7';
import { useGlobalState } from '../Hooks';
import { isPinned } from './tabState';

export const READER_TAB_BAR_HEIGHT = 38;

/**
 * Label for a tab or archived tab in the current menu language, with an extra book's Hebrew
 * section names in place of its section keys (extras/schema7.js).
 * The tab strip names the book and section/page the tab is at ("Niddah 2a"), so its title does
 * not change with every passage scrolled past (QA, 2026-11-11). With `{ passage: true }` (the
 * home page's Open Tabs cards and the archive list, which have room) it names the passage itself
 * ("Shulchan Arukh, Orach Chayim 447:11", QA round 2).
 */
export const tabLabel = (tab, isHeb, { passage = false } = {}) => {
  if (!tab) { return ''; }
  // a day read as one unit has its own name: "Chok LeYisrael — Wednesday, 11 Nov"
  const named = tab.schedule && tab.schedule.tabLabel;
  if (named && (isHeb ? named.he : named.en)) { return isHeb ? named.he : named.en; }
  const seg = passage && tab.segmentRef && tab.ref && tab.segmentRef.startsWith(`${tab.ref}:`) ? tab.segmentRef : null;
  if (isHeb) {
    if (seg && tab.heRef && typeof Sefaria !== 'undefined' && Sefaria.toHeSegmentRef) {
      try { return Sefaria.toHeSegmentRef(tab.heRef, seg) || tab.heRef; } catch (e) { /* the section's ref */ }
    }
    return tab.heRef || tab.heTitle || tab.ref || tab.title || '';
  }
  return displayRef(seg || tab.ref || tab.title || '', tab.heRef);
};

const showOptions = (options, onChoose) => {
  ActionSheet.showActionSheetWithOptions({
    options: [...options.map(o => o.label), strings.common.cancel],
    cancelButtonIndex: options.length,
  }, index => {
    if (index >= 0 && index < options.length) { options[index].onPress(); }
  });
};

// The title is capped and ends in "…"; the pin mark and × keep their full width (QA: a long
// title squeezed the × out of the tab).
const TabChip = ({ tab, active, isHeb, onSelect, onClose, onLongPress, theme }) => (
  <TouchableOpacity
    onPress={() => onSelect(tab.id)}
    onLongPress={() => onLongPress(tab.id)}
    accessibilityRole={'tab'}
    accessibilityState={{ selected: active }}
    style={[localStyles.chip, theme.lighterGreyBorder, active ? [localStyles.chipActive, theme.mainTextPanel] : theme.lighterGreyBackground, isHeb ? localStyles.rtl : null]}
  >
    {isPinned(tab) ?
      <Text style={localStyles.pin} accessibilityLabel={strings.tabs.pinned_tab}>{'📌'}</Text> : null}
    <Text numberOfLines={1} ellipsizeMode={'tail'} style={[localStyles.chipText, active ? theme.text : theme.tertiaryText, isHeb ? localStyles.heText : null]}>
      {tabLabel(tab, isHeb)}
    </Text>
    <TouchableOpacity
      onPress={() => onClose(tab.id)}
      style={localStyles.closeButton}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      accessibilityLabel={strings.tabs.close_tab}
    >
      <Text style={[localStyles.close, theme.secondaryText]}>{'×'}</Text>
    </TouchableOpacity>
  </TouchableOpacity>
);

/**
 * Close tab `tab`; a pinned tab asks first, so it is not closed by accident. (It then goes to
 * Recently closed, unpinned, like any closed tab.)
 */
export const closeWithCare = (tab, onClose) => {
  if (!tab) { return; }
  if (!isPinned(tab)) { onClose(tab.id); return; }
  Alert.alert(strings.tabs.close_pinned_title, strings.tabs.close_pinned_message, [
    { text: strings.common.cancel, style: 'cancel' },
    { text: strings.tabs.close_tab, style: 'destructive', onPress: () => onClose(tab.id) },
  ]);
};

/** The long-press menu of tab `tab`. */
export const tabMenuOptions = (tab, { onClose, onCloseOthers, onPin, onUnpin, onAddToHomeScreen, os = Platform.OS }) => {
  const options = [];
  if (isPinned(tab)) {
    if (onUnpin) { options.push({ label: strings.tabs.unpin_tab, onPress: () => onUnpin(tab.id) }); }
  } else if (onPin) {
    options.push({ label: strings.tabs.pin_tab, onPress: () => onPin(tab.id) });
  }
  // home-screen shortcuts: Android only (it pins the tab first: tabs/tabShortcuts.js)
  if (onAddToHomeScreen && os === 'android') {
    options.push({ label: strings.tabs.add_to_home_screen, onPress: () => onAddToHomeScreen(tab.id) });
  }
  options.push({ label: strings.tabs.close_tab, onPress: () => closeWithCare(tab, onClose) });
  options.push({ label: strings.tabs.close_other_tabs, onPress: () => onCloseOthers(tab.id) });
  return options;
};

/**
 * Browser-style tab strip shown above the reader. Tap a tab to switch, × to close (a pinned tab
 * asks first), long-press for Pin/Unpin, Add to home screen, Close, Close other tabs. The ⋮
 * button opens New tab / Pin (or Unpin) this tab / Close other tabs / Archived tabs.
 * Pinned tabs come first.
 */
const ReaderTabBar = ({
  tabs, activeTabId, archived, onSelect, onClose, onCloseOthers, onNewTab,
  onRestoreArchived, onRemoveArchived, onClearArchived,
  recentlyClosed = [], onRestoreClosed, onRemoveClosed, onClearClosed,
  onPin, onUnpin, onAddToHomeScreen,
}) => {
  const { theme, menuLanguage } = useGlobalState();
  const isHeb = menuLanguage === 'hebrew';
  const [archiveOpen, setArchiveOpen] = useState(false);
  const scrollRef = useRef(null);
  const activeIndex = tabs.findIndex(t => t.id === activeTabId);

  useEffect(() => {
    // keep the active tab in view (approximate: chips are about the same width)
    if (scrollRef.current && activeIndex > 2) {
      scrollRef.current.scrollTo({ x: Math.max(0, (activeIndex - 1) * 120), animated: true });
    }
  }, [activeIndex]);

  const tabById = id => tabs.find(t => t.id === id);
  const onCloseTab = id => closeWithCare(tabById(id), onClose);
  const onLongPressTab = id => {
    const tab = tabById(id);
    if (!tab) { return; }
    showOptions(tabMenuOptions(tab, { onClose, onCloseOthers, onPin, onUnpin, onAddToHomeScreen }));
  };
  const onMore = () => {
    const options = [{ label: strings.tabs.new_tab, onPress: onNewTab }];
    const active = tabById(activeTabId);
    if (active && isPinned(active) && onUnpin) {
      options.push({ label: strings.tabs.unpin_tab, onPress: () => onUnpin(active.id) });
    } else if (active && onPin) {
      options.push({ label: strings.tabs.pin_tab, onPress: () => onPin(active.id) });
    }
    if (tabs.length > 1 && activeTabId) {
      options.push({ label: strings.tabs.close_other_tabs, onPress: () => onCloseOthers(activeTabId) });
    }
    options.push({
      label: strings.formatString(strings.tabs.archived_tabs_count, { count: archived.length + recentlyClosed.length }),
      onPress: () => setArchiveOpen(true),
    });
    showOptions(options);
  };

  return (
    <View style={[localStyles.bar, theme.header, isHeb ? localStyles.rtl : null]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={localStyles.scroll}
        contentContainerStyle={[localStyles.scrollContent, isHeb ? localStyles.rtl : null]}
      >
        {tabs.map(tab => (
          <TabChip
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            isHeb={isHeb}
            theme={theme}
            onSelect={onSelect}
            onClose={onCloseTab}
            onLongPress={onLongPressTab}
          />
        ))}
      </ScrollView>
      <TouchableOpacity onPress={onMore} style={localStyles.more} accessibilityLabel={strings.tabs.tab_options} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={[localStyles.moreText, theme.tertiaryText]}>{'⋮'}</Text>
      </TouchableOpacity>
      <ArchivedTabsModal
        visible={archiveOpen}
        archived={archived}
        isHeb={isHeb}
        theme={theme}
        onClose={() => setArchiveOpen(false)}
        onRestore={id => { setArchiveOpen(false); onRestoreArchived(id); }}
        onRemove={onRemoveArchived}
        onClear={onClearArchived}
        recentlyClosed={recentlyClosed}
        onRestoreClosed={id => { setArchiveOpen(false); onRestoreClosed && onRestoreClosed(id); }}
        onRemoveClosed={onRemoveClosed}
        onClearClosed={onClearClosed}
      />
    </View>
  );
};
ReaderTabBar.propTypes = {
  tabs:              PropTypes.array.isRequired,
  activeTabId:       PropTypes.string,
  archived:          PropTypes.array.isRequired,
  onSelect:          PropTypes.func.isRequired,
  onClose:           PropTypes.func.isRequired,
  onCloseOthers:     PropTypes.func.isRequired,
  onNewTab:          PropTypes.func.isRequired,
  onRestoreArchived: PropTypes.func.isRequired,
  onRemoveArchived:  PropTypes.func.isRequired,
  onClearArchived:   PropTypes.func.isRequired,
  recentlyClosed:    PropTypes.array,
  onRestoreClosed:   PropTypes.func,
  onRemoveClosed:    PropTypes.func,
  onClearClosed:     PropTypes.func,
  onPin:             PropTypes.func,
  onUnpin:           PropTypes.func,
  onAddToHomeScreen: PropTypes.func,
};

const noop = () => {};

/**
 * The tab archive, in two sections: "Archived" (tabs moved out when more than 10 were open) and
 * "Recently closed" (tabs the user closed, newest first, like Chrome). Tapping an entry reopens it
 * at its place; × removes it; each section has its own "Clear all".
 */
export const ArchivedTabsModal = ({
  visible, archived, isHeb, theme, onClose, onRestore, onRemove, onClear,
  recentlyClosed = [], onRestoreClosed = noop, onRemoveClosed = noop, onClearClosed = noop,
}) => {
  const sections = [
    { key: 'archived', title: strings.tabs.archived_section, empty: strings.tabs.no_archived_tabs,
      data: archived, onRestore, onRemove, onClear },
    { key: 'closed', title: strings.tabs.recently_closed, empty: strings.tabs.no_recently_closed,
      data: recentlyClosed, onRestore: onRestoreClosed, onRemove: onRemoveClosed, onClear: onClearClosed },
  ];
  return (
    <Modal visible={visible} animationType={'slide'} transparent onRequestClose={onClose}>
      <View style={localStyles.modalMask}>
        <View style={[localStyles.modalBox, theme.mainTextPanel]}>
          <View style={[localStyles.modalHeader, theme.lighterGreyBorder, isHeb ? localStyles.rtl : null]}>
            <Text style={[localStyles.modalTitle, theme.text]}>{strings.tabs.archived_tabs}</Text>
            <TouchableOpacity onPress={onClose} style={localStyles.headerButton} accessibilityLabel={strings.common.cancel}>
              <Text style={[localStyles.moreText, theme.tertiaryText]}>{'×'}</Text>
            </TouchableOpacity>
          </View>
          <SectionList
            sections={sections}
            keyExtractor={(item, index) => `${item.id}|${index}`}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <View>
                <View style={[localStyles.sectionHeader, theme.lighterGreyBorder, isHeb ? localStyles.rtl : null]}>
                  <Text style={[localStyles.sectionTitle, theme.secondaryText]}>{section.title}</Text>
                  {section.data.length ? (
                    <TouchableOpacity onPress={section.onClear} style={localStyles.headerButton}>
                      <Text style={theme.tertiaryText}>{strings.tabs.clear_archived}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {section.data.length ? null : <Text style={[localStyles.empty, theme.secondaryText]}>{section.empty}</Text>}
              </View>
            )}
            renderItem={({ item, section }) => (
              <View style={[localStyles.archivedRow, theme.lighterGreyBorder, isHeb ? localStyles.rtl : null]}>
                <TouchableOpacity style={localStyles.archivedLabel} onPress={() => section.onRestore(item.id)}>
                  <Text numberOfLines={1} style={[localStyles.archivedText, theme.text, isHeb ? localStyles.heText : null]}>{tabLabel(item, isHeb, { passage: true })}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => section.onRemove(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={strings.tabs.close_tab}>
                  <Text style={[localStyles.close, theme.secondaryText]}>{'×'}</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
};

const localStyles = StyleSheet.create({
  bar: { height: READER_TAB_BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  rtl: { flexDirection: 'row-reverse' },
  row: { flexDirection: 'row', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { alignItems: 'center', paddingHorizontal: 4 },
  // the title has its own width cap, so the chip never squeezes the pin mark or the ×
  chip: {
    flexDirection: 'row', alignItems: 'center', height: 28, marginHorizontal: 2,
    paddingLeft: 8, paddingRight: 4, borderRadius: 6, borderWidth: 1,
  },
  chipActive: { borderWidth: 1.5 },
  chipText: { fontSize: 13, maxWidth: 130, flexShrink: 1, marginHorizontal: 2 },
  heText: { writingDirection: 'rtl', fontSize: 15 },
  pin: { fontSize: 11, flexShrink: 0, marginHorizontal: 1 },
  closeButton: { flexShrink: 0, minWidth: 22, alignItems: 'center', justifyContent: 'center' },
  close: { fontSize: 18, paddingHorizontal: 4, lineHeight: 20 },
  more: { width: 32, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 22 },
  modalMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalBox: { maxHeight: '70%', minHeight: 200, borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontWeight: 'bold' },
  headerButton: { paddingHorizontal: 10 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, borderBottomWidth: 1 },
  sectionTitle: { fontSize: 14, fontWeight: "bold", textTransform: "uppercase" },
  archivedRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  archivedLabel: { flex: 1 },
  archivedText: { fontSize: 16 },
  empty: { padding: 20, textAlign: 'center' },
});

export default ReaderTabBar;
