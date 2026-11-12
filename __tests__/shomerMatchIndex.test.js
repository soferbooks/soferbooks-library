/**
 * shomer/matcher.js match() works out each config's rules once, indexes them by their terms'
 * first words and keeps each name's answer (it filters the whole TOC at startup). This checks
 * it answers exactly as the plain rule-by-rule loop it replaced, over every name in toc.json
 * and search_toc.json plus each rule's terms in and around other words.
 */
import { withDefault } from '../shomer/presets';
const fs = require('fs');

test('match() answers as the plain rule-by-rule loop', () => {
  const orig = require('../shomer/matcher');
  const { GROUPS, normalize: norm } = require('../shomer/presets');
  const toc = JSON.parse(fs.readFileSync('android/app/src/main/assets/sources/toc.json', 'utf8'));
  const stoc = JSON.parse(fs.readFileSync('android/app/src/main/assets/sources/search_toc.json', 'utf8'));
  // reference: the pre-change match, inlined
  const lower = l => (l || []).map(s => String(s).toLowerCase().trim()).filter(Boolean);
  const decode = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const ref = (cfg, text, href) => {
    if (!cfg || !cfg.active) return null;
    const hides = g => !!(cfg.groups && cfg.groups[g]);
    const raw = decode((text || '') + ' ' + (href || '')).toLowerCase();
    const hay = raw + ' ' + raw.replace(/[_/.,:()-]/g, ' ');
    if (lower(cfg.customWhitelist).some(w => hay.includes(w))) return null;
    const own = lower(cfg.customBlacklist).find(b => hay.includes(b));
    if (own) return { reason: 'your list: ' + own };
    let names = null;
    for (const r of orig.RULES) {
      if (!hides(r.group) || r.exceptions.some(x => hay.includes(x))) continue;
      if (r.terms.some(t => orig.hasWord(hay, t))) return { reason: r.name };
      if (r.titles && r.titles.length) { names = names || orig.namesOf(decode(text || ''), href);
        if (r.titles.some(t => names.some(n => orig.isTitle(n, t)))) return { reason: r.name }; }
    }
    return null;
  };
  const allOn = norm({ preset: 'rwmo', groups: Object.fromEntries(GROUPS.map(g => [g.id, true])) });
  const cfgs = [norm(withDefault(null)), allOn, norm({ preset: 'rwmo', customBlacklist: ['Rashi'], customWhitelist: ['steinsaltz'] })];
  const texts = [];
  const walk = t => t.forEach(x => { if (x.contents) { texts.push([x.category, x.heCategory].filter(Boolean).join(' | ')); walk(x.contents); } else texts.push(orig.bookText(x)); });
  walk(toc); walk(stoc);
  for (const r of orig.RULES) for (const t of r.terms.concat(r.titles, r.exceptions)) { texts.push('Intro ' + t + ' 1:2', t + 'x', 'x' + t, t.toUpperCase(), 'A | ' + t + ', B'); }
  let diffs = 0, hits = 0;
  for (const cfg of cfgs) for (const t of texts) {
    const a = ref(cfg, t), b = orig.match(cfg, t);
    if (a) hits++;
    if ((a && a.reason) !== (b && b.reason)) diffs++;
  }
  expect(hits).toBeGreaterThan(1000);
  expect(diffs).toBe(0);
});
