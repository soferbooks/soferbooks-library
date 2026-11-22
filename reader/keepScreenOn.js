/**
 * Keeping the screen on while reading (owner, 2026-11-22: "can we add a setting to keep screen on
 * (for longer)"). The choice, in Settings: the phone's own timeout ('off'), 5, 10 or 30 minutes after
 * the last touch (then the phone's own timeout counts from there), or all the while the app is open.
 * expo-keep-awake does the keeping (Android: the window's FLAG_KEEP_SCREEN_ON; iOS: the idle timer).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export const KEEP_SCREEN_ON_KEY = 'keepScreenOn.v1';
export const KEEP_SCREEN_ON_CHOICES = ['off', '5', '10', '30', 'always'];
const TAG = 'sofer-keep-screen-on';

let choice = 'off';
let loaded = null;
const listeners = new Set();
let lastTouch = 0;
let timer = null;
let on = false;
let foreground = AppState.currentState !== 'background';

/** Minutes to keep the screen on after a touch (0: never; Infinity: always) */
export const minutesOf = c => (c === 'always' ? Infinity : (KEEP_SCREEN_ON_CHOICES.includes(c) && c !== 'off' ? Number(c) : 0));

/** Should the screen be kept on now? (pure: the tests) */
export const wantOn = (c, isForeground, msSinceTouch) => {
  const minutes = minutesOf(c);
  return !!isForeground && minutes > 0 && (minutes === Infinity || msSinceTouch < minutes * 60000);
};

const set = want => {
  if (want === on) { return; }
  on = want;
  try {
    if (want) { activateKeepAwakeAsync(TAG).catch(() => {}); } else { deactivateKeepAwake(TAG); }
  } catch (e) { /* (not linked: the phone's own timeout) */ }
};

const apply = () => {
  clearTimeout(timer);
  timer = null;
  const since = Date.now() - lastTouch;
  const want = wantOn(choice, foreground, since);
  set(want);
  const minutes = minutesOf(choice);
  if (want && minutes !== Infinity) {
    timer = setTimeout(apply, minutes * 60000 - since + 50);
  }
};

export const loadKeepScreenOn = () => {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEEP_SCREEN_ON_KEY)
      .then(v => { if (KEEP_SCREEN_ON_CHOICES.includes(v)) { choice = v; } })
      .catch(() => {})
      .then(() => { lastTouch = Date.now(); apply(); return choice; });
  }
  return loaded;
};

export const getKeepScreenOn = () => choice;

export const setKeepScreenOn = async value => {
  if (!KEEP_SCREEN_ON_CHOICES.includes(value)) { return; }
  choice = value;
  lastTouch = Date.now();
  apply();
  listeners.forEach(fn => fn(choice));
  await AsyncStorage.setItem(KEEP_SCREEN_ON_KEY, value).catch(() => {});
};

export const subscribeKeepScreenOn = fn => { listeners.add(fn); return () => listeners.delete(fn); };

/** A touch anywhere in the app: the minutes count again from now */
export const noteTouch = () => {
  lastTouch = Date.now();
  if (choice !== 'off' && choice !== 'always' && (!on || timer)) { apply(); }
};

let started = false;
/** Once, when the app starts: the choice read, and the app's going to the background followed */
export const startKeepScreenOn = () => {
  if (started) { return; }
  started = true;
  loadKeepScreenOn();
  AppState.addEventListener('change', state => {
    foreground = state === 'active';
    if (foreground) { lastTouch = Date.now(); }
    apply();
  });
};
