/**
 * "Order a printed copy": a small link to the sefer on soferbooks.com, shown only when Sofer
 * sells it (soferPrint.js). Used in the book's table of contents and in the reader's display menu.
 */
import PropTypes from 'prop-types';
import React from 'react';
import {Linking, Text, TouchableOpacity} from 'react-native';
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
    <TouchableOpacity onPress={open} accessibilityRole="link" style={[{paddingVertical: 6}, style]}>
      <Text style={[langStyle, theme.text, {fontSize: 14, textAlign: 'center', textDecorationLine: 'underline'}]}>
        {strings.reader.order_printed_copy}
      </Text>
    </TouchableOpacity>
  );
};
PrintCopyLink.propTypes = {
  title: PropTypes.string,
  heTitle: PropTypes.string,
  style: PropTypes.any,
};

export default PrintCopyLink;
