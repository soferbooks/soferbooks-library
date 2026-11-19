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
import { BRAND_GOLD } from '../Styles';
import { displayRef } from '../extras/schema7';
import { useGlobalState } from '../Hooks';
import { isPinned } from './tabState';

export const READER_TAB_BAR_HEIGHT = 38;

const TANAKH_BOOKS = new Set([
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'I Samuel', 'II Samuel', 'I Kings', 'II Kings',
  'Isaiah', 'Jeremiah', 'Ezekiel',
  'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Psalms', 'Proverbs', 'Job', 'Song of Songs', 'Ruth', 'Lamentations',
  'Ecclesiastes', 'Esther', 'Daniel', 'Ezra', 'Nehemiah',
  'I Chronicles', 'II Chronicles',
]);

const KNOWN_HE_ACRONYMS = new Set([
  'ש"ע', 'או"ח', 'יו"ד', 'אה"ע', 'חו"מ', 'שועה"ר', 'קצש"ע', 'עה"ש',
  'רמב"ם', 'מ"ב', 'בה"ל', 'שה"צ', 'מג"א', 'ט"ז', 'ש"ך', 'באה"ט', 'ב"י', 'רש"י',
]);

/**
 * True when `tab.segmentRef` adds a canonical verse/mishnah/se'if/halakha number onto a depth-1
 * section ref (Tanakh Perek:Pasuk, Mishnah Perek:Mishnah, Tosefta Perek:Halakha, Shulchan Arukh
 * Siman:Se'if, Rambam Perek:Halakha, Midrash Rabbah, classic Halakhah). Excludes Sefaria-only
 * segment numbers (Bavli line numbers, 3rd-level commentary/Yerushalmi lines, paragraphs).
 */
const hasStandardSegmentRef = tab => {
  if (!tab || !tab.ref || !tab.segmentRef || !tab.segmentRef.startsWith(`${tab.ref}:`)) { return false; }
  if (/\s\d+[ab](?::\d+)*$/.test(tab.ref)) { return false; }
  if (tab.ref.includes(':')) { return false; }
  const segSuffix = tab.segmentRef.slice(tab.ref.length + 1);
  if (!/^\d+$/.test(segSuffix)) { return false; }
  const title = tab.title || '';
  const idx = typeof Sefaria !== 'undefined' && Sefaria.index ? Sefaria.index(title) : null;
  const cats = (idx && idx.categories) || [];
  const isComm = Boolean((idx && idx.dependence === 'Commentary') || /\son\s/i.test(title));
  if (cats[0] === 'Tanakh' && !isComm) { return true; }
  if (cats[0] === 'Mishnah' && !isComm) { return true; }
  if (cats[0] === 'Tosefta' && !isComm) { return true; }
  if ((cats[0] === 'Halakhah' && cats[1] === 'Shulchan Arukh' && !isComm) || /^Shulchan Arukh,\s/i.test(title)) { return true; }
  if ((cats[0] === 'Halakhah' && cats[1] === 'Mishneh Torah' && !isComm) || /^Mishneh Torah,\s/i.test(title)) { return true; }
  if ((cats[0] === 'Halakhah' && cats[1] === 'Shulchan Arukh HaRav') ||
      /^(?:Kitzur Shulchan Arukh|Arukh HaShulchan(?: HeAtid)?|Shulchan Arukh HaRav|Mishnah Berurah|Magen Avraham|Turei Zahav|Siftei Kohen|Be'er Heitev|Sha'ar HaTziyun)\b/i.test(title)) {
    return true;
  }
  if (cats[0] !== 'Talmud' && (cats.includes('Midrash Rabbah') || (idx && idx.corpus === 'Midrash Rabbah') || /\bRabbah$/i.test(title))) {
    return true;
  }
  if (!idx) {
    return TANAKH_BOOKS.has(title) || /^Mishnah\s/i.test(title) || /^Tosefta\s/i.test(title);
  }
  return false;
};

