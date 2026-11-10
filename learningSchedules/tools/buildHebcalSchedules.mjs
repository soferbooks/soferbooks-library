#!/usr/bin/env node
/**
 * Builds learningSchedules/data/hebcalSchedules.json from Hebcal's open-source learning schedules
 * (@hebcal/learning, BSD-2-Clause, https://github.com/hebcal/hebcal-learning), for the schedules
 * Sefaria's calendar.json does not have. The app reads the JSON, so it works offline and needs
 * no ESM-only package at run time.
 *
 *  - psalms: the 30-day Tehillim cycle by Hebrew day of the month (`dailyPsalms`), as a table
 *  - mishnahBerurah: Dirshu's Daf HaYomi B'Halacha, the daily Mishnah Berurah program
 *    (`dirshuDafHalacha`), one entry per day from FROM to the end of Hebcal's transcribed luach
 *
 * Usage (not a dependency of the app; install it anywhere and point at it):
 *   npm install --prefix <dir> @hebcal/learning@6
 *   HEBCAL_LEARNING=<dir>/node_modules/@hebcal/learning node learningSchedules/tools/buildHebcalSchedules.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'data', 'hebcalSchedules.json');
const FROM = new Date(2026, 9, 1);  // 1 October 2026

const pkgDir = process.env.HEBCAL_LEARNING;
const load = async file => (pkgDir
  ? import(pathToFileURL(path.join(pkgDir, 'dist', 'esm', file)).href)
  : import(`@hebcal/learning/${file.replace(/\.js$/, '')}`));
const pkgVersion = pkgDir ? JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version : 'installed';

const { dailyPsalms } = await load('psalmsBase.js');
const { dirshuDafHalacha, dirshuDafHalachaEnd } = await load('dirshuDafHalachaBase.js');

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// @hebcal/hdate, the package's own dependency, for Hebrew days
const { HDate } = await (pkgDir
  ? import(pathToFileURL(path.join(pkgDir, '..', 'hdate', 'dist', 'esm', 'index.js')).href)
  : import('@hebcal/hdate'));

// Psalms: one portion per Hebrew day of the month; a 29-day month reads the 29th and 30th
// together. Walk a few Hebrew months and table the package's answer by Hebrew day.
const byDay = {};
let shortMonth29 = null;
for (let d = FROM, i = 0; i < 120; i++, d = addDays(d, 1)) {
  const hd = new HDate(d);
  const portion = dailyPsalms(d);
  if (hd.getDate() === 29 && hd.daysInMonth() === 29) { shortMonth29 = portion; } else { byDay[hd.getDate()] = portion; }
}

// Mishnah Berurah (Dirshu): one entry per day; null where Hebcal has no reading
const mb = [];
const end = dirshuDafHalachaEnd;
for (let d = FROM; ; d = addDays(d, 1)) {
  const r = dirshuDafHalacha(d);
  if (!r) {
    if (mb.length && new HDate(d).abs() > end) { break; }
    mb.push(null);
    continue;
  }
  mb.push(r.review ? { b: r.b, e: r.e, review: true } : { b: r.b, e: r.e });
}
while (mb.length && mb[mb.length - 1] === null) { mb.pop(); }

const out = {
  source: `@hebcal/learning ${pkgVersion} (BSD-2-Clause), https://github.com/hebcal/hebcal-learning`,
  built: iso(new Date()),
  psalms: { byHebrewDay: byDay, shortMonth29 },
  mishnahBerurah: {
    name: "Dirshu Daf HaYomi B'Halacha",
    from: iso(FROM),
    readings: mb.map(r => (r ? [r.b, r.e || null, r.review ? 1 : 0] : null)),
  },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`wrote ${OUT}: psalms days ${Object.keys(byDay).length}, Mishnah Berurah days ${mb.length} (to ${iso(addDays(FROM, mb.length - 1))})`);
