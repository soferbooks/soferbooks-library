/**
 * Download Wikisource books now, with the phone's own download code (extras/wikisource.js
 * fetchPages: the same API requests the phone makes), for the live fidelity check:
 *
 *   node -r @babel/register tools/library-export/fetch_wikisource_live.js <dir> [--max-pages 40] [page ...]
 *   node -r @babel/register tools/library-export/compare_wikisource.js --live <dir>
 *
 * Writes <dir>/<book>.json ({title, pages}, Sofer's layout) and <dir>/requests.json (requests and
 * seconds for each book). Books already in <dir> are not fetched again.
 */
const fs = require('fs');
const path = require('path');
const {fetchPages, apiClient} = require('../../extras/wikisource');
const CATALOG = require('../../extras/wikisourceBooks.json');

const fileOf = title => `${title.replace(/[\\/:*?"<>|]/g, '-')}.json`;

async function main() {
  const args = process.argv.slice(2);
  const dir = args.shift();
  const mi = args.indexOf('--max-pages');
  const maxPages = mi >= 0 ? parseInt(args.splice(mi, 2)[1], 10) : Infinity;
  fs.mkdirSync(dir, {recursive: true});
  const statsFile = path.join(dir, 'requests.json');
  const stats = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : {};
  const books = CATALOG.books.filter(b => (args.length ? args.includes(b.page) : b.pages <= maxPages));
  for (const b of books) {
    const out = path.join(dir, fileOf(b.page));
    if (fs.existsSync(out)) { continue; }
    const t0 = Date.now();
    const client = apiClient();
    const book = await fetchPages(b.page, {client});
    stats[b.page] = {requests: client.requests, pages: book.pages.length, soferPages: b.pages, seconds: (Date.now() - t0) / 1000};
    fs.writeFileSync(out, JSON.stringify(book));
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 1));
    console.log(`${b.page}: ${book.pages.length} pages (Sofer ${b.pages}), ${client.requests} requests, ${stats[b.page].seconds}s`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
