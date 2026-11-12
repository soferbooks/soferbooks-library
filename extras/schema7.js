/**
 * A converted book (extras/tree.js Node) as the files of the app's offline library: the
 * "schema version 7" layout Sefaria's mobile export uses and offline.js reads.
 *
 *   <Title>_index.json                      the index: schema (the book's sections), versions
 *   <Section ref>.metadata.json             one per section: ref, heRef, versions, prev/next
 *   <Section ref>.<md5(version)[:8]>.he.json  the section's paragraphs
 *
 * This is the part of tools/library-export/export_v7.py that books from Sofer's importers go
 * through (complex books whose sections are depth-1 lists of paragraphs), written for the
 * phone. Two differences, both so the reader works with them:
 *   - an unnamed part (text before a book's first heading) is a named section too (Sofer: a
 *     "default" node, which the reader's table of contents cannot list); its Hebrew name is the
 *     heading above it, or the book's name at the top;
 *   - prev/next run across all the book's sections, so reading continues from one to the next.
 * Sections keep Sofer's keys (S1, S2 ... for the named ones at each level), so a ref names the
 * same section here and in Sofer ("זמרת הארץ, S2").
 */
import md5 from 'md5';

export const SCHEMA_VERSION = '7';

const leafNode = (key, heTitle) => ({
  key, title: key, enTitle: key, heTitle,
  titles: [{text: key, lang: 'en', primary: true}, {text: heTitle, lang: 'he', primary: true}],
  nodeType: 'JaggedArrayNode', depth: 1, sectionNames: ['Paragraph'], heSectionNames: ['פסקה'],
  addressTypes: ['Integer'],
});

/**
 * The book's sections in order: {nodes (the schema's), leaves: [{keys, heTitles, paras}]}.
 * heTitle: the Hebrew name above this level (the book's, at the top).
 */
export function sectionsOf(tree, heTitle) {
  const leaves = [];
  const walk = (node, keys, heTitles, aboveName) => {
    const parts = [];
    if (node.paras.length) { parts.push({title: '', paras: node.paras, children: []}); }
    node.children.forEach(c => { if (!c.empty()) { parts.push(c); } });
    const nodes = [];
    let named = 0;
    let unnamed = 0;
    for (const c of parts) {
      let key;
      if (c.title) {
        named += 1;
        key = `S${named}`;
      } else {
        unnamed += 1;
        key = unnamed === 1 ? 'S0' : `S0_${unnamed}`;
      }
      const name = c.title || aboveName;
      if (c.children.length) {
        const sub = walk(c, keys.concat(key), heTitles.concat(name), name);
        nodes.push({
          key, title: key, enTitle: key, heTitle: name,
          titles: [{text: key, lang: 'en', primary: true}, {text: name, lang: 'he', primary: true}],
          nodeType: 'SchemaNode', nodes: sub,
        });
      } else {
        nodes.push(leafNode(key, name));
        leaves.push({keys: keys.concat(key), heTitles: heTitles.concat(name), paras: c.paras});
      }
    }
    return nodes;
  };
  const nodes = walk(tree, [], [], heTitle);
  return {nodes, leaves};
}

/** Drop the leaves `keep` refuses, and the parts left with nothing (the others keep their keys) */
function pruneNodes(nodes, keys, keep) {
  const out = [];
  for (const n of nodes) {
    const path = keys.concat(n.key);
    if (n.nodes) {
      const sub = pruneNodes(n.nodes, path, keep);
      if (sub.length) { out.push({...n, nodes: sub}); }
    } else if (keep(path.join(', '))) {
      out.push(n);
    }
  }
  return out;
}

/**
 * Every file of the book: {files: {name: object}, firstSection, sections: [refs]}.
 * book: {title, heTitle, categories, heCategories, version: {versionTitle, versionSource,
 *        license, versionNotes, versionNotesInHebrew, versionTitleInHebrew, librarySource},
 *        authors, extra (more index fields)}
 * More than one edition of the same text: book.versions [{version, tree}] in place of
 * book.version, the default (the one the reader shows) first; each tree laid out exactly as
 * `tree` (the same sections and paragraphs), which gives the book its sections.
 * book.onlyWithText: leave out the sections with no text at all (the others keep their keys, so
 * a ref names the same section as in a book laid out the same way: the editors' notes).
 */
