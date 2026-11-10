'use strict';

import React, {useEffect, useState, useCallback} from 'react';
import {
    Text,
    TouchableOpacity,
    View,
    FlatList,
} from 'react-native';
import {
    PageHeader, StatefulHeader, FlexFrame, LoadingView,
} from './Misc.js';
import {PreviewFrame, PreviewTitleBlock, ColorBarBox, PreviewBodyBlock} from './TextPreview';
import styles from './Styles';
import strings from './LocalizedStrings';
import {useGlobalState} from './Hooks.js';
import Sefaria from './sefaria';

// History and saved items live only on this phone (see history.js loadLocalHistory).
const useLoadLocalHistory = () => useCallback(async () => {
    await Sefaria.history.loadLocalHistory();
}, []);


export const HistorySavedPage = ({openRef, openMenu, hasInternet}) => {
    const loadLocalHistory = useLoadLocalHistory();
    const [loaded, setLoaded] = useState(false);
    const [mode, setMode] = useState('saved');


    useEffect(() => {
        (async () => { //using an async IAFE so the whole function doest become async
            await loadLocalHistory();
            setLoaded(true);
        })();
    }, [loadLocalHistory]);


    const changeMode = useCallback((newmode) => {
        setMode(prevMode => {
            if(newmode !== prevMode){
                return newmode;
            }
            return prevMode;
        });
    }, []);

    return(
        <View style={styles.menu}>
            {
                // While local history loads, still show the headers.
                // Once the rest renders the header will render as part of the FlatList below.
                !loaded ? <HistorySavedPageHeader mode={mode} changeMode={changeMode} openMenu={openMenu} /> : null
            }
            <FlexFrame dir="column">
                {loaded ?
                    <HistoryOrSavedList mode={mode} changeMode={changeMode} openRef={openRef} openMenu={openMenu} hasInternet={hasInternet}/>
                    :
                   <HistorySavedPageLoadingView />
                }
            </FlexFrame>
        </View>
    );
};


const HistorySavedPageLoadingView = () => {
    return(
        <LoadingView size="large" style={styles.historyLoadingView}/>
    );
};


const HistorySavedPageHeader = ({mode, changeMode, openMenu}) => {
    const {theme, readingHistory} = useGlobalState();
    const openSettings = () => openMenu('settings', 'HistorySavedPage');
    const changeToSaved = useCallback(() => changeMode('saved'), [changeMode]);
    const changeToHistory = useCallback(() => changeMode('history'), [changeMode]);
    return(
        <View>
            <View style={[styles.navRePage, styles.navReHistoryItem, theme.lighterGreyBorder]}>
                <PageHeader>
                    <FlexFrame justifyContent={'flex-start'}>
                        <StatefulHeader titleKey={'history.saved'} icon={'bookmark2'} active={mode === 'saved'} callbackFunc={changeToSaved}/>
                        <StatefulHeader titleKey={'history.history'} icon={'clock'} active={mode === 'history'} callbackFunc={changeToHistory}/>
                    </FlexFrame>
                </PageHeader>
            </View>
            {
              mode === 'history' && !readingHistory ? <ReadingHistoryPrompt openSettings={openSettings} /> : null
            }
        </View>
    );
};

const HistoryOrSavedList = ({mode, changeMode, openRef, openMenu, hasInternet}) => {
    const RenderClass = mode === 'history' ? HistoryList : SavedList;
    return (<RenderClass changeMode={changeMode} openRef={openRef} openMenu={openMenu} hasInternet={hasInternet}/>);
};

const SavedList = ({changeMode, openRef, openMenu, hasInternet}) => {
    return (<UserReadingList mode={'saved'} changeMode={changeMode} openRef={openRef} openMenu={openMenu} hasInternet={hasInternet}/>);
};

const HistoryList = ({changeMode, openRef, openMenu, hasInternet}) => {
    return (<UserReadingList mode={'history'} changeMode={changeMode} openRef={openRef} openMenu={openMenu} hasInternet={hasInternet}/>);
};

