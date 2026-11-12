import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import {
  View,
  FlatList,
  TouchableOpacity,
  Text,
  Platform,
  useWindowDimensions,
} from 'react-native';
import ActionSheet from 'react-native-action-sheet';

import {
  openActionSheet,
  openLinkActionSheet,
  SYSTEM_FONTS,
} from './Misc.js';
import { GlobalStateContext, getTheme, commentaryFontSize } from './StateManager';
import { boldDibbur, isCommentaryBook, isCommentaryCategory } from './reader/dibbur';
import { commentaryTitles } from './extras/links';
import { RenderHTML } from 'react-native-render-html';
import strings from './LocalizedStrings';
import styles, { SCROLL_PADDING_BOTTOM_FRACTION, makeScrollViewLayoutHandler } from './Styles.js';
import { useHTMLViewStyles } from './useHTMLViewStyles';


/*
 * The placeholder rows shown while a link's text loads, when the fetch failed, and when the
 * source turned out to be empty.
 *
 * These are functions rather than constants on purpose. `strings.common.loading` resolves to
 * whatever language is active at the moment it is read, and the interface language can change
 * while the app is running (SettingsPage dispatches setInterfaceLanguage, which calls
 * strings.setLanguage). Read once at import time, all three would stay stuck in the language
 * the app happened to start in.
 */
const defaultLinkContent = () => ({en: strings.common.loading, he: "", sectionRef: ""});
const noContentLinkContent = () => ({en: strings.errors.no_content, he: "", sectionRef: ""});
const errorLinkContent = () => ({en: strings.errors.failed_to_load_text, he: "", sectionRef: ""});

/**
 * Which sources of the panel's list to ask for again after the list's contents changed: those that
 * just went back to "not loaded" (or all of a list emptied anew), of the ones on screen - or, before
 * the list has said what is on screen, of all of them. Positions that were already waiting are not
 * asked for twice.
 */
export const reloadPositions = (prevContents, contents, visiblePositions) => {
  if (!Array.isArray(contents) || !contents.length) { return []; }
  const prev = Array.isArray(prevContents) ? prevContents : [];
  const allEmptiedAnew = contents.every(c => c === null) && prev !== contents;
  const wantsLoad = pos => contents[pos] === null && (allEmptiedAnew || (prev[pos] != null));
  const candidates = (visiblePositions && visiblePositions.length) ? visiblePositions : contents.map((c, i) => i);
  return [...new Set(candidates)].filter(pos => pos >= 0 && pos < contents.length && wantsLoad(pos));
};

class TextList extends React.Component {
  static whyDidYouRender = true;
  static propTypes = {
    recentFilters:   PropTypes.array.isRequired,
    filterIndex:     PropTypes.number,
    listContents:    PropTypes.array,
    openRef:         PropTypes.func.isRequired,
    // a source tapped: "Open here" / "Open in new tab" / "Show underneath" (ConnectionsPanel.js)
    openRefHere:     PropTypes.func,
    openRefInNewTab: PropTypes.func,
    showInline:      PropTypes.func,
    inlineCommentary: PropTypes.string,
    inlineKeyFor:    PropTypes.func,
    loadContent:     PropTypes.func.isRequired,
    textLanguage:    PropTypes.oneOf(['english', 'bilingual', 'hebrew']).isRequired,
    themeStr:        PropTypes.string.isRequired,
    fontSize:        PropTypes.number.isRequired,
  };
  static contextType = GlobalStateContext;

  constructor(props) {
    super(props);
    const dataSource = this.generateDataSource(props);
    this._savedHistorySegments = new Set();
    this._visibleSegments = [];
    this.state = {
      dataSource,
      updateScrollPosKey: true,
      // Height of the list's own viewport, measured via onLayout. Used to size the
      // bottom padding relative to the ConnectionsPanel rather than the full window.
      scrollViewHeight: 0,
    };
    this._onScrollViewLayout = makeScrollViewLayoutHandler(this);
  }


