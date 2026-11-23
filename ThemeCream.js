'use strict'
// The cream theme (owner, 2026-11-20): the light theme's layout on warm paper - a cream page, its
// panels a shade deeper, the text a dark brown-black. Every style is the light theme's
// (ThemeWhite.makeLightTheme), only the colours differ.
import { makeLightTheme, lightColors } from './ThemeWhite';

export const creamColors = {
  ...lightColors,
  border: '#E3D5B8',
  secondaryBorder: '#EFE4CC',
  // (the same cream as the text's - the connections panel, the menus and the pages were a shade deeper,
  //  which showed as a second colour beside the text: owner, 2026-11-23)
  mainBackground: '#FBF4E4',
  mainText: '#2B2116',
  secondaryText: '#8F8270',
  tertiaryText: '#6B5E4C',
  quaternaryText: '#BFB39C',
  mainForeground: '#FBF4E4',
  textBackground: '#FBF4E4',
  textSectionTitleBorder: '#E6D9BE',
  lightGrey: '#D6C9AE',
  lighterGrey: '#EADFC6',
  lightestGrey: '#F7EEDB',
  textSegmentHighlight: '#F1E3BF',
  wordHighlight: '#E9D49C',
  textListHeader: '#EFE4CB',
  buttonBackground: '#FBF4E4',
};

export default makeLightTheme(creamColors);
