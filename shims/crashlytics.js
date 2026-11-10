/**
 * Stand-in for `@react-native-firebase/crashlytics`.
 *
 * SoferBooks Library does not ship Firebase (no analytics, no crash reporting to a
 * third party). A few modules still import the modular Crashlytics API
 * (getCrashlytics / recordError / log / setAttribute); metro.config.js points that
 * import here, so those call sites keep working and errors just go to the device log.
 *
 * New code should not import Crashlytics at all. The alias exists so files owned by
 * other work in flight (DownloadControl.js, sefaria.js) need no edit; once they drop
 * the import, delete the alias and this file.
 */
const instance = {};

export const getCrashlytics = () => instance;
export const recordError = (_instance, error) => { console.warn(error); };
export const log = (_instance, message) => { if (__DEV__) { console.log(message); } };
export const setAttribute = () => {};