  componentDidUpdate(prevProps, prevState) {
    if (this.props.segmentRef !== prevProps.segmentRef ||
        this.props.recentFilters !== prevProps.recentFilters ||
        this.props.connectionsMode !== prevProps.connectionsMode ||
        this.props.filterIndex !== prevProps.filterIndex ||
        this.props.listContents !== prevProps.listContents) {
      let updateScrollPosKey = this.state.updateScrollPosKey;
      if (this.props.segmentRef !== prevProps.segmentRef) {
        // changed segments
        updateScrollPosKey = !this.state.updateScrollPosKey;
        this._visibleSegments = [];
        this._savedHistorySegments = new Set();
      }
      this.setState({dataSource: this.generateDataSource(this.props), updateScrollPosKey});
    }
    if (this.props.filterIndex !== prevProps.filterIndex) {
      const curFilter = this.props.recentFilters[this.props.filterIndex]
      curFilter.refList.forEach((ref, i) => {
        this.props.loadContent(ref, i)
      })
    } else if (this.props.listContents !== prevProps.listContents &&
               this.props.segmentRef === prevProps.segmentRef) {
      // The same list emptied again (its links arrived once more, e.g. after Back brought the panel
      // back): the sources on screen do not change, so onViewableItemsChanged never asks for them
      // and they said "Loading..." for good. Ask for them here. (A new segment remounts the list.)
      const filter = this.props.recentFilters[this.props.filterIndex];
      const prevFilter = prevProps.recentFilters && prevProps.recentFilters[prevProps.filterIndex];
      const sameSources = !!filter && !!prevFilter && this.props.connectionsMode === prevProps.connectionsMode &&
        filter.refList.length === prevFilter.refList.length && filter.refList.every((r, i) => r === prevFilter.refList[i]);
      // (another list - a new filter - is new rows: the FlatList asks for those itself)
      if (!sameSources) { return; }
      for (const pos of reloadPositions(prevProps.listContents, this.props.listContents, this._visibleSegments.map(s => s.item.pos))) {
        if (filter && filter.refList[pos] !== undefined) {
          this.props.loadContent(filter.refList[pos], pos, filter.versionTitle, filter.versionLanguage);
        }
      }
    }
  }

  generateDataSource = (props) => {
    const filter = props.recentFilters[props.filterIndex];
    if (!filter) {
      return [];
    }
    const displayRef = filter.displayRef();
    return filter.refList.map((ref, index) => {
      const key = filter.listKey(index);
      const loading = props.listContents[index] === null;
      return {
        key,
        ref,
        heRef: filter.heRefList[index],
        //changeString: [ref, loading, props.fontSize, props.textLanguage].join("|"),
        versionTitle: filter.versionTitle,
        versionLanguage: filter.versionLanguage,
        pos: index,
        displayRef,
        category: filter.category,
        content: props.listContents[index],
      };
    });
  };

  renderItem = ({ item }) => {
    const loading = item.content == null;  // == b/c seems content is sometimes undefined
    const noContent = !loading && item.content.he.length === 0 && item.content.en.length === 0;
    const linkContentObj = loading ? defaultLinkContent() : (item.content.error ? errorLinkContent() : (noContent ? noContentLinkContent() : item.content));
    const visibleSeg = this._visibleSegments.find(seg => seg.item.ref === item.ref);
    if (!!visibleSeg && !loading) {
      visibleSeg.loaded = !loading;
      Sefaria.history.saveHistoryItem(this.getHistoryObject.bind(this, visibleSeg), true, this.onHistorySave);
    }
    return (
      <ListItem
        openRef={this.props.openRef}
        openRefHere={this.props.openRefHere}
        openRefInNewTab={this.props.openRefInNewTab}
        showInline={this.props.showInline}
        inlineCommentary={this.props.inlineCommentary}
        inlineKeyFor={this.props.inlineKeyFor}
        refStr={item.ref}
        heRefStr={item.heRef}
        category={item.category}
        versionTitle={item.versionTitle}
        versionLanguage={item.versionLanguage}
        linkContentObj={linkContentObj}
        loading={loading}
        displayRef={item.displayRef}
      />
    );
  };

