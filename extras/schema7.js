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

/**
 * Every file of the book: {files: {name: object}, firstSection, sections: [refs]}.
 * book: {title, heTitle, categories, heCategories, version: {versionTitle, versionSource,
 *        license, versionNotes, librarySource}, authors, extra (more index fields)}
 */
export function bookFiles(tree, book) {
  const {title, heTitle} = book;
  const {nodes, leaves} = sectionsOf(tree, heTitle);
  const vtitle = book.version.versionTitle;
  const hash = md5(vtitle).substring(0, 8);
  const files = {};
  const version = {
    language: 'he', title, versionTitle: vtitle, versionSource: book.version.versionSource || '',
    actualLanguage: 'he', isSource: true, isPrimary: true, direction: 'rtl', status: 'locked',
    priority: 0, license: book.version.license || 'unknown',
    librarySource: book.version.librarySource,
  };
  if (book.version.versionNotes) { version.versionNotes = book.version.versionNotes; }
  if (book.version.versionNotesInHebrew) { version.versionNotesInHebrew = book.version.versionNotesInHebrew; }
  files[`${title}_index.json`] = {
    title, heTitle,
    categories: book.categories, heCategories: book.heCategories,
    schema: {
      nodeType: 'SchemaNode', key: title, nodes,
      titles: [{text: title, lang: 'en', primary: true}, {text: heTitle, lang: 'he', primary: true}],
    },
    ...(book.authors ? {authors: book.authors} : {}),
    ...(book.extra || {}),
    librarySource: book.version.librarySource,
    versions: [version],
  };
  const refs = leaves.map(l => `${title}, ${l.keys.join(', ')}`);
  leaves.forEach((leaf, i) => {
    const ref = refs[i];
    files[`${ref}.metadata.json`] = {
      ref,
      heRef: `${heTitle}, ${leaf.heTitles.join(', ')}`,
      indexTitle: title,
      heTitle,
      sectionRef: ref,
      versions: [{versionTitle: vtitle, language: 'he'}],
      prev: i > 0 ? refs[i - 1] : null,
      next: i + 1 < refs.length ? refs[i + 1] : null,
      links: [],
    };
    files[`${ref}.${hash}.he.json`] = leaf.paras;
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
  return item;
}
