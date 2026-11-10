import React from 'react';
import PropTypes from 'prop-types';
import {View, ScrollView, Image, Text} from 'react-native';
import VersionNumber from 'react-native-version-number';
import {BackButtonRow, Header, InterfaceText, SefariaPressable} from './Misc';
import styles from './Styles';
import {useGlobalState} from './Hooks';
import strings from './LocalizedStrings';

const SOFERBOOKS_URL = 'https://soferbooks.com';
const SEFARIA_URL = 'https://www.sefaria.org';
const SOURCE_CODE_URL = 'https://github.com/Sefaria/Sefaria-Mobile';

/**
 * About SoferBooks Library: who makes the app, where the texts come from and under what
 * licences, and the open-source app it is built on. Replaces Sefaria's dedication page.
 */
export const AboutPage = ({ close, openUri }) => {
    const { theme, themeStr } = useGlobalState();
    const logo = themeStr === 'white' ? require('./img/soferbooks-logo.png') : require('./img/soferbooks-logo-light.png');
    const body = [styles.fontSize16, theme.text, {marginTop: 15, lineHeight: 24}];
    const link = [styles.fontSize16, theme.brandColorText, {marginTop: 15, textDecorationLine: 'underline'}];
    return (
        <View style={[{alignSelf: 'stretch', flex: 1}, theme.mainTextPanel]}>
            <ScrollView contentContainerStyle={{paddingHorizontal: 30, paddingBottom: 40}}>
                <BackButtonRow onPress={close} />
                <Header titleKey={'about.about_soferbooks'} />
                <Image source={logo} resizeMode={'contain'} style={styles.aboutLogo} accessibilityLabel={strings.a11y.soferbooks_logo} />
                <InterfaceText stringKey={'about.soferbooks_intro'} extraStyles={body} />
                <InterfaceText stringKey={'about.texts_courtesy'} extraStyles={body} />
                <InterfaceText stringKey={'about.licences'} extraStyles={body} />
                <InterfaceText stringKey={'about.built_on'} extraStyles={body} />
                <SefariaPressable onPress={() => openUri(SOFERBOOKS_URL)}>
                    <Text style={link}>soferbooks.com</Text>
                </SefariaPressable>
                <SefariaPressable onPress={() => openUri(SEFARIA_URL)}>
                    <Text style={link}>sefaria.org</Text>
                </SefariaPressable>
                <SefariaPressable onPress={() => openUri(SOURCE_CODE_URL)}>
                    <InterfaceText stringKey={'about.source_code'} extraStyles={link} />
                </SefariaPressable>
                {VersionNumber.appVersion ?
                    <Text style={[styles.fontSize16, theme.secondaryText, {marginTop: 30, textAlign: 'center'}]}>
                        {`SoferBooks Library ${VersionNumber.appVersion}`}
                    </Text> : null}
            </ScrollView>
        </View>
    );
};

AboutPage.propTypes = {
    close: PropTypes.func.isRequired,
    openUri: PropTypes.func.isRequired,
};
