'use strict';
import PropTypes from 'prop-types';
import React from 'react';

import {
  TouchableOpacity,
  Text,
  View,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import ActionSheet from 'react-native-action-sheet';

import {
  InterfaceText,
  SText,
} from '../Misc';
import styles from '../Styles';
import strings from '../LocalizedStrings';
import {iconData} from "../IconData";
import {
  localNameResults, shouldCallNameApi, noteNameApiFailure, noteNameApiSuccess, NAME_DEBOUNCE_MS, withOwnBooks,
} from './localAutocomplete';
import * as extras from '../extras';

const EXCLUDED_COMPLETION_TYPES = new Set(['topic', 'persontopic', 'authortopic', 'user', 'collection', 'group']);

class AutocompleteList extends React.Component {
  static propTypes = {
    interfaceLanguage:   PropTypes.oneOf(["english", "hebrew"]).isRequired,
    theme:    PropTypes.object.isRequired,
    themeStr: PropTypes.string.isRequired,
    query:    PropTypes.string,
    openRef:  PropTypes.func.isRequired,
    openTextTocDirectly: PropTypes.func.isRequired,
    setCategories: PropTypes.func.isRequired,
    search:   PropTypes.func.isRequired,
    openUri: PropTypes.func.isRequired,
    setQueryRef: PropTypes.func.isRequired,
  };

  constructor(props) {
    super(props);
    this.state = {
      completions: [],
      completionsLang: null,
      recentQueries: Sefaria.recentQueries
        .filter(q => !Sefaria.shomer?.hiddenBookForRef(q.key || q.query))  // content filter
        .map(q => ({...q})),
    }
  }

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
    clearTimeout(this._nameTimer);
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.props.query !== prevProps.query) {
      this.onQueryChange(this.props.query);
    }
  }

  shouldQueryOpenToc = ({ is_book, is_node, is_section, is_segment, is_range }) => {
    return is_book || (is_node && !(is_section || is_segment || is_range));
  }

  onQueryChange = q => {
    clearTimeout(this._nameTimer);
    if (q.length >= 3) {
      // the library on the phone answers at once (and is all there is offline) ...
      this.showResults(q, localNameResults(q));
      // ... the Name API only after a pause in typing, and only when it can be reached
      this._nameTimer = setTimeout(() => this.askNameApi(q), NAME_DEBOUNCE_MS);
    } else {
      this.setState({completions: []});
    }
  };

  askNameApi = async q => {
    if (!this._isMounted || this.props.query !== q) { return; }
    if (!(await shouldCallNameApi())) { return; }
    if (!this._isMounted || this.props.query !== q) { return; }
    Sefaria.api.name(q, true)
      .then(results => { noteNameApiSuccess(); return results; })
      .then(results => Sefaria.shomer?.filterNameResponse(results) ?? results)  // content filter
      // (the extra sources' books, which the API does not know, stay in the list)
      .then(results => withOwnBooks(q, results, t => !!(extras.isExtraTitle && extras.isExtraTitle(t))))
      .then(results => this.showResults(q, results))
      .catch(() => noteNameApiFailure());  // keep the local results; no retry per keystroke
  };

  showResults = (q, results) => {
        // only if the box still holds this query: a late answer for an older one (or for a
        // query since cleared) must not fill the list
        if (results && this._isMounted && this.props.query === q) {
          const typeToValue = { "ref": 1, "toc": 3 };
          let completions = results.completion_objects.map((c,i) =>
          {
            c.type = c.type.toLowerCase()
            return c;
          })
          // SoferBooks shows library items only: no Sefaria topics, users, groups or collections.
          .filter(c => !EXCLUDED_COMPLETION_TYPES.has(c.type))
          .map((c, i) => {
            if (i === 0) {typeToValue[c.type] = 0;}  // priveledge the first results' type
            return c;
          })
          .stableSort((a,b) => typeToValue[a.type] - typeToValue[b.type])
          .concat([{title: `Search for: "${this.props.query}"`, type: "searchFor"}]); // always add a searchFor element at the bottom
          this.props.setQueryRef(null, false);
          if (results.is_ref && !!results.ref) {
            // manually add ref item to list
            function lastSectionName(data) {
              return data?.sectionNames?.[data.sections.length-1];
            }
            const queryRef = Sefaria.addPageToWholeDafRef(results.ref, lastSectionName(results));
            this.props.setQueryRef(queryRef, results.index, this.shouldQueryOpenToc(results));
            // one line per book: "Bikkurim" (another name of Mishnah Bikkurim) is the ref itself,
            // as on Sefaria - not "Mishnah Bikkurim" and "Bikkurim" both (QA round 13)
            completions = completions.filter(c => c.type !== 'ref' || (c.key !== queryRef && c.key !== results.ref));
            completions.unshift({
              title: results.ref,
              key: queryRef,
              type: 'ref',
              is_primary: true,
            });
          }
          this.setState({completions, completionsLang: results.lang})
        }
  };
  close = () => {
    this.setState({completions: []});
  }
  openItem = (item) => {
    let recentType;
    if ((item.type === 'ref' && !!Sefaria.booksDict[item.key]) || item.type == 'book') {
      // actually a book ref so open toc
      this.props.openTextTocDirectly(item.key);
      recentType = "book";
    }
    else if (item.type == 'ref') {
      this.props.openRef(item.key);
      recentType = "ref";
    }
    else if (item.type == "person" || item.type == "group") {
      recentType = item.type;
      ActionSheet.showActionSheetWithOptions(
        {
          options: [`View '${item.title}' on Sefaria site`,strings.common.cancel],
          cancelButtonIndex: 1,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            const uri = item.type == 'person' ? `https://www.sefaria.org/person/${item.key}` : `https://www.sefaria.org/groups/${item.key.split(' ').join('-')}`;
            this.props.openUri(uri);
          }
        }
      );
    } else if (item.type == "toccategory" || item.type == 'toc') {
      this.props.setCategories(item.key);
      recentType = "toc";
    } else {
      return;  // a type SoferBooks doesn't open (e.g. an old recent query for a topic)
    }
    Sefaria.saveRecentQuery(item.title, recentType, item.key, item.pic);
  };

  openItemOLD = (query, index) => {
    // Older versions of the app only saved query and type for the recent item
    // this meant that the app needed to make an extra api call to get the key to open the relevant item
    const [currList, currListKey] = this.state.completions[index] ? [this.state.completions, "completions"] : [this.state.recentQueries, "recentQueries"];
    currList[index].loading = true;
    this.setState({[currListKey]: currList});
    Sefaria.api.name(query, false).then(d => {
      currList[index].loading = false;
      this.setState({[currListKey]: currList});
      // If the query isn't recognized as a ref, but only for reasons of capitalization. Resubmit with recognizable caps.
      if (Sefaria.api.isACaseVariant(query, d)) {
        this.openRef(Sefaria.api.repairCaseVariant(query, d));
        return;
      }
      let recentType;
      if (d.is_book) {
        this.props.openTextTocDirectly(d.book);
        recentType = "book";
      }
      else if (d.is_ref) {
        this.props.openRef(d.ref);
        recentType = "ref";
      }
      else if (d.type == "Group") {
        recentType = d.type.toLowerCase;
        ActionSheet.showActionSheetWithOptions(
          {
            options: [`View '${d.key}' on Sefaria site`,strings.common.cancel],
            cancelButtonIndex: 1,
          },
          (buttonIndex) => {
            if (buttonIndex === 0) {
              if (d.type == "Group") {
                this.props.openUri(`https://www.sefaria.org/groups/${d.key.split(' ').join('-')}`);
              }
            }
          }
        );
      } else if (d.type == "TocCategory") {
        this.props.setCategories(d.key);
        recentType = "toc";
      } else if (d.type == "Group") {
        recentType = "group"
      } else {
        return;
      }
      Sefaria.saveRecentQuery(query, recentType, d.key, d.pic);
    });
  };

  renderItem = ({ item, index }) => {
    if (item.query) { item.title = item.query; }
    // toc queries get saved as arrays
    const isHeb = this.state.completionsLang === 'he';
    let src;
    switch (item.type) {
      case "searchFor":
      case "query":
        src = iconData.get('search', this.props.themeStr);
        break;
      case "ref":
      case "book":
        src = iconData.get('book', this.props.themeStr);
        break;
      case "toc":
      case "toccategory":
        src = iconData.get('category', this.props.themeStr);
        break;
      case "group":
        src = iconData.get('group', this.props.themeStr);
        break;        
      case "authortopic":
        src = iconData.get('quill', this.props.themeStr);
        break;
      case "persontopic":
      case "topic":
        src = iconData.get('hashtag', this.props.themeStr);
        break;
      case "user":
        src = item.pic.length ? {uri: item.pic} : (iconData.get('user', this.props.themeStr));
        break;
      case "collection":
        src = iconData.get('layers', this.props.themeStr);
        break;
    }
    return (
      <TouchableOpacity
        style={[{flexDirection: this.props.interfaceLanguage === "hebrew" ? 'row-reverse' : 'row'}, styles.autocompleteItem, this.props.theme.lighterGreyBorder]}
        onPress={()=>{
          if (item.type === 'query') {
            this.props.search(item.title || item.query);
          } else if (item.type === 'searchFor') {
            this.props.search(this.props.query);
          } else {
            if (item.key) { this.openItem(item); }
            else {
              // dont have key, need to query for item again
              this.openItemOLD(item.query, index);
            }      
          }
        }}>
        <Image source={src}
          style={[styles.menuButtonMargined]}
          resizeMode={'contain'}
        />
        <SText lang={isHeb ? "hebrew" : "english"} style={[styles.autocompleteItemText, this.props.theme.text, {textAlign: this.props.interfaceLanguage === "hebrew" ? 'right' : 'left', fontFamily: isHeb ? 'Heebo' : 'Amiri', paddingTop: 5, marginTop: isHeb ? 0 : 5}]}>
          { (item.type === 'toc' || item.type === 'toccategory') ? item.title.toUpperCase() : item.title }
        </SText>
        {item.loading ? (<Text style={[{paddingHorizontal: 10}, this.props.theme.secondaryText, !isHeb ? styles.enInt : styles.heInt]}>
          { strings.common.loading }
        </Text>) : null}
      </TouchableOpacity>
    )
  };

  _keyExtractor = (item, pos) => {
    return (item.title || item.query) + "|" + pos;
  };

  render() {
    const isheb = this.props.interfaceLanguage === "hebrew";
    // an empty (or too short) box shows recent searches, never the suggestions of an old query
    const completions = (this.props.query || '').length >= 3 ? this.state.completions : [];
    const langStyle = !isheb ? styles.enInt : styles.heInt;
    return (

        Platform.OS == "ios" ?

            (<KeyboardAvoidingView style={[styles.autocompleteList, this.props.theme.mainTextPanel, this.props.theme.lighterGreyBorder]} behavior="padding">
              {!!completions.length ?
                <FlatList
                  keyExtractor={this._keyExtractor}
                  contentContainerStyle={{paddingBottom: 20}}
                  keyboardShouldPersistTaps={'handled'}
                  data={completions}
                  renderItem={this.renderItem}
                />
                :
                <View style={styles.flex1}>
                  <View style={[{paddingVertical: 15, borderBottomWidth: 1}, this.props.theme.lighterGreyBorder]}>
                    <InterfaceText stringKey={"search.recent_searches"} extraStyles={[this.props.theme.tertiaryText, styles.fontBold, styles.fontSize16]} />
                  </View>
                  <FlatList
                    keyExtractor={this._keyExtractor}
                    contentContainerStyle={{paddingBottom: 20}}
                    keyboardShouldPersistTaps={'handled'}
                    data={this.state.recentQueries}
                    renderItem={this.renderItem}
                  />
                </View>
              }
            </KeyboardAvoidingView>)

        : (!!completions.length ?
                <FlatList
                  keyExtractor={this._keyExtractor}
                  contentContainerStyle={{paddingBottom: 20}}
                  keyboardShouldPersistTaps={'handled'}
                  data={completions}
                  renderItem={this.renderItem}
                />
                :
                <View style={styles.flex1}>
                  <View style={[{paddingVertical: 15, paddingHorizontal: 15, borderBottomWidth: 1}, this.props.theme.lighterGreyBorder]}>
                    <Text style={[this.props.theme.searchResultSummaryText, langStyle, this.props.theme.secondaryText]}>{strings.search.recent_searches}</Text>
                  </View>
                  <FlatList
                    keyExtractor={this._keyExtractor}
                    contentContainerStyle={{paddingBottom: 20}}
                    keyboardShouldPersistTaps={'handled'}
                    data={this.state.recentQueries}
                    renderItem={this.renderItem}
                  />
              </View>)


    );
  }
}

export default AutocompleteList;