export function bookFiles(tree, book) {
  const {title, heTitle} = book;
  const {nodes: allNodes, leaves: allLeaves} = sectionsOf(tree, heTitle);
  const editions = (book.versions || [{version: book.version, tree}]).map((ed, i) => {
    const leaves = ed.tree && ed.tree !== tree ? sectionsOf(ed.tree, heTitle).leaves : allLeaves;
    if (leaves.length !== allLeaves.length || leaves.some((l, j) => l.paras.length !== allLeaves[j].paras.length
      || l.keys.join() !== allLeaves[j].keys.join())) {
      throw new Error(`${title}: the edition "${ed.version.versionTitle}" is not laid out as the book`);
    }
    return {v: ed.version, leaves, hash: md5(ed.version.versionTitle).substring(0, 8), primary: i === 0};
  });
  const hasText = paras => paras.some(p => p);
  const kept = allLeaves.map((l, j) => !book.onlyWithText || editions.some(ed => hasText(ed.leaves[j].paras)));
  const keptKeys = new Set(allLeaves.filter((l, j) => kept[j]).map(l => l.keys.join(', ')));
  const nodes = book.onlyWithText ? pruneNodes(allNodes, [], k => keptKeys.has(k)) : allNodes;
  const files = {};
  const versions = editions.map(({v, primary}, i) => {
    const version = {
      language: 'he', title, versionTitle: v.versionTitle, versionSource: v.versionSource || '',
      actualLanguage: 'he', isSource: true, isPrimary: primary, direction: 'rtl', status: 'locked',
      priority: i, license: v.license || 'unknown',
      librarySource: v.librarySource,
    };
    if (v.versionTitleInHebrew) { version.versionTitleInHebrew = v.versionTitleInHebrew; }
    if (v.versionNotes) { version.versionNotes = v.versionNotes; }
    if (v.versionNotesInHebrew) { version.versionNotesInHebrew = v.versionNotesInHebrew; }
    return version;
  });
  files[`${title}_index.json`] = {
    title, heTitle,
    categories: book.categories, heCategories: book.heCategories,
    schema: {
      nodeType: 'SchemaNode', key: title, nodes,
      titles: [{text: title, lang: 'en', primary: true}, {text: heTitle, lang: 'he', primary: true}],
    },
    ...(book.authors ? {authors: book.authors} : {}),
    ...(book.extra || {}),
    librarySource: editions[0].v.librarySource,
    versions,
  };
  const indices = allLeaves.map((l, j) => j).filter(j => kept[j]);
  const refs = indices.map(j => `${title}, ${allLeaves[j].keys.join(', ')}`);
  indices.forEach((j, i) => {
    const leaf = allLeaves[j];
    const ref = refs[i];
    files[`${ref}.metadata.json`] = {
      ref,
      heRef: `${heTitle}, ${leaf.heTitles.join(', ')}`,
      indexTitle: title,
      heTitle,
      sectionRef: ref,
      versions: editions.map(ed => ({versionTitle: ed.v.versionTitle, language: 'he'})),
      prev: i > 0 ? refs[i - 1] : null,
      next: i + 1 < refs.length ? refs[i + 1] : null,
      links: [],
    };
    editions.forEach(ed => { files[`${ref}.${ed.hash}.he.json`] = ed.leaves[j].paras; });
  });
  return {files, firstSection: refs[0] || title, sections: refs};
}

/** The book's entry in the library's table of contents (as export_v7.book_toc_item). */
export function tocItem(entry, firstSection) {
  const item = {
    title: entry.title,
    heTitle: entry.heTitle,
    categories: entry.categories,
    primary_category: entry.categories[0],
    firstSection: firstSection || entry.title,
    enShortDesc: '',
    heShortDesc: '',
    librarySource: entry.source,
  };
  if (entry.dependence) { item.dependence = entry.dependence; }
  if (entry.base_text_titles) { item.base_text_titles = entry.base_text_titles; }
  // (the book's other names: the search box finds it by them - search/localAutocomplete.js)
  if (entry.titleVariants) { item.titleVariants = entry.titleVariants; }
  if (entry.heTitleVariants) { item.heTitleVariants = entry.heTitleVariants; }
  return item;
}

