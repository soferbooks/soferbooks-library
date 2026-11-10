'use strict';

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Phone layout: the connections (commentary) panel takes the bottom part of the reader body and
 * the divider (the panel's header) can be dragged up and down, as in Sefaria's app. `flex` is
 * the panel's share of the reader body's height (0..1).
 */

export const PANEL_FLEX_STORAGE_KEY = 'textListFlexPreference';
export const DEFAULT_PANEL_FLEX = 0.6;
export const MIN_PANEL_FLEX = 0.001;
export const MAX_PANEL_FLEX = 0.999;
// Released above/below these the panel snaps to full height / closes.
export const SNAP_FULL_FLEX = 0.9;
export const SNAP_CLOSE_FLEX = 0.2;

/**
 * Panel share for a finger at `pageY`, given the reader body's top (page coordinates) and
 * height. `grabOffset` keeps the divider from jumping to the finger: it is the distance between
 * where the panel top was and where the drag started (in flex units).
 */
export const panelFlexForTouch = (pageY, bodyTop, bodyHeight, grabOffset = 0) => {
  if (!bodyHeight || bodyHeight <= 0) { return DEFAULT_PANEL_FLEX; }
  const flex = 1.0 - (pageY - bodyTop) / bodyHeight + grabOffset;
  return Math.min(MAX_PANEL_FLEX, Math.max(MIN_PANEL_FLEX, flex));
};

/** What to do when the drag ends: 'full', 'close' or 'keep' (remember as the preferred height). */
export const panelReleaseAction = flex => (flex > SNAP_FULL_FLEX ? 'full' : (flex < SNAP_CLOSE_FLEX ? 'close' : 'keep'));

export const loadPanelFlexPreference = async () => {
  try {
    const v = parseFloat(await AsyncStorage.getItem(PANEL_FLEX_STORAGE_KEY));
    return v >= SNAP_CLOSE_FLEX && v <= SNAP_FULL_FLEX ? v : DEFAULT_PANEL_FLEX;
  } catch (e) {
    return DEFAULT_PANEL_FLEX;
  }
};

export const savePanelFlexPreference = flex => AsyncStorage.setItem(PANEL_FLEX_STORAGE_KEY, String(flex)).catch(() => {});

// Height of the reader header (ReaderControls); the display (Aa) menu opens just below it.
export const READER_HEADER_HEIGHT = 58;

/**
 * Top of the display (Aa) menu: below the header, the tab bar and the schedule bar, so the
 * schedule bar stays in view while the menu is open. undefined = the menu's own default (58).
 */
export const displayMenuTop = (tabBarHeight = 0, scheduleBarHeight = 0) => {
  const extra = (tabBarHeight || 0) + (scheduleBarHeight || 0);
  return extra > 0 ? READER_HEADER_HEIGHT + extra : undefined;
};
