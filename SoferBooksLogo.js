import React from 'react';
import { View, Text, Platform } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import strings from './LocalizedStrings';

/**
 * The SoferBooks Library logo: Sofer's book-and-quill mark beside the name.
 *
 * The mark is Sofer's own drawing (C:\Users\morde\Sofer\web\src\components\Logo.tsx, `Mark`,
 * the source of the files in Sofer\brand), redrawn path for path with react-native-svg so it
 * stays sharp at any size. On the dark theme the navy parts turn white, as in Sofer's
 * sofer-logo-light.png.
 *
 * The name is set in Cinzel (bundled Android asset font; Latin only), navy with gold:
 * "SoferBooks" navy, "Library" gold. Hebrew interface: "ספריית SoferBooks" (about.*),
 * "ספריית" in gold in the interface font.
 */
export const NAVY = '#1F3366';
export const GOLD = '#C49A3C';

export const BookQuillMark = ({ size = 44, dark = false }) => {
  const ink = dark ? '#FFFFFF' : NAVY;
  const ground = dark ? '#2d2d2b' : '#FFFFFF';
  return (
    <Svg width={size * 230 / 190} height={size} viewBox="0 0 230 190" testID="soferbooks-mark">
      <Defs>
        <LinearGradient id="soferbooksFeather" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={GOLD} />
          <Stop offset="1" stopColor={ink} />
        </LinearGradient>
      </Defs>
      <Path d="M18 40 C50 26 86 28 112 42 L112 132 C86 120 52 118 18 128 Z" fill={ink} />
      <Path d="M118 42 C144 28 180 26 212 40 L212 128 C178 118 144 120 118 132 Z"
        fill="none" stroke={ink} strokeWidth="5" strokeLinejoin="round" />
      <Path d="M8 50 L8 140 C42 130 82 132 112 146 L118 146 C148 132 188 130 222 140 L222 50"
        fill="none" stroke={GOLD} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M34 56 C56 50 78 52 98 60 M34 74 C56 68 78 70 98 78 M34 92 C56 86 78 88 98 96 M34 110 C56 104 78 106 98 114"
        fill="none" stroke={ground} strokeWidth="4" strokeLinecap="round" opacity="0.85" />
      <Path d="M132 60 C152 52 174 50 198 56 M132 78 C152 70 174 68 198 74 M132 96 C152 88 174 86 198 92 M132 114 C150 107 166 105 182 108"
        fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <Path d="M214 70 C186 92 160 124 140 160 L148 164 C164 128 188 98 214 70 Z" fill="url(#soferbooksFeather)" />
      <Path d="M214 70 C190 98 166 130 144 162" fill="none" stroke={ground} strokeWidth="1.5" opacity="0.7" />
      <Path d="M140 160 L148 164 L139 176 Z" fill={ink} />
      <Path d="M60 174 C90 160 112 182 138 176" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
    </Svg>
  );
};

// Cinzel is bundled as an Android asset font only
const cinzel = Platform.OS === 'android' ? { fontFamily: 'Cinzel', fontWeight: 'normal' } : { fontWeight: 'bold' };

export const SoferBooksLogo = ({ dark = false, hebrew = false, size = 'small', style }) => {
  const markSize = size === 'large' ? 64 : 40;
  const fontSize = size === 'large' ? 24 : 19;
  const nameColor = { color: dark ? '#FFFFFF' : NAVY };
  const goldColor = { color: GOLD };
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', marginVertical: 10, flexShrink: 1 }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={strings.a11y.soferbooks_logo}
      testID="soferbooks-logo"
    >
      <BookQuillMark size={markSize} dark={dark} />
      <Text style={{ marginStart: 8, fontSize, letterSpacing: 0.5, flexShrink: 1 }} numberOfLines={1}>
        {hebrew ? (
          <>
            <Text style={[goldColor, { fontWeight: 'bold' }]}>{'ספריית '}</Text>
            <Text style={[nameColor, cinzel]}>SoferBooks</Text>
          </>
        ) : (
          <>
            <Text style={[nameColor, cinzel]}>{'SoferBooks '}</Text>
            <Text style={[goldColor, cinzel]}>Library</Text>
          </>
        )}
      </Text>
    </View>
  );
};

export default SoferBooksLogo;
