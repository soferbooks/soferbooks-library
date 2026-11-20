import { NativeModules } from 'react-native';
import mockRNCNetInfo from '@react-native-community/netinfo/jest/netinfo-mock.js';

jest.mock('@react-native-community/netinfo', () => mockRNCNetInfo);


// NativeModules.RNCNetInfo = {
//   getCurrentState: jest.fn(),
//   addListener: jest.fn(),
//   removeListeners: jest.fn()
// };

// Offline search is off by default in the app (searchPrefs.js); the tests of search files,
// packs and conversions were written with it on
require('./searchPrefs')._setOfflineSearchForTests(true);
