'use strict'
// The cream theme (owner, 2026-11-20): the light theme's layout on warm paper. Its colours are the
// SoferBooks website's (owner, 2026-11-23: "make it align with our websites look. the background should be
// cream like our cream"; Sofer/web/src/app/globals.css and layout.tsx): one cream for the page, the text
// and the commentary alike (the website's stone-50, #FAF7F0 - the text and the commentary had had two
// different creams), ivory for what stands on it (the website's header), stone for the text and the
// lines, and the website's golds for what is marked. Every style is the light theme's
// (ThemeWhite.makeLightTheme), only the colours differ.
import { makeLightTheme, lightColors } from './ThemeWhite';

export const CREAM = '#FAF7F0';      // the website's page (stone-50)
const IVORY = '#FDFBF6';             // its header and footer
export const creamColors = {
  ...lightColors,
  border: '#E7E5E4',                 // stone-200: the website's lines
  secondaryBorder: '#EFECE6',
  mainBackground: CREAM,
  mainText: '#1C1917',               // stone-900: the website's text
  secondaryText: '#A8A29E',          // stone-400
  tertiaryText: '#57534E',           // stone-600
  quaternaryText: '#D6D3D1',         // stone-300
  mainForeground: IVORY,
  textBackground: CREAM,
  textSectionTitleBorder: '#E7E5E4',
  lightGrey: '#D6D3D1',
  lighterGrey: '#E7E5E4',
  lightestGrey: IVORY,
  textSegmentHighlight: '#F5EAD0',   // gold-100
  wordHighlight: '#EAD5A3',          // gold-200
  textListHeader: '#FBF6EA',         // gold-50
  buttonBackground: IVORY,
};

export default makeLightTheme(creamColors);
