// Sefaria Shomer - the matcher. Pure JavaScript (no React Native), so it can be unit-tested and
// reused. The matching itself is the extension's `match()` from content.js, kept in step with it
// (including the whole-name "titles" rules); the helpers below apply it to the app's own data
// (TOC, versions, search hits...).
import RULES_JSON from './rules.json';
import { GROUPS } from './presets';

const lower = list => (list || []).map(s => String(s).toLowerCase().trim()).filter(Boolean);
const TRANSLATION_GROUPS = new Set(GROUPS.filter(g => g.translation).map(g => g.id));
const KNOWN_ORTHODOX_SHEETS = lower(['yeshiva university', 'orthodox union', 'riets', 'koren']);

export function compileRules(rules) {
  return (rules || []).map(r => ({
    id: r.id,
    name: r.name,
    group: r.group,
    translation: TRANSLATION_GROUPS.has(r.group),
    terms: lower([].concat((r.sefariaSlugs || []).map(s => s.replace(/[_-]/g, ' ')), r.keywords || [])),
    titles: lower(r.titles),
    exceptions: lower(r.exceptions),
  }));
}

// The names in `text` ("Title | Hebrew title | ...") and the page named by `href` ("/Orot.1.2")
export function namesOf(text, href) {
  const names = String(text || '').split('|');
  const path = String(href || '').split(/[?#]/)[0].split('/').filter(Boolean).pop();
  if (path) { names.push(decode(path).replace(/_/g, ' ')); }
  return names.map(n => n.toLowerCase().trim()).filter(Boolean);
}

// A rule's "titles" match only a whole book name, or a reference into it ("Orot 1:2", "Orot.1",
// "Orot, Introduction"), never a longer name: "Orot" is not "Orot Chaim".
export function isTitle(name, title) {
  if (!name.startsWith(title)) { return false; }
  const rest = name.slice(title.length);
  return rest === '' || /^(?:[.,:]|\s+\d)/.test(rest);
}

export const RULES = compileRules(RULES_JSON);

// Whole words only: "maharat" is not in "Maharatz", nor "orot" in "Torot"
const WORD = /[0-9a-zÀ-ɏ֐-׿]/;
export function hasWord(hay, kw) {
  for (let i = hay.indexOf(kw); i !== -1; i = hay.indexOf(kw, i + 1)) {
    if (!WORD.test(hay[i - 1] || ' ') && !WORD.test(hay[i + kw.length] || ' ')) { return true; }
  }
  return false;
}

function decode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

/**
 * What hides this name/link, if anything.
 * @param {object|null} cfg  normalized config (presets.normalize); null or inactive = nothing hidden
 * @param {string} text      names to check (title, Hebrew title, version title...)
 * @param {string} [href]    a link or path; "/sheets/" marks a community source sheet
 * @param {Array} [rules]    compiled rules (defaults to the bundled rules.json)
 * @returns {{reason: string, translation: boolean, group: string|null}|null}
 */
export function match(cfg, text, href, rules = RULES) {
  if (!cfg || !cfg.active) { return null; }
  // the whole TOC goes through here at startup (thousands of names): the config's lists and
  // the rules it turns on are worked out once per config, and each name's answer is kept
  const c = compiled(cfg, rules);
  const key = (text || '') + '\u0000' + (href || '');
  if (c.seen.has(key)) { return c.seen.get(key); }
  const m = matchCompiled(c, text, href);
  if (c.seen.size >= SEEN_MAX) { c.seen.clear(); }
  c.seen.set(key, m);
  return m;
}

const SEEN_MAX = 50000;
// config -> {rules -> compiled}; configs are replaced, never changed (presets.normalize)
const compiledCache = new WeakMap();
function compiled(cfg, rules) {
  let byRules = compiledCache.get(cfg);
  if (!byRules) { byRules = new Map(); compiledCache.set(cfg, byRules); }
  let c = byRules.get(rules);
  if (!c) {
    const hides = group => !!(cfg.groups && cfg.groups[group]);
    c = {
      white: lower(cfg.customWhitelist),
      black: lower(cfg.customBlacklist),
      sheets: hides('community_sheets'),
      rules: (rules || []).filter(r => hides(r.group)),
      seen: new Map(),
    };
    // A term only matches as whole words (hasWord), so its first word must be one of the
    // name's words: index the rules by their terms' first words, and a name checks only the
    // terms of the rules its words point to (a rule with a term that does not start with a
    // letter or digit is always checked).
    c.byFirstWord = new Map();
    c.always = new Set();
    for (const rule of c.rules) {
      for (const t of rule.terms) {
        const first = t.match(FIRST_WORD);
        if (!first) { c.always.add(rule); continue; }
        if (!c.byFirstWord.has(first[0])) { c.byFirstWord.set(first[0], new Set()); }
        c.byFirstWord.get(first[0]).add(rule);
      }
    }
    byRules.set(rules, c);
  }
  return c;
}

const WORDS = /[0-9a-zÀ-ɏ֐-׿]+/g;  // runs of WORD characters
const FIRST_WORD = /^[0-9a-zÀ-ɏ֐-׿]+/;

function matchCompiled(c, text, href) {
  const raw = decode((text || '') + ' ' + (href || '')).toLowerCase();
  const hay = raw + ' ' + raw.replace(/[_/.,:()-]/g, ' ');
  if (c.white.some(w => hay.includes(w))) { return null; }
  const own = c.black.find(b => hay.includes(b));
  if (own) { return { reason: 'your list: ' + own, translation: false, group: null }; }
  if (c.sheets && /\/sheets\/|tab=sheet/.test(href || '') &&
      !KNOWN_ORTHODOX_SHEETS.some(k => hasWord(hay, k))) {
    return { reason: 'Community source sheet', translation: false, group: 'community_sheets' };
  }
  let maybe = null;  // the rules whose terms could be in this name
  for (const w of hay.match(WORDS) || []) {
    const rs = c.byFirstWord.get(w);
    if (rs) { maybe = maybe || new Set(); rs.forEach(x => maybe.add(x)); }
  }
  let names = null;
  for (const r of c.rules) {
    const termsMayMatch = c.always.has(r) || (maybe !== null && maybe.has(r));
    if (!termsMayMatch && !(r.titles && r.titles.length)) { continue; }
    if (r.exceptions.some(x => hay.includes(x))) { continue; }
    if (termsMayMatch && r.terms.some(t => hasWord(hay, t))) { return { reason: r.name, translation: r.translation, group: r.group }; }
    if (r.titles && r.titles.length) {
      names = names || namesOf(decode(text || ''), href);
      if (r.titles.some(t => names.some(n => isTitle(n, t)))) {
        return { reason: r.name, translation: r.translation, group: r.group };
      }
    }
  }
  return null;
}

// ---------- Applying the match to the app's data ----------

// The names a TOC book entry is known by
export function bookText(entry) {
  if (!entry) { return ''; }
  return [entry.title, entry.heTitle, entry.collectiveTitle, entry.heCollectiveTitle,
    entry.commentator, entry.heCommentator].filter(Boolean).join(' | ');
}

// A whole book is hidden (a hidden translation does not hide the book it translates)
export function bookMatch(cfg, entry) {
  const m = match(cfg, bookText(entry));
  return m && !m.translation ? m : null;
}

// A version (translation or edition) is hidden by any rule, translation or not
export function versionMatch(cfg, version) {
  if (!version) { return null; }
  return match(cfg, [version.versionTitle, version.versionTitleInHebrew, version.versionSource,
    version.shortVersionTitle].filter(Boolean).join(' | '));
}

/**
 * The TOC with hidden books and categories taken out (categories left empty are dropped too).
 * Never changes `toc`. `hidden` collects {title: reason} for every book taken out, so the app
 * can say why a link does not open.
 */
export function filterToc(cfg, toc, hidden = {}) {
  if (!Array.isArray(toc)) { return toc; }
  const markAll = (node, reason) => {
    if (node.contents) { node.contents.forEach(c => markAll(c, reason)); }
    else if (node.title) { hidden[node.title] = reason; }
  };
  const out = [];
  for (const node of toc) {
    if (node.contents) {
      const m = match(cfg, [node.category, node.heCategory].filter(Boolean).join(' | '));
      if (m && !m.translation) { markAll(node, m.reason); continue; }
      const contents = filterToc(cfg, node.contents, hidden);
      if (contents.length || !node.contents.length) { out.push(contents === node.contents ? node : { ...node, contents }); }
    } else {
      const m = bookMatch(cfg, node);
      if (m) { hidden[node.title] = m.reason; continue; }
      out.push(node);
    }
  }
  // keep the same array when nothing changed, so callers can cheaply tell
  return out.length === toc.length && out.every((n, i) => n === toc[i]) ? toc : out;
}

// search_toc.json has the same shape as toc.json (fewer fields)
export const filterSearchToc = filterToc;

// A list of version objects without the hidden ones
export function filterVersions(cfg, versions) {
  if (!Array.isArray(versions) || !cfg || !cfg.active) { return versions; }
  return versions.filter(v => !versionMatch(cfg, v));
}

// A sheet (search hit or related sheet) is hidden as a community sheet unless from a known
// Orthodox source; any other rule hides it by its title too.
export function sheetMatch(cfg, sheet) {
  if (!sheet) { return null; }
  const text = [sheet.title, sheet.sheet_title, sheet.ownerName, sheet.owner_name,
    sheet.ownerOrganization, sheet.organization].filter(Boolean).join(' | ');
  const id = sheet.id || sheet.sheetId || sheet.sheet_id || '';
  return match(cfg, text, `/sheets/${id}`);
}
