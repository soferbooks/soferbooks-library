/**
 * Android's button bar (back, home, recent apps) in the reading theme's colour (owner, 2026-11-23: "if the
 * bottom bar (android buttons) can match the background color"): the theme's one background, with dark
 * buttons on the white and cream themes and light ones on the dark theme. expo-navigation-bar does it
 * (the window's navigation bar colour). Nothing on iOS, which has no such bar.
 */
import { Platform, StyleSheet } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { getTheme } from '../StateManager';

let last = null;

export function matchNavigationBar(themeStr) {
  if (Platform.OS !== 'android' || !themeStr || themeStr === last) { return; }
  last = themeStr;
  const panel = StyleSheet.flatten(getTheme(themeStr).mainTextPanel) || {};
  const color = panel.backgroundColor;
  if (!color) { return; }
  NavigationBar.setBackgroundColorAsync(color).catch(() => {});
  NavigationBar.setButtonStyleAsync(themeStr === 'black' ? 'light' : 'dark').catch(() => {});
}

export const _resetNavigationBar = () => { last = null; };
