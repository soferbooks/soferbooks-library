/**
 * The phone's storage, for the downloads (QA round 14: a full-library download filled the disk,
 * Android then cleared the app's cache folder under a book being unzipped, and the unzip crashed
 * the app; a Sefaria bundle unzipped over the books it replaced left them half written).
 *
 *   - Free space (expo-file-system's getFreeDiskStorageAsync): a download starts only when what
 *     it will take, and a margin, fits; the background downloads pause when the phone runs low.
 *   - Work files live in the app's documents folder (WORK_DIR), not its cache folder, which
 *     Android empties when space runs low - under a download that is still using them.
 *   - Every unzip is checked first (the zip is there and not empty) and its failure is an error
 *     the caller handles, never a crash.
 *   - A file is replaced only once its new copy is complete (replaceFile): the old one is kept
 *     until then, and put back if the new one cannot be moved in.
 */
import * as FileSystem from 'expo-file-system/legacy';
import {unzip} from 'react-native-zip-archive';

export const WORK_DIR = `${FileSystem.documentDirectory}work/`;
export const MB = 1e6;
// what must stay free beyond what a download will take (the phone, other apps)
export const MARGIN_BYTES = 300 * MB;
// the background downloads pause when less than this is free
export const LOW_SPACE_BYTES = 400 * MB;

export class LowSpaceError extends Error {
  constructor(needed, free) {
    super(`not enough space: ${Math.round(needed / MB)} MB needed, ${Math.round(free / MB)} MB free`);
    this.name = 'LowSpaceError';
    this.needed = needed;
    this.free = free;
  }
}

export class UnzipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnzipError';
  }
}

let fakeFree = null;    // (tests)

/** Bytes free on the phone, or null when it cannot be told */
export async function freeBytes() {
  if (fakeFree !== null) { return fakeFree; }
  try {
    if (!FileSystem.getFreeDiskStorageAsync) { return null; }
    const n = await FileSystem.getFreeDiskStorageAsync();
    return typeof n === 'number' && n >= 0 ? n : null;
  } catch (e) {
    return null;
  }
}

/** Whether `bytes` fit with `margin` to spare (true when the free space cannot be told) */
export async function hasRoom(bytes, margin = MARGIN_BYTES) {
  const free = await freeBytes();
  return free === null || free >= (bytes || 0) + margin;
}

/** Throws LowSpaceError when `bytes` and `margin` do not fit */
export async function ensureRoom(bytes, margin = MARGIN_BYTES) {
  const free = await freeBytes();
  if (free !== null && free < (bytes || 0) + margin) { throw new LowSpaceError((bytes || 0) + margin, free); }
  return free;
}

/** A folder for work files (created), under WORK_DIR */
export async function workDir(name) {
  const dir = `${WORK_DIR}${name}/`;
  await FileSystem.makeDirectoryAsync(dir, {intermediates: true}).catch(() => {});
  return dir;
}

/** Delete work files: one folder of WORK_DIR, or all of it */
export async function cleanWork(name = null) {
  await FileSystem.deleteAsync(name ? `${WORK_DIR}${name}/` : WORK_DIR, {idempotent: true}).catch(() => {});
}

/** Unzip `zipPath` into `dest`, after checking it is there and not empty. Throws UnzipError. */
export async function safeUnzip(zipPath, dest) {
  let info = null;
  try { info = await FileSystem.getInfoAsync(zipPath); } catch (e) { info = null; }
  if (!info || !info.exists) { throw new UnzipError(`no zip at ${zipPath}`); }
  if (!info.size) { throw new UnzipError(`empty zip at ${zipPath}`); }
  try {
    return await unzip(zipPath, dest);
  } catch (e) {
    throw new UnzipError(`could not unzip ${zipPath}: ${(e && e.message) || e}`);
  }
}

/**
 * Put the complete file `from` at `to`: the old copy is moved aside first and deleted only once
 * the new one is in place (put back if the move fails).
 */
export async function replaceFile(from, to) {
  const aside = `${to}.old`;
  let had = false;
  try { had = !!(await FileSystem.getInfoAsync(to)).exists; } catch (e) { had = false; }
  if (had) {
    await FileSystem.deleteAsync(aside, {idempotent: true}).catch(() => {});
    await FileSystem.moveAsync({from: to, to: aside});
  }
  try {
    await FileSystem.moveAsync({from, to});
  } catch (e) {
    if (had) { await FileSystem.moveAsync({from: aside, to}).catch(() => {}); }
    throw e;
  }
  if (had) { await FileSystem.deleteAsync(aside, {idempotent: true}).catch(() => {}); }
}

/** Bytes a file or folder takes (0 when it is not there) */
export async function sizeOf(path) {
  try {
    const info = await FileSystem.getInfoAsync(path, {size: true});
    return (info && info.exists && info.size) || 0;
  } catch (e) {
    return 0;
  }
}

// (tests)
export function _setFreeBytes(n) { fakeFree = n; }
