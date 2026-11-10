# Soferia library export

Builds the offline library that the Android app downloads. The output follows
Sefaria's mobile "schema version 7" layout, so the unmodified reader code can
consume it.

## Full export

```powershell
$env:PYTHONIOENCODING = "utf-8"
python tools\library-export\export_v7.py --out C:\Users\morde\Soferia\export-v7 --no-links
```

* Reads Sofer's library at `C:\Users\morde\Sofer\data\sefaria-export`.
* Applies Sofer's corrections and the Soferia licence filter (editions marked
  "all rights reserved" / "not offered" are left out).
* Writes one `<Title>.zip` per book, the core files (`toc.json`,
  `packages.json`, `last_updated.json`, ...), and the downloadable bundles in
  `bundles\<Package>\<N>.zip`.
* `--no-links` skips the cross-reference index (it does not fit in 16 GB RAM);
  links can be added in a later pass.

A full run takes roughly 45-60 minutes (the exporter derives every book's real
section counts from its text, which is what keeps commentaries with incomplete
schemas from coming out truncated or empty).

Two Sefaria data quirks the exporter handles:

* some schemas declare placeholder lengths (e.g. one halakhah per chapter) while
  the text holds many more; the exporter always takes the larger of the two;
* a schema node with no name ("default": true) stores its text under the empty
  key `""`; the exporter unwraps that envelope.

`tools\library-export\find_empty_key_books.py` lists books whose source uses the
empty-key form (useful when deciding which books a patch run must cover).

## Re-exporting individual books

`--books` understands titles that contain commas:

```powershell
python tools\library-export\export_v7.py --out ... --books "Mishneh Torah, Foundations of the Torah,Genesis"
```

For many titles (one per line, commas allowed) use a file:

```powershell
python tools\library-export\export_v7.py --out ... --books-file failed.txt --patch
```

`--patch` writes only the book zips and leaves the core files and bundles
alone. When the patch run is done, rebuild the core files from every zip that
is now in the output folder:

```powershell
python tools\library-export\export_v7.py --out ... --core-only
```

`--core-only` also rebuilds the bundles and keeps each book's original
timestamp, so phones only re-download the books that actually changed.

## Checking an export

```powershell
python tools\library-export\validate_export.py --export C:\Users\morde\Soferia\export-v7
```

It reports missing zips, missing `firstSection` files, duplicate zip entries,
books with no text at all, and package sizes that do not match the real files.
The detailed result is written to `_validation.json` next to the export.

## Offline search

The app searches the books it has downloaded. Each book needs a plain-text copy
next to its zip, which the exporter puts into the download bundles as
`<Title>_search.txt` (one line per segment: `ref, heRef, lang, version, text`).

Build it after an export (or after a patch export):

```powershell
python tools\library-export\build_search.py --export C:\Users\morde\Soferia\export-v7
```

This writes `_search\<Title>.txt` and rebuilds the bundles so the files ship
with the library. Only the primary edition of each language is indexed, so the
search does not duplicate translations. Use `--books` / `--books-file` to
rebuild a few books only, and `--no-bundles` to skip the bundle step.

The full library produces about 6.1 GB of search text (6.6 million segments).
After `build_search.py --no-bundles`, run `export_v7.py --core-only` so the
bundles include the new files and `packages.json` reports the real download
sizes.

### Search index (fast offline search)

Reading every search file takes minutes on a phone. The app therefore uses a
compact trigram index, one per package:

```powershell
python tools\library-export\build_search_index.py --export C:\Users\morde\Soferia\export-v7
```

This reads all `_search` files once (about 30 minutes) and writes
`_index\<Package>.idx`. A query word can only occur in a book that contains
every three-letter run of that word, so the app opens only the few books that
can match instead of the whole downloaded library. Books without an index are
still searched (only slower), so an out-of-date index can never hide a result.

Rebuild the index whenever the search text changes, then run
`export_v7.py --out ... --core-only` without `--no-bundles`: this adds the index
to `packages.json` and ships it as `0.zip` in each package (it is fetched
first).

