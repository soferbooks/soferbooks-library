'use strict';

import * as FileSystem from 'expo-file-system/legacy';
import { getBundleUrl } from '../isMac';

export const FONT_FILES = {
  FrankSofer: [
    { file: 'FrankSofer.ttf', weight: '400', style: 'normal' },
    { file: 'FrankSofer_bold.ttf', weight: '700', style: 'normal' },
  ],
  VilnaSofer: [
    { file: 'VilnaSofer.ttf', weight: '400', style: 'normal' },
    { file: 'VilnaSofer_bold.ttf', weight: '700', style: 'normal' },
  ],
  Hadassah: [
    { file: 'Hadassah.ttf', weight: '400', style: 'normal' },
    { file: 'Hadassah_bold.ttf', weight: '700', style: 'normal' },
  ],
  MekorotRashi: [
    { file: 'MekorotRashi.ttf', weight: '400', style: 'normal' },
    { file: 'MekorotRashi_bold.ttf', weight: '700', style: 'normal' },
  ],
  Amiri: [
    { file: 'Amiri-Regular.ttf', weight: '400', style: 'normal' },
    { file: 'Amiri-Bold.ttf', weight: '700', style: 'normal' },
    { file: 'Amiri-Slanted.ttf', weight: '400', style: 'italic' },
    { file: 'Amiri-BoldSlanted.ttf', weight: '700', style: 'italic' },
  ],
  'MiriamLibre-Regular': [
    { file: 'MiriamLibre-VariableFont_wght.ttf', weight: '400', style: 'normal' },
  ],
};

export const MAC_THEME_PALETTES = {
  white: {
    bg: '#ffffff',
    text: '#000000',
    secondary: '#999999',
    tertiary: '#666666',
    quaternary: '#bebebe',
    border: '#e6e5e6',
    highlight: '#f0f7ff',
    bullet: '#000000',
    biEn: '#666666',
    link: '#1F3366',
  },
  black: {
    bg: '#333331',
    text: '#ffffff',
    secondary: '#dddddd',
    tertiary: '#bbbbbb',
    quaternary: '#999999',
    border: '#666666',
    highlight: '#343444',
    bullet: '#ffffff',
    biEn: '#bbbbbb',
    link: '#7aa7ff',
  },
};

const _fontCssCache = new Map();

export async function loadFontFaceCSS(families) {
  const baseDir = getBundleUrl() || FileSystem.bundleDirectory;
  if (!baseDir) { return ''; }
  const normalizedBase = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  const encoding = (FileSystem.EncodingType && FileSystem.EncodingType.Base64) || 'base64';

  const uniqueFamilies = [...new Set((families || []).filter(f => f && FONT_FILES[f]))];
  const rules = [];

  for (const family of uniqueFamilies) {
    if (_fontCssCache.has(family)) {
      const cached = _fontCssCache.get(family);
      if (cached) { rules.push(cached); }
      continue;
    }
    const specs = FONT_FILES[family];
    const familyRules = [];
    for (const spec of specs) {
      try {
        const b64 = await FileSystem.readAsStringAsync(`${normalizedBase}${spec.file}`, { encoding });
        if (b64) {
          familyRules.push(
            `@font-face { font-family: '${family}'; src: url('data:font/ttf;base64,${b64}') format('truetype'); font-weight: ${spec.weight}; font-style: ${spec.style}; font-display: swap; }`
          );
        }
      } catch (e) {
        // Ignore missing/unreadable bundled font; WebView falls back to system serif
      }
    }
    const joined = familyRules.join('\n');
    if (joined) {
      _fontCssCache.set(family, joined);
      rules.push(joined);
    }
  }
  return rules.join('\n');
}

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toJsLiteral(val) {
  return JSON.stringify(val)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/<\//g, '<\\/');
}
