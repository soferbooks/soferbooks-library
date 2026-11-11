/**
 * "Order a printed copy": a small link to the sefer on soferbooks.com, shown only when Sofer
 * sells it (soferPrint.js). Shown as an outlined button in the brand colour, so it is seen: in the
 * book's table of contents, in "About this text" (AboutBox), and in the reader's display menu.
 */
import PropTypes from 'prop-types';
import React from 'react';
import {Linking, StyleSheet, Text, TouchableOpacity} from 'react-native';
import strings from './LocalizedStrings';
import styles from './Styles';
import {useGlobalState} from './Hooks';
import {orderUrl, usePrintableTitle} from './soferPrint';

const PrintCopyLink = ({title, heTitle, style}) => {
  const {theme, interfaceLanguage} = useGlobalState();
  const sofer = usePrintableTitle(title, heTitle);
  if (!sofer) { return null; }
  const langStyle = interfaceLanguage === 'hebrew' ? styles.heInt : styles.enInt;
  // (the phone's browser, not the in-app one: an order needs the site's sign-in)
  const open = () => { Linking.openURL(orderUrl(sofer)).catch(() => {}); };
  return (
    <TouchableOpacity onPress={open} accessibilityRole="link" testID="printCopyLink" style={[localStyles.button, theme.lighterGreyBorder, style]}>
      <Text style={[langStyle, theme.brandColorText, localStyles.text]}>
        {strings.reader.order_printed_copy}
      </Text>
    </TouchableOpacity>
  );
};
const localStyles = StyleSheet.create({
  button: {alignSelf: 'center', marginVertical: 10, paddingVertical: 8, paddingHorizontal: 18, borderWidth: 1, borderRadius: 20},
  text: {fontSize: 15, fontWeight: 'bold', textAlign: 'center'},
});

PrintCopyLink.propTypes = {
  title: PropTypes.string,
  heTitle: PropTypes.string,
  style: PropTypes.any,
};

export default PrintCopyLink;
