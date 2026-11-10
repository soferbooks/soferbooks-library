const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');
const path = require('path');

// SoferBooks ships without Firebase: route the remaining Crashlytics imports to a local
// no-op shim (see shims/crashlytics.js).
const MODULE_ALIASES = {
  '@react-native-firebase/crashlytics': path.resolve(__dirname, 'shims/crashlytics.js'),
};

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/**
 * Metro configuration
 * * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */


const config = {
  transformer: {
    babelTransformerPath: require.resolve("react-native-svg-transformer")
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== "svg"),
    sourceExts: [...sourceExts, "svg"],
    resolveRequest: (context, moduleName, platform) => {
      if (MODULE_ALIASES[moduleName]) {
        return { type: 'sourceFile', filePath: MODULE_ALIASES[moduleName] };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  }
};

module.exports = mergeConfig(defaultConfig, config);
