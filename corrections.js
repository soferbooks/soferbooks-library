/**
 * Sofer's text corrections, applied to Sefaria's books as they are read.
 *
 * Sefaria's book zips stay exactly as Sefaria serves them. The SoferBooks release brings
 * `library/_corrections/<Title>.json` (built by tools/library-export/sofer_corrections.py
 * from Sefaria's own mobile export, downloaded by packs.js):
 *
 *     {"title": ..., "sefaria_last_updated": ..., "files": {
 *         "<section file name without .json>": [[path, fromHash, toText], ...]}}
 *
 * offline.js passes every section file it reads through applyCorrections(), so the
 * corrections are in force for a book as soon as it is downloaded, and again after every
 * update - nothing on disk has to be rewritten. Each operation carries the md5 (first 12
 * hex digits, of the UTF-8 text) of the passage it corrects: when Sefaria has changed that
 * passage since, the operation does nothing, so an old text is never written over a newer
 * one. fromHash "" is a fill: applied only while the place is empty.
 */
import md5 from 'md5';
import * as FileSystem from 'expo-file-system/legacy';

export const CORRECTIONS_DIR = `${FileSystem.documentDirectory}library/_corrections`;

const cache = new Map();  // title -> {files} | null (no corrections for this book)

export function textHash(text) {
  try {
    return md5(text).substring(0, 12);
  } catch (e) {
    return null;
  }
}

function isEmpty(x) {
  return x === undefined || x === null || (typeof x === 'string' && !x.trim());
}

/** Apply operations to a parsed section file in place; returns how many applied. */
export function applyOps(payload, ops) {
  let applied = 0;
  for (const op of ops || []) {
    if (!Array.isArray(op) || op.length < 3 || !Array.isArray(op[0]) || !op[0].length) { continue; }
    const [path, fromHash, toText] = op;
    let node = payload;
    let ok = true;
    for (const key of path.slice(0, -1)) {
      if (Array.isArray(node) && Number.isInteger(key) && key >= 0 && key < node.length) {
        node = node[key];
      } else if (node && typeof node === 'object' && !Array.isArray(node)
          && typeof key === 'string' && key in node) {
        node = node[key];
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) { continue; }
    const last = path[path.length - 1];
    let current;
    if (Array.isArray(node) && Number.isInteger(last) && last >= 0) {
      current = node[last];
    } else if (node && typeof node === 'object' && !Array.isArray(node) && typeof last === 'string') {
      current = node[last];
    } else {
      continue;
    }
    if (fromHash === '') {
      if (!isEmpty(current)) { continue; }
    } else if (typeof current !== 'string' || textHash(current) !== fromHash) {
      continue;
    }
    if (Array.isArray(node)) {
      while (node.length <= last) { node.push(''); }
    }
    node[last] = toText;
    applied += 1;
  }
  return applied;
}

async function correctionsFor(title) {
  if (!title) { return null; }
  if (cache.has(title)) { return cache.get(title); }
  let data = null;
  const path = `${CORRECTIONS_DIR}/${title}.json`;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(path));
      data = parsed && parsed.files ? parsed : null;
    }
  } catch (e) {
    data = null;  // a damaged file: read the book as Sefaria has it
  }
  cache.set(title, data);
  return data;
}

/**
 * The section file's JSON with Sofer's corrections for it (the same object, changed in
 * place). `fileName` is the section file's name without ".json"
 * ("Genesis 4.beac3f51.he").
 */
export async function applyCorrections(title, fileName, payload) {
  if (!payload || typeof payload !== 'object') { return payload; }
  try {
    const data = await correctionsFor(title);
    const ops = data && data.files[fileName];
    if (ops) { applyOps(payload, ops); }
  } catch (e) {
    // never let a correction stop a book from opening
  }
  return payload;
}

/** Forget what was read (after a new corrections file is installed). */
export function clearCorrectionsCache() {
  cache.clear();
}