/** Shorten well-known Hebrew sefer names and drop " על " in commentaries for compact tabs. */
const abbreviateHeTabTitle = title => String(title || '')
  .replace(/שו?לחן ערוך,?\s+אורח חיים/g, 'ש"ע או"ח')
  .replace(/שו?לחן ערוך,?\s+יורה דעה/g, 'ש"ע יו"ד')
  .replace(/שו?לחן ערוך,?\s+אבן העזר/g, 'ש"ע אה"ע')
  .replace(/שו?לחן ערוך,?\s+חושן משפט/g, 'ש"ע חו"מ')
  .replace(/שו?לחן ערוך הרב/g, 'שועה"ר')
  .replace(/קיצור שו?לחן ערוך/g, 'קצש"ע')
  .replace(/ערוך השו?לחן/g, 'עה"ש')
  .replace(/ארבעה טורים/g, 'טור')
  .replace(/משנה תורה,?\s+הלכות\s+/g, 'רמב"ם ')
  .replace(/משנה תורה,\s+/g, 'רמב"ם ')
  .replace(/תלמוד ירושלמי\s+/g, 'ירושלמי ')
  .replace(/משנה ברורה/g, 'מ"ב')
  .replace(/ביאור הלכה/g, 'בה"ל')
  .replace(/שער הציון/g, 'שה"צ')
  .replace(/מגן אברהם/g, 'מג"א')
  .replace(/טורי זהב/g, 'ט"ז')
  .replace(/שפתי כהן/g, 'ש"ך')
  .replace(/באר היטב/g, 'באה"ט')
  .replace(/בית יוסף/g, 'ב"י')
  .replace(/תרגום אונקלוס/g, 'אונקלוס')
  .replace(/,\s*אורח חיים/g, ' או"ח')
  .replace(/,\s*יורה דעה/g, ' יו"ד')
  .replace(/,\s*אבן העזר/g, ' אה"ע')
  .replace(/,\s*חושן משפט/g, ' חו"מ')
  .replace(/\s+על\s+/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

/** Shorten well-known English sefer names and drop " on " in commentaries for compact tabs. */
const abbreviateEnTabTitle = title => String(title || '')
  .replace(/Shulchan Arukh,?\s+Orach Chay?im/gi, 'SA OC')
  .replace(/Shulchan Arukh,?\s+Yoreh De'?ah/gi, 'SA YD')
  .replace(/Shulchan Arukh,?\s+Even HaEzer/gi, 'SA EH')
  .replace(/Shulchan Arukh,?\s+Choshen Mishpat/gi, 'SA CM')
  .replace(/Shulchan Arukh HaRav/gi, 'SA HaRav')
  .replace(/Kitzur Shulchan Arukh/gi, 'Kitzur SA')
  .replace(/Mishneh Torah,\s+/gi, 'Rambam ')
  .replace(/Jerusalem Talmud\s+/gi, 'Yerushalmi ')
  .replace(/,\s*Orach Chay?im/gi, ' OC')
  .replace(/,\s*Yoreh De'?ah/gi, ' YD')
  .replace(/,\s*Even HaEzer/gi, ' EH')
  .replace(/,\s*Choshen Mishpat/gi, ' CM')
  .replace(/\s+on\s+/gi, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

/**
 * Simplify a Hebrew ref for the narrow tab strip:
 * - Talmud daf + ammud (`נדה ב׳ א` / `נדה ב׳ א:ה׳` / `נדה ל״ב ב`) -> `נדה ב.` / `נדה לב:`
 * - Commentaries drop ` על ` (`רש"י על נדה ב׳ א:ה׳` -> `רש"י נדה ב.`)
 * - Known sefarim abbreviate (`שולחן ערוך, אורח חיים` -> `ש"ע או"ח`)
 * - Non-Talmud sections keep at most 2 colon parts (`א׳:ה׳:ב׳` -> `א:ה`) and strip numeral
 *   geresh/gershayim while leaving book-title acronyms (`רש"י`, `רמב"ם`) and book-only titles
 *   (`שמואל א`) intact.
 */
const compactHeTabRef = (heRef, tab) => {
  if (!heRef) { return heRef; }
  if (tab && tab.heTitle && heRef === tab.heTitle) { return abbreviateHeTabTitle(heRef); }
  const isTalmudRef = Boolean(tab && tab.ref && /\s\d+[ab](?::\d+)*$/.test(tab.ref));
  const talmudStripped = heRef.replace(/:[א-ת0-9]+[׳״'"]*(?::[א-ת0-9]+[׳״'"]*)*$/, '');
  const dafPattern = isTalmudRef
    ? /^(.+\s)([א-ת׳״'"]+)\s+([אב])[׳']?$/
    : /^(.+\s)([א-ת]{1,4}[׳״'"]+[א-ת]?)\s+([אב])[׳']?$/;
  const dafMatch = talmudStripped.match(dafPattern);
  if (dafMatch) {
    const titlePart = abbreviateHeTabTitle(dafMatch[1]);
    const daf = dafMatch[2].replace(/[׳״'"]/g, '');
    const ammud = dafMatch[3] === 'א' ? '.' : ':';
    return `${titlePart} ${daf}${ammud}`;
  }
  const abbreviated = abbreviateHeTabTitle(heRef);
  const m = abbreviated.match(/^(.+)\s+([א-ת׳״'":0-9-]+)$/);
  if (!m) { return abbreviated; }
  const [, prefix, rawSec] = m;
  if (KNOWN_HE_ACRONYMS.has(rawSec)) { return abbreviated; }
  const secParts = rawSec.split(':').slice(0, 2).map(part => part.replace(/[׳״'"]/g, ''));
  return `${prefix} ${secParts.join(':')}`;
};

/** Simplify an English ref for the narrow tab strip: abbreviate titles and drop Sefaria-only segments. */
const compactEnTabRef = enRef => {
  if (!enRef) { return enRef; }
  let s = enRef.replace(/(\s\d+[ab])(?::\d+)+$/, '$1');
  s = s.replace(/(\s\d+:\d+)(?::\d+)+$/, '$1');
  return abbreviateEnTabTitle(s);
};

/**
 * Label for a tab or archived tab in the current menu language, with an extra book's Hebrew
 * section names in place of its section keys (extras/schema7.js).
 * The tab strip names the book, standard section/verse when canonical ("Niddah 2a", "נדה ב.",
 * "ש"ע או"ח תמז:יא", "Genesis 1:5"), omitting Sefaria-only segment numbers, ` על `/` on `, and
 * Hebrew geresh/gershayim on numerals. With `{ passage: true }` (the home page's Open Tabs cards
 * and the archive list, which have room) it names the full passage ("Shulchan Arukh, Orach Chayim 447:11").
 */
export const tabLabel = (tab, isHeb, { passage = false } = {}) => {
  if (!tab) { return ''; }
  // a day read as one unit has its own name: "Chok LeYisrael — Wednesday, 11 Nov"
  const named = tab.schedule && tab.schedule.tabLabel;
  if (named && (isHeb ? named.he : named.en)) { return isHeb ? named.he : named.en; }
  const includeSeg = passage || hasStandardSegmentRef(tab);
  const seg = includeSeg && tab.segmentRef && tab.ref && tab.segmentRef.startsWith(`${tab.ref}:`) ? tab.segmentRef : null;
  if (isHeb) {
    let raw;
    if (seg && tab.heRef && typeof Sefaria !== 'undefined' && Sefaria.toHeSegmentRef) {
      try { raw = Sefaria.toHeSegmentRef(tab.heRef, seg) || tab.heRef; } catch (e) { raw = tab.heRef; }
    } else {
      raw = tab.heRef || tab.heTitle || tab.ref || tab.title || '';
    }
    return passage ? raw : compactHeTabRef(raw, tab);
  }
  const raw = displayRef(seg || tab.ref || tab.title || '', tab.heRef);
  return passage ? raw : compactEnTabRef(raw);
};

const showOptions = (options, onChoose) => {
  ActionSheet.showActionSheetWithOptions({
    options: [...options.map(o => o.label), strings.common.cancel],
    cancelButtonIndex: options.length,
  }, index => {
    if (index >= 0 && index < options.length) { options[index].onPress(); }
  });
};

/**
 * The mark of a pinned tab: a thin brand-gold bar along the top edge of its chip or card (the
 * owner's choice "B", 2026-11-12: no icon). A screen reader calls it "Pinned tab".
 */
export const PinnedTabBar = () => (
  <View style={localStyles.pinBar} accessible accessibilityLabel={strings.tabs.pinned_tab} testID={'pinned-tab-bar'} />
);

// The title is capped and ends in "…"; the × keeps its full width (QA: a long title squeezed
// the × out of the tab).
const TabChip = ({ tab, active, isHeb, onSelect, onClose, onLongPress, theme, onLayout }) => (
  <TouchableOpacity
    onLayout={onLayout}
    onPress={() => onSelect(tab.id)}
    onLongPress={() => onLongPress(tab.id)}
    accessibilityRole={'tab'}
    accessibilityState={{ selected: active }}
    style={[localStyles.chip, theme.lighterGreyBorder, active ? [localStyles.chipActive, theme.mainTextPanel] : theme.lighterGreyBackground, isHeb ? localStyles.rtl : null, isPinned(tab) ? localStyles.chipPinned : null]}
  >
    {isPinned(tab) ? <PinnedTabBar /> : null}
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

  const sizes = useRef({ content: 0, view: 0, chips: {} });
  // keep the active tab in view, centred by where it really is, once the strip and its tabs are
  // laid out (QA round 10: the active tab was left cut off under the ⋮ - the old estimate took
  // every tab as 120 wide; in Hebrew, where the tabs run from the right, it showed the last ones)
  const showActive = (animated = true) => {
    const { content, view, chips } = sizes.current;
    const chip = chips[activeTabId];
    if (!scrollRef.current || !chip || !content || !view) { return; }
    const x = Math.min(Math.max(0, chip.x + chip.width / 2 - view / 2), Math.max(0, content - view));
    scrollRef.current.scrollTo({ x, animated });
  };
  useEffect(() => { showActive(); }, [activeIndex, activeTabId, isHeb]);

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
        onLayout={e => { sizes.current.view = e.nativeEvent.layout.width; showActive(false); }}
        onContentSizeChange={w => { sizes.current.content = w; showActive(false); }}
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
            onLayout={e => {
              const { x, width } = e.nativeEvent.layout;
              sizes.current.chips[tab.id] = { x, width };
              if (tab.id === activeTabId) { showActive(false); }
            }}
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
  // the title has its own width cap, so the chip never squeezes the ×
  chip: {
    flexDirection: 'row', alignItems: 'center', height: 28, marginHorizontal: 2,
    paddingLeft: 8, paddingRight: 4, borderRadius: 6, borderWidth: 1,
  },
  chipActive: { borderWidth: 1.5 },
  chipText: { fontSize: 13, maxWidth: 130, flexShrink: 1, marginHorizontal: 2 },
  heText: { writingDirection: 'rtl', fontSize: 15 },
  // a pinned tab: the gold bar is its top edge (square corners there), in place of the top border
  chipPinned: { borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  pinBar: { position: 'absolute', top: 0, left: -2, right: -2, height: 3, backgroundColor: BRAND_GOLD },
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
