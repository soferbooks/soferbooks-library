'use strict';

import { Platform } from 'react-native';
import VersionNumber from 'react-native-version-number';

// Without an explicit User-Agent the apps reach the server as the platform
// default (CFNetwork on iOS, bare okhttp on Android). SoferBooks identifies itself
// honestly to the Sefaria API it reads texts from, rather than as Sefaria's own app.
const service = `SoferBooksLibrary/mobile-${Platform.OS}`;
export const USER_AGENT = VersionNumber.appVersion
  ? `${service} (${VersionNumber.appVersion})`
  : service;
