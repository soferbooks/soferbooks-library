'use strict';

import PropTypes from 'prop-types';
import React, { useContext, useReducer } from 'react';
import {
  Text,
  TouchableOpacity,
  View,
  Image,
  Platform,
} from 'react-native';

import ReaderDisplayOptionsMenu from './ReaderDisplayOptionsMenu';
import styles from './Styles.js';
import {
  MenuButton,
  DisplaySettingsButton,
  CategoryAttribution,
  SText,
  HebrewInEnglishText,
  SaveButton,
} from './Misc.js';
import { GlobalStateContext, getTheme } from './StateManager';
import strings from './LocalizedStrings';
import { iconData } from "./IconData";
import Sefaria from "./sefaria";
import { displayRef, displayHeRef } from "./extras/schema7";

const ReaderControls = ({
  enRef,
  heRef,
  categories,
  openTextToc,
  goHome,
  toggleReaderDisplayOptionsMenu,
  openUri,
  sheet,
  getHistoryObject,
  showToast,
  textTitle: bookTitle,
  currVersionObjects,
}) => {
  const { themeStr, textLanguage, interfaceLanguage } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  const historyItem = getHistoryObject();
  const isHeb = Sefaria.util.get_menu_language(interfaceLanguage, textLanguage) == "hebrew";
  var langStyle = isHeb ? [styles.he] : [styles.en, sheet ? {lineHeight: 28} : {marginBottom: -5.3}];
  var titleTextStyle = [langStyle, styles.headerTextTitleText, theme.text];
  // Home, not Back: the top button never moves the reader's place (the owner lost his place with
  // the old Back, which stepped through the reading history). The tab stays where it is, and
  // reopens there from Home; Android's Back still goes back through the history.
  const leftMenuButton = (
      <TouchableOpacity
          style={[styles.headerButton, styles.leftHeaderButton]}
          onPress={goHome}
          accessibilityRole={'button'}
          accessibilityLabel={strings.nav.home}
      >
        <Image
            source={iconData.get('book', themeStr)}
            style={styles.readerHomeButton}
            resizeMode={'contain'}
        />
      </TouchableOpacity>
  );
    var textTitle = isHeb ? displayHeRef(enRef, heRef) : displayRef(enRef, heRef);  // an extra book's section keys: its Hebrew names
    if (sheet) {
      textTitle = Sefaria.util.stripHtml(sheet.title);
    }
  return (
      <View style={[styles.header, theme.header]}>
        {leftMenuButton}
        <View style={styles.readerNavSectionMoreInvisible}>
          <Image
            style={styles.starIcon}
            source={iconData.get('bookmark-unfilled', 'white')}
            resizeMode={'contain'}
          />
        </View>
        <TouchableOpacity style={styles.headerTextTitle} onPress={openTextToc}>
          <View style={styles.headerTextTitleInner}>
            <Image source={iconData.get('caret', themeStr)}
                     style={[styles.downCaret, isHeb ? null: {opacity: 0}]}
                     resizeMode={'contain'} />

            {sheet ?
                <Text lang={textLanguage} style={titleTextStyle} numberOfLines={1} ellipsizeMode={"middle"}><HebrewInEnglishText text={sheet.title} stylesHe={[styles.heInEn]} stylesEn={[]}/></Text> :
                <SText lang={textLanguage} style={titleTextStyle} numberOfLines={1} ellipsizeMode={"middle"} lineMultiplier={Platform.OS == 'ios' ? 1.5 : 1}>{textTitle}</SText>
            }
            <Image source={iconData.get('caret', themeStr)}
                     style={[styles.downCaret, isHeb ? {opacity: 0} : null]}
                     resizeMode={'contain'} />
          </View>
          <CategoryAttribution
            categories={categories}
            title={bookTitle}
            versions={currVersionObjects}
            context={"header"}
            linked={false}
            openUri={openUri}
          />
        </TouchableOpacity>
        <SaveButton
          historyItem={historyItem}
          showToast={showToast}
        />
        <DisplaySettingsButton onPress={toggleReaderDisplayOptionsMenu} />
      </View>
  );
}
ReaderControls.propTypes = {
  enRef:                           PropTypes.string,
  heRef:                           PropTypes.string,
  categories:                      PropTypes.array,
  textTitle:                       PropTypes.string,
  currVersionObjects:              PropTypes.object,
  openTextToc:                     PropTypes.func,
  goHome:                          PropTypes.func,
  toggleReaderDisplayOptionsMenu:  PropTypes.func,
  openUri:                         PropTypes.func.isRequired,
  getHistoryObject:                PropTypes.func.isRequired,
  showToast:                       PropTypes.func.isRequired,
};
ReaderControls.whyDidYouRender = true;

export default ReaderControls;
