// The start-up shortcuts (32-bit tablet, 2026-11-21) give the same answers as before
import { normTitle } from '../extras/tree';
import { match, seenAnswers, seedAnswers, isTitle, compileRules } from '../shomer/matcher';
import { normalize } from '../shomer/presets';

const oldNorm = t => String(t || '').replace(/[-–־]/g, ' ').replace(/[֑-׉]/g, '')
  .replace(/["'״׳”“‘’,.()[\]]/g, '').replace(/\s+/g, ' ').trim();

test('normTitle: a name with nothing to change returned as it is, the others as before', () => {
  const names = ['  a  b ', 'x\ty', 'שִׁיר', 'a-b', 'ab ', ' ab', 'a b', null, '', 'Genesis', 'Rashi on Genesis',
    'שולחן ערוך, אורח חיים', 'ספר "המצוות"', 'מגילת אנטיוכוס (מהדורת הרב מנשה זליכה)', 'Ben Ish Hai', 'Tur, Orach Chayim',
    'חק לישראל', 'אור החיים־הקדוש', 'Rabbi Akiva Eiger on Mishnah'];
  for (const n of names) { expect(normTitle(n)).toBe(oldNorm(n)); expect(normTitle(n)).toBe(oldNorm(n)); }
});

test('the content filter: a whole-title rule still matches the name and refs into it, not a longer name', () => {
  const rules = compileRules([{ id: 't', name: 'T', group: 'reform', titles: ['Orot'], keywords: [] }]);
  const cfg = normalize({ preset: 'centrist_mo' });
  expect(match(cfg, 'Orot', '', rules)).toMatchObject({ reason: 'T' });
  expect(match(cfg, 'Orot 1:2', '', rules)).toMatchObject({ reason: 'T' });
  expect(match(cfg, 'Orot, Introduction', '', rules)).toMatchObject({ reason: 'T' });
  expect(match(cfg, 'Orot.1', '', rules)).toMatchObject({ reason: 'T' });
  expect(match(cfg, 'Orot Chaim', '', rules)).toBeNull();
  expect(isTitle('orot chaim', 'orot')).toBe(false);
});

test('the content filter\'s answers kept from one start to the next are used as they are', () => {
  const cfg = normalize({ preset: 'centrist_mo' });
  match(cfg, 'Genesis | בראשית');
  const kept = seenAnswers(cfg);
  expect(kept.length).toBeGreaterThan(0);
  const next = normalize({ preset: 'centrist_mo' });      // (the next start: a new config, the same settings)
  seedAnswers(next, [['Made Up Name\u0000',{ reason: 'kept', translation: false, group: null }]]);
  expect(match(next, 'Made Up Name')).toMatchObject({ reason: 'kept' });
});
