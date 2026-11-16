#!/usr/bin/env node
/**
 * Takes in the files Sofer's library tools made for this app (see SHARED.md):
 * everything under C:\Users\morde\SoferShared\library-app\for-app is copied to the same path here
 * (extras/dictaRules.json, extras/otzariaRules.json, extras/wikisourceBooks.json,
 * fullLibrarySizes.json, __tests__/fixtures/...). Only files that differ are copied; nothing here
 * is deleted.
 *
 *   node scripts/sync-shared.js          copy them in
 *   node scripts/sync-shared.js --dry    only list what would change
 *
 * SOFER_SHARED may name another shared folder.
 */
const fs = require('fs');
const path = require('path');

const SHARED = process.env.SOFER_SHARED || 'C:\\Users\\morde\\SoferShared';
const FROM = path.join(SHARED, 'library-app', 'for-app');
const TO = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry');

function* files(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { yield* files(p); } else if (e.isFile()) { yield p; }
  }
}

if (!fs.existsSync(FROM)) {
  console.error(`Nothing to take in: ${FROM} does not exist.`);
  process.exit(1);
}
let changed = 0;
for (const src of files(FROM)) {
  const rel = path.relative(FROM, src);
  const dest = path.join(TO, rel);
  const same = fs.existsSync(dest) && Buffer.compare(fs.readFileSync(src), fs.readFileSync(dest)) === 0;
  if (same) { continue; }
  changed += 1;
  console.log(`${dry ? 'would copy' : 'copied'}: ${rel}`);
  if (!dry) {
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.copyFileSync(src, dest);
  }
}
console.log(changed ? `${changed} file(s) ${dry ? 'differ' : 'taken in'}.` : 'Everything is up to date.');
