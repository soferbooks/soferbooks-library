/**
 * The order of a book's section files, from its index's schema (pure; tested in
 * __tests__/sectionOrder.test.js).
 *
 * A book on the phone is a zip of files, one "<section stem>.metadata.json" per section (or per
 * chapter of sections), each of whose sections names the one before and after it ("prev",
 * "next"). The Sofer Library's books left those null at the edges of each file (QA round 14:
 * reading stopped at the end of every section), so the reader works out the neighbouring file from
 * the schema: its leaves in order, each leaf's files in the order of their numbers.
 *
 * Also: the Sofer Library named the files of a book's default node "<title>, default 1" where
 * Sefaria's refs (and so the reader) say "<title> 1" (Beit Yosef, Orach Chayim: QA round 14,
 * "Extra book not downloaded" for a book just downloaded). defaultAlias gives the other name.
 */

/** "<title>, default<rest>" for a stem of the book's default node ("<title><rest>"), else null */
export function defaultAlias(stem, title) {
  if (!title || typeof stem !== 'string' || !stem.startsWith(title)) { return null; }
  const rest = stem.slice(title.length);
  if (rest !== '' && !rest.startsWith(' ')) { return null; }
  return `${title}, default${rest}`;
}

/** A ref named by the default node's files ("<title>, default 1:2") as the reader names it ("<title> 1:2") */
export function withoutDefault(ref, title) {
  if (typeof ref !== 'string' || !title) { return ref; }
  const prefix = `${title}, default`;
  if (ref === prefix) { return title; }
  return ref.startsWith(`${prefix} `) ? `${title}${ref.slice(prefix.length)}` : ref;
}

/** The schema's leaves in order: [{stem, alias}] (alias: the default node's other name) */
export function leafStems(index) {
  const title = index && (index.title || (index.schema && index.schema.key));
  const out = [];
  const walk = (node, path, isDefault) => {
    if (!node) { return; }
    if (Array.isArray(node.nodes)) {
      for (const child of node.nodes) {
        const name = child.default ? null : (child.title || child.key);
        walk(child, name ? `${path}, ${name}` : path, !!child.default);
      }
      return;
    }
    out.push({stem: path, alias: isDefault ? `${path}, default` : null});
  };
  if (title && index.schema) { walk(index.schema, title, false); }
  return out;
}

const ADDRESS = /^[\d ab:]+$/;
/** "12" -> [12], "2a" -> [3], "3:4" -> [3, 4] (a daf's amud b after its a) */
function addressKey(rest) {
  return rest.trim().split(/[: ]+/).filter(Boolean).map(p => {
    const m = /^(\d+)([ab])?$/.exec(p);
    if (!m) { return 0; }
    const n = parseInt(m[1], 10);
    return m[2] ? 2 * n - (m[2] === 'a' ? 1 : 0) : n;
  });
}
const compareKeys = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) { return d; }
  }
  return 0;
};

/**
 * The stems of a book's section files (`names`, without ".metadata.json") in reading order. Names
 * the schema does not place come last, in their own order (or are left out: includeUnplaced).
 */
export function orderStems(index, names, {includeUnplaced = true} = {}) {
  const left = new Set(names);
  const out = [];
  for (const {stem, alias} of leafStems(index)) {
    const mine = [];
    for (const n of left) {
      for (const base of [stem, alias].filter(Boolean)) {
        if (n === base) { mine.push({n, key: []}); break; }
        if (n.startsWith(`${base} `) && ADDRESS.test(n.slice(base.length + 1))) {
          mine.push({n, key: addressKey(n.slice(base.length + 1))});
          break;
        }
      }
    }
    mine.sort((a, b) => compareKeys(a.key, b.key));
    mine.forEach(({n}) => { left.delete(n); out.push(n); });
  }
  return includeUnplaced ? out.concat(Array.from(left)) : out;
}

/** The section refs of one metadata file, in order (a file of one section is that section) */
export function sectionsOfFile(json) {
  if (!json) { return []; }
  if (json.sections && typeof json.sections === 'object') { return Object.keys(json.sections); }
  return json.ref ? [json.ref] : [];
}