`check_search_index.py` reads random books and verifies that every word in them
is present in the index (so a query can never miss a book):

```powershell
python tools\library-export\check_search_index.py --export C:\Users\morde\Soferia\export-v7
```

## SoferBooks release for Sefaria's books (search packs + Sofer's corrections)

The app now downloads Sefaria's books unchanged from Sefaria's own mobile server
(`DownloadControl.js`, `sources.js`). Those zips have no search files and do not
carry Sofer's corrections, so both come from a SoferBooks GitHub Release:

```powershell
$env:PYTHONIOENCODING = "utf-8"
# a test run on a few books (titles separated by "," without a space after it)
python tools\library-export\build_sefaria_packs.py --work C:\Users\morde\Soferia\sefaria-packs --books "Genesis,Zohar,Psalms"
# the whole library (downloads ~1.5 GB from Sefaria the first time; later runs only
# download the books whose last_updated changed)
python tools\library-export\build_sefaria_packs.py --work C:\Users\morde\Soferia\sefaria-packs
```

Everything in `<work>\release\` is uploaded as the assets of one release:

| Asset | What | On the phone |
|---|---|---|
| `manifest.json` | tag, build time, Sefaria `last_updated` it matches, every asset with size + sha256 | read first (`packs.js`) |
| `sefaria-last-updated.json` | Sefaria's `last_updated.json` the release was built from (per-book dates) | not downloaded |
| `corrections.zip` | `_corrections/<Title>.json`, Sofer's corrections as patch operations | `library/_corrections/` |
| `search-<shard>[-<n>].zip` | `<Title>_search.txt` for the books of one shard | `library/` |
| `index-<package>.idx` | the package's trigram index (`build_search_index.py` format) | `library/<Package>_search.idx` |
| `SHA256SUMS.txt` | checksums | - |

**Why Sefaria's mobile zips, not Sofer's `sefaria-export`.** A sample (Genesis, Psalms,
Berakhot, Pirkei Avot, Mishneh Torah Prayer and the Priestly Blessing; 104 versions in both)
compared version by version: the segmentation is the same for all but one version, but
the *text* often is not:
Sefaria's mobile export is a different snapshot (Genesis: 41 of 47 shared versions
identical, The Contemporary Torah differs in 242 verses, one community translation has a
different number of segments; Mishneh Torah's Touger translation differs in 143 of 240
halachot), 14 of the versions the phone has are not in Sofer's copy at all, and Sofer's
"Miqra according to the Masorah" is his own Wikitext copy with private shva-na /
dagesh-chazak marks (U+05C8/U+05C9) - 1,526 of Genesis' 1,533 verses differ. Search
results must point at exactly the text the phone shows, so the release is built from the
same zips the phone downloads, and records the `last_updated` date it matches.

**Shards.** Sefaria's packages overlap (TANAKH with Rashi is inside TANAKH and all
commentaries; COMPLETE LIBRARY holds everything). Each book's search text is stored once,
in the shard of books that belong to exactly the same packages; `manifest.json` lists each
package's shards and its index, and the phone downloads the shards of the packages the
reader chose (all of them for COMPLETE LIBRARY). Assets are compared by sha256, so a new
release only re-downloads shards whose books changed. A shard bigger than `--part-size`
(1 GB of text, default) is split into parts; every asset stays far below GitHub's 2 GiB
per-file limit.

**Licence filter.** The release is public, so its search text and corrections cover only
versions whose Sefaria licence (`license` in the zip's `<Title>_index.json`) is Public
Domain/PD, CC0, CC-BY, CC-BY-SA, CC-BY-NC or CC-BY-NC-SA. Copyright, all rights reserved,
`unknown`, CC-BY-NC-ND, a missing licence or a version the index does not list stay out
(`<work>\excluded-versions.json` lists them; `manifest.json` `licences` has the counts).
The trigram indexes still cover every version: they hold 16-bit trigram hashes -> book ids,
no words or positions. The phone makes the excluded versions' search lines itself, from the
zips Sefaria sent it (`localSearch.js`, books in `search.local_titles`, redone when a book's
zip changes) into `local_search/<Title>_search.txt`, which `offlineSearch.js` searches with
the hosted files. Check a build with
`python tools\library-export\verify_release_licences.py --work <work>`.

**Corrections** (`sofer_corrections.py`). Sofer never edits the downloaded files; he applies
his corrections while an edition is read (`C:\Users\morde\Sofer\docs\BOOK_CORRECTIONS.md`).
The builder runs Sofer's own functions on each section file of Sefaria's zips and records
every passage that comes out different, as `[path, md5-of-Sefaria's-text, corrected text]`.
`offline.js` applies them (`corrections.js`) every time it reads a section, so they hold
right after a book is downloaded and again after every update, and nothing on disk is
rewritten. When Sefaria later changes a corrected passage the hash no longer matches and
the operation is skipped (an old text is never written over a newer one) until the next
release rebuilds it. The search text in the release has the corrections applied too.

Applied: `text_fills.FILLS` (fills only where the edition is empty), `real_questions`
(Zohar, Chok LeYisrael), `without_note_stars` (Hartman), `without_placeholders`,
`inline_notes`, `without_publisher_notes`, and `masorah.VERSE_CORRECTIONS` on Sefaria's
Miqra according to the Masorah (Sofer's private marks written as the plain shva/dagesh).
Not applied on the phone (structural or not about Sefaria's text):

* **splits** (`splits.SPLITS`: Ben Ish Hai's Derashos/Halachos, the Tur and its five
  commentaries in four parts each, the Gate of Trust with its commentaries): these are new
  books with their own titles, tables of contents and links. A patch cannot create them
  inside Sefaria's catalogue, so Sefaria's whole book stays on the phone, and the parts
  ship in the SoferBooks extras (below);
* Sofer's Wikitext copy of Miqra according to the Masorah, `ELYON_CORRECTIONS`, the
  Wikitext siddur fixes: other texts, not corrections of Sefaria's;
* printing-time restyling (`markup.py`, `structure.py`), preferred editions, aliases,
  licence fixes and books never offered (the content filter's business, `shomer/`).

Tests: `python -m unittest tools/library-export/test_sofer_corrections.py`;
`npx jest __tests__/packs.test.js __tests__/corrections.test.js`.

**Publishing.** The release repository is
`https://github.com/soferbooks/soferbooks-library-data` (set once in `sources.js`,
`SOFERBOOKS_RELEASES`). For each build create a release whose tag is the manifest's `tag`
(`library-YYYY-MM-DD`, or pass `--tag`) and upload every file of `release\`:

```powershell
$rel = "C:\Users\morde\Soferia\sefaria-packs\release"
$tag = (Get-Content "$rel\manifest.json" -Raw | ConvertFrom-Json).tag
gh release create $tag (Get-ChildItem $rel).FullName --repo soferbooks/soferbooks-library-data --title "Library $tag" --latest
```

The newest release must stay "latest" (the app reads `releases/latest/download/manifest.json`
and then fetches the other files from that tag). Rebuild after Sefaria's weekly export
(the manifest's `sefaria.last_updated` tells which export a release matches).

## Extra sources (Otzaria now; Dicta, Wikitext later)

**Owner's decision (2026-11-10): every book comes from its own source's server.** SoferBooks
hosts no book files (only Sefaria's search files above). So the phone downloads each extra
book from the source itself and converts ("rewraps") it into the schema-7 layout, the way
Sofer's importer (`C:\Users\morde\Sofer\src\sofer\importers.py`) converts it. The plan
further below (`build_extras.py`, hosting converted packs) is superseded and not used.

The app side is `extras/` (the source interface is described in `extras/index.js`):
`tree.js` (Sofer's `_Node`, `norm_title`, `safe`, headings inside the text, `restricted`),
`schema7.js` (a book's `_index.json` + section files, as `export_v7.py` writes them),
`catalog.js` (one copy of each sefer: Sefaria > Dicta > Otzaria > Wikitext; Sofer's category
placement), `otzaria.js` (the source). Each source is turned on in Settings; its books are
listed in the library, and opening one that is not downloaded offers the download.

**Otzaria** serves each book on its own:
`raw.githubusercontent.com/Otzaria/otzaria-library/main/<path>`; the catalogue is the
repository's `files_manifest.json` (every file with its sha256, used for the update check).
Licences per collection follow the library's README (2026-11): `extras/otzaria.js`
`COLLECTIONS`. Two files are made on the PC with Sofer's own code:

```powershell
# books whose own notice forbids them, Rav Yosef Peretz's permitted ones, and Otzaria copies of
# Sefaria books under another Hebrew name -> extras/otzariaRules.json (names only)
python tools\library-export\otzaria_rules.py
# expected results of the conversion fixtures (__tests__/fixtures/otzaria/*.sofer.json)
python tools\library-export\otzaria_fixtures.py
```

Checking the phone's converter against Sofer's converted books (`Sofer\data`, read only):

```powershell
python tools\library-export\otzaria_fidelity.py C:\tmp\fid --random 300
node -r @babel/register tools\library-export\compare_otzaria.js C:\tmp\fid --quiet
```

2026-11-10: all 1,172 Otzaria books Sofer imported came out the same (sections, headings,
paragraphs, author line), and the book-notice rule agreed on all 1,172.

**Dicta** (`extras/dicta.js`): the catalogue is Dicta's official `books.json`
(`raw.githubusercontent.com/Dicta-Israel-Center-for-Text-Analysis/Dicta-Library-Download/main`,
linked from library.dicta.org.il's About page) plus Otzaria's `files_manifest.json` (its copies
of Dicta's books); each book is its `textFileURL`, a zip of its pages on `files.dicta.org.il`,
unzipped on the phone. Licence CC BY-SA 4.0 (the repository's README and the site's About page),
credited to Dicta. Sofer's rules: Otzaria's layout of a Dicta book (DictaToOtzaria) is used when
it has text (fetched from Otzaria's repository; then nothing is downloaded from Dicta), still
Dicta's; where Dicta's own has no sections, another collection's copy that has them (with the
app's collection licences). Dicta's computer-nikud editions (`nikudMetegFileURL`) are not offered.

```powershell
# expected results of the fixtures (__tests__/fixtures/dicta/*.sofer.json), by Sofer's import_dicta
python tools\library-export\dicta_fixtures.py
python tools\library-export\dicta_fixtures.py --take <fileName> <name>     # another real book
# all Dicta books Sofer imported, through the phone's converter
python tools\library-export\dicta_fidelity.py C:\tmp\dfid
node --max-old-space-size=8000 -r @babel/register tools\library-export\compare_dicta.js C:\tmp\dfid --quiet [--app]
```

2026-11-10: all 1,154 Dicta books Sofer imported came out the same (choice of text, version
name, source line, licence, sections, headings, paragraphs). With the app's collection licences
(`--app`) two differ, by the app's licence table, not the converter: Eitz Hadar (wiki Jewish
books, not offered by the app: Dicta's own text, one section) and Tevunah (National Library,
now CC BY-NC-SA 4.0 in Otzaria's README: under that licence instead of Dicta's).


**Wikitext (Hebrew Wikisource)** is read through the site's API, as Sofer reads it: each page as
the site renders it (`action=parse`, one request a page), the title page first, then its parts in
the order it links to them; the update check asks the revisions of a downloaded book's pages
(`prop=info`, 50 pages a request). Converted by `extras/wikisourceParse.js` (htmlparser2), with the
editors' notes as a book of their own, "הערות המהדיר על ...". The list of books is Sofer's:

```powershell
# Sofer's whole sefarim the library lacks -> extras/wikisourceBooks.json
python tools\library-export\wikisource_books.py
# expected results of the conversion fixtures (__tests__/fixtures/wikisource/*.sofer.json)
python tools\library-export\wikisource_fixtures.py
# every book Sofer imported, converted from the pages Sofer downloaded, compared with Sofer's
node -r @babel/register tools\library-export\compare_wikisource.js --quiet
# the same with the pages fetched now by the phone's own download code
node -r @babel/register tools\library-export\fetch_wikisource_live.js C:\tmp\wslive
node -r @babel/register tools\library-export\compare_wikisource.js --live C:\tmp\wslive --quiet
# and those pages converted by Sofer's own code and by the phone's
python tools\library-export\wikisource_fixtures.py C:\tmp\wslive
node -r @babel/register tools\library-export\compare_wikisource.js --sofer-on C:\tmp\wslive
```

### Superseded: hosted extras packs

**Can the phone use the sources' own releases?** No, not sensibly:

* **Otzaria** publishes one GitHub Release asset, `otzaria_latest.zip` (1.18 GB of plain
  text with heading markup, plus links; `C:\Users\morde\Sofer\data\otzaria`). There is no
  per-book download, so one book would cost the whole 1.2 GB, and turning the text into
  books (structure from headings, licences per sub-collection - some are "copyrighted:
  testing only" -, which copy of a book Sefaria/Dicta already has, 385,000 links) is Sofer's
  importer (`importers.py`, ~1,700 lines of Python).
* **Dicta** serves one text zip per book (`files.dicta.org.il/library-1-0/...`, catalogue
  `books.json`; 1,205 books, 516 MB), so per-book download would work, but the conversion
  (nikud editions laid out like the book, Otzaria's better copy when there is one, licence
  check) is again Sofer's Python importer.
* **Wikitext** is MediaWiki markup fetched page by page through the API.

Porting those importers to JavaScript would duplicate Sofer's code and keep the phone busy
for a long time; the owner allows hosting converted books instead. So the extras are
converted on the PC into schema-7 zips (the existing `export_v7.py`, with Sofer's
corrections and licence rules) and hosted as "SoferBooks extras" packs on GitHub Releases:

```powershell
python tools\library-export\build_extras.py --out C:\Users\morde\Soferia\extras --limit 2     # test
python tools\library-export\build_extras.py --out C:\Users\morde\Soferia\extras               # all
```

It reads the books Sofer added (`data\extra_import_manifest.json`, `data\split_manifest.json`),
exports them with `export_v7.py --patch`, builds `toc.json`/`last_updated.json` for them
(`--core-only`), their search text (`build_search.py`) and one index per source, and writes
`<out>\release\`: `extras-<source>[-n].zip` (book zips + `<Title>_search.txt`, at most
1.5 GB of input each), `index-extras-<source>.idx`, `extras-toc.json`,
`extras-last-updated.json`, `extras-packages.json`, `extras-manifest.json`, `SHA256SUMS.txt`.
Sources: `dicta`, `otzaria`, `wikisource`, `soferbooks` (splits, Ben-Yehuda, Sofer's own).
They can go in their own release (`extras-YYYY-MM-DD`) of the same repository.

Still to do in the app (not built yet): turn on the `soferbooks_extras` entries in
`sources.js` per source; in Settings, download `extras-manifest.json`, merge
`extras-toc.json` into the library's table of contents and `extras-last-updated.json`
into the update check, and unzip the chosen source's `extras-<source>*.zip` into `library/`
(the files are already in the layout the reader and offline search use).

## Serving it to a phone / emulator

```powershell
python tools\server\serve.py --export C:\Users\morde\Soferia\export-v7 --port 5200
```

With a USB device or emulator:

```powershell
adb reverse tcp:5200 tcp:5200
```

The app's `DOWNLOAD_SERVER` (in `DownloadControl.js`) must point at
`http://127.0.0.1:5200` for local testing.

## Release APK

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd android
.\gradlew.bat assembleRelease
```

Then sign the unsigned APK with the debug key:

```powershell
$bt = "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0"
& "$bt\apksigner.bat" sign --ks "$env:USERPROFILE\.android\debug.keystore" `
  --ks-pass pass:android --key-pass pass:android `
  --out android\app\build\outputs\apk\release\app-release-signed.apk `
  android\app\build\outputs\apk\release\app-release-unsigned.apk
```
