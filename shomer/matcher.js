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
  const hides = group => !!(cfg.groups && cfg.groups[group]);
  const raw = decode((text || '') + ' ' + (href || '')).toLowerCase();
  const hay = raw + ' ' + raw.replace(/[_/.,:()-]/g, ' ');
  if (lower(cfg.customWhitelist).some(w => hay.includes(w))) { return null; }
  const own = lower(cfg.customBlacklist).find(b => hay.includes(b));
  if (own) { return { reason: 'your list: ' + own, translation: false, group: null }; }
  if (hides('community_sheets') && /\/sheets\/|tab=sheet/.test(href || '') &&
      !KNOWN_ORTHODOX_SHEETS.some(k => hasWord(hay, k))) {
    return { reason: 'Community source sheet', translation: false, group: 'community_sheets' };
  }
  let names = null;
  for (const r of rules) {
    if (!hides(r.group) || r.exceptions.some(x => hay.includes(x))) { continue; }
    if (r.terms.some(t => hasWord(hay, t))) { return { reason: r.name, translation: r.translation, group: r.group }; }
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
