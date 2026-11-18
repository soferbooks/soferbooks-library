'use strict';

import { Platform } from 'react-native';

let _isMac = !!Platform.isMacCatalyst;
let _bundleUrl = null;

/**
 * Capture host properties injected from native AppDelegate on startup.
 * On Apple Silicon Macs ("Designed for iPad"), `Platform.isMacCatalyst` is false,
 * so native passes `ProcessInfo.processInfo.isiOSAppOnMac || isMacCatalystApp`.
 */
export function initPlatformInfo(initialProps) {
  if (typeof initialProps?.isMac === 'boolean') {
    _isMac = initialProps.isMac || !!Platform.isMacCatalyst;
  }
  if (typeof initialProps?.bundleUrl === 'string') {
    _bundleUrl = initialProps.bundleUrl;
  }
}

export function isMac() {
  return _isMac;
}

export function getBundleUrl() {
  return _bundleUrl;
}

export function _setIsMacForTests(val) {
  _isMac = !!val;
}

export default isMac;
