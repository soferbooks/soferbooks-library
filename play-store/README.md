# SoferBooks Library on Google Play

Everything Play Console asks for, in one place (prepared 2026-11-23):

| What | Where |
|---|---|
| The app bundle to upload | `SoferBooks-Library-<version>-<versionCode>.aab`, e.g. `SoferBooks-Library-1.0.1-2.aab` (here; not in git) |
| Title, short and full description | `listing/` |
| 512x512 icon, 1024x500 feature graphic | `graphics/` |
| Phone screenshots | `graphics/phone-screenshots/` |
| Answers for every form | `play-console-answers.md` |
| The upload key's backup | `C:\Users\morde\Documents\SoferBooks Library signing key\` (never in git) |
| Upload key fingerprint (SHA-256) | `61:3B:82:33:FA:DF:1C:1B:8C:FF:A6:9A:C9:1F:AF:80:D5:76:45:87:87:5A:80:A8:2B:B9:5F:09:86:2F:B1:38` |

## Steps

1. **Create the app.** Play Console -> Create app: name "SoferBooks Library", default language English (United
   States), App, Free; tick the declarations. (Sofer Books LLC is an organization account: no 12-tester closed
   test is needed before production.)
2. **App content** (Dashboard -> "Set up your app" -> each item): privacy policy, ads, app access, content
   rating, target audience, news app, data safety, government apps, financial features, health. Copy the answers
   from `play-console-answers.md`.
3. **Store listing** (Grow users -> Store presence -> Main store listing): paste `listing/`'s three texts, upload
   `graphics/icon-512.png`, `graphics/feature-graphic-1024x500.png` and the phone screenshots. Category: Books &
   Reference; contact email.
4. **Internal testing first** (Test and release -> Testing -> Internal testing -> Create new release):
   - Play App Signing: accept "Use Google-generated key" (the default). Google then keeps the key that signs
     the app on phones; ours is only the upload key.
   - Upload the newest `SoferBooks-Library-*.aab`, release notes "First release of SoferBooks Library on Google
     Play.", Save -> Review release -> Start rollout.
   - Add yourself as a tester (an email list), open the opt-in link on your phone, install from Play and check
     it.
5. **Production** (Test and release -> Production -> Create new release -> "Add from library" -> the same
   build): countries (all), release notes, Review release -> Send for review. Google's first review usually
   takes a few days.

## Good to know

- **Phones that installed the APK from the website or by cable** (your tablet among them) have the app signed
  with a different key, so Play cannot update them, and installing from Play over them is refused. To move
  such a phone to Play, the app must be uninstalled first, which deletes its downloaded books, tabs and history.
  Your tablet can simply stay on the cable builds.
- **Later releases:** raise `VERSION_BUILD` (the versionCode) and the version in `android/app/build.gradle`,
  build the bundle with all three phone types (`cd android; .\gradlew.bat bundleRelease
  -PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64` - without it the 32-bit phones get nothing), sign it
  with `make-upload-key-and-sign.ps1`, and upload it to a new release. Every upload must be signed with
  the same upload key: keep its backup and password safe. If it is ever lost, Google can reset the upload key
  on request (Play App Signing).
