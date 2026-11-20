# For the website: what the app changed on 2026-11-20, to match there

Mordy's request: "Make sure all things that u find u match across all our products like the website too".
The app can't write to the website's repository, so this note lists each change and where the website should match it.

1. **Better copies win.** Mordy's rule, from today: "always use better versions. My rules were only what I thought was in general". So `pninim_import.py`'s "only the missing ones" is guidance, not a limit. The app compared Pninim's own books with Otzaria's copies of the same text (Otzaria's `pninimToOtzaria/...`):

   | Book | Otzaria's copy | Pninim's copy | App's choice |
   |---|---|---|---|
   | Asifat Zekenim | a fragment, about 10,000 letters | 4.5 million letters | Pninim's |
   | Birkei Yosef | two books (על אורח חיים, על יורה דעה) | one book | Pninim's |
   | Midrash Talpiot | "חלק א" only | complete | Pninim's |
   | Ezra LeHavin | same text | same text | Pninim's |
   | Tzeidah LaDerekh | same text | same text | Pninim's |
   | Artzot HaChaim | המאיר לארץ and ארץ יהודה as separate books, linked passage by passage (1,323 links) | one book with them inside, no links | Otzaria's |

   On the website:
   - The library has a separate `המאיר לארץ` schema next to Pninim's Artzot HaChaim, which seems to contain it too. Check for that duplicate.
   - Check for any other sefer where the site keeps a worse copy when a better one is available.
   - Check Pninim's Birkei Yosef headings. The app's siman list shows "א" where סימן טו should be, and "סימן טו״ב".
2. **Siddur kavanot.** Mordy asked to take out the kavanah written after Hashem's name (יאהדונהי) in Siddur Edot HaMizrach (Shaliehsaboo edition).
   - The app does it in `tools/siddur/build_app_siddur.py` (regexes `KAVANAH` and `GLUED`): 6,688 taken out, none left.
   - The website's copy of that siddur should match (`scripts/fix_siddur_text.py`, `siddur_*.py`). For printed books, ask Mordy whether they should keep them.
3. **Chok LeYisrael.** If the website has the Chok or a daily-learning page, apply the app's corrections:
   - `learningSchedules/data/chokFixes.json` (Zohar refs and other fixes),
   - `learningSchedules/chokSheet.js` and `learningSchedules/tools/buildChokSheets.js`,
   - before alot hashachar it is still the previous day (Friday night before dawn is still ליל שישי).
4. **Cream reading colour.** There is now a third colour beside light and dark (`ThemeCream.js`): page #F3E9D2, panels #FBF4E4, text #2B2116, borders #E3D5B8. If the website's reader has a light/dark choice, add Cream the same way.
5. **Pninim credit.** Each Pninim edition in the app shows their notice, project section and dedications under the edition, and "report an error" goes to contact@pninim.org, as their notice asks. Check the website gives the same credit wherever it shows those books (its printed sources pages already do, per `pninim.py`).
6. **Pninim books for the app.** The app's Pninim library (release `pninim-2026-11-20`) is built from the website's export by `tools/pninim/build_pninim_release.py`, which calls `scripts/library_app/build_sofer_library.py --books`. If the Pninim books change on the website, tell the app so the release can be rebuilt.
