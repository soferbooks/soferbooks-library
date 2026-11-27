'use strict';

import { stringPair } from '../LocalizedStrings';

/**
 * Where a Chumash book's aliyot start, from its index's Parasha table (textToc.alts.Parasha.nodes:
 * each parasha's refs, its first one the parasha itself, then the second aliyah's ... the seventh's).
 * Used by the Chok LeYisrael page to mark the aliyot as the Chumash does (owner, 2026-11-27: "add new
 * aliyah markers in chok like u have in regular chumash"); TextColumn's _getParashaDict for the Chumash.
 */

/** The aliyot's names [{en, he}], first to seventh (one id per line: i18n.test.js looks for each) */
export const aliyahNames = () => [
  stringPair('reader.aliyah_first'),
  stringPair('reader.aliyah_second'),
  stringPair('reader.aliyah_third'),
  stringPair('reader.aliyah_fourth'),
  stringPair('reader.aliyah_fifth'),
  stringPair('reader.aliyah_sixth'),
  stringPair('reader.aliyah_seventh'),
];

/**
 * Map of a verse's ref ("Genesis 32:8") to the aliyah that starts there ({en, he}): the second to the
 * seventh - the first starts the parasha, which the page names itself.
 */
export const aliyahStarts = nodes => {
  const names = aliyahNames();
  const starts = new Map();
  for (const n of Array.isArray(nodes) ? nodes : []) {
    (n.refs || []).forEach((r, i) => {
      if (i === 0 || !names[i] || typeof r !== 'string') { return; }
      const dash = r.lastIndexOf('-');
      starts.set(dash > 0 ? r.slice(0, dash) : r, names[i]);
    });
  }
  return starts;
};
