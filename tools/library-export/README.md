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
