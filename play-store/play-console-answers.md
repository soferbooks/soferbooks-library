# Play Console answers: SoferBooks Library (com.soferbooks.library)

Checked against the app's code on 2026-11-23. The app has no account, no analytics, no crash reporting and no
ads (Sefaria's Firebase Crashlytics is replaced by a stub, `shims/crashlytics.js`; the advertising-ID
permission is removed in `AndroidManifest.xml`).

## App details (Create app)

| Field | Answer |
|---|---|
| App name | SoferBooks Library |
| Default language | English (United States) - en-US |
| App or game | App |
| Free or paid | Free |
| Category | Books & Reference |
| Contact email | the one Sofer Books LLC uses for support |
| Website | https://soferbooks.com |
| Privacy policy | https://soferbooks.com/privacy#library-app |

## App content

**Privacy policy:** https://soferbooks.com/privacy#library-app (its "The SoferBooks Library app" section describes
this app).

**Ads:** No, the app does not contain ads.

**App access:** All functionality is available without special access (no login).

**Target audience and content:** 13 and over (13-15, 16-17, 18 and over). Not "designed for children": choosing
an age under 13 puts the app under Google's Families policy. Appeals to children: No.

**Content rating questionnaire** (IARC):
- Category: Reference, News, or Educational.
- Violence, sexuality, language, controlled substances, crude humour, gambling: No.
  (The texts are classic religious literature, as in any Tanakh or Talmud.)
- Users can interact or exchange content: No.
- Shares the user's location: No.
- Digital purchases: No.
- Unrestricted internet access (a web browser): No.
- Expected rating: Everyone / PEGI 3.

**News app:** No. **COVID-19 tracing:** No. **Government app:** No. **Financial features:** None.
**Health:** None.

**Data safety:**
- Does the app collect or share any of the required user data types? **No.**
  - No personal info, location, contacts, messages, photos, files, app activity, web history, app info and
    performance, or device or other IDs are collected or shared.
  - What the app sends, none of it user data: requests for public book files (Sefaria's API, the libraries'
    files on GitHub, Dicta, Otzaria, Wikisource, Pninim) over HTTPS, with nothing identifying the user; and,
    only when the user turns on "nikud by computer", the Hebrew passage on screen to Dicta's Nakdan. That is
    the book's text, not anything about the user.
  - "Report an error" opens the user's own email app with the passage filled in; the user sends it
    themselves.
- Is all user data encrypted in transit? Yes (HTTPS). (Asked only if data is collected.)
- Can users ask for their data to be deleted? Not applicable: nothing is collected. Reading history, tabs
  and downloads are on the device and can be cleared in Settings.

**Permissions** (the app's merged manifest):

| Permission | Why |
|---|---|
| INTERNET | Download books, check for library updates, read texts not yet downloaded |
| ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE | Download only on Wi-Fi when the user chooses "Download on Wi-Fi only" |
| READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE | Older Android versions only: keep downloaded books (Android ignores them from version 13 on) |
| VIBRATE | A short haptic tick on a long press of a passage |
| com.soferbooks.library.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION | Added by AndroidX itself: keeps the app's own broadcasts inside the app |

None of these needs a declaration form in Play Console.

**Families / Teacher Approved:** not applying.

## Store listing

In `listing/` (title, short description, full description) and `graphics/` (512x512 icon, 1024x500 feature
graphic, phone screenshots).

## Release

- File: `SoferBooks-Library-1.0.0-1.aab` (versionName 1.0.0, versionCode 1; targetSdk 36, minSdk 24;
  arm64-v8a, armeabi-v7a and x86_64), signed with the upload key.
- Play App Signing: on (Google keeps the app signing key; the key here is only the upload key).
- Release notes: "First release of SoferBooks Library on Google Play."
