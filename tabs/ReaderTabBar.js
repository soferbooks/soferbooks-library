'use strict';

import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Modal,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ActionSheet from 'react-native-action-sheet';
import strings from '../LocalizedStrings';
import { useGlobalState } from '../Hooks';

export const READER_TAB_BAR_HEIGHT = 38;

/** Label for a tab or archived tab in the current menu language. */
export const tabLabel = (tab, isHeb) => {
  if (!tab) { return ''; }
  if (isHeb) { return tab.heRef || tab.heTitle || tab.ref || tab.title || ''; }
  return tab.ref || tab.title || '';
};

const showOptions = (options, onChoose) => {
  ActionSheet.showActionSheetWithOptions({
    options: [...options.map(o => o.label), strings.common.cancel],
    cancelButtonIndex: options.length,
  }, index => {
    if (index >= 0 && index < options.length) { options[index].onPress(); }
  });
};

const TabChip = ({ tab, active, isHeb, onSelect, onClose, onLongPress, theme }) => (
  <TouchableOpacity
    onPress={() => onSelect(tab.id)}
    onLongPress={() => onLongPress(tab.id)}
    accessibilityRole={'tab'}
    accessibilityState={{ selected: active }}
    style={[localStyles.chip, theme.lighterGreyBorder, active ? [localStyles.chipActive, theme.mainTextPanel] : theme.lighterGreyBackground, isHeb ? localStyles.rtl : null]}
  >
    <Text numberOfLines={1} style={[localStyles.chipText, active ? theme.text : theme.tertiaryText, isHeb ? localStyles.heText : null]}>
      {tabLabel(tab, isHeb)}
    </Text>
    <TouchableOpacity
      onPress={() => onClose(tab.id)}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      accessibilityLabel={strings.tabs.close_tab}
    >
      <Text style={[localStyles.close, theme.secondaryText]}>{'×'}</Text>
    </TouchableOpacity>
  </TouchableOpacity>
);

/**
 * Browser-style tab strip shown above the reader. Tap a tab to switch, × to close, long-press for
 * "close other tabs". The ⋮ button opens New tab / Close other tabs / Archived tabs.
 */
const ReaderTabBar = ({
  tabs, activeTabId, archived, onSelect, onClose, onCloseOthers, onNewTab,
  onRestoreArchived, onRemoveArchived, onClearArchived,
  recentlyClosed = [], onRestoreClosed, onRemoveClosed, onClearClosed,
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

  const onLongPressTab = id => {
    showOptions([
      { label: strings.tabs.close_tab, onPress: () => onClose(id) },
      { label: strings.tabs.close_other_tabs, onPress: () => onCloseOthers(id) },
    ], () => {});
  };
  const onMore = () => {
    const options = [{ label: strings.tabs.new_tab, onPress: onNewTab }];
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
            onClose={onClose}
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
                  <Text numberOfLines={1} style={[localStyles.archivedText, theme.text, isHeb ? localStyles.heText : null]}>{tabLabel(item, isHeb)}</Text>
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
  chip: {
    flexDirection: 'row', alignItems: 'center', maxWidth: 170, height: 28, marginHorizontal: 2,
    paddingLeft: 10, paddingRight: 6, borderRadius: 6, borderWidth: 1,
  },
  chipActive: { borderWidth: 1.5 },
  chipText: { fontSize: 13, flexShrink: 1, marginHorizontal: 2 },
  heText: { writingDirection: 'rtl', fontSize: 15 },
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
