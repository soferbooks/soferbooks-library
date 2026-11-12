'use strict';

import React from 'react';
import PropTypes from 'prop-types';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import TextColumn from '../TextColumn';
import { LoadingView } from '../Misc';
import strings from '../LocalizedStrings';
import Sefaria from '../sefaria';
import { tabResumeRef } from '../tabs/tabState';
import { tabLabel } from '../tabs/ReaderTabBar';
import { ownReadingEditions, readingEditions, sameEditions } from './editionNotes';

const noop = () => {};
const emptyText = () => '';

/**
 * Tablet split view: a second, simple reader showing another open tab beside the main one.
 * It loads its own text (same loader as the reader) and reuses TextColumn for display and
 * infinite scroll. Tapping a segment here makes this tab the main one (with the panel etc.).
 */
class SplitTabPane extends React.Component {
  static propTypes = {
    tab:               PropTypes.object,        // tab to show (null: nothing to show)
    otherTabs:         PropTypes.array.isRequired,  // tabs that could be shown here
    theme:             PropTypes.object.isRequired,
    themeStr:          PropTypes.string.isRequired,
    fontSize:          PropTypes.number.isRequired,
    textLanguage:      PropTypes.string.isRequired,
    interfaceLanguage: PropTypes.string.isRequired,
    biLayout:          PropTypes.string.isRequired,
    showAliyot:        PropTypes.bool.isRequired,
    hasInternet:       PropTypes.bool,
    onPickTab:         PropTypes.func.isRequired,   // (tabId) show another tab here
    onFocusTab:        PropTypes.func.isRequired,   // (tabId) make this tab the main one
    onPlaceChange:     PropTypes.func.isRequired,   // (tabId, place)
    showToast:         PropTypes.func.isRequired,
    handleOpenURL:     PropTypes.func.isRequired,
    textUnavailableAlert: PropTypes.func.isRequired,
  };

  state = { loadedTabId: null, data: null };

  componentDidMount() { this.load(); }

  componentDidUpdate(prevProps) {
    if ((this.props.tab && this.props.tab.id) !== (prevProps.tab && prevProps.tab.id)) { this.load(); }
  }

  componentWillUnmount() { this._unmounted = true; }

  load = () => {
    const { tab, hasInternet } = this.props;
    if (!tab) { this.setState({ loadedTabId: null, data: null }); return; }
    const token = this._token = (this._token || 0) + 1;
    this.setState({ loadedTabId: tab.id, data: null });
    Sefaria.offlineOnline.loadText(tabResumeRef(tab), true, tab.versions || null, !hasInternet, true)
      .then(({ textContent }) => {
        if (this._unmounted || token !== this._token) { return; }
        // the editions being read: a section shown from another edition says so (editionNotes.js)
        const selected = tab.versions || null;
        readingEditions({ sectionRef: textContent.sectionRef, selected, prev: textContent.prev, next: textContent.next })
          .then(reading => {
            if (this._unmounted || token !== this._token || sameEditions(reading, this.state.readingEditions)) { return; }
            this.setState({ readingEditions: reading });
          }).catch(() => {});
        this.setState({
          readingEditions: ownReadingEditions({ sectionRef: textContent.sectionRef, selected }).reading,
          data: [textContent.content],
          sectionArray: [textContent.sectionRef],
          sectionHeArray: [textContent.heSectionRef || textContent.heRef],
          textTitle: textContent.indexTitle,
          heTitle: textContent.heTitle,
          textReference: textContent.sectionRef,
          heRef: textContent.heSectionRef || textContent.heRef,
          next: textContent.next,
          prev: textContent.prev,
          offsetRef: !textContent.isSectionLevel ? textContent.requestedRef : null,
          segmentRef: null,
          segmentIndexRef: -1,
          columnKey: `${tab.id}|${token}`,
        });
      })
      .catch(() => { if (!this._unmounted && token === this._token) { this.setState({ data: [] }); } });
  };

  updateData = direction => {
    const ref = direction === 'next' ? this.state.next : this.state.prev;
    const busyKey = direction === 'next' ? 'loadingTextTail' : 'loadingTextHead';
    if (!ref || this.state[busyKey]) { return; }
    const token = this._token;
    this.setState({ [busyKey]: true });
    Sefaria.offlineOnline.loadText(ref, true, (this.props.tab && this.props.tab.versions) || null, !this.props.hasInternet, true)
      .then(({ textContent }) => {
        if (this._unmounted || token !== this._token) { return; }
        this.setState(prev => (direction === 'next' ? {
          data: [...prev.data, textContent.content],
          sectionArray: [...prev.sectionArray, textContent.sectionRef],
          sectionHeArray: [...prev.sectionHeArray, textContent.heSectionRef || textContent.heRef],
          next: textContent.next,
          loadingTextTail: false,
        } : {
          data: [textContent.content, ...prev.data],
          sectionArray: [textContent.sectionRef, ...prev.sectionArray],
          sectionHeArray: [textContent.heSectionRef || textContent.heRef, ...prev.sectionHeArray],
          prev: textContent.prev,
          loadingTextHead: false,
        }));
      })
      .catch(() => this.setState({ [busyKey]: false }));
  };

