'use strict';

import React from 'react';
import {View} from 'react-native';
import {SimpleInterfaceBlock, SimpleContentBlock, SimpleLinkedBlock} from './Misc';
import styles from './Styles';
import {useGlobalState} from './Hooks';

/**
 * Building blocks for a text preview card (a ref title over a colour-barred text snippet),
 * used by search results and the Saved/History page. These are what was left of Sefaria's
 * Story.js once its news-feed cards were removed.
 */

export const PreviewFrame = ({extraStyles, children}) => (
    <View style={extraStyles}>
        {children}
    </View>
);

export const PreviewTitleBlock = ({ he, en, children, onClick }) => {
    const { interfaceLanguage } = useGlobalState();
    const SBlock = onClick ? SimpleLinkedBlock : SimpleInterfaceBlock;
    const isHeb = interfaceLanguage === 'hebrew';
    return (
        <View style={{flex: 1}}>
            <SBlock he={he} en={en} extraStyles={[styles.topicSourceTitle, isHeb ? styles.he : styles.en]} onClick={onClick} />
            {children}
        </View>
    );
};

export const ColorBarBox = ({tref, children}) => {
    const { interfaceLanguage } = useGlobalState();
    const langStyle = interfaceLanguage == 'hebrew' ? styles.colorBarBoxHebrew : styles.colorBarBoxEnglish;
    return (<View style={[langStyle, {"borderColor": Sefaria.palette.refColor(tref)}]}>{children}</View>);
};

export const PreviewBodyBlock = ({en, he}) => <SimpleContentBlock en={en} he={he}/>;
