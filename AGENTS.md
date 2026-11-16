# Rules for working in this repository (read SHARED.md too)

**Stay inside this repository.** The only outside folder this app uses is `C:\Users\morde\SoferShared`, and only to read. Never write, move or delete anything outside this repository.

# What this app shares with the other Sofer projects

This repository is the library app's own code. Everything it needs from outside comes from one
place, `C:\Users\morde\SoferShared`, which other projects maintain. **Treat that folder as read-only
from here:** never write, move or delete anything in it, and never touch any other folder outside
this repository (in particular not `C:\Users\morde\Sofer`, the website, which a different team works
on).

| Shared folder | What it is | Who changes it |
|---|---|---|
| `SoferShared\library` | the texts (Sefaria's export, Dicta, Otzaria, Wikisource ...) | the website team's library update |
| `SoferShared\fonts` | the fonts every Sofer project uses | the website team's font tools |
| `SoferShared\brand` | the SoferBooks logo files | the website team |
| `SoferShared\library-app` | this app's book data: `export-v7`, `sefaria-packs`, `sofer-library` (the releases phones download), reports and logs | the website team's tools (`C:\Users\morde\Sofer\scripts\library_app`) |
| `SoferShared\library-app\for-app` | files made for this repository: `extras/dictaRules.json`, `extras/otzariaRules.json`, `extras/wikisourceBooks.json`, `fullLibrarySizes.json`, `__tests__/fixtures/...` | the same tools |

## Taking in the files made for this app

```
node scripts/sync-shared.js --dry    # what differs
node scripts/sync-shared.js          # copy them in (then commit them here as usual)
```

Only the files in `for-app` are copied, to the same paths here. If a test fixture or rules file
needs to change, ask the website team to run the tool that makes it; do not edit the copy here
by hand (the next sync would overwrite it).

## Reading the library here

The JavaScript checks in `tools/library-export/` (`compare_*.js`, `shomer_group_examples.js` ...)
read `SoferShared\library` directly, read-only (`SOFER_LIBRARY` may name another copy).

## Building the book data

The book data is not built here. The Python tools that build it (`export_v7.py`,
`build_sofer_library.py`, `build_sefaria_packs.py`, the fixtures and rules tools) were moved to the
website team's repository on 2026-11-16, because they run the website's own code; they write their
results into `SoferShared\library-app`. Ask the website team for a new export or release.