  updateTitle = (ref, heRef) => {
    this.setState({ textReference: ref, heRef });
    this.reportPlace({ ref, heRef });
  };

  textSegmentPressed = (section, segment, segmentRef, shouldToggle) => {
    if (shouldToggle) {
      this.props.onFocusTab(this.props.tab.id, segmentRef);
      return;
    }
    this.setState({ segmentRef, segmentIndexRef: segment });
    this.reportPlace({ segmentRef });
  };

  reportPlace = patch => {
    const { tab } = this.props;
    if (!tab) { return; }
    this.props.onPlaceChange(tab.id, {
      title: this.state.textTitle || tab.title,
      heTitle: this.state.heTitle || tab.heTitle,
      ref: this.state.textReference || tab.ref,
      heRef: this.state.heRef || tab.heRef,
      segmentRef: this.state.segmentRef || tab.segmentRef,
      ...patch,
    });
  };

  renderHeader() {
    const { tab, otherTabs, theme, interfaceLanguage, onPickTab } = this.props;
    const isHeb = interfaceLanguage === 'hebrew';
    return (
      <View style={[localStyles.header, theme.header, isHeb ? localStyles.rtl : null]}>
        <Text numberOfLines={1} style={[localStyles.title, theme.text]}>{tabLabel(tab, isHeb, { passage: true })}</Text>
        {otherTabs.length > 1 ? (
          <TouchableOpacity onPress={() => onPickTab(null)} style={localStyles.button} accessibilityLabel={strings.tabs.split_next_tab}>
            <Text style={[localStyles.buttonText, theme.tertiaryText]}>{'⇆'}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => this.props.onFocusTab(tab.id)} style={localStyles.button}>
          <Text style={[localStyles.buttonText, theme.tertiaryText]}>{strings.tabs.make_main}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  render() {
    const { tab, theme } = this.props;
    if (!tab) {
      return (
        <View style={[localStyles.pane, localStyles.empty, theme.mainTextPanel, theme.lighterGreyBorder]}>
          <Text style={[localStyles.emptyText, theme.secondaryText]}>{strings.tabs.split_empty}</Text>
        </View>
      );
    }
    const { data } = this.state;
    return (
      <View style={[localStyles.pane, theme.mainTextPanel, theme.lighterGreyBorder]}>
        {this.renderHeader()}
        {!data ? <LoadingView /> : (data.length === 0 ? null : (
          <TextColumn
            key={this.state.columnKey}
            interfaceLanguage={this.props.interfaceLanguage}
            textLanguage={this.props.textLanguage}
            showAliyot={this.props.showAliyot}
            theme={theme}
            themeStr={this.props.themeStr}
            fontSize={this.props.fontSize}
            isSheet={false}
            biLayout={this.props.biLayout}
            showToast={this.props.showToast}
            textToc={null}
            data={data}
            relatedBySectionRef={{}}
            textReference={this.state.textReference}
            sectionArray={this.state.sectionArray}
            sectionHeArray={this.state.sectionHeArray}
            offsetRef={this.state.offsetRef}
            segmentRef={this.state.segmentRef || ''}
            segmentIndexRef={this.state.segmentIndexRef}
            textFlow={'segmented'}
            updateData={this.updateData}
            updateTitle={this.updateTitle}
            textTitle={this.state.textTitle}
            heTitle={this.state.heTitle}
            heRef={this.state.heRef}
            textSegmentPressed={this.textSegmentPressed}
            textListVisible={false}
            next={this.state.next}
            prev={this.state.prev}
            linksLoaded={[]}
            loadingTextTail={!!this.state.loadingTextTail}
            loadingTextHead={!!this.state.loadingTextHead}
            handleOpenURL={this.props.handleOpenURL}
            textUnavailableAlert={this.props.textUnavailableAlert}
            setDictionaryLookup={noop}
            shareCurrentSegment={noop}
            getDisplayedText={emptyText}
            readingEditions={this.state.readingEditions}
            vowelToggleAvailable={Sefaria.vowelToggleAvailability(data[0])}
            highlightedWordID={null}
            highlightedWordSegmentRef={null}
            setHighlightedWord={noop}
          />
        ))}
      </View>
    );
  }
}

const localStyles = StyleSheet.create({
  pane: { flex: 1, borderLeftWidth: 1 },
  rtl: { flexDirection: 'row-reverse' },
  header: { height: 40, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1 },
  title: { flex: 1, fontSize: 15 },
  button: { paddingHorizontal: 8, paddingVertical: 4 },
  buttonText: { fontSize: 14 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { textAlign: 'center', fontSize: 15 },
});

export default SplitTabPane;
