'use strict';

import PropTypes from 'prop-types';

import React from 'react';
import {
  Animated,
  Alert,
  LayoutAnimation,
  Dimensions,
  View,
  StatusBar,
  Platform,
  BackHandler,
  UIManager,
  Linking,
  Share,
} from 'react-native';
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from '@react-native-async-storage/async-storage';
//import --- from 'react-native-gesture-handler';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import BootSplash from "react-native-bootsplash";
import nextFrame from 'next-frame';
import RNShake from 'react-native-shake';
import SoundPlayer from 'react-native-sound-player'
import { SearchState } from '@sefaria/search';
import { STATE_ACTIONS } from './StateManager';
import ReaderAppContext from './context';
import ReaderControls from './ReaderControls';
import styles from './Styles';
import strings, { isolate } from './LocalizedStrings';
import Sefaria from './sefaria';
import { LinkFilter, VersionFilter } from './Filter';
import ReaderDisplayOptionsMenu from './ReaderDisplayOptionsMenu';
import {TextsPage} from "./TextsPage";
import {LearningSchedulesPage} from "./learningSchedules/LearningSchedules";
import ReaderTextTableOfContents from './ReaderTextTableOfContents';
import SearchPage from './search/SearchPage';
import AutocompletePage from './search/AutocompletePage';
import TextColumn from './TextColumn';
import ConnectionsPanel from './ConnectionsPanel';
import SettingsPage from './SettingsPage';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-root-toast';
import { TabHistory, TabMetadata } from './PageHistory';
import DeepLinkRouter from "./DeepLinkRouter.js";
import {HistorySavedPage} from "./HistorySavedPage";
import {AboutPage} from "./AboutPage";
import {
  Tracker as DownloadTracker,
} from "./DownloadControl.js"
import {
  LoadingView,
  CategoryColorLine,
  SefariaProgressBar,
  ConditionalProgressWrapper,
} from './Misc.js';
import {FooterTabBar} from "./FooterTabBar";
import {getSafeViewStyleAndStatusBarBackground} from "./getSafeViewStyles";
import {correctionEmail, versionOnScreen} from "./reportError";
import * as extras from "./extras";
import {ExtraDownloadModal} from "./ExtraDownloadProgress";
import {SOURCES} from "./sources";
import ReaderTabBar, { READER_TAB_BAR_HEIGHT } from "./tabs/ReaderTabBar";
import {
  emptyTabsState,
  openTab,
  switchTab,
  closeTab,
  closeOtherTabs,
  updateTabPlace,
  restoreArchivedTab,
  removeArchivedTab,
  clearArchivedTabs,
  restoreRecentlyClosedTab,
  removeRecentlyClosedTab,
  clearRecentlyClosedTabs,
  findTab,
  findTabForBook,
  findTabForSchedule,
  tabResumeRef,
} from "./tabs/tabState";
import { loadTabs, makeDebouncedTabSaver } from "./tabs/tabStorage";
import SplitTabPane from "./reader/SplitTabPane";
import { makeScheduleSequence, sequenceAt, currentReading, hasSequence, isBounded, boundedNeighbours, readingIndexOf, isLastReading } from "./learningSchedules/scheduleSequence";
import { chokDaySequence } from "./learningSchedules/chokDay";
import { ID as CHOK_SOURCE, TITLE as CHOK_TITLE } from "./extras/chok";
import ScheduleSequenceBar from "./learningSchedules/ScheduleSequenceBar";
import {
  getInlineCommentary,
  effectiveInlineCommentary,
  clearSessionInlineCommentary,
  setInlineCommentary,
  loadInlineCommentaryPrefs,
  saveInlineCommentaryPrefs,
  availableInlineSources,
  availableInlineConnections,
} from "./reader/inlineCommentaryPrefs";
import {
  getNakdanPrefs,
  loadNakdanPrefs,
  subscribeNakdanPrefs,
  nakdanWanted,
  shouldAskNakdan,
  sectionLacksNikud,
  setNakdanForBook,
} from "./reader/nakdanPrefs";
import { NakdanAskCard, NakdanCredit } from "./reader/NakdanNotices";
import { VOCALIZATION } from "./VocalizationEnum";
import {
  panelFlexForTouch,
  panelReleaseAction,
  loadPanelFlexPreference,
  savePanelFlexPreference,
  DEFAULT_PANEL_FLEX,
  displayMenuTop,
} from "./reader/panelLayout";

const ViewPort = Dimensions.get('window');

// Reader state kept per open tab in memory, so switching back to a tab is instant and keeps its
// exact place, open panel and filters. (Tabs that are not in memory reopen from their saved place.)
const TAB_SNAPSHOT_KEYS = [
  'offsetRef', 'segmentRef', 'segmentIndexRef', 'sectionIndexRef', 'textReference', 'textTitle', 'heTitle', 'heRef',
  'textFlow', 'data', 'sectionArray', 'sectionHeArray', 'next', 'prev', 'textToc', 'relatedBySectionRef', 'linksLoaded',
  'textListVisible', 'textListFlex', 'connectionsMode', 'filterIndex', 'linkSummary', 'linkContents',
  'linkRecentFilters', 'linkStaleRecentFilters', 'loadingLinks', 'versionRecentFilters', 'versionFilterIndex',
  'currVersionObjects', 'selectedVersions', 'versions', 'versionsApiError', 'versionStaleRecentFilters',
  'versionContents', 'dictLookup', 'highlightedWordID', 'highlightedWordSegmentRef', 'translations',
  'currentTranslations', 'segmentRefOnSheet',
];
// A change in any of these may move the active tab's place.
const TAB_PLACE_STATE_KEYS = ['menuOpen', 'loaded', 'textTitle', 'textReference', 'segmentRef', 'segmentIndexRef',
  'sectionIndexRef', 'sectionArray', 'textListVisible', 'connectionsMode', 'selectedVersions', 'offsetRef'];
// App-wide reader state that must never be rolled back by the back button (PageHistory snapshots).
// extraDownload: a book opened right after its download is saved for Back before React applies
// "the download is over", so the snapshot still has it; restoring it brought back a "Downloading"
// box with no download behind it (no progress, no Cancel, stuck).
const NON_HISTORY_STATE_KEYS = ['readerTabs', 'inlineCommentaryPrefs', 'nakdanPrefs', 'splitView', 'splitTabId', 'windowWidth',
  'textListFlexPreference', 'hasInternet', 'extraDownload'];
const SPLIT_VIEW_STORAGE_KEY = 'readerSplitView';
const SPLIT_VIEW_MIN_WIDTH = 600;  // dp: tablets and large foldables


class ReaderApp extends React.PureComponent {
  static whyDidYouRender = true;
  static propTypes = {
    theme:            PropTypes.object.isRequired,
    themeStr:         PropTypes.string.isRequired,
    biLayout:         PropTypes.string.isRequired,
    textLanguage:     PropTypes.string.isRequired,
    dispatch:         PropTypes.func.isRequired,
    showErrorBoundary:PropTypes.func.isRequired,
  };