  onViewableItemsChanged = ({viewableItems, changed}) => {
    for (let vItem of viewableItems) {
      const { item } = vItem;
      if (item.content === null) {
        this.props.loadContent(item.ref, item.pos, item.versionTitle, item.versionLanguage);
      }
    }
    for (let cItem of changed) {
      const ind = this._visibleSegments.findIndex(i => cItem.item.ref === i.item.ref);
      if (!cItem.isViewable) {
        if (ind !== -1) { this._visibleSegments.splice(ind, 1); }
        continue;
      }
      const loaded = cItem.item.content !== null;
      let visibleSeg = this._visibleSegments[ind];
      if (!visibleSeg) {
        visibleSeg = { item: cItem.item, loaded };
        this._visibleSegments.push(visibleSeg);
      } else {
        visibleSeg.loaded = loaded;
      }
      if (loaded) {
        Sefaria.history.saveHistoryItem(this.getHistoryObject.bind(this, visibleSeg), true, this.onHistorySave);
      }
    }
  };

  getHistoryObject = visibleSeg => {
    const { item, loaded } = visibleSeg;
    const { readingHistory } = this.context;
    if (!readingHistory || !loaded) { return {}; }
    if (this._savedHistorySegments.has(item.ref)) { return {}; }
    if (!this._visibleSegments.find(seg => seg.item.ref === item.ref)) { return {}; }
    return {
      book: Sefaria.textTitleForRef(item.ref),
      ref: item.ref,
      he_ref: item.heRef,
      versions: { [item.versionLanguage]: item.versionTitle },
      language: this.props.textLanguage,
      secondary: true,
    };
  };

  onHistorySave = history_item => {
    this._savedHistorySegments.add(history_item.ref);
  };

  render() {
    return (
      <FlatList
        key={this.state.updateScrollPosKey}
        style={styles.scrollViewPaddingInOrderToScroll}
        data={this.state.dataSource}
        extraData={`${this.props.fontSize}|${this.props.themeStr}|${this.context && this.context.commentaryFontScale}|${this.props.inlineCommentary}`}
        renderItem={this.renderItem}
        contentContainerStyle={[{justifyContent: "center"}, { paddingBottom: this.state.scrollViewHeight * SCROLL_PADDING_BOTTOM_FRACTION }]}
        onLayout={this._onScrollViewLayout}
        onViewableItemsChanged={this.onViewableItemsChanged}
        ListEmptyComponent={
          <View style={styles.noLinks}>
            <EmptyListMessage />
          </View>
        }
      />
    );
  }
}

const EmptyListMessage = () => (
  <GlobalStateContext.Consumer>
    {({ themeStr }) => (
      <Text
        style={[styles.emptyLinksMessage, getTheme(themeStr).secondaryText]}
      >
        {strings.connections.no_connections_message}
      </Text>
    )}
  </GlobalStateContext.Consumer>
);


/** Is a source in the panel a commentary's comment (its dibbur hamaschil made bold: reader/dibbur.js)? */
export const isCommentaryItem = (category, refStr) => isCommentaryCategory(category)
  || isCommentaryBook(Sefaria.textTitleForRef(refStr), commentaryTitles());

