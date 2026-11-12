/**
 * A short notice at the bottom of the screen with one action, gone by itself after a few seconds:
 * "Opened in a new tab - your pinned place is kept" [Go to pinned tab] (owner, 2026-11-12).
 * react-native-root-toast (the app's other notices) has no buttons.
 */
import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export const ACTION_TOAST_MS = 7000;

const ActionToast = ({ text, actionLabel, onAction, onHide, duration = ACTION_TOAST_MS, langStyle }) => {
  useEffect(() => {
    const timer = setTimeout(() => onHide && onHide(), duration);
    return () => clearTimeout(timer);
  }, [text, duration, onHide]);
  return (
    <View style={local.wrap} pointerEvents="box-none" testID="action-toast">
      <View style={local.toast}>
        <Text style={[langStyle, local.text]}>{text}</Text>
        {actionLabel ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => { if (onHide) { onHide(); } if (onAction) { onAction(); } }}
            style={local.action}
            testID="action-toast-action"
          >
            <Text style={[langStyle, local.actionText]}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

ActionToast.propTypes = {
  text: PropTypes.string.isRequired,
  actionLabel: PropTypes.string,
  onAction: PropTypes.func,
  onHide: PropTypes.func,
  duration: PropTypes.number,
  langStyle: PropTypes.any,
};

const local = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 90, alignItems: 'center' },
  toast: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#333333', borderRadius: 8,
    paddingVertical: 10, paddingHorizontal: 14, maxWidth: 560, elevation: 6,
  },
  text: { color: '#ffffff', fontSize: 14, flexShrink: 1 },
  action: { marginStart: 14, paddingVertical: 4 },
  actionText: { color: '#9ecbff', fontSize: 14, fontWeight: 'bold' },
});

export default ActionToast;