// ---------------------------------------------------------------- showing the sections' names
// The sections' English names are Sofer's keys (S0, S1, S1_2 ...): they make the refs, but they
// are not names to show. Where an English name or ref would show one, the Hebrew is shown
// instead (books converted before this was added included, since nothing on disk changes).

const KEY = 'S\\d+(?:_\\d+)?';
const SECTION_KEY = new RegExp(`^${KEY}$`);
const KEY_IN_REF = new RegExp(`, ${KEY}(?=$|[ ,:])`, 'g');
const HAS_KEY_IN_REF = new RegExp(`, ${KEY}(?=$|[ ,:])`);

/**
 * A web address (or a text with some) as people read it: percent-escapes decoded
 * ("https://he.wikisource.org/wiki/%D7%90" -> ".../wiki/א"); left as it is when it cannot be.
 */
export function readableUrl(text) {
  if (typeof text !== 'string' || text.indexOf('%') === -1) { return text; }
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, run => {
    try { return decodeURIComponent(run); } catch (e) { return run; }
  });
}

/** True for a section key used as an English name ("S0", "S2_3") */
export const isSectionKey = name => typeof name === 'string' && SECTION_KEY.test(name);

/** A section's English name to show: '' for a key (ContentTextWithFallback then shows the Hebrew) */
export const nodeEnTitle = name => (isSectionKey(name) ? '' : name);

/** True when an English ref names sections by their keys ("חבור יפה מהישועה, S0") */
export const refHasSectionKeys = ref => typeof ref === 'string' && HAS_KEY_IN_REF.test(ref);

/**
 * A Hebrew ref without a section name that only repeats the name before it: a book whose one
 * section is named as the book (a page's heading, or the text before its first heading) had
 * "שאר ישראל, שאר ישראל" (QA 2026-11-11). "שאר ישראל, שאר ישראל 3" -> "שאר ישראל 3".
 */
export function dedupeHeRef(heRef) {
  if (typeof heRef !== 'string' || heRef.indexOf(', ') === -1) { return heRef; }
  const parts = heRef.split(', ');
  const out = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const prev = out[out.length - 1];
    const part = parts[i];
    if (part === prev) { continue; }
    if (i === parts.length - 1 && part.startsWith(prev + ' ') && /^[\d\-א-ת׳״'"]+$/.test(part.slice(prev.length + 1))) {
      out[out.length - 1] = part;   // (the section's name with the paragraph number)
      continue;
    }
    out.push(part);
  }
  return out.join(', ');
}

/**
 * An English ref as it is shown: a ref with section keys is shown as its Hebrew ref (heRef), with
 * the paragraph number of a paragraph-level ref; without a Hebrew ref, the keys are left out.
 */
export function displayRef(ref, heRef) {
  if (!refHasSectionKeys(ref)) { return ref; }
  const seg = / (\d+(?:-\d+)?)$/.exec(ref);
  if (heRef) {
    heRef = withEnglishName(ref, dedupeHeRef(heRef));
    return seg && !/[\d׳']$/.test(heRef) ? `${heRef} ${seg[1]}` : heRef;
  }
  return ref.replace(KEY_IN_REF, '').trim();
}

// A book with a real English name (the Sofer Library's): its keyed refs are shown with that name in
// place of the Hebrew one ("Out of the Iron Furnace, TRANSLATOR'S PREFACE", not "מכור הברזל, ..."
// - QA round 14). extras/index.js tells it the names: ref -> {en, he} or null.
let englishNameOf = () => null;
export const setEnglishNameLookup = fn => { englishNameOf = typeof fn === 'function' ? fn : () => null; };
function withEnglishName(ref, heRef) {
  let names = null;
  try { names = englishNameOf(ref); } catch (e) { names = null; }
  if (!names || !names.en || !names.he || typeof heRef !== 'string' || !heRef.startsWith(names.he)) { return heRef; }
  return `${names.en}${heRef.slice(names.he.length)}`;
}

/** A Hebrew ref as it is shown: an extra book's (section keys in `ref`) without a repeated name */
export const displayHeRef = (ref, heRef) => (refHasSectionKeys(ref) ? dedupeHeRef(heRef) : heRef);