const ListItem = ({
  openRef,
  openRefHere,
  openRefInNewTab,
  showInline,
  inlineCommentary,
  inlineKeyFor,
  refStr,
  heRefStr,
  versionTitle,
  category,
  versionLanguage,
  linkContentObj,
  loading,
  displayRef,
}) => {
  const { themeStr, fontSize: readerFontSize, commentaryFontScale, interfaceLanguage, textLanguage } = useContext(GlobalStateContext);
  // (the commentary's own text size: the Aa menu's "Commentary Size")
  const fontSize = commentaryFontSize(readerFontSize, commentaryFontScale);
  const theme = getTheme(themeStr);
  const { width } = useWindowDimensions();
  const lco = linkContentObj;
  const lang = Sefaria.util.getTextLanguageWithContent(textLanguage,lco.en,lco.he);
  const bilingual = lang === 'bilingual';
  const { classesStyles:enClasses, textStyle:enStyle, tagsStyles:enTags } = useHTMLViewStyles(bilingual, 'english', fontSize);
  const { classesStyles:heClasses, textStyle:heStyle, tagsStyles:heTags } = useHTMLViewStyles(bilingual, 'hebrew', fontSize);

  const versions = (versionLanguage) ? {[versionLanguage]: versionTitle} : null;
  // a translation (the versions list) is opened as before; a connection offers three ways to read it
  const asLink = !versions && !!openRefHere;
  const onPress = asLink ? () => openLinkActionSheet({
    refStr, heRefStr, interfaceLanguage,
    openHere: () => openRefHere(refStr),
    openInNewTab: openRefInNewTab ? () => openRefInNewTab(refStr) : null,
    showUnderneath: showInline ? () => showInline(refStr) : null,
    shownUnderneath: !!showInline && !!inlineCommentary && !!inlineKeyFor && inlineKeyFor(refStr) === inlineCommentary,
  }) : () => openActionSheet(refStr, versions, openRef, interfaceLanguage, heRefStr, category);
  // (a long press: straight to a new tab, what a tap did before)
  const onLongPress = asLink && openRefInNewTab ? () => openRefInNewTab(refStr) : undefined;
  let textViews = [];
  // a commentary's comment: its dibbur hamaschil in bold, as SoferBooks prints it (reader/dibbur.js)
  const heHtml = !loading && isCommentaryItem(category, refStr) ? boldDibbur(lco.he) : lco.he;
  const he = Sefaria.util.getDisplayableHTML(heHtml, "hebrew");
  const en = Sefaria.util.getDisplayableHTML(lco.en, "english");
  const lineHeightMultiplierHe = Platform.OS === 'android' ? 1.3 : 1.2;
  const smallEnSheet = {
    small: {
      fontSize: fontSize * 0.8 * 0.8
    }
  };
  const smallHeSheet = {
    small: {
      fontSize: fontSize * 0.8
    }
  };

  const hebrewElem = (
    <RenderHTML
      key={"he"}
      source={{html: he}}
      contentWidth={width}
      defaultTextProps={heStyle}
      classesStyles={heClasses}
      tagsStyles={heTags}
      systemFonts={SYSTEM_FONTS}
    />
  );
  const englishElem = (
    <RenderHTML
      key={"en"}
      source={{html: en}}
      contentWidth={width}
      defaultTextProps={enStyle}
      classesStyles={enClasses}
      tagsStyles={enTags}
      systemFonts={SYSTEM_FONTS}
    />
  );

  if (lang == "bilingual") {
    textViews = [hebrewElem, englishElem];
  } else if (lang == "hebrew") {
    textViews = [hebrewElem];
  } else if (lang == "english") {
    textViews = [englishElem];
  }
  const isHeb = Sefaria.util.get_menu_language(interfaceLanguage, textLanguage) == "hebrew";
  const refTitleStyle = isHeb ? styles.he : styles.en;
  const tempRefStr = isHeb ? heRefStr : refStr;
  return (
    <TouchableOpacity style={[styles.textListItem, theme.searchTextResult]} onPress={onPress} onLongPress={onLongPress} delayPressIn={200}>
      {displayRef ? null : <Text style={[refTitleStyle, styles.textListCitation, theme.textListCitation]}>{tempRefStr}</Text>}
      {textViews}
    </TouchableOpacity>
  );
}
ListItem.propTypes = {
  openRef:           PropTypes.func.isRequired,
  openRefHere:       PropTypes.func,
  openRefInNewTab:   PropTypes.func,
  showInline:        PropTypes.func,
  inlineCommentary:  PropTypes.string,
  inlineKeyFor:      PropTypes.func,
  refStr:            PropTypes.string,
  heRefStr:          PropTypes.string,
  versionTitle:      PropTypes.string,
  category:          PropTypes.string,
  versionLanguage:   PropTypes.oneOf(["en", "he"]),
  linkContentObj:    PropTypes.object, /* of the form {en,he} */
  loading:           PropTypes.bool,
  displayRef:        PropTypes.bool
};

export default TextList;