  constructor(props, context) {
    super(props, context);
    this._initDeepLinkURL = null;  // if you init the app thru a deep link, need to make sure the URL is applied during componentDidMount()
    this.tabHistory = new TabHistory();
    this._tabSnapshots = {};  // tab id -> reader state (see TAB_SNAPSHOT_KEYS)
    this._saveTabs = makeDebouncedTabSaver();
    this._loadToken = 0;  // bumped by every text load / tab switch, so stale async loads are dropped
    this._tocFromReader = false;
    this._newTabRouteUntil = 0;
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental && UIManager.setLayoutAnimationEnabledExperimental(true);
      if (strings.getInterfaceLanguage() === 'iw-IL') {
        // there seems to be a discrepancy b/w interfaceLanguage and language for LocalizedStrings
        strings.setLanguage('he');
      }
    }
    this.state = {
        _completedInit: false,
        offsetRef: null, /* used to jump to specific ref when opening a link*/
        segmentRef: "",
        segmentIndexRef: -1,
        sectionIndexRef: 0,
        textReference: "",
        textTitle: "",
        loaded: false,
        menuOpen: "navigation",
        textFlow: "segmented",
        subMenuOpen: null, // currently only used to define subpages in search
        navigationCategories: [],
        footerTab: TabMetadata.initialTabName(),
        loadingTextTail: false,
        loadingTextHead: false,
        textListVisible: false,
        textListFlex: 0.0001,
        textListFlexPreference: DEFAULT_PANEL_FLEX,
        textListAnimating: false,
        data: null,
        linksLoaded: [],  // bool arrary corresponding to data indicating if links have been loaded, which occurs async with API
        connectionsMode: null, // null means connections summary
        filterIndex: null, /* index of filters in recentFilters */
        linkSummary: [],
        linkContents: [],
        linkRecentFilters: [],
        linkStaleRecentFilters: [], /*bool array indicating whether the corresponding filter in recentFilters is no longer synced up with the current segment*/
        loadingLinks: false,
        versionRecentFilters: [],
        versionFilterIndex: null,
        currVersionObjects: {en: null, he: null}, /* actual current versions you're reading. Full version objects. */
        selectedVersions: {en: null, he: null}, /* custom versions you've selected. not necessarily available for the current section. Just version title. */
        versions: [],
        versionsApiError: false,
        versionStaleRecentFilters: [],
        versionContents: [],
        textSearchState: new SearchState({
          type: 'text'
        }),
        searchType: 'text',
        searchQuery: '',
        sheet: null,
        sheetMeta: null,
        activeSheetNode: null,
        isNewSearch: false,
        ReaderDisplayOptionsMenuVisible: false,
        dictLookup: null,
        highlightedWordID: null,
        highlightedWordSegmentRef: null,
        translations: [],
        currentTranslations: [],
        readerTabs: emptyTabsState(),
        inlineCommentaryPrefs: {},
        nakdanPrefs: getNakdanPrefs(),
        scheduleBarHeight: 0,
        splitView: false,
        splitTabId: null,
        windowWidth: ViewPort.width,
      };
    this.NetInfoEventListener = () => {};  // calling the event listener unsubcribes, initialize to a null method

  }

  componentDidMount() {
    // add handleOpenURL listener before running initFiles so that _initDeepLinkURL will be set in time
    // the link that started the app (a sefaria.org link tapped elsewhere) counts as from outside
    Linking.getInitialURL().then(url => { this.handleOpenURLNamedParam({ url, fromOutside: true }); }).catch(err => {
        console.warn('An error occurred', err);
    });
    this.linkingSubscription = Linking.addEventListener('url', this.handleOpenURLNamedParam);
    this.initFiles();
    this.NetInfoEventListener = NetInfo.addEventListener(
      this.networkChangeListener
    );
    this.backHandlerListener = BackHandler.addEventListener('hardwareBackPress', this.manageBack);
    this.dimensionsSubscription = Dimensions.addEventListener('change', ({ window }) => {
      this.setState({ windowWidth: window.width });
    });
    this._extrasSubscription = extras.subscribe(this._onExtrasChanged);
    // nikud by computer (Dicta): its settings, shared with the Settings page
    this._nakdanSubscription = subscribeNakdanPrefs(nakdanPrefs => this.setState({ nakdanPrefs }));
    loadNakdanPrefs().catch(() => {});
    this.RNShakeSubscription = RNShake.addListener(() => {
      if (this.props.groggerActive === 'on' && Sefaria.isGettinToBePurimTime()) {
        SoundPlayer.playSoundFile('grogger', 'mp3');
        SoundPlayer.setVolume(10);
      }
    });
  }

  networkChangeListener = netState => {
    this.setState({hasInternet: netState.isConnected});
  };
  setSearchTypeState = type => {
    this.setState({searchType: type});
  };

  componentWillUnmount() {
    this.backHandlerListener.remove();
    this.NetInfoEventListener();  // calling the event listener unsubcribes
    this.linkingSubscription.remove();
    this.RNShakeSubscription.remove();
    DownloadTracker.unsubscribe('ReaderApp')
    this._extrasSubscription && this._extrasSubscription();
    this._nakdanSubscription && this._nakdanSubscription();
    this.dimensionsSubscription && this.dimensionsSubscription.remove();
    this._saveTabs.flush();
  }

  componentDidUpdate(prevProps, prevState) {
    if (this._libraryPromptPending && prevProps.contentFilter == null && this.props.contentFilter != null) {
      this.promptLibraryDownload();  // the content-filter setting has just loaded
    }
    if (this.state.readerTabs !== prevState.readerTabs) {
      this._saveTabs(this.state.readerTabs);
    }
    if (!this.state.menuOpen && this.state.loaded && !this.state.sheet &&
        (TAB_PLACE_STATE_KEYS.some(k => this.state[k] !== prevState[k]) || this.props.textLanguage !== prevProps.textLanguage)) {
      this._syncActiveTabPlace();
    }
  }

  /**
   * Saved reader preferences: open/archived tabs, "show under each passage" choices, the
   * connections panel height and split view. Never rejects.
   */
  loadReaderPrefs = async () => {
    try {
      const [readerTabs, inlineCommentaryPrefs, textListFlexPreference, splitView] = await Promise.all([
        loadTabs(),
        loadInlineCommentaryPrefs(),
        loadPanelFlexPreference(),
        AsyncStorage.getItem(SPLIT_VIEW_STORAGE_KEY).catch(() => null),
      ]);
      this.setState(prev => ({
        readerTabs: prev.readerTabs.tabs.length ? prev.readerTabs : readerTabs,
        inlineCommentaryPrefs,
        textListFlexPreference,
        splitView: splitView === 'true',
      }));
    } catch (e) {
      console.warn('Could not load reader preferences', e);
    }
  };

  promptLibraryDownload() {
    // Wait for the content-filter setting to load (undefined until then; with nothing saved it is
    // the default preset, no chooser - owner, 2026-11-11); componentDidUpdate asks again.
    if (this.props.contentFilter == null) {
      this._libraryPromptPending = true;
      return Promise.resolve();
    }
    this._libraryPromptPending = false;
    if (this._libraryPromptStarted) { return Promise.resolve(); }
    this._libraryPromptStarted = true;
    return AsyncStorage.getItem("libraryDownloadPrompted").
    then(async (prompted) => {
      prompted = JSON.parse(prompted); // todo: if (prompted) return and move the Asynctorage down
      await AsyncStorage.setItem("libraryDownloadPrompted", "true");
      if (!prompted) {
        const onDownload = () => {


          this.openMenu("settings")
        };
        // One prompt only (QA): it already says how to download later, so "Not now" just
        // closes it instead of opening a second "Using Online Library" alert.
        // (A reader who stays online reads Sefaria's books online; a book of an extra source -
        //  Otzaria ... - offers its own download when opened: extraBookAlert.)
        const showWelcomeAlert = () => {
          Alert.alert(
            strings.common.welcome,
            `${strings.download.download_library_recommended_message}\n\n${strings.download.how_to_download_library_message}`,
            [
              {text: strings.download.open_settings, onPress: onDownload},
              {text: strings.common.not_now, style: 'cancel'}
            ]
          );
        };
        showWelcomeAlert();
      }
    });
  }

  /**
   * Return initial promise on app startup
    * @returns {Promise<unknown>|*}
   */
  getInitialPromise = () => {
    // SoferBooks opens on the home page; the open tabs (and Continue Reading) are one tap away there.
    return Promise.resolve(this.openNav(false));
  }

  initFiles = () => {
    Promise.all([Sefaria.util.deleteUnzippedFiles(), this.loadReaderPrefs()])
    .then(() => Sefaria.init(this.props.dispatch)).then(() => {
        setTimeout(BootSplash.hide, 700);
        this.setState({
          loaded: true,
        });
        if (!this._initDeepLinkURL) {

          this.getInitialPromise()
          .then(Sefaria.postInitSearch)
          .then(() => { this.setState({_completedInit: true}); })  // setting this true before end of postInit. postInit takes a surprisingly long time due to download update check.
          .then(() => Sefaria.postInit(this.props.downloadNetworkSetting))
          .then(this.promptLibraryDownload.bind(this));
        } else {
          // apply deep link here to make sure it applies correctly
          // load search files before deep link incase deep link is to search
          Sefaria.postInitSearch()
          .then(() => {
            this._deepLinkRouterRef.route(this._initDeepLinkURL, this._initDeepLinkFromOutside);
          })
          .then(() => { this.setState({_completedInit: true}); })
          .then(() => Sefaria.postInit(this.props.downloadNetworkSetting))
          .then(this.promptLibraryDownload.bind(this));
        }
    })
    .catch(error => {
      console.error("error with app init", error);
      this.props.showErrorBoundary(error);
    });
  }

  manageBackMain = () => {
    return this.manageBack("main");
  };

  /**
   * Try to go back. If history is empty, open nav menu.
   */
  manageBackMainOrOpenNav = () => {
    const wentBack = this.manageBackMain();
    if (!wentBack) {
      this.openNav();
    }
  };

  modifyHistory = ({ dir, ...args }) => {
    /**
     * dir is either "back" or "forward"
     * ...args are either the arguments for TabHistory.back() or TabHistory.forward(), depending on the value of `dir`
     */
    const func = this.tabHistory[dir];
    return func({ tab: this.state.footerTab, ...args });
  };

  manageBack = type => {
    const oldState = this.modifyHistory({dir: "back", type});
    if (!!oldState) {
      this._applyPreviousState(oldState);
      return true;
    } else if (!this.state.menuOpen) {
      // reader with nothing behind it (e.g. after switching tabs): go home rather than closing the app
      this.openNav(false);
      return true;
    } else {
      // close app
      return false;
    }
  };

  _applyPreviousState = oldState => {
    oldState._completedInit = this.state._completedInit || oldState._completedInit;  // dont go back to false for this variable. can't undo completedInit!
    for (const k of NON_HISTORY_STATE_KEYS) { delete oldState[k]; }  // tabs and reader preferences are not part of "back"
    this._loadToken++;
    const isTextColumn = !oldState.menuOpen;
    if (isTextColumn) {
      // you're going back to textcolumn. make sure to jump
      oldState.textColumnKey = oldState.segmentRef;  // manually add a key to TextColumn to make sure it gets regenerated
      oldState.offsetRef = oldState.segmentRef;
      if (!!oldState.linksLoaded) {
        oldState.linksLoaded = oldState.linksLoaded.map(() => false);  // manually set linksLoaded to false because links are not stored in oldState
      }
    } else if (oldState.menuOpen === 'search') {
      this.onQueryChange('text', oldState.searchQuery, true, true, true);
    }
    this.setState(oldState, () => {
      if (isTextColumn && (!!oldState.sectionArray || !!oldState.sheet)) {
        Sefaria.history.saveHistoryItem(this.getHistoryObject, true);
        if (!oldState.sheet) {
          for (let sectionRef of oldState.sectionArray) {
            this.loadRelated(sectionRef);
          }
        }
        else { this.loadRelatedSheet(oldState.sheet); }
      }
    });
  };

  handleOpenURLNamedParam = ({ url, fromOutside=true } = {}) => {
    // needs to be named param to be compatible with Linking API
    if (url) {
      url = url.replace(/^about:\/\/\//, Sefaria.api._baseHost);
      if (this.state._completedInit) {
        this._deepLinkRouterRef.route(url, fromOutside);
      } else {
        // save URL. it will be applied when componentDidMount finishes
        this._initDeepLinkURL = url;
        this._initDeepLinkFromOutside = fromOutside;
      }
    }
  };

  handleOpenURL = (url) => {
    // unnamed parameter.
    // func used for internal routing (e.g. HTMLView and Markdown)
    this.handleOpenURLNamedParam({ url, fromOutside: false });
  };

  /** Long-press on an in-text link: route it as usual, but open the text it leads to in a new tab. */
  openURLInNewTab = (url) => {
    this._newTabRouteUntil = Date.now() + 3000;  // consumed by openRef (the router may resolve the ref asynchronously)
    this.handleOpenURL(url);
  };

  onDownloaderChange = (openSettings) => {
    if (openSettings) {
      this.openMenu("settings");
    }
    this.forceUpdate();
  };

  pendingIncrement = 1;

  showToast = (text, duration, onHidden) => {
    Toast.show(text, {duration, onHidden});
  }

  openReaderDisplayOptionsMenu = () => {
    this.setState({ReaderDisplayOptionsMenuVisible:  true}, () => {
      // wait for ref to be defined
      this._readerDisplayOptionsMenuRef && this._readerDisplayOptionsMenuRef.show();
    });
  }

  closeReaderDisplayOptionsMenu = () => {
    this._readerDisplayOptionsMenuRef && this._readerDisplayOptionsMenuRef.hide(() => {
      this.setState({ReaderDisplayOptionsMenuVisible:  false});
    });
  }

  toggleReaderDisplayOptionsMenu = () => {
    if (this.state.ReaderDisplayOptionsMenuVisible == false) {
      this.openReaderDisplayOptionsMenu();
    } else {
      this.closeReaderDisplayOptionsMenu();
    }
  };

  setTextFlow = textFlow => {
    this.setState({ textFlow });
    if (textFlow == "continuous" && this.props.textLanguage == "bilingual") {
      this.setTextLanguage("hebrew");
    }
    this.closeReaderDisplayOptionsMenu();
  };

  setBiLayout = layout => {
    this.props.dispatch({
      type: STATE_ACTIONS.setBiLayout,
      value: layout,
    });
    this.closeReaderDisplayOptionsMenu();
  };

  setTextLanguage = (textLanguage, textFlow) => {
    // try to be less dependent on state in this func because it is called in componentWillUpdate
    textFlow = textFlow || this.state.textFlow;
    
    this.props.dispatch({
      type: STATE_ACTIONS.setTextLanguage,
      value: textLanguage,
    });
    
    if (textLanguage === "bilingual" && textFlow === "continuous") {
      this.setTextFlow("segmented");
    }
    
    this.closeReaderDisplayOptionsMenu();
  };

  setTheme = themeStr => {
    this.props.dispatch({
      type: STATE_ACTIONS.setTheme,
      value: themeStr,
    });
    this.closeReaderDisplayOptionsMenu();
  };

  setAliyot = show => {
    this.props.dispatch({
      type: STATE_ACTIONS.setAliyot,
      value: show,
    })
    this.closeReaderDisplayOptionsMenu();
  }

  setVocalization = value => {
    this.props.dispatch({
      type: STATE_ACTIONS.setVocalization,
      value,
    })
    this.closeReaderDisplayOptionsMenu();
  }

  incrementFont = (increment) => {
    let x;
    if (increment == "larger") {
      x = 1.1;
    } else if (increment == "smaller") {
      x = .9;
    } else {
      x = increment;
    }
    let newFontSize = this.props.fontSize;
    newFontSize *= x;
    newFontSize = newFontSize > 60 ? 60 : newFontSize; // Max size
    newFontSize = newFontSize < 18 ? 18 : newFontSize; // Min size
    newFontSize = parseFloat(newFontSize.toFixed(2));
    this.props.dispatch({
      type: STATE_ACTIONS.setFontSize,
      value: newFontSize,
    });
  };

  getHistoryObject = () => {
    // get ref to send to /api/profile/user_history
    try {
      const {
        sheet,
        activeSheetNode,
        segmentRef,
        heSegmentRef,
        sectionIndexRef,
        sectionArray,
        sectionHeArray,
        selectedVersions,
        textListVisible,
      } = this.state;
      const { textLanguage, readingHistory } = this.props;
      if (!readingHistory) { return {}; }
      let ref, he_ref, sheet_owner, sheet_title;
      if (!!sheet) {
        ref = `Sheet ${sheet.id}${activeSheetNode && textListVisible ? `:${activeSheetNode}`: ''}`;
        sheet_owner = sheet.ownerName;
        sheet_title = sheet.title;
      } else {
        // a text opened at a passage (Shulchan Arukh OC 447:11) is remembered there while the reader
        // is still in that section, so Continue Reading says (and reopens) 447:11, not just 447
        const sectionRef = sectionArray[sectionIndexRef];
        const offsetRef = this.state.offsetRef;
        const openedAt = (typeof offsetRef === 'string' && sectionRef && offsetRef.startsWith(`${sectionRef}:`)) ? offsetRef : null;
        if (textListVisible && segmentRef) {
          ref = segmentRef;
          he_ref = heSegmentRef || Sefaria.toHeSegmentRef(sectionHeArray[sectionIndexRef], segmentRef);
        } else if (openedAt) {
          ref = openedAt;
          he_ref = Sefaria.toHeSegmentRef(sectionHeArray[sectionIndexRef], openedAt);
        } else {
          ref = sectionRef;
          he_ref = sectionHeArray[sectionIndexRef];
        }
      }
      if (!ref) {
        console.warn(new Error(`Ref is null. textListVisible: '${String(textListVisible)}'. segmentRef: '${String(segmentRef)}. sectionArray: '${String(sectionArray)}'. sectionIndexRef: '${String(sectionIndexRef)}'`));
      }
      const versions = this.removeDefaultVersions(ref, selectedVersions);
      return {
        ref,
        he_ref,
        versions,
        book: Sefaria.textTitleForRef(ref),
        language: textLanguage,
        sheet_owner,
        sheet_title,
        is_sheet: !!sheet,
      };
    } catch (e) {
      return {};
    }
  };

  textSegmentPressed = (section, segment, segmentRef, shouldToggle, onlyOpen) => {
    const isSheet = !!this.state.sheet;
    if (shouldToggle && this.state.textListVisible) {
      if (!onlyOpen) {
        this.animateTextList(this.state.textListFlex, 0.0001, 200);
        this.modifyHistory({dir: "back", type: "secondary"});
      }
      return; // Don't bother with other changes if we are simply closing the TextList
    }
    if ((isSheet && !this.state.sheet) || (!isSheet && (!this.state.data || !this.state.data[section] || !this.state.data[section][segment]))) {
      return;
    }
    
    const justOpened = shouldToggle && !this.state.textListVisible;
    const justScrolling = !shouldToggle && !this.state.textListVisible; // true when called while scrolling with text list closed
    
    if (((segment !== this.state.segmentIndexRef || section !== this.state.sectionIndexRef) && !justScrolling) || justOpened) {
      if (this.state.linksLoaded[section]) {
        this.updateLinkSummary(section, segment);
      }
      this.updateVersionCat(null, segmentRef);
    }
    
    this.setState(prevState => {
      let stateObj = {
        segmentRef,
        segmentIndexRef: segment,
        sectionIndexRef: section,
        linkStaleRecentFilters: prevState.linkRecentFilters.map(()=>true),
        versionStaleRecentFilters: prevState.versionRecentFilters.map(()=>true),
        currentTranslations: this._getTranslationForSegment(section, segment),
      };
      
      if (isSheet) {
        // sometimes the quoted segment ref is the data we care about (e.g. for lexicon lookup)
        stateObj.segmentRefOnSheet = this.state.data[section][segment].sourceRef;
      }
      
      if (shouldToggle) {
        this.modifyHistory({ dir: "forward", state: {textListVisible: prevState.textListVisible}, type: "secondary" });
        stateObj.textListVisible = !prevState.textListVisible;
        stateObj.offsetRef = null; //offsetRef is used to highlight. once you open textlist, you should remove the highlight
      }
      
      return stateObj;
    }, () => {
      if (shouldToggle) {
        // make sure textlist renders once before using layoutanimations
        nextFrame().then(() => {
          this.animateTextList(0.0001, this.state.textListFlexPreference, 200);
        });
      }
      Sefaria.history.saveHistoryItem(this.getHistoryObject, true);
    });
    
    // NOTE: This forceUpdate is potentially problematic - it forces a re-render
    // immediately after setting state, which can lead to inconsistencies
    this.forceUpdate();
  };
  /*
    isLoadingVersion - true when you are replacing an already loaded text with a specific version
  */
  loadNewText = ({ ref, versions, isLoadingVersion = false, numTries = 0 }) => {
    // Open ranged refs to their first segment (not ideal behavior, but good enough for now)
    ref = ref.indexOf("-") !== -1 ? ref.split("-")[0] : ref;

    // Clear the current state, load ref, then load text into the state.
    const loadToken = ++this._loadToken;
    return new Promise((resolve, reject) => {
      this.setState({
          loadingTextTail: false,
          loadingTextHead: false,
          loaded: false,
          data: [],
          relatedBySectionRef: {},
          textReference: ref,
          textTitle: Sefaria.textTitleForRef(ref),
          heTitle: "",
          heRef: "",
          segmentIndexRef: -1,
          sectionIndexRef: 0,
          selectedVersions: versions,
          currVersionObjects: {en: null, he: null},
          textToc: null,
      },
      () => {

        Sefaria.offlineOnline.loadText(ref, true, versions, !this.state.hasInternet, true).then(({textContent, links}) => { // Silencing the popup on failed Sefaria.api _requests and creating a new pop up if an error arises
            if (loadToken !== this._loadToken) { resolve(); return; }  // another text or tab replaced this load
            // if specific versions were requested, but no content exists for those versions, try again with default versions
            if (Sefaria.util.objectHasNonNullValues(textContent.nonExistantVersions) ||
                (textContent.content.length === 0 && !!versions)) {
              if (numTries >= 4) { //Unclear why 4 times. Maybe for low connectivity.
                console.error(`Can't find text for ref: ${ref} dispite reverting to default version. Throwing 'Return to Nav'`)
                throw "Return to Nav";
              } 
              console.info(`ReaderApp.loadNewText: Recursive call without versions (fallback to default version), nonExistantVersions: ${JSON.stringify(textContent.nonExistantVersions)}`);
              this.loadNewText({ ref, isLoadingVersion, numTries: numTries + 1 }).then(resolve);
              return;
            }
            // (a day read as one unit - Chok LeYisrael - goes from one of its readings to the next, and ends)
            const around = this._readingNeighbours(textContent.sectionRef, textContent);
            let nextState = {
              data:              [textContent.content],
              relatedBySectionRef: {[textContent.sectionRef]: {links}},
              textTitle:         textContent.indexTitle,
              next:              around.next,
              prev:              around.prev,
              heTitle:           textContent.heTitle,
              heRef:             textContent.heSectionRef || textContent.heRef,
              sectionArray:      [textContent.sectionRef],
              sectionHeArray:    [textContent.heSectionRef || textContent.heRef], // backwards compatible because offline files are missing `heSectionRef`. we specifically want heSectionRef in case you load a segment ref with context
              loaded:            true,
              offsetRef:         !textContent.isSectionLevel ? textContent.requestedRef : null,
            };
            if (!isLoadingVersion) {
              // also overwrite sidebar state
              nextState = {
                ...nextState,
                linksLoaded:       [false],
                connectionsMode:   null, //Reset link state
                filterIndex:       null,
                linkRecentFilters: [],
                versionFilterIndex: null,
                versionRecentFilters: [],
                linkSummary:       [],
                linkContents:      [],
                loadingLinks:      false,
                textListVisible:   false,
                dictLookup:        null,
              };
              Sefaria.links.reset();
            }
            this.setState(nextState, ()=>{
              // Preload Text TOC data into memory
              this.loadTextToc(textContent.indexTitle, textContent.sectionRef).then(() => {
                // dependent on versions cached from offline textToc
                this.loadSecondaryData(textContent.sectionRef);
                // dependent on nextState and currVersionObjects
                Sefaria.history.saveHistoryItem(this.getHistoryObject);
              });
            });


            resolve();
        }).catch(error => {
          console.log(`Dealing with error: ${error}. Ref: ${ref}`);
          if (error == "Return to Nav") {
            this._handleNavError(ref, versions, isLoadingVersion, numTries, resolve);
            return;
          }
          console.error('Error caught from ReaderApp.loadNewText', error);
          reject();
        });
      });
    });
  };

  loadTextToc = (title, sectionRef) => {
    return new Promise((resolve, reject) => {
      this.setState({textToc: null}, () => {
        Sefaria.offlineOnline.textToc(title).then(textToc => {
          this.setState({textToc}, () => {
            // at this point, both book and section level version info is available
            this.setCurrVersionObjects(sectionRef);
            resolve();
          });
        }).catch(error => {
          // no index anywhere (offline and not readable): still load the section's
          // translations and related texts rather than leaving them empty
          console.warn(`Could not load the index of ${title}`, error);
          resolve();
        });
      });
    });
  }

  removeDefaultVersions = (ref, versions) => {
    if (!versions) return versions;
    const cachedVersionList = Sefaria.api.getCachedVersions(ref);
    if (!cachedVersionList) return versions;
    const newVersions = {};
    for (let [lang, versionTitle] of Object.entries(versions)) {
      const versionObject = cachedVersionList.find(v => v.versionTitle === versionTitle && v.language === lang);
      if (!!versionObject && !versionObject.default) {
        newVersions[lang] = versionTitle;
      } // else you're switching to a default version. dont list this in `versions` so that it can be loaded offline (assuming you have it downloaded)
    }
    return newVersions;
  };

  setCurrVersionObjects = (sectionRef) => {
      this.setState({ currVersionObjects: {
        en: Sefaria.getCurrVersionObjectBySection(sectionRef, 'en'),
        he: Sefaria.getCurrVersionObjectBySection(sectionRef, 'he'),
      } });
  };

  loadSecondaryData = (ref) => {
    //loads secondary data every time a section is loaded
    //this data is not required for initial renderring of the section
    this.loadTranslations(ref);
    this.loadRelated(ref);
    this.loadVersions(ref);
  };
  loadTranslations = async (ref) => {
    try {
      // Careful with `hasInternet` here: it is `undefined` until NetInfo's listener first fires
      // in componentDidMount, and passing it while unset does NOT mean "offline". loadTranslations
      // declares `online=true` as a default parameter, and a default parameter applies whenever
      // the argument is `undefined` -- so an unset hasInternet reads as "online" and skips the
      // offline guard entirely. Not reachable today (NetInfo reports long before Sefaria.init
      // finishes, let alone before a section loads and prefetches its translations), but worth
      // knowing before moving this call anywhere earlier in startup.
      Sefaria.offlineOnline.loadTranslations(ref, this.state.hasInternet).then(response => {
        const sectionIndex = this._getSectionIndex(ref);
        const translations = [...this.state.translations];
        translations[sectionIndex] = response;
        this.setState({translations: translations});
      });
    } catch (error) {
      console.warn(new Error(`Translations load error: Message: ${error}`));
    }
  }
  loadRelated = async (ref, isSheet) => {
    let hadSuccess = false;
    for (let isOnline of [false, true]) {
      try {
        await this._loadRelatedOnlineAndOffline(ref, isSheet, isOnline);
        hadSuccess = true;
        // TODO check that online call is necessary even after offline call
      } catch (error) {
        console.warn(new Error(`Related load error: Message: ${error}`));
      }
    }
    if (!hadSuccess) {
      // make sure links get marked as loaded no matter what
      const iSec = this._getSectionIndex(ref, isSheet);
      let tempLinksLoaded = this.state.linksLoaded.slice(0);
      tempLinksLoaded[iSec] = 'error';
      this.setState({linksLoaded: tempLinksLoaded});
    }
  };

  loadRelatedSheet = (sheet) => {
    const sourceRefs = sheet.sources.filter(source => 'ref' in source).map(source => source.ref);
    Sefaria.util.procedural_promise_on_array(sourceRefs, async (ref, isSheet) => {
      if (!this.state.sheet || this.state.sheet.id !== sheet.id || !!this.state.menuOpen) {
        // stop loading related API for this sheet since it's no longer being viewed
        throw Sefaria.util.PROCEDURAL_PROMISE_INTERRUPT;
      }
      await this.loadRelated(ref, isSheet);
    }, [true]);
  };

  _loadRelatedOnlineAndOffline = (ref, isSheet, online=true) => {
    // isSheet is true when loading links for individual refs on a sheet
    // Ensures that links have been loaded for `ref` and stores result in `this.state.linksLoaded` array.
    // Links are not loaded yet in case you're in API mode, or you are reading a non-default version
    const iSec = this._getSectionIndex(ref, isSheet);
    if (iSec === -1) { console.log("could not find section ref in sectionArray", ref); return; }
    return Sefaria.offlineOnline.loadRelated(ref, online)
      .then(response => {
        if (ref !== this.state.sectionArray[iSec] || iSec >= this.state.data.length) {
          // this async call to load links is for a section that is no longer being viewed
          return;
        }
        if (this.state.segmentIndexRef !== -1 && this.state.sectionIndexRef !== -1) {
          this.updateLinkSummary(this.state.sectionIndexRef, this.state.segmentIndexRef);
        }
        this.setState(prevState => {
          const currSection = this.state.data[iSec];
          if (!currSection || currSection.length === 0) {
            // Some books start with an empty section (e.g. Berakhot 2a in
            // Sefaria's data); there is nothing to attach links to.
            return null;
          }
          const currSectionRef = isSheet ? this.state.sectionArray[0] : ref;
          const offset = parseInt(currSection[0]['segmentNumber']) - 1;

          let relatedObj;
          if (isSheet) {
            const sheetSegIndexes = currSection.flatMap((seg, i) =>
              seg.sourceRef === ref ? [i] : []
            );
            const partialRelatedObj = Sefaria.links.makeRelatedByIndexForSheet(response, sheetSegIndexes);
            relatedObj = {...(this.state.relatedBySectionRef[currSectionRef] || {}), ...partialRelatedObj};
          } else {
            relatedObj = Sefaria.links.postProcessRelatedResponse(response, offset, currSection.length);
          }
          Sefaria.cacheCommentatorListBySection(ref, currSection);

          // Update linksLoaded immutably
          let newLinksLoaded = prevState.linksLoaded;
          if (!newLinksLoaded[iSec]) {
            newLinksLoaded = [...newLinksLoaded];
            newLinksLoaded[iSec] = true;
          }

          return {
            relatedBySectionRef: {...this.state.relatedBySectionRef, [currSectionRef]: relatedObj},
            linksLoaded: newLinksLoaded
          };
        });
      });
  };

  _getSectionIndex = (ref, isSheet) => {
    return isSheet ? 0 : this.state.sectionArray.findIndex(secRef => secRef === ref);
  };

  loadVersions = async (ref) => {
    let versionsApiError = false;
    let versions = [];
    try {
      versions = await Sefaria.offlineOnline.loadVersions(ref);
    } catch(error) {
      versionsApiError = true;
    }
    this.setState({versions, versionsApiError});
  };

  updateData = (direction) => {
      // direction: either "next" or "prev"
      // shouldCull: bool, if True, remove either first or last section (depending on `direction`)
      if (direction === "next" && this.state.next) {
          this.updateDataNext();
      } else if (direction == "prev" && this.state.prev) {
          this.updateDataPrev();
      }
  };

  updateDataPrev = () => {
    const loadToken = this._loadToken;
    this.setState({ loadingTextHead: true });
    Sefaria.offlineOnline.loadText(this.state.prev, true, this.state.selectedVersions, !this.state.hasInternet)
      .then(({textContent}) => {
        if (loadToken !== this._loadToken) { return; }  // switched tab/text meanwhile
        this.setState(prevState => {
          const updatedData = [textContent.content, ...prevState.data];
          const newSectionArray = [textContent.sectionRef, ...prevState.sectionArray];
          const newSectionHeArray = [textContent.heRef, ...prevState.sectionHeArray];
          const newLinksLoaded = [false, ...prevState.linksLoaded];
          const newTranslations = [{versions: []}, ...prevState.translations];

          return {
            data: updatedData,
            prev: this._readingNeighbours(textContent.sectionRef, textContent).prev,
            next: prevState.next,
            sectionArray: newSectionArray,
            sectionHeArray: newSectionHeArray,
            sectionIndexRef: prevState.sectionIndexRef + 1,  // needs to be shifted
            linksLoaded: newLinksLoaded,
            translations: newTranslations,
            loaded: true,
            loadingTextHead: false,
          };
        }, () => {
          this.loadSecondaryData(textContent.sectionRef);
          this.setCurrVersionObjects(textContent.sectionRef);
        });
      })
      .catch(function(error) {
        console.log('Error caught from ReaderApp.updateDataPrev', error);
      });
  };

  updateDataNext = () => {
    const loadToken = this._loadToken;
    this.setState({ loadingTextTail: true }, () => {
      Sefaria.offlineOnline.loadText(this.state.next, true, this.state.selectedVersions, !this.state.hasInternet)
          .then(({textContent}) => {
            if (loadToken !== this._loadToken) { return; }  // switched tab/text meanwhile
            this.setState(prevState => {
              const updatedData = [...prevState.data, textContent.content];
              const newSectionArray = [...prevState.sectionArray, textContent.sectionRef];
              const newSectionHeArray = [...prevState.sectionHeArray, textContent.heRef];
              const newLinksLoaded = [...prevState.linksLoaded, false];

              return {
                data: updatedData,
                prev: prevState.prev,
                next: this._readingNeighbours(textContent.sectionRef, textContent).next,
                sectionArray: newSectionArray,
                sectionHeArray: newSectionHeArray,
                linksLoaded: newLinksLoaded,
                loaded: true,
                loadingTextTail: false
              };
            }, () => {
              this.loadSecondaryData(textContent.sectionRef);
              this.setCurrVersionObjects(textContent.sectionRef);
            });
          })
          .catch(function(error) {
            console.log('Error caught from ReaderApp.updateDataNext', error);
          });
    });
  };

  updateTitle = (ref, heRef, sectionIndexRef) => {
    this.setState(prev => {
      const next = { textReference: ref, heRef, sectionIndexRef };
      // a day read as one unit: its bar follows the reading on the screen
      const tab = findTab(prev.readerTabs, prev.readerTabs.activeTabId);
      const i = tab && isBounded(tab.schedule) ? readingIndexOf(tab.schedule, ref) : -1;
      if (i >= 0 && i !== tab.schedule.index) {
        next.readerTabs = updateTabPlace(prev.readerTabs, tab.id, { schedule: sequenceAt(tab.schedule, i) });
      }
      return next;
    }, () => {
      if (!this.state.textListVisible) {
        // otherwise saveHistoryItem is called in textListPressed
        Sefaria.history.saveHistoryItem(this.getHistoryObject, true);
      }
    });
  };

  openRefSearch = (ref, ...args) => {
    this.openRef(ref, "search", ...args);
  };

  openRefTOC = (ref, enableAliyot) => {
    this.openRef(ref, "text toc", null, false, enableAliyot);
  };

  openRefConnectionsPanel = (ref, versions, loadNewVersions=false) => {
    if (loadNewVersions && Sefaria.textTitleForRef(ref) === this.state.textTitle) {
      // choosing another translation/version of the text being read stays in this tab
      return this.openRef(ref,"text list", versions, undefined, undefined, loadNewVersions);
    }
    // a source from the panel (Gemara, a commentary's full text, ...) opens in a new tab; this tab keeps its place
    return this.openRefInNewTab(ref, versions);
  };

  /**
   * A book of an extra source (Otzaria ...) that is not downloaded: it has no online reader,
   * so say so and offer to download it (from the source's own server; it is converted on the
   * phone), then open it. Returns the alert's promise: true when the book was opened.
   */
  extraBookAlert = (title, open) => {
    const book = extras.extraBook(title);
    const sourceId = book?.via || book?.source;     // (via: Chok LeYisrael's book comes from Otzaria)
    const sourceName = (SOURCES.find(s => s.id === sourceId) || {}).name || sourceId || '';
    const heSourceName = (SOURCES.find(s => s.id === sourceId) || {}).heName || sourceName;
    const isHe = this.props.interfaceLanguage === 'hebrew';
    return new Promise(resolve => {
      const download = async () => {
        // (how far it is, and Cancel, over the reader while it downloads: ExtraDownloadModal)
        this.setState({extraDownload: {title, name: (isHe ? book?.heTitle : book?.title) || title}});
        try {
          const firstSection = await extras.downloadBook(title);
          this.setState({extraDownload: null});
          if (open) { await open(firstSection); }
          resolve(true);
        } catch (e) {
          this.setState({extraDownload: null});
          if (e instanceof extras.DownloadCancelledError) { resolve(false); return; }   // (the reader cancelled)
          const restricted = e instanceof extras.RestrictedBookError;
          Alert.alert(
            restricted ? strings.extras.not_offered_title : strings.download.download_error,
            restricted ? strings.extras.not_offered_message : strings.extras.download_failed_message,
            [{text: strings.common.ok}]);
          resolve(false);
        }
      };
      Alert.alert(
        strings.extras.not_downloaded_title,
        strings.formatString(strings.extras.not_downloaded_message,
          {title: isolate(book?.heTitle || title), source: isHe ? heSourceName : sourceName}),
        [
          {text: strings.common.cancel, style: 'cancel', onPress: () => resolve(false)},
          {text: strings.download.download, onPress: download},
        ],
        {cancelable: true, onDismiss: () => resolve(false)},
      );
    });
  };

  /**
   * An extra book was deleted (from its contents page, or with its source turned off): its tabs
   * must not keep showing it from memory. Their saved screens are dropped, and when the reader is
   * showing it, the "download to read" warning of its source comes up (Cancel leaves the reader).
   */
  _onExtrasChanged = () => {
    const gone = t => !!t && extras.needsDownload(t);
    for (const tab of this.state.readerTabs.tabs) {
      if (gone(tab.title)) { delete this._tabSnapshots[tab.id]; }
    }
    const title = this.state.textTitle;
    if (this.state.menuOpen || this.state.sheet || !gone(title)) {
      if (!gone(title)) { this._deletedExtraAlerted = null; }
      return;
    }
    if (this._deletedExtraAlerted === title) { return; }
    this._deletedExtraAlerted = title;
    const ref = this.state.segmentRef || this.state.sectionArray?.[this.state.sectionIndexRef] || title;
    this.extraBookAlert(title, first => this.openRef(Sefaria.textTitleForRef(ref) === title && ref !== title ? ref : first, 'tab', undefined, false))
      .then(opened => {
        this._deletedExtraAlerted = null;
        if (!opened && gone(this.state.textTitle) && !this.state.menuOpen) { this.openNav(false); }
      });
  };

  textUnavailableAlert = ref => {
    const extraTitle = Sefaria.textTitleForRef(ref);
    if (extras.needsDownload(extraTitle)) {
      this.extraBookAlert(extraTitle, first => this.openRef(ref === extraTitle ? first : ref, 'navigation'));
      return;
    }
    const hidden = Sefaria.shomer?.hiddenBookForRef(ref);  // content filter
    if (hidden) {
      Alert.alert(strings.filter.hidden_title,
        strings.formatString(strings.filter.hidden_message, {title: hidden.title, reason: hidden.reason}),
        [{text: strings.common.ok}]);
      return;
    }
    Alert.alert(
      strings.errors.text_unavailable,
      strings.errors.prompt_open_on_web_message,
      [
        {text: strings.common.cancel, style: 'cancel'},
        {text: strings.common.open, onPress: () => {
          this.openUri(Sefaria.refToFullUrl(ref));
        }}
      ]
    );
  };

  /*
  calledFrom parameter used for analytics and for back button
  prevScrollPos parameter used for back button
  enableAliyot - true when you click on an aliya form ReaderTextTableOfContents
  */
  openRef = (ref, calledFrom, versions, addToBackStack=true, enableAliyot=false, loadNewVersions=false) => {
    // a book of an extra source (Otzaria ...): read only once downloaded
    const extraTitle = Sefaria.textTitleForRef(ref);
    if (extras.isExtraTitle(extraTitle)) {
      if (extras.needsDownload(extraTitle)) {
        return this.extraBookAlert(extraTitle, first => this.openRef(ref === extraTitle ? first : ref,
          calledFrom, versions, addToBackStack, enableAliyot, loadNewVersions)).then(() => {});
      }
      if (ref === extraTitle && extras.firstSectionOf(extraTitle)) {
        ref = extras.firstSectionOf(extraTitle);  // (the toc names such a book by its title)
      }
    }
    if (calledFrom === 'deep link' && Date.now() < this._newTabRouteUntil) {
      this._newTabRouteUntil = 0;
      return this.openRefInNewTab(ref, versions);
    }
    if (calledFrom !== 'tab' && this._isOutsideReader()) {
      const routed = this._openRefFromOutside(ref, calledFrom, versions, addToBackStack, enableAliyot, loadNewVersions);
      if (routed) { return routed; }
    }
    return new Promise((resolve, reject) => {
      if (enableAliyot) {
        this.setAliyot(true);
      }
      const title = Sefaria.textTitleForRef(ref);
      const overwriteVersions = calledFrom !== 'search' || calledFrom !== 'deep link' ; // if called from search or deeplink, use version specified by search (or default if none specified)
      if (!title) {
        if (ref.startsWith("Sheet")) { //TODO: Load Sheet data via sheet ref
            resolve();
            return;
        }
        this.textUnavailableAlert(ref);
        resolve();
        return;
      }
      if (!versions && overwriteVersions) {
        //pull up default versions
        const historyItem = Sefaria.history.getHistoryRefForTitle(title);
        if (!!historyItem) { versions = historyItem.versions; }
      }

      // only consider selectedVersions when opening same book (so that you can open 2 non-default versions)
      const sameBook = title === this.state.textTitle;
      const selectedVersions = (sameBook && !!this.state.selectedVersions) ? this.state.selectedVersions : {};
      const newVersions = !!versions && {
        ...selectedVersions,
        ...versions,
      };

      // make sure loaded text will show the versions you selected
      let newTextLang = this.props.textLanguage;
      if (newTextLang !== 'bilingual' && loadNewVersions) {
        // if you're in bilingual, assume you want to stay in that
        if (!!newVersions['en'] && !!newVersions['he']) { newTextLang = "bilingual"; }
        else if (!!newVersions['en']) { newTextLang = "english"; }
        else if (!!newVersions['he']){ newTextLang = "hebrew"; }
        this.setTextLanguage(newTextLang, null);
      }

      if (addToBackStack) {
        if (calledFrom === 'search') {
          // only pass small state variables to forward() (eg avoid passing `results`) because cloning large variables takes too long.
          let { appliedFilters, appliedFilterAggTypes, currPage, initScrollPos } = this.state.textSearchState;
          this.state.textSearchState = new SearchState({type: 'text', appliedFilters, appliedFilterAggTypes});
        }
        this.modifyHistory({ dir: "forward", state: this.state, calledFrom });
      }

      this.setState({
        loaded: false,
        textListVisible: false,
        textReference: ref,
        sheet: null,
        sheetMeta: null,
        connectionsMode: null,
      }, () => {
          this.closeMenu(); // Don't close until these values are in state, so we know if we need to load defualt text
          this.loadNewText({ ref, versions: newVersions }).then(resolve);
      });
    })
  };

  openMenu = (menu, via, pushHistory=true) => {
    if (!!menu && !this.state.menuOpen) {
      this._saveSnapshotForActiveTab();  // leaving the reader: keep this tab's exact state for when it is reopened
    }
    if (!!menu && pushHistory) {
      if (!this.state.menuOpen && !!this.state.data) {
        // text column. remove related data
        this.state.relatedBySectionRef = {};
      }
      this.modifyHistory({ dir: "forward", state: this.state });
    }
    this.setState({menuOpen: menu});
  };

  openSubMenu = (subMenu, isBack) => {
    if (isBack) {
      this.manageBackMain();
    } else {
      this.modifyHistory({ dir: "forward", state: this.state });
      this.setState({subMenuOpen: subMenu});
    }
  };

  closeMenu = () => {
      this.clearMenuState();
      this.openMenu(null);
      if (!this.state.textReference && !this.state.sheet) {
          this.openDefaultText();
      }
  };

  openNav = (pushHistory = true) => {
      this._saveSnapshotForActiveTab();
      this.clearAllSearchFilters('text');
      this.setState({
        loaded: true,
        searchQuery: "",
        navigationCategories: [],
        textSearchState: new SearchState({type: 'text'}),
        textListVisible: false,
        connectionsMode: null,
        dictLookup: null,
      });
      this.openMenu("navigation", null, pushHistory !== false);
  };

  openUri = uri => {
    uri = encodeURI(uri);
    InAppBrowser.open(uri, {
      android: {
        toolbarColor: Sefaria.palette.colors.system,
        showTitle: true,
        addDefaultShareMenu: true,
      },
      ios: {
        preferredBarTintColor: Sefaria.palette.colors.system,
        preferredControlTintColor: Sefaria.palette.colors.system,
      }
    }).catch(error => { this.openInDefaultBrowser(uri); });
  };

  openInDefaultBrowser = uri => {
    Linking.openURL(uri).catch(error => {
      Alert.alert(
        "Failed to open URL",
        `Failed to open ${uri}. If your browser is updating, wait for it to finish and try again. Otherwise, your phone might not have a browser installed. For help, visit soferbooks.com.`,
        [
          {text: strings.common.ok}
        ]
      );
    });
  }

  setNavigationCategories = (categories) => {
    if (categories.length) {
      this.modifyHistory({ dir: "forward", state: this.state, calledFrom: "toc" });
    } else {
      // you're navigating home, make sure to delete previous toc entries in the backStack
      this.modifyHistory({ dir: "back", calledFrom: "toc" });
    }
    this.setState({navigationCategories: categories});
  };

  setInitSearchScrollPos = (type, initScrollPos) => {
    const searchState = this._getSearchState(type);
    const searchStateName = this._getSearchStateName(type);
    this.setState({
      [searchStateName]:
        searchState.update({
          initScrollPos,
        })
    });
  };

  setHighlightedWord = (wordID, segmentRef) => {
    this.setState({ highlightedWordID: wordID, highlightedWordSegmentRef: segmentRef });
  };

  openTextTocDirectly = (title) => {

    // used to open text toc witout going throught the reader
    if (extras.needsDownload(title)) {
      this.extraBookAlert(title, () => this.openTextTocDirectly(title));
      return;
    }
    if (!Sefaria.booksDict[title]) {
      this.textUnavailableAlert(title);
      return;
    }
    this._tocFromReader = false;  // choosing a chapter here opens the book in a tab, not in the current one
    this.loadTextToc(title);
    this.setState({
      textTitle: title,
      textReference: '',
      heRef: '',
    }, () => {  // openTextToc assumes that title is set correctly
      this.openTextToc();
    });
  };

  openTextToc = () => {
      this._tocFromReader = !this.state.menuOpen;
      this.openMenu("text toc");
  };

  openSearch = (type, query) => {
    this.onQueryChange(type, query,true,false,true);
    this.openMenu("search");
  };

  openAutocomplete = () => {
    this.openMenu("autocomplete");
  }

  clearMenuState = () => {
      this.setState({
          navigationCategories: [],
      });
  };

  openDefaultText = () => {
      this.openRef("Genesis 1");
  };

  setConnectionsMode = (cat) => {
    this.setState({ connectionsMode: cat });
  };

  openFilter = (filter, type) => {
      // type is either "link" or "version"
      let recentFilters, staleRecentFilters;
      switch (type) {
        case "link":
          recentFilters = this.state.linkRecentFilters;
          staleRecentFilters = this.state.linkStaleRecentFilters;
          break;
        case "version":
          recentFilters = this.state.versionRecentFilters;
          staleRecentFilters = this.state.versionStaleRecentFilters;
      }
      // copy before editing: the assignments above point at the arrays held in
      // state, so mutating them directly would be mutating state in place
      recentFilters = [...recentFilters];
      staleRecentFilters = [...staleRecentFilters];

      let filterIndex = null;
      //check if filter is already in recentFilters
      for (let i = 0; i < recentFilters.length; i++) {
          let tempFilter = recentFilters[i];
          if (tempFilter.equals(filter)) {
            filterIndex = i;
            if (staleRecentFilters[i]) {
              recentFilters[i] = filter;
              staleRecentFilters[i] = false;
            }
            break;
          }
      }

      //if it's not in recentFilters, add it
      if (filterIndex == null) {
          recentFilters.unshift(filter);
          if (recentFilters.length > 5)
            recentFilters.pop();
          filterIndex = 0;
      }

      let newState;
      switch (type) {
        case "link":
          const linkContents = filter.refList.map(ref=>null);
          Sefaria.links.reset();
          newState = {
            connectionsMode: "filter",
            filterIndex: filterIndex,
            linkRecentFilters: recentFilters,
            linkStaleRecentFilters: staleRecentFilters,
            linkContents: linkContents,
          };
          break;
        case "version":
          const versionContents = [null]; //hard-coded to one segment for now
          newState = {
            connectionsMode: "version open",
            versionFilterIndex: filterIndex,
            versionRecentFilters: recentFilters,
            versionStaleRecentFilters: staleRecentFilters,
            versionContents: versionContents,
          }
          break;
      }

      this.setState(newState);
  };

  closeLinkCat = () => {
    this.setState({connectionsMode: null, highlightedWordID: null, highlightedWordSegmentRef: null});
  };

  updateLinkSummary = (section, segment) => {
    const menuLanguage = Sefaria.util.get_menu_language(this.props.interfaceLanguage, this.props.textLanguage);
    try {
      const links = this.state.relatedBySectionRef[this.state.sectionArray[section]][segment]?.links;
      const linkSummary = Sefaria.links.linkSummary(this.state.textReference, links, menuLanguage);
      this.setState({linkSummary, loadingLinks: false});
      this.updateLinkCat(null, linkSummary); // Set up `linkContents` in their initial state as an array of nulls
    } catch (error) {
      console.warn(new Error(`Link summary error: Message: ${error}`));
      this.setState({linkSummary: [], loadingLinks: false});
      this.updateLinkCat(null, []); // Set up `linkContents` in their initial state as an array of nulls
    }
  };
  updateLinkCat = (filterIndex, linkSummary) => {
      //search for the current filter in the the links object
      if (this.state.filterIndex === filterIndex) return;
      if (this.state.filterIndex == null) return;
      if (linkSummary == null) linkSummary = this.state.linkSummary;
      if (filterIndex == null) filterIndex = this.state.filterIndex;
      const { name, heName, category, collectiveTitle, heCollectiveTitle } = this.state.linkRecentFilters[filterIndex];
      let nextRefList = [];
      let nextHeRefList = [];
      for (let cat of linkSummary) {
          if (cat.category == name) {
            nextRefList = cat.refList;
            nextHeRefList = cat.heRefList;
            break;
          }
          for (let book of cat.books) {
            if (book.title == name) {
              nextRefList = book.refList;
              nextHeRefList = book.heRefList;
              break;
            }
          }
      }
      const nextFilter = new LinkFilter(name, heName, collectiveTitle, heCollectiveTitle, nextRefList, nextHeRefList, category);

      Sefaria.links.reset();
      this.setState(prevState => {
        const newLinkRecentFilters = [...prevState.linkRecentFilters];
        newLinkRecentFilters[filterIndex] = nextFilter;
        const linkContents = nextFilter.refList.map((ref)=>null);
        
        return {
          filterIndex,
          linkRecentFilters: newLinkRecentFilters,
          linkContents,
        };
      });
  };

  loadLinkContent = (ref, pos) => {
    // Loads link content for `ref` then inserts it into `this.state.linkContents[pos]`
    let isLinkCurrent = function(ref, pos) {
      // check that we haven't loaded a different link set in the mean time
      if (typeof this.state.linkRecentFilters[this.state.filterIndex] === "undefined") { return false;}
      const refList = this.state.linkRecentFilters[this.state.filterIndex].refList;
      if (pos > refList.length) { return false; }
      return (refList[pos] === ref);
    }.bind(this);
    let resolve = (data) => {
      if (isLinkCurrent(ref, pos)) {
          this.onLinkLoad(pos, data);
      }
    };
    let reject = (error) => {
      if (error != 'inQueue') {
        if (isLinkCurrent(ref, pos)) {
            this.onLinkLoad(pos, {error: true, en: "", he: "", sectionRef: ""});
        }
      }
    };

    let resolveClosure = function(ref, pos, data) {
      resolve(data);
    }.bind(this, ref, pos);

    let rejectClosure = function(ref, pos, data) {
      reject(data);
    }.bind(this, ref, pos);

    Sefaria.links.loadLinkData(ref, pos, resolveClosure, rejectClosure).then(resolveClosure).catch(rejectClosure);
  };

  onLinkLoad = (pos, data) => {
    // truncate data if it's crazy long (e.g. Smag)
    const cutoffLen = 3500;
    if (data.en.length > cutoffLen) {
      let spaceInd = data.en.indexOf(' ', cutoffLen);
      if (spaceInd === -1) { spaceInd = cutoffLen; }
      data.en = data.en.slice(0, spaceInd) + `... <b>${strings.getString('connections.tap_to_read_more', 'en')}</b>`;
    }
    if (data.he.length > cutoffLen) {
      let spaceInd = data.he.indexOf(' ', cutoffLen);
      if (spaceInd === -1) { spaceInd = cutoffLen; }
      data.he = data.he.slice(0, spaceInd) + `... <b>${strings.getString('connections.tap_to_read_more', 'he')}</b>`;
    }
    
    this.setState(prevState => {
      const newLinkContents = [...prevState.linkContents];
      newLinkContents[pos] = data;
      return { linkContents: newLinkContents };
    });
  };

  updateVersionCat = (filterIndex, segmentRef) => {
    if (this.state.versionFilterIndex === filterIndex) return;
    if (!filterIndex && filterIndex !== 0) {
      if (this.state.versionFilterIndex == null) return;
      filterIndex = this.state.versionFilterIndex;
    }
    if (!segmentRef) { segmentRef = this.state.segmentRef; }
    
    this.setState(prevState => {
      const newVersionRecentFilters = [...prevState.versionRecentFilters];
      const prevFilter = newVersionRecentFilters[filterIndex];
      // build a new VersionFilter rather than spreading `prevFilter` into an object
      // literal, which would drop the class methods (listKey(), toString(), equals())
      newVersionRecentFilters[filterIndex] = new VersionFilter(
        prevFilter.versionTitle,
        prevFilter.versionTitleInHebrew,
        prevFilter.versionLanguage,
        segmentRef
      );
      const versionContents = [null];

      return {
        versionFilterIndex: filterIndex,
        versionRecentFilters: newVersionRecentFilters,
        versionContents,
      };
    });
  };

  loadVersionContent = (ref, pos, versionTitle, versionLanguage) => {
    Sefaria.offlineOnline.loadText(ref, false, {[versionLanguage]: versionTitle }, false).then(({result}) => {
      // only want to show versionLanguage in results
      const removeLang = versionLanguage === "he" ? "en" : "he";
      result[removeLang] = "";
      
      this.setState(prevState => {
        const newVersionContents = [...prevState.versionContents];
        newVersionContents[pos] = result;
        return { versionContents: newVersionContents };
      });
    });
  };

  clearOffsetRef = () => {
    /* used after TextList has used the offsetRef to render initially*/
    this.setState({offsetRef:null});
  };

  _getReaderBodyRef = ref => { this._readerBodyRef = ref; };

  _measureReaderBody = () => {
    // page position and height of the area shared by the text and the connections panel
    this._readerBodyRef && this._readerBodyRef.measure && this._readerBodyRef.measure((x, y, width, height, pageX, pageY) => {
      if (height > 0) { this._readerBodyLayout = { top: pageY, height }; }
    });
  };

  _panelFlexForTouch = (pageY, grabOffset = 0) => {
    const layout = this._readerBodyLayout || { top: 75, height: ViewPort.height - 75 };
    return panelFlexForTouch(pageY, layout.top, layout.height, grabOffset);
  };

  onTextListDragStart = (evt) => {
    this._measureReaderBody();
    const flex = this._panelFlexForTouch(evt.nativeEvent.pageY);
    // Save an offset which represent how high inside the header the click started
    this._textListDragOffset = this.state.textListFlex - flex;
    return !this.state.textListAnimating;
  };

  onTextListDragMove = (evt) => {
    if (this.state.textListAnimating) return;
    this.setState({ textListFlex: this._panelFlexForTouch(evt.nativeEvent.pageY, this._textListDragOffset) });
  };

  onTextListAnimateFinish = () => {
    const { textListFlex } = this.state;
    const tempState = { textListAnimating: false };
    if (textListFlex < 0.001) {
      tempState.textListFlex = 0.0001;
      tempState.textListVisible = false;
    }
    this.setState(tempState);
  };

  animateTextList = (fromValue, toValue, duration) => {
    this.setState({ textListAnimating: true, textListFlex: fromValue}, () => {
      const CustomLayoutLinear = {
        duration,
        create: {
          type: LayoutAnimation.Types.linear,
          property: LayoutAnimation.Properties.opacity,
        },
        update: {
          type: LayoutAnimation.Types.linear,
        }
      }
      const isIOS = Platform.OS === 'ios';
      LayoutAnimation.configureNext(CustomLayoutLinear, isIOS ? this.onTextListAnimateFinish : undefined);
      this.setState({ textListFlex: toValue });
      if (!isIOS) {
        setTimeout(this.onTextListAnimateFinish, duration + 100);
      }
    })
  };

  onTextListDragEnd = evt => {
    if (this.state.textListAnimating) return;
    const pageY = evt && evt.nativeEvent && evt.nativeEvent.pageY;
    const flex = typeof pageY === 'number' ? this._panelFlexForTouch(pageY, this._textListDragOffset || 0) : this.state.textListFlex;
    const action = panelReleaseAction(flex);
    if (action === 'full') {
      this.animateTextList(flex, 0.9999, 200);
    } else if (action === 'close') {
      this.animateTextList(flex, 0.0001, 200);
    } else {
      // remembered (also across restarts) as the height the panel opens at
      this.setState({ textListFlexPreference: flex });
      savePanelFlexPreference(flex);
    }
  };
  _getSearchStateName = type => ( `${type}SearchState` );
  _getSearchState = type => ( this.state[this._getSearchStateName(type)] );
  _getTranslationForSegment(section, segment) {
    const translations = Sefaria.util.clone(this.state.translations[section]) || {versions: []};
    translations.versions.forEach((version) => {
      version.text = version.text[segment];
    });
    return translations;
  }
  convertSearchHit = (searchType, hit, field) => {
    const source = hit._source;
    const duplicates = hit.duplicates || [];
    return ({
        title: searchType === "sheet" ? source.title : source.ref,
        heTitle: searchType === "sheet" ? source.title : source.heRef,
        text: hit.highlight[field].join(" ... "),
        id: hit._id,
        duplicates: duplicates.map(subhit => this.convertSearchHit(searchType, subhit, field)),
        textType: hit._id.includes("[he]") ? "hebrew" : "english",
        version: source.version,
        metadata: searchType === "sheet" ? {
          ownerImageUrl: source.owner_image,
          ownerName: source.owner_name,
          views: source.views,
          tags: source.tags,
        } : null
    });
  };
  _updateAggregations = (data, type) => {
    let availableFilters = [];
    let registry = {};
    let orphans = [];
    const { appliedFilters, appliedFilterAggTypes } = this._getSearchState(type);
    const { aggregation_field_array, build_and_apply_filters } = SearchState.metadataByType[type];
    for (let aggregation of aggregation_field_array) {
      if (!!data.aggregations[aggregation]) {
        const { buckets } = data.aggregations[aggregation];
        const { availableFilters: tempAvailable, registry: tempRegistry, orphans: tempOrphans } = Sefaria.search[build_and_apply_filters](buckets, appliedFilters, appliedFilterAggTypes, aggregation, Sefaria);
        availableFilters.push(...tempAvailable);  // array concat
        registry = {...registry, ...tempRegistry};
        orphans.push(...tempOrphans);
        this.setAvailableSearchFilters(type, availableFilters, orphans);
      }
    }
  }
  onQueryChange = (type, query, resetQuery, fromBackButton, getFilters) => {
    // getFilters should be true if the query has changed or the exactType has changed
    const searchState = this._getSearchState(type);
    const searchStateName = this._getSearchStateName(type);
    const { field, fieldExact, sortType, filtersValid, appliedFilters, appliedFilterAggTypes } = searchState;
    const { aggregation_field_array, build_and_apply_filters } = SearchState.metadataByType[type];
    let newSearchPage = 0;
    let start = 0;
    let size = 20;
    if (resetQuery && !fromBackButton) {
      this.setInitSearchScrollPos(type, 0);
      Sefaria.saveRecentQuery(query, "query");
    }
    if (!resetQuery) {
      newSearchPage = searchState.currPage + 1;
      start = 20 * newSearchPage;
    }
    if (fromBackButton) {
      size = 20 * (searchState.currPage + 1);
      newSearchPage = size/20;
    }

    const justUnapplied = false; //TODO: placeholder
    const getAggregationsToUpdate = () => aggregation_field_array.filter( a => justUnapplied || a !== 'this.lastAppliedAggType[type]');
    const aggregationsToUpdate = ((filtersValid && aggregation_field_array.length === 1) || fromBackButton) ? [] : getAggregationsToUpdate(); //TODO: placeholder
    let queryProps = {
      query,
      size,
      start,
      type,
      field,
      exact: fieldExact === field,
      applied_filters: appliedFilters,
      appliedFilterAggTypes,
      aggregationsToUpdate,
      sort_type: sortType,
    };
    this.setState({
      searchQuery:query,
      [searchStateName]: searchState.update({
        currPage: newSearchPage,
        isLoading: true,
        filtersValid: !getFilters,
      }),
    }, () => {
      // for some reason `searchState` pointed to out of date object here so reset it
      const searchState = this._getSearchState(type);
      const searchStateName = this._getSearchStateName(type);
      Sefaria.search.execute_query(queryProps)
      .then(data => {
        const newResultsArray = (
            type === "sheet" ?
                data.hits.hits :
                Sefaria.search.process_text_hits(data.hits.hits)).map(hit => this.convertSearchHit(type, hit, field)
        );
        const results = resetQuery ? newResultsArray :
          searchState.results.concat(newResultsArray);
        let numResults = data.hits.total;
        this.setState({
          [searchStateName]: searchState.update({
            isLoadingTail: false,
            isLoading: false,
            results,
            numResults,
          }),
        }, () => {
          if (data.aggregations) {
            this._updateAggregations(data, type);
          } else if (getFilters) {
            [queryProps.appliedFilterAggTypes, queryProps.applied_filters, queryProps.aggregationsToUpdate] = [[], [], getAggregationsToUpdate()];
            Sefaria.search.execute_query(queryProps).then(data => {
              this._updateAggregations(data, type);
            })
          }
        });
      })
      .catch((error) => {
        //TODO: add hasError boolean to state
        console.log(error);
        this.setState({
          [searchStateName]: searchState.update({
            isLoadingTail: false,
            isLoading: false,
            filtersValid: false,
            results: [],
            numResults: 0,
            initScrollPos: 0,
          }),
        });
      });
    });
  };

  setLoadQueryTail = (type, isLoading) => {
    const searchState = this._getSearchState(type);
    const searchStateName = this._getSearchStateName(type);
    this.setState({
      [searchStateName]:
        searchState.update({
          isLoading,
        }),
    });
    if (isLoading) {
      this.onQueryChange(type, this.state.searchQuery, false);
    }
  };

  setIsNewSearch = (isNewSearch) => {
    this.setState({isNewSearch: isNewSearch});
  };

  setAvailableSearchFilters = (type, availableFilters, orphanFilters) => {
    const searchState = this._getSearchState(type);
    const searchStateName = this._getSearchStateName(type);
    this.setState({
      [searchStateName]:
        searchState.update({
          availableFilters,
          orphanFilters,
          filtersValid: true,
          //aggregationsToUpdate, TODO: placeholder
        })
    });
  };

  toggleSearchFilter = (type, filterNode) => {
    if (!filterNode) {
      return;
    }
    if (filterNode.isUnselected()) {
      filterNode.setSelected(true);
    } else {
      filterNode.setUnselected(true);
    }
    this.reapplySearchFilters(type);
  };

  clearAllSearchFilters = type => {
    const searchState = this._getSearchState(type);
    for (let filterNode of searchState.availableFilters) {
      filterNode.setUnselected(true);
    }
    this.reapplySearchFilters(type);
  };

  reapplySearchFilters = type => {
    const searchState = this._getSearchState(type);
    const searchStateName = this._getSearchStateName(type);
    this.setState({
      [searchStateName]: searchState.update(
        Sefaria.search.getAppliedSearchFilters(searchState.availableFilters)
      )
    });
  }

  setSearchOptions = (type, sortType, field, cb) => {
    const searchState = this._getSearchState(type);
    const searchStateName = this._getSearchStateName(type);
    const metaState = SearchState.metadataByType[type];
    if (!field) { field = metaState.field; }
    const filtersValid = field === searchState.field;
    this.setState({
      [searchStateName]: searchState.update({
        sortType,
        field,
        filtersValid,
      })
    }, cb);
  };

  onChangeSearchQuery = query => {
    this.setState({searchQuery: query});
  }

  setDictionaryLookup = ({ dictLookup }) => {
    this.setState({ dictLookup });
    this.setConnectionsMode('dictionary');
  }

  getDisplayedText = (withUrl, sectionIndex, segmentIndex, segmentRef) => {
    // need to be careful because sectionIndex and segmentIndex can be 0
    if (typeof sectionIndex == 'undefined') { sectionIndex = this.state.sectionIndexRef; }
    if (typeof segmentIndex == 'undefined') { segmentIndex = this.state.segmentIndexRef; }
    if (typeof segmentRef == 'undefined')   { segmentRef = this.state.segmentRef; }
    const {text, he} = this.state.data[sectionIndex][segmentIndex];
    const enText = Sefaria.util.htmlToTextCanonical(typeof text === "string" ? text : "") || "";
    const heText = Sefaria.util.applyVocalizationSettings(Sefaria.util.htmlToTextCanonical(typeof he === "string" ? he : ""), this.props.vocalization) || "";
    const isHeb = this.props.textLanguage !== "english";
    const isEng = this.props.textLanguage !== "hebrew";
    const fullText = (heText && isHeb ? heText + (enText && isEng ? "\n" : "") : "") + ((enText && isEng) ? enText : "");
    if (withUrl) {
      return `${fullText}\n\n${Sefaria.refToFullUrl(segmentRef)}`;
    }
    return fullText;
  }

  reportError = () => {
    // Sent to the corrections address of the library the text came from (reportError.js)
    const { to, subject, body } = correctionEmail({
      ref: this.state.segmentRef,
      text: this.getDisplayedText(true),
      version: versionOnScreen(this.state.currVersionObjects, this.props.textLanguage),
      platform: Platform.OS,
    });
    Sefaria.util.openComposedEmail(to, subject, body);
  };

  shareCurrentSegment = (sectionIndex, segmentIndex, segmentRef) => {
    segmentRef = segmentRef || this.state.segmentRef;
    Share.share({
      message: this.getDisplayedText(Platform.OS === 'android', sectionIndex, segmentIndex, segmentRef),  // android for some reason doesn't share text with a url attached at the bottom
      title: segmentRef,
      url: Sefaria.refToFullUrl(segmentRef)
    });
  }

  viewOnSite = () => {
    const uri = this.state.sheet ? Sefaria.sheetIdToUrl(this.state.sheet.id) : Sefaria.refToFullUrl(this.state.segmentRef);
    this.openUri(uri);
  }

  setFooterTab = tab => {
    const alreadyOnTab = tab === this.state.footerTab;
    this.tabHistory.saveCurrentState({ tab: this.state.footerTab, state: this.state });
    const newState = this.tabHistory.getCurrentState({ tab });
    if (!newState || alreadyOnTab) {
      this._openTabForFirstTime(tab);
      if (alreadyOnTab) {
        this.tabHistory.clear({ tab });
      }
    } else {
      this._applyPreviousState(newState);
    }
    this.setState({footerTab: tab});
  };

  _openTabForFirstTime = tab => {
    const newMenu = TabMetadata.menuByName(tab);
    const specialCases = {navigation: this.openNav};
    if (specialCases.hasOwnProperty(newMenu)) {
      specialCases[newMenu](false);
    } else {
      this.openMenu(newMenu, null, false);
    }
  };

  _getReaderDisplayOptionsMenuRef = ref => {
    this._readerDisplayOptionsMenuRef = ref;
  };

  _getDeepLinkRouterRef = ref => {
    this._deepLinkRouterRef = ref;
  };

  _onStartShouldSetResponderCapture = () => {
    if (this.state.ReaderDisplayOptionsMenuVisible === true) {
       this.toggleReaderDisplayOptionsMenu();
       return true;
    }
  };

  shouldShowFooter = menuOpen => {
    const menuBlacklist = [null, 'text toc'];
    return menuBlacklist.indexOf(menuOpen) === -1;
  };

  /* ======================= Reader tabs ======================= */

  _isOutsideReader = () => !!this.state.menuOpen && !(this.state.menuOpen === 'text toc' && this._tocFromReader);

  /** Keep the in-memory reader state of the active tab (see TAB_SNAPSHOT_KEYS). */
  _saveSnapshotForActiveTab = () => {
    const id = this.state.readerTabs.activeTabId;
    if (!id || this.state.menuOpen || !this.state.loaded || !this.state.data || this.state.sheet) { return; }
    const tab = findTab(this.state.readerTabs, id);
    if (!tab || tab.title !== this.state.textTitle) { return; }
    const snapshot = {};
    for (const k of TAB_SNAPSHOT_KEYS) { snapshot[k] = this.state[k]; }
    this._tabSnapshots[id] = snapshot;
  };

  /** Drop in-memory state of tabs that were closed or archived (archived tabs keep only book + place). */
  _pruneSnapshots = readerTabs => {
    const open = new Set(readerTabs.tabs.map(t => t.id));
    for (const id of Object.keys(this._tabSnapshots)) {
      if (!open.has(id)) { delete this._tabSnapshots[id]; }
    }
  };

  /** Where the reader is now, in the shape stored on a tab. */
  _currentTabPlace = () => {
    const s = this.state;
    if (!s.textTitle || !s.sectionArray || !s.sectionArray.length) { return null; }
    const sectionRef = s.sectionArray[s.sectionIndexRef] || s.textReference;
    if (!sectionRef) { return null; }
    const inThisBook = r => !!r && Sefaria.textTitleForRef(r) === s.textTitle;
    let segmentRef = null;
    if (s.segmentIndexRef !== -1 && inThisBook(s.segmentRef)) {
      segmentRef = s.segmentRef;  // top segment on screen (or the one the panel is open on)
    } else if (inThisBook(s.offsetRef)) {
      segmentRef = s.offsetRef;   // segment the text was opened at, before any scrolling
    }
    return {
      title: s.textTitle,
      heTitle: s.heTitle || null,
      ref: sectionRef,
      heRef: (s.sectionHeArray && s.sectionHeArray[s.sectionIndexRef]) || s.heRef || null,
      segmentRef,
      versions: this.removeDefaultVersions(sectionRef, s.selectedVersions) || null,
      textLanguage: this.props.textLanguage,
      textListVisible: !!s.textListVisible,
      connectionsMode: s.connectionsMode || null,
    };
  };

  /** Record the reader's place on the active tab (opening a tab first if the reader shows a text without one). */
  _syncActiveTabPlace = () => {
    const place = this._currentTabPlace();
    if (!place) { return; }
    const readerTabs = this.state.readerTabs;
    const next = readerTabs.activeTabId ? updateTabPlace(readerTabs, readerTabs.activeTabId, place) : openTab(readerTabs, place);
    if (next !== readerTabs) {
      this._pruneSnapshots(next);
      this.setState({ readerTabs: next });
    }
  };

  /**
   * Show tab `id` in the reader. With `target` ({ref, versions, loadNewVersions}) the tab is
   * navigated there; otherwise it reopens exactly where it was.
   * opts.keepHistory: keep the back stack (used when coming from a page such as home);
   * opts.baseTabs: tabs state to start from (e.g. after closing a tab); opts.skipSnapshot.
   */
  switchToTab = (id, target = null, { keepHistory = false, baseTabs = null, skipSnapshot = false } = {}) => {
    const base = baseTabs || this.state.readerTabs;
    const tab = findTab(base, id);
    if (!tab) { return Promise.resolve(); }
    const inReader = !this.state.menuOpen;
    if (inReader && !baseTabs && id === base.activeTabId && !target) { return Promise.resolve(); }  // already showing
    if (inReader && !skipSnapshot) { this._saveSnapshotForActiveTab(); }
    if (!keepHistory) { this.tabHistory.clear({ tab: this.state.footerTab }); }  // back history belonged to the other tab
    const readerTabs = switchTab(base, id);
    this._pruneSnapshots(readerTabs);
    // each tab keeps its language; applied once the tab is showing, so it is recorded on the right tab
    const applyTabLanguage = () => {
      if (tab.textLanguage && tab.textLanguage !== this.props.textLanguage) {
        this.props.dispatch({ type: STATE_ACTIONS.setTextLanguage, value: tab.textLanguage });
      }
    };
    this._loadToken++;  // ignore anything still loading for the previous tab
    // (a deleted extra book is not shown from memory: openRef below asks to download it)
    const snapshot = extras.needsDownload(tab.title) ? null : this._tabSnapshots[id];
    if (snapshot && !target) {
      Sefaria.links.reset();
      return new Promise(resolve => this.setState({
        ...snapshot,
        readerTabs,
        menuOpen: null,
        loaded: true,
        loadingTextTail: false,
        loadingTextHead: false,
        textListAnimating: false,
        ReaderDisplayOptionsMenuVisible: false,
        // TextColumn jumps to offsetRef when (re)mounted: put the tab back at its top segment
        offsetRef: (snapshot.segmentIndexRef !== -1 && snapshot.segmentRef) ? snapshot.segmentRef : snapshot.offsetRef,
        textColumnKey: `${id}|${Date.now()}`,
      }, () => { applyTabLanguage(); resolve(); }));
    }
    delete this._tabSnapshots[id];
    const ref = target ? target.ref : tabResumeRef(tab);
    const versions = (target ? target.versions : tab.versions) || undefined;
    // loaded: false until the tab's text arrives, so the previous tab's text is never recorded as this tab's place
    return new Promise(resolve => this.setState({ readerTabs, loaded: false, ReaderDisplayOptionsMenuVisible: false }, () => {
      applyTabLanguage();
      this.openRef(ref, 'tab', versions, false, false, !!(target && target.loadNewVersions)).then(() => {
        if (!Sefaria.textTitleForRef(ref)) {
          // the book is no longer available (e.g. hidden by the content filter): drop the tab
          // (not offered under "Recently closed": it could not be reopened)
          this.setState(prev => ({ readerTabs: removeRecentlyClosedTab(closeTab(prev.readerTabs, id), id) }));
          this.openNav(false);
        }
        resolve();
      }, resolve);
    }));
  };

  /**
   * openRef from a page outside the reader (home, library, search, history, calendars...):
   * a book that is already open in a tab is shown in that tab (at its place when `ref` is just the
   * book's resume point); otherwise a new tab is opened (or the book's archived tab is reopened).
   * Returns a promise when it took over, or null to let openRef continue in the (new) active tab.
   */
  _openRefFromOutside = (ref, calledFrom, versions, addToBackStack, enableAliyot, loadNewVersions) => {
    const title = Sefaria.textTitleForRef(ref);
    if (!title) { return null; }  // openRef shows the "text unavailable" alert
    let readerTabs = this.state.readerTabs;
    const existing = findTabForBook(readerTabs, title);
    if (existing) {
      const historyItem = Sefaria.history.getHistoryRefForTitle(title);
      const isResume = ref === existing.ref || ref === tabResumeRef(existing) || (!!historyItem && historyItem.ref === ref);
      if (addToBackStack) {
        if (calledFrom === 'search') {
          // as in openRef: don't clone the (large) search results into the back stack
          const { appliedFilters, appliedFilterAggTypes } = this.state.textSearchState;
          this.state.textSearchState = new SearchState({type: 'text', appliedFilters, appliedFilterAggTypes});
        }
        this.modifyHistory({ dir: "forward", state: this.state, calledFrom });
      }
      if (enableAliyot) { this.setAliyot(true); }
      return this.switchToTab(existing.id, isResume && !loadNewVersions ? null : { ref, versions, loadNewVersions }, { keepHistory: true });
    }
    const archived = readerTabs.archived.find(a => a.title === title);
    readerTabs = archived ?
      restoreArchivedTab(readerTabs, archived.id) :
      openTab(readerTabs, { title, heTitle: Sefaria.index(title)?.heTitle || null, ref, versions: versions || null });
    this._pruneSnapshots(readerTabs);
    this.setState({ readerTabs });
    return null;
  };

  /** Open `ref` in a new tab; the current tab stays exactly where it is. */
  openRefInNewTab = (ref, versions) => {
    const title = Sefaria.textTitleForRef(ref);
    if (!title) {
      this.textUnavailableAlert(ref);
      return Promise.resolve();
    }
    if (!this.state.menuOpen) { this._saveSnapshotForActiveTab(); }
    const readerTabs = openTab(this.state.readerTabs, { title, heTitle: Sefaria.index(title)?.heTitle || null, ref, versions: versions || null });
    this._pruneSnapshots(readerTabs);
    this.tabHistory.clear({ tab: this.state.footerTab });
    this.showToast(strings.tabs.opened_in_new_tab, Toast.durations.SHORT);
    return new Promise(resolve => this.setState({ readerTabs, loaded: false, ReaderDisplayOptionsMenuVisible: false }, () => {
      this.openRef(ref, 'tab', versions || undefined, false).then(resolve, resolve);
    }));
  };

  /**
   * Open reading `n` of a learning schedule item (home page "Today's learning", the schedules page)
   * in the schedule's own tab (learningSchedules/scheduleSequence.js). A tab the reader opened for
   * the same book keeps its place: Chok's Genesis 25:29 no longer takes over a Genesis 1 tab. The
   * schedule's tab is reused for it (and moves to the new reading); a day with several readings
   * shows them in a bar above the text.
   */
  openScheduleItem = (calendarItem, n = 0) => (calendarItem && calendarItem.chok
    ? this.openChokDay(calendarItem)
    : this._openScheduleSequence(makeScheduleSequence(calendarItem, n)));

  /**
   * Today's Chok LeYisrael (learningSchedules/chokDay.js): the whole day's learning from the sefer
   * itself (extras/chok.js, downloaded once from Otzaria's library, then read offline), in the
   * schedule's own tab, from the prayers before learning to the day's last part, where it ends.
   */
  openChokDay = async calendarItem => {
    try {
      await extras.loadExtras();
      if (!extras.isEnabled(CHOK_SOURCE)) { await extras.setSourceEnabled(CHOK_SOURCE, true); }
    } catch (e) {
      console.log('Chok LeYisrael: could not add the book', e);
    }
    const hidden = Sefaria.shomer?.hiddenBookForRef(CHOK_TITLE);  // content filter
    if (hidden) {
      Alert.alert(strings.filter.hidden_title,
        strings.formatString(strings.filter.hidden_message, {title: hidden.title, reason: hidden.reason}),
        [{text: strings.common.ok}]);
      return;
    }
    if (!extras.isExtraTitle(CHOK_TITLE)) {
      Alert.alert(strings.download.download_error, strings.extras.download_failed_message, [{text: strings.common.ok}]);
      return;
    }
    // one tap: the download (with its progress and Cancel), then the day opens
    if (extras.needsDownload(CHOK_TITLE) && !(await this.extraBookAlert(CHOK_TITLE, null))) { return; }
    let index = null;
    try { index = await Sefaria.offlineOnline.textToc(CHOK_TITLE); } catch (e) { console.log('Chok LeYisrael: index', e); }
    const seq = chokDaySequence(index, calendarItem);
    if (!seq) {
      Alert.alert(strings.errors.text_unavailable, strings.extras.download_failed_message, [{text: strings.common.ok}]);
      return;
    }
    await this._openScheduleSequence(seq);
  };

  /** The sections before and after `sectionRef` here: a day read as one unit keeps to its own readings */
  _readingNeighbours = (sectionRef, book) => {
    const tab = this.state.sheet ? null : findTab(this.state.readerTabs, this.state.readerTabs.activeTabId);
    return boundedNeighbours(tab && tab.schedule, sectionRef, { prev: book.prev || null, next: book.next || null });
  };

  _openScheduleSequence = seq => {
    const reading = currentReading(seq);
    if (!reading) { return Promise.resolve(); }
    const ref = reading.ref;
    const title = Sefaria.textTitleForRef(ref);
    if (!title) {
      this.textUnavailableAlert(ref);
      return Promise.resolve();
    }
    const inReader = !this.state.menuOpen;
    if (!inReader) { this.modifyHistory({ dir: "forward", state: this.state }); }  // back returns to the page it came from
    const existing = findTabForSchedule(this.state.readerTabs, seq.key);
    if (existing) {
      const baseTabs = updateTabPlace(this.state.readerTabs, existing.id, { schedule: seq });
      return this.switchToTab(existing.id, { ref }, { keepHistory: true, baseTabs });
    }
    if (inReader) { this._saveSnapshotForActiveTab(); }
    const readerTabs = openTab(this.state.readerTabs, { title, heTitle: Sefaria.index(title)?.heTitle || null, ref, schedule: seq });
    this._pruneSnapshots(readerTabs);
    return new Promise(resolve => this.setState({ readerTabs, loaded: false, ReaderDisplayOptionsMenuVisible: false }, () => {
      this.openRef(ref, 'tab', undefined, false).then(resolve, resolve);
    }));
  };

  // the display (Aa) menu opens below the schedule bar, so the bar stays in view while it is open
  _onScheduleBarLayout = e => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h !== this.state.scheduleBarHeight) { this.setState({ scheduleBarHeight: h }); }
  };

  /** The schedule sequence bar: go to reading `index` of the active tab's schedule. */
  goToScheduleReading = index => {
    const tab = findTab(this.state.readerTabs, this.state.readerTabs.activeTabId);
    const seq = tab && sequenceAt(tab.schedule, index);
    if (seq) { this._openScheduleSequence(seq); }
  };

  /** Home page strip: open a tab, with "back" returning to the home page. */
  openReaderTabFromHome = id => {
    this.modifyHistory({ dir: "forward", state: this.state });
    this.switchToTab(id, null, { keepHistory: true });
  };

  closeReaderTab = id => {
    const readerTabs = this.state.readerTabs;
    const wasActive = readerTabs.activeTabId === id;
    const next = closeTab(readerTabs, id);
    delete this._tabSnapshots[id];
    if (wasActive && !this.state.menuOpen) {
      if (next.activeTabId) {
        this.switchToTab(next.activeTabId, null, { baseTabs: next, skipSnapshot: true });
      } else {
        this.setState({ readerTabs: next });
        this.openNav(false);
      }
      return;
    }
    this.setState({ readerTabs: next });
  };

  closeOtherReaderTabs = id => {
    const next = closeOtherTabs(this.state.readerTabs, id);
    if (!this.state.menuOpen && this.state.readerTabs.activeTabId !== id) {
      this.switchToTab(id, null, { baseTabs: next });
    } else {
      this._pruneSnapshots(next);
      this.setState({ readerTabs: next });
    }
  };

  restoreArchivedReaderTab = archivedId => {
    if (!this.state.menuOpen) { this._saveSnapshotForActiveTab(); }
    const next = restoreArchivedTab(this.state.readerTabs, archivedId);
    if (next === this.state.readerTabs) { return; }
    this.switchToTab(next.activeTabId, null, { baseTabs: next, skipSnapshot: true, keepHistory: !!this.state.menuOpen });
  };

  removeArchivedReaderTab = archivedId => {
    this.setState(prev => ({ readerTabs: removeArchivedTab(prev.readerTabs, archivedId) }));
  };

  clearArchivedReaderTabs = () => {
    this.setState(prev => ({ readerTabs: clearArchivedTabs(prev.readerTabs) }));
  };

  /** Reopen a tab from "Recently closed", at the place it was closed. */
  restoreRecentlyClosedReaderTab = closedId => {
    if (!this.state.menuOpen) { this._saveSnapshotForActiveTab(); }
    const next = restoreRecentlyClosedTab(this.state.readerTabs, closedId);
    if (next === this.state.readerTabs) { return; }
    this.switchToTab(next.activeTabId, null, { baseTabs: next, skipSnapshot: true, keepHistory: !!this.state.menuOpen });
  };

  removeRecentlyClosedReaderTab = closedId => {
    this.setState(prev => ({ readerTabs: removeRecentlyClosedTab(prev.readerTabs, closedId) }));
  };

  clearRecentlyClosedReaderTabs = () => {
    this.setState(prev => ({ readerTabs: clearRecentlyClosedTabs(prev.readerTabs) }));
  };

  /* ---------- tablet split view ---------- */

  _isSplitViewAvailable = () => this.state.windowWidth >= SPLIT_VIEW_MIN_WIDTH;

  _otherTabs = () => this.state.readerTabs.tabs.filter(t => t.id !== this.state.readerTabs.activeTabId);

  _getSplitTab = () => {
    const others = this._otherTabs();
    return others.find(t => t.id === this.state.splitTabId) ||
      others.reduce((best, t) => (!best || (t.lastUsed || 0) > (best.lastUsed || 0) ? t : best), null);
  };

  setSplitView = on => {
    this.setState({ splitView: !!on });
    AsyncStorage.setItem(SPLIT_VIEW_STORAGE_KEY, on ? 'true' : 'false').catch(() => {});
    this.closeReaderDisplayOptionsMenu();
  };

  /** Show another tab in the split pane (null: the next one). */
  pickSplitTab = id => {
    if (id) { this.setState({ splitTabId: id }); return; }
    const others = this._otherTabs();
    const current = this._getSplitTab();
    const i = others.findIndex(t => current && t.id === current.id);
    const next = others[(i + 1) % others.length];
    if (next) { this.setState({ splitTabId: next.id }); }
  };

  /** Make the split pane's tab the main one (the main one moves to the split pane). */
  focusSplitTab = (id, segmentRef) => {
    let base = this.state.readerTabs;
    if (segmentRef) { base = updateTabPlace(base, id, { segmentRef }); }
    delete this._tabSnapshots[id];
    this.setState({ splitTabId: this.state.readerTabs.activeTabId });
    this.switchToTab(id, null, { baseTabs: base });
  };

  onSplitTabPlaceChange = (id, place) => {
    delete this._tabSnapshots[id];  // its saved place is now newer than any in-memory state
    this.setState(prev => ({ readerTabs: updateTabPlace(prev.readerTabs, id, place) }));
  };

  /* ---------- nikud by computer (Dicta): the sefer's own switch, in the Aa menu ---------- */

  setNakdanForThisBook = on => {
    setNakdanForBook(this.state.textTitle, on);
    this.closeReaderDisplayOptionsMenu();
  };

  /* ---------- "show under each passage" ---------- */

  setInlineCommentaryForBook = key => {
    clearSessionInlineCommentary(this.state.textTitle);  // the reader's own pick replaces a schedule's
    const inlineCommentaryPrefs = setInlineCommentary(this.state.inlineCommentaryPrefs, this.state.textTitle, key);
    this.setState({ inlineCommentaryPrefs });
    saveInlineCommentaryPrefs(inlineCommentaryPrefs);
    this.closeReaderDisplayOptionsMenu();
  };

  _getContextValue = () => {
    // memoized so context consumers only re-render when the tabs change
    if (!this._contextValue || this._contextValue.readerTabs !== this.state.readerTabs) {
      this._contextValue = {
        handleOpenURL: this.handleOpenURL,
        openURLInNewTab: this.openURLInNewTab,
        readerTabs: this.state.readerTabs,
        openReaderTab: this.openReaderTabFromHome,
        openScheduleItem: this.openScheduleItem,
      };
    }
    return this._contextValue;
  };

  renderContent() {
    const loading = !this.state.loaded;
    switch(this.state.menuOpen) {
      case (null):
        break;
      case ("navigation"):
        return (
          loading ?
          <LoadingView /> :
          (<TextsPage
              categories={this.state.navigationCategories}
              setCategories={this.setNavigationCategories}
              openRef={(ref, versions)=>this.openRef(ref,"navigation", versions)}
              onBack={this.manageBackMain}
              openLearningSchedules={this.openMenu.bind(null, "learning schedules")}
              openAbout={this.openMenu.bind(null, "about")}
              openHistory={this.openMenu.bind(null, "history")}
              openUri={this.openUri}
            />)
        );
      case ("learning schedules"):
        return (
           <LearningSchedulesPage openRef={this.openRef} openUri={this.openUri} onBack={this.manageBackMain}/>
        );
      case ("text toc"):
        return (
          <ReaderTextTableOfContents
            textUnavailableAlert={this.textUnavailableAlert}
            textToc={this.state.textToc}
            title={this.state.textTitle}
            currentRef={this.state.textReference}
            currentHeRef={this.state.heRef}
            close={this.manageBackMain}
            openRef={this.openRefTOC}
            openUri={this.openUri}/>);
        break;
      case ("search"):
        return(
          <SearchPage
            subMenuOpen={this.state.subMenuOpen}
            openSubMenu={this.openSubMenu}
            hasInternet={this.state.hasInternet}
            onBack={this.manageBackMain}
            search={this.onQueryChange}
            openRef={this.openRefSearch}
            setLoadTail={this.setLoadQueryTail}
            setIsNewSearch={this.setIsNewSearch}
            setSearchTypeState={this.setSearchTypeState}
            setSearchOptions={this.setSearchOptions}
            query={this.state.searchQuery}
            searchState={this._getSearchState(this.state.searchType)}
            searchType={this.state.searchType}
            textSearchState={this._getSearchState('text')}
            toggleFilter={this.toggleSearchFilter}
            isNewSearch={this.state.isNewSearch}
            setInitSearchScrollPos={this.setInitSearchScrollPos}
            clearAllFilters={this.clearAllSearchFilters}
            openAutocomplete={this.openAutocomplete}
            onChangeSearchQuery={this.onChangeSearchQuery}
          />);
        break;
      case ("autocomplete"):
        return (
          <AutocompletePage
            interfaceLanguage={this.props.interfaceLanguage}
            theme={this.props.theme}
            themeStr={this.props.themeStr}
            onBack={this.manageBackMain}
            openSearch={this.openSearch}
            setIsNewSearch={this.setIsNewSearch}
            onChange={this.onChangeSearchQuery}
            query={this.state.searchQuery}
            openRef={this.openRef}
            openTextTocDirectly={this.openTextTocDirectly}
            setCategories={cats => { /* first need to go to nav page */ this.openNav(); this.setNavigationCategories(cats);} }
            openUri={this.openUri}
          />);
        break;
      case ("settings"):
        return(<SettingsPage close={this.manageBackMain} openUri={this.openUri} />);
      case ("history"):
        return(<HistorySavedPage openRef={this.openRef} openMenu={this.openMenu} hasInternet={this.state.hasInternet}/>);  
        break;

      case ("about"):
        return <AboutPage close={this.manageBackMain} openUri={this.openUri} />;
    }
    const isSheet = !!this.state.sheet;
    let textColumnFlex = this.state.textListVisible ? 1.0 - this.state.textListFlex : 1.0;
    let relatedData = {};
    try {
      relatedData = this.state.relatedBySectionRef[this.state.sectionArray[this.state.sectionIndexRef]][this.state.segmentIndexRef].relatedWOLinks || {};
    } catch(e) {}
    const vowelToggleAvailable = Sefaria.vowelToggleAvailability(this.state.data[this.state.sectionIndexRef]);
    const { readerTabs } = this.state;
    const showTabBar = readerTabs.tabs.length > 0;
    const activeTab = findTab(readerTabs, readerTabs.activeTabId);
    const activeSchedule = !isSheet && activeTab && hasSequence(activeTab.schedule) ? activeTab.schedule : null;
    const splitViewAvailable = this._isSplitViewAvailable() && !isSheet;
    const showSplit = splitViewAvailable && this.state.splitView;
    const inlineCommentary = (!isSheet && this.state.textFlow !== 'continuous') ?
      effectiveInlineCommentary(this.state.inlineCommentaryPrefs, this.state.textTitle) : null;
    // Nikud by computer (Dicta) for texts without nikud, as the owner's extension adds it: only while
    // vowels are shown, when the sefer's switch (or "Always add nikud") is on; else a card asks.
    const nakdanBook = (!isSheet && this.state.textFlow !== 'continuous') ? this.state.textTitle : null;
    const nakdanOn = nakdanWanted(this.state.nakdanPrefs, nakdanBook, this.props.vocalization);
    const mainLacksNikud = !!nakdanBook && vowelToggleAvailable === VOCALIZATION.NONE &&
      sectionLacksNikud(this.state.data[this.state.sectionIndexRef]);
    const nakdanSwitchAvailable = !!nakdanBook && this.props.vocalization !== VOCALIZATION.NONE &&
      (vowelToggleAvailable === VOCALIZATION.NONE || !!inlineCommentary);
    const showNakdanAsk = !loading && !this.state.ReaderDisplayOptionsMenuVisible &&
      shouldAskNakdan(this.state.nakdanPrefs, nakdanBook, this.props.vocalization, mainLacksNikud);
    const showNakdanCredit = !loading && nakdanOn && (mainLacksNikud || !!inlineCommentary);
    return (
        <Animated.View
          style={[styles.container, this.props.theme.container]}
        >
            {showTabBar ?
              <ReaderTabBar
                tabs={readerTabs.tabs}
                activeTabId={readerTabs.activeTabId}
                archived={readerTabs.archived}
                onSelect={this.switchToTab}
                onClose={this.closeReaderTab}
                onCloseOthers={this.closeOtherReaderTabs}
                onNewTab={this.openNav}
                onRestoreArchived={this.restoreArchivedReaderTab}
                onRemoveArchived={this.removeArchivedReaderTab}
                onClearArchived={this.clearArchivedReaderTabs}
                recentlyClosed={readerTabs.recentlyClosed || []}
                onRestoreClosed={this.restoreRecentlyClosedReaderTab}
                onRemoveClosed={this.removeRecentlyClosedReaderTab}
                onClearClosed={this.clearRecentlyClosedReaderTabs}
              /> : null}
            <CategoryColorLine category={Sefaria.primaryCategoryForTitle(this.state.textTitle, isSheet)} />
            <ReaderControls
              enRef={this.state.textReference}
              heRef={this.state.heRef}
              categories={Sefaria.categoriesForTitle(this.state.textTitle, isSheet)}
              goBack={this.manageBackMainOrOpenNav}
              openTextToc={this.openTextToc}
              sheet={this.state.sheet}
              toggleReaderDisplayOptionsMenu={this.toggleReaderDisplayOptionsMenu}
              openUri={this.openUri}
              getHistoryObject={this.getHistoryObject}
              showToast={this.showToast}
            />
            {activeSchedule ?
              <View onLayout={this._onScheduleBarLayout}>
                <ScheduleSequenceBar sequence={activeSchedule} onGo={this.goToScheduleReading} />
              </View> : null}

            <View style={{flex: 1, flexDirection: 'row'}}>
            <View style={{flex: 1}} ref={this._getReaderBodyRef} onLayout={this._measureReaderBody} collapsable={false}>
            { loading ?
            <LoadingView style={{flex: textColumnFlex}} category={Sefaria.primaryCategoryForTitle(this.state.textTitle)}/> :
            <View style={[{flex: textColumnFlex}, styles.mainTextPanel, this.props.theme.mainTextPanel]}
                  onStartShouldSetResponderCapture={this._onStartShouldSetResponderCapture}>
                <TextColumn
                  interfaceLanguage={this.props.interfaceLanguage}
                  textLanguage={this.props.textLanguage}
                  showAliyot={this.props.showAliyot}
                  theme={this.props.theme}
                  themeStr={this.props.themeStr}
                  fontSize={this.props.fontSize}
                  sheetMeta={this.state.sheetMeta}
                  isSheet={isSheet}
                  biLayout={this.props.biLayout}
                  key={this.state.textColumnKey}
                  showToast={this.showToast}
                  textToc={this.state.textToc}
                  data={this.state.data}
                  relatedBySectionRef={this.state.relatedBySectionRef}
                  textReference={this.state.textReference}
                  sectionArray={this.state.sectionArray}
                  sectionHeArray={this.state.sectionHeArray}
                  offsetRef={this.state.offsetRef}
                  segmentRef={this.state.segmentRef}
                  segmentIndexRef={this.state.segmentIndexRef}
                  textFlow={this.state.textFlow}
                  updateData={this.updateData}
                  updateTitle={this.updateTitle}
                  textTitle={this.state.textTitle}
                  heTitle={this.state.heTitle}
                  heRef={this.state.heRef}
                  textSegmentPressed={ this.textSegmentPressed }
                  textListVisible={this.state.textListVisible}
                  next={this.state.next}
                  prev={this.state.prev}
                  scheduleEnd={activeSchedule && isLastReading(activeSchedule, this.state.sectionArray[this.state.sectionArray.length - 1]) ? activeSchedule : null}
                  linksLoaded={this.state.linksLoaded}
                  loadingTextTail={this.state.loadingTextTail}
                  loadingTextHead={this.state.loadingTextHead}
                  handleOpenURL={this.handleOpenURL}
                  textUnavailableAlert={this.textUnavailableAlert}
                  setDictionaryLookup={this.setDictionaryLookup}
                  shareCurrentSegment={this.shareCurrentSegment}
                  getDisplayedText={this.getDisplayedText}
                  vowelToggleAvailable={vowelToggleAvailable}
                  highlightedWordID={this.state.highlightedWordID}
                  highlightedWordSegmentRef={this.state.highlightedWordSegmentRef}
                  setHighlightedWord={this.setHighlightedWord}
                  inlineCommentary={inlineCommentary}
                  nakdan={nakdanOn}
                />
                {showNakdanCredit ? <NakdanCredit theme={this.props.theme} /> : null}
                {showNakdanAsk ?
                  <NakdanAskCard book={nakdanBook} theme={this.props.theme} interfaceLanguage={this.props.interfaceLanguage} /> : null}
            </View> }

            {this.state.textListVisible ?
              <ConnectionsPanel
                theme={this.props.theme}
                themeStr={this.props.themeStr}
                interfaceLanguage={this.props.interfaceLanguage}
                fontSize={this.props.fontSize}
                textLanguage={this.props.textLanguage}
                sheet={this.state.sheet}
                sheetMeta={this.state.sheetMeta}
                textListFlex={this.state.textListFlex}
                animating={this.state.textListAnimating}
                onStartShouldSetResponderCapture={this._onStartShouldSetResponderCapture}
                textToc={this.state.textToc}
                segmentRefOnSheet={this.state.segmentRefOnSheet}
                segmentRef={this.state.segmentRef}
                sectionRef={this.state.sectionArray[this.state.sectionIndexRef]}
                heSegmentRef={Sefaria.toHeSegmentRef(this.state.heRef, this.state.segmentRef)}
                categories={Sefaria.categoriesForTitle(this.state.textTitle, isSheet)}
                textFlow={this.state.textFlow}
                openRef={this.openRefConnectionsPanel}
                setConnectionsMode={this.setConnectionsMode}
                openFilter={this.openFilter}
                closeCat={this.closeLinkCat}
                updateLinkCat={this.updateLinkCat}
                updateVersionCat={this.updateVersionCat}
                loadLinkContent={this.loadLinkContent}
                loadVersionContent={this.loadVersionContent}
                linkSummary={this.state.linkSummary}
                linkContents={this.state.linkContents}
                versionContents={this.state.versionContents}
                loading={this.state.loadingLinks}
                relatedHasError={this.state.linksLoaded && (this.state.linksLoaded[this.state.sectionIndexRef] === 'error')}
                loadRelated={this.loadRelated}
                connectionsMode={this.state.connectionsMode}
                filterIndex={this.state.filterIndex}
                recentFilters={this.state.linkRecentFilters}
                versionRecentFilters={this.state.versionRecentFilters}
                versionFilterIndex={this.state.versionFilterIndex}
                currVersionObjects={this.state.currVersionObjects}
                versions={this.state.versions}
                versionsApiError={this.state.versionsApiError}
                relatedData={relatedData}
                onDragStart={this.onTextListDragStart}
                onDragMove={this.onTextListDragMove}
                onDragEnd={this.onTextListDragEnd}
                textTitle={this.state.textTitle}
                openUri={this.openUri}
                handleOpenURL={this.handleOpenURL}
                dictLookup={this.state.dictLookup}
                shareCurrentSegment={this.shareCurrentSegment}
                viewOnSite={this.viewOnSite}
                reportError={this.reportError}
                translations={this.state.currentTranslations}
              />
               : null
            }
            </View>
            {showSplit ?
              <SplitTabPane
                tab={this._getSplitTab()}
                otherTabs={this._otherTabs()}
                theme={this.props.theme}
                themeStr={this.props.themeStr}
                fontSize={this.props.fontSize}
                textLanguage={this.props.textLanguage}
                interfaceLanguage={this.props.interfaceLanguage}
                biLayout={this.props.biLayout}
                showAliyot={this.props.showAliyot}
                hasInternet={this.state.hasInternet}
                onPickTab={this.pickSplitTab}
                onFocusTab={this.focusSplitTab}
                onPlaceChange={this.onSplitTabPlaceChange}
                showToast={this.showToast}
                handleOpenURL={this.handleOpenURL}
                textUnavailableAlert={this.textUnavailableAlert}
              /> : null}
            </View>
            {this.state.ReaderDisplayOptionsMenuVisible ?
              (<ReaderDisplayOptionsMenu
                ref={this._getReaderDisplayOptionsMenuRef}
                theme={this.props.theme}
                textFlow={this.state.textFlow}
                biLayout={this.props.biLayout}
                textReference={this.state.textReference}
                interfaceLanguage={this.props.interfaceLanguage}
                textLanguage={this.props.textLanguage}
                showAliyot={this.props.showAliyot}
                vocalization={this.props.vocalization}
                setTextFlow={this.setTextFlow}
                setBiLayout={this.setBiLayout}
                setAliyot={this.setAliyot}
                setTextLanguage={this.setTextLanguage}
                setVocalization={this.setVocalization}
                incrementFont={this.incrementFont}
                setTheme={this.setTheme}
                canBeContinuous={Sefaria.canBeContinuous(this.state.textTitle)}
                canHaveAliyot={Sefaria.canHaveAliyot(this.state.textTitle)}
                vowelToggleAvailable={vowelToggleAvailable}
                themeStr={this.props.themeStr}
                inlineSources={isSheet ? [] : availableInlineSources(this.state.relatedBySectionRef, t => Sefaria.index(t)?.heTitle)}
                inlineConnections={isSheet ? [] : availableInlineConnections(this.state.relatedBySectionRef)}
                inlineCommentary={inlineCommentary}
                setInlineCommentary={this.setInlineCommentaryForBook}
                nakdanAvailable={nakdanSwitchAvailable}
                nakdanForCommentary={vowelToggleAvailable !== VOCALIZATION.NONE}
                nakdan={nakdanOn}
                setNakdan={this.setNakdanForThisBook}
                splitViewAvailable={splitViewAvailable}
                splitView={this.state.splitView}
                setSplitView={this.setSplitView}
                bookTitle={isSheet ? null : this.state.textTitle}
                bookHeTitle={isSheet ? null : Sefaria.index(this.state.textTitle)?.heTitle}
                topOffset={displayMenuTop(showTabBar ? READER_TAB_BAR_HEIGHT : 0, activeSchedule ? this.state.scheduleBarHeight : 0)}
              />) : null
            }
        </Animated.View>
    );
  }

  getBottomSafeAreaEdges = (menuOpen) => {
    const bottomSafeAreaEdges = ["left", "right"];
    if (this.shouldShowFooter(menuOpen)) {
      bottomSafeAreaEdges.push("bottom");
    }
    return bottomSafeAreaEdges;
  }

  /**
   * Handles "Return to Nav" errors by attempting to go up one reference level and loadNewText again.
   * @param {string} ref - The original reference that failed
   * @param {Object} versions - Version information
   * @param {boolean} isLoadingVersion - Whether we're loading a specific version
   * @param {number} numTries - Number of previous attempts
   * @param {Function} resolve - Promise resolve function
   */
  _handleNavError = (ref, versions, isLoadingVersion, numTries, resolve) => {
    // In case of unfound ref, try going one ref up (up to the book) before dealing with error by returning to nav.
    // We do this to avoid failing in case of ref to a non existent ref after a changing index of a book.
    const refUpOne = Sefaria.refUpOne(ref, true);

    // Break if there is no more ref up to do.
    // refUpOne checks if book exists, so code wont go into this if if the book doesn't exist
    if (ref !== refUpOne) {
      console.warn(`Navigation fallback: ${ref} -> ${refUpOne} (try ${numTries + 1})`);

      this.loadNewText({ ref: refUpOne, versions, isLoadingVersion, numTries: numTries + 1 }).then(resolve);
    } else {

      console.warn(`Navigation failure: cannot resolve ${ref} (tries ${numTries})`);

      const bookTitle = Sefaria.textTitleForRef(ref);
      if (bookTitle) {
        this.openTextTocDirectly(bookTitle);
      }
      // Pop up here because we silence the error in Sefaria.api._request to avoid uneeded popups during the recursive refUpone call.
      this.textUnavailableAlert(ref);
    }
    resolve();
  };

  render() {
    // StatuBar comment: can't figure out how to get barStyle = light-content to be respected on Android
    const { safeViewStyle, statusBarBackgroundColor, statusBarStyle } = getSafeViewStyleAndStatusBarBackground(this.state, this.props.theme.mainTextPanel, this.props.themeStr === "white");
    const readerAppContextData = this._getContextValue();

    return (
      <ReaderAppContext.Provider value={readerAppContextData}>
        <View style={styles.rootContainer}>
          <SafeAreaView edges={["top"]} style={[{ flex: 0 }, safeViewStyle]} />
          <SafeAreaView
             edges={this.getBottomSafeAreaEdges(this.state.menuOpen)}
             style={[styles.safeArea, this.props.theme.mainTextPanel]}
          >
            <View style={[styles.container, this.props.theme.mainTextPanel]}>
                <StatusBar barStyle={statusBarStyle} backgroundColor={statusBarBackgroundColor}/>
              <ConditionalProgressWrapper
                conditionMethod={(state, props) => {
                  return state && (props.menuOpen !== 'settings' || state.downloadNotification === 'Update');
                }}
                initialValue={DownloadTracker.getDownloadStatus()}
                downloader={DownloadTracker}
                listenerName={'ReaderAppBar'}
                menuOpen={this.state.menuOpen}
              >
                <SefariaProgressBar
                  onPress={()=>{
                    this.openMenu("settings")
                  }}
                  onClose={() => DownloadTracker.cancelDownload()}
                  download={DownloadTracker}
                  identity={'ReaderApp'}
                />
              </ConditionalProgressWrapper>
                { this.renderContent() }
              { this.shouldShowFooter(this.state.menuOpen) && (
                  <FooterTabBar selectedTabName={TabMetadata.selectedTabName(this.state.menuOpen, this.state.footerTab)} setTab={this.setFooterTab} />
              )}
            </View>
          </SafeAreaView>
          <DeepLinkRouter
            ref={this._getDeepLinkRouterRef}
            openNav={this.openNav}
            openMenu={this.openMenu}
            openRef={this.openRef}
            openRefInNewTab={this.openRefInNewTab}
            openUri={this.openUri}
            openSearch={this.openSearch}
            setSearchOptions={this.setSearchOptions}
            openTextTocDirectly={this.openTextTocDirectly}
            setTextLanguage={this.setTextLanguage}
            setNavigationCategories={this.setNavigationCategories}
          />
          {this.state.extraDownload ? (
            <ExtraDownloadModal
              title={this.state.extraDownload.title}
              name={this.state.extraDownload.name}
              theme={this.props.theme}
              langStyle={this.props.interfaceLanguage === 'hebrew' ? styles.heInt : styles.enInt}
            />
          ) : null}
        </View>
      </ReaderAppContext.Provider>
    );
  }
}

export default ReaderApp;
