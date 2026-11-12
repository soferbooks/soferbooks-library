/**
 * Is the phone online? (@react-native-community/netinfo, as the rest of the app asks it.)
 * Used where a download needs a server the phone cannot reach offline: Dicta's books are made from
 * pages fetched from Dicta's server (owner, 2026-11-12: while offline, Dicta's downloads are not
 * offered, and say why). Books already downloaded stay readable offline.
 */
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/** NetInfo's state -> false only when it says the phone is offline (unknown counts as online) */
export const isOnlineState = state => !(state && (state.isConnected === false || state.isInternetReachable === false));

/** The sources whose books cannot be downloaded without a connection to the source's server */
export const NEEDS_CONNECTION_TO_DOWNLOAD = new Set(['dicta']);
export const downloadNeedsConnection = sourceId => NEEDS_CONNECTION_TO_DOWNLOAD.has(sourceId);

/** Online now? (a promise; true when it cannot be told) */
export async function isOnline() {
  try { return isOnlineState(await NetInfo.fetch()); } catch (e) { return true; }
}

/** A hook: online, kept up to date (true until NetInfo says otherwise) */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let alive = true;
    isOnline().then(o => { if (alive) { setOnline(o); } });
    const unsubscribe = NetInfo.addEventListener(state => { if (alive) { setOnline(isOnlineState(state)); } });
    return () => { alive = false; if (typeof unsubscribe === 'function') { unsubscribe(); } };
  }, []);
  return online;
}