const UserReadingList = ({mode, changeMode, openRef, openMenu, hasInternet}) => {
    const loadLocalHistory = useLoadLocalHistory();
    const [localData, setLocalData] = useState([]);
    const [data, setData] = useState([]);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingState, setLoadingState] = useState({
        loadingAPIData: false,
        currSkipLoaded: 0,
        hasMoreData: true,
    });
    // Both loadingAPIData and loadingRef are needed.
    // loadingRef is synchronous which is good for blocking double load calls. loadingAPIData is a state var which can be used to render footer.
    const loadingRef = React.useRef(false);
    const SKIP_STEP = 20;

    const {theme, interfaceLanguage} = useGlobalState();

    /***
     * Removes duplicate or too similar history items and pathces sheet hist items
     * @param historyArray
     * @param onlyNormalize
     * @returns {*}
     */
    const dedupeAndNormalizeHistoryArray = useCallback((historyArray, onlyNormalize = false) => {
        return historyArray.reduce((accum, curr, index) => {
            if (curr.is_sheet) {
                // skip all sheets post-MDL
                return accum;
            }
            if(curr.hasOwnProperty('he_ref')) { curr.heRef = curr.he_ref; }
            if(!curr.hasOwnProperty('book')) { curr.book = Sefaria.textTitleForRef(curr.ref); }
            //for saved items we don't want to dedupe at all
            if (!accum.length || onlyNormalize) {return accum.concat([curr]); }
            const prev = accum[accum.length-1];

            if (curr.book === prev.book) {
                return accum;
            } else {
                return accum.concat([curr]);
            }
        }, []);
    }, []);

    const reinitializeData = useCallback(() => {
        let rstore = Sefaria.history.getLocalHistoryArray(mode);
        let nstore = dedupeAndNormalizeHistoryArray(rstore, mode === 'saved');
        setLocalData([...nstore]);
        setData([]);
        setLoadingState({
            loadingAPIData: false,
            currSkipLoaded: 0,
            hasMoreData: true,
        });
        loadingRef.current = false;
    }, [mode, dedupeAndNormalizeHistoryArray]);

    const getAnnotatedItems = useCallback(async (refs) => {
        // Text previews come from the online API; offline, items show their ref only.
        if(!hasInternet){
            return {};
        }
        try {
            return await Sefaria.api.getBulkText(refs, true);
        } catch (error) {
            console.error(error);
            return {};
        }
    }, [hasInternet]);

    const getAnnotatedNextItems = useCallback(async (items) => {
        const textsAnnotated = await getAnnotatedItems(items.map(i => i.ref));
        // iterate over original items and put the extra data in
        //filter for errors here before mapping
        return items.reduce((result, element) => {
            if(element.hasOwnProperty('error')){
                return result;
            }
            if(textsAnnotated.hasOwnProperty(element.ref)){
                element = {...element, ...textsAnnotated[element.ref]};
            }
            return [...result, element];
        }, []);
    }, [getAnnotatedItems]);

    const loadData = useCallback(() => {
        if (!loadingState.hasMoreData || loadingRef.current) {
            return;
        }

        loadingRef.current = true;
        let nitems = localData.slice(loadingState.currSkipLoaded, loadingState.currSkipLoaded + SKIP_STEP); //get the next 20 items from the raw local history
        if(!nitems.length) {
            setLoadingState(prev => ({...prev, hasMoreData: false}));
            loadingRef.current = false;
            return;
        }
        setLoadingState(prev => ({...prev, loadingAPIData: true}));
        getAnnotatedNextItems(nitems).then( nextItems => {
            setData(prevItems => {
                return [...prevItems, ...nextItems];
            });
            setLoadingState(prev => ({
                ...prev,
                hasMoreData: (prev.currSkipLoaded + SKIP_STEP) < localData.length,  // Use prev.currSkipLoaded instead of closure value
                currSkipLoaded: prev.currSkipLoaded + SKIP_STEP,
                loadingAPIData: false,
            }));
            loadingRef.current = false;
        });
    }, [loadingState.hasMoreData, localData, getAnnotatedNextItems, loadingState.currSkipLoaded]);

    useEffect(() => {
        //here we are getting a 'copy' of local history items that we will perform operations on.
        reinitializeData();
    }, [reinitializeData]);

    useEffect(()=> {
        // Load initial data when localData is set and we don't have any data yet
        if(localData.length > 0 && data.length === 0 && !loadingRef.current) {
            loadData();
        }
    }, [localData, data.length, loadData]);

    const onItemsEndReached = () => {
        if (!loadingState.hasMoreData || loadingRef.current || localData.length === 0) {
            return;
        }
        loadData();
    };

    const renderEmpty = () => {
        const isHeb = interfaceLanguage === 'hebrew';
        return(
            <View style={{ paddingVertical: 20 }}>
                <Text style={[theme.secondaryText, isHeb ? styles.heInt : styles.enInt, styles.textCenter]}>{strings.history.no_history}</Text>
            </View>
        );
    };

    const renderFooter = () => {
        if (!loadingState.loadingAPIData) {
            return null;
        }
        return (
            <HistorySavedPageLoadingView />
        );
    };

    const renderItem = ({item, index}) => {
        return (<HistoryItem item={item} key={index} openRef={openRef} />);
    };

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await loadLocalHistory();
        reinitializeData();
        setRefreshing(false);
    }, [loadLocalHistory, reinitializeData]);

    return (
        <FlatList
            ListHeaderComponent={
                <HistorySavedPageHeader mode={mode} changeMode={changeMode} openMenu={openMenu} />
            }
            ListEmptyComponent={renderEmpty}
            data={data}
            keyExtractor={(item, index) => `${item.ref}-${index}`}
            renderItem={renderItem}
            onEndReached={onItemsEndReached}
            onEndReachedThreshold={0.3}
            ListFooterComponent={renderFooter}
            refreshing={refreshing}
            onRefresh={onRefresh}
        />
    );
};


const HistoryItem = ({item, openRef}) => {
    const {theme} = useGlobalState();
    let { ref, versions } = item;
    const openHistoryItem = () => openRef(ref, null, versions);
    return(
        <TouchableOpacity onPress={openHistoryItem} delayPressIn={200}>
            <View style={[styles.navReHistoryItem, theme.lighterGreyBorder]}>
                <TextHistoryItem text={item} />
            </View>
        </TouchableOpacity>
    );
};

const TextHistoryItem = ({text}) => {
    return (
        <PreviewFrame>
          <View style={styles.historyItemTitle}>
              <PreviewTitleBlock en={text.ref} he={Sefaria.normHebrewRef(text.heRef)} />
          </View>
          <ColorBarBox tref={text.ref}>
            <PreviewBodyBlock en={text.en} he={text.he}/>
          </ColorBarBox>
        </PreviewFrame>
      );
};



const ReadingHistoryPrompt = ({ openSettings }) => {
  const { theme, interfaceLanguage } = useGlobalState();
  const langStyle = interfaceLanguage === 'he' ? styles.heInt : styles.enInt;
  return (
    <View>
      <Text style={[langStyle, styles.navReUpToEdge, styles.readingHistoryPrompt, theme.secondaryText]}>
        {strings.history.reading_history_is_currently_disabled + ' '}
        <Text style={[langStyle, theme.text]} onPress={openSettings}>
          {strings.common.settings.toLowerCase()}
        </Text>
        {'.'}
      </Text>
    </View>
  );
};
