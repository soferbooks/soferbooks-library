# SoferBooks Library

SoferBooks Library is a free Android app for reading the classic Jewish texts: Tanakh, Talmud,
halacha, commentaries and more, online or downloaded for offline reading. It needs no account;
reading history and saved texts stay on the phone. A content filter (Right-Wing Modern Orthodox by
default, changeable in Settings) hides books, translations and sheets the reader does not want to see.
Sefaria links (sefaria.org) can open in the app: Settings, "Open Sefaria links in this app".

The texts come from [Sefaria](https://www.sefaria.org)'s free library and keep their own licences
(shown under "About this text" in the reader).

## Origin

This app is built on [Sefaria-Mobile](https://github.com/Sefaria/Sefaria-Mobile), Sefaria's
open-source React Native app, and keeps its GPL-3.0 licence. Thanks to Sefaria for the app and
for the library behind it.

## Building

You need Node 20 or later, JDK 17 and the Android SDK (platform 36, build-tools 36.0.0 and NDK
27.1.12297006, installed with Android Studio or `sdkmanager`). No Firebase files are needed.

1. Install the JavaScript dependencies (this also applies the patches in `patches/`):

   ```sh
   npm install
   ```

2. Tell Gradle where the JDK and the Android SDK are. Either set the environment variables:

   ```sh
   # Windows (PowerShell)
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

   # macOS / Linux
   export JAVA_HOME=/path/to/jdk-17
   export ANDROID_HOME=$HOME/Android/Sdk     # macOS: $HOME/Library/Android/sdk
   ```

   or create `android/local.properties` (not committed) with the SDK path:

   ```properties
   sdk.dir=C\:\\Users\\you\\AppData\\Local\\Android\\Sdk
   ```

   Without one of these the build stops with "SDK location not found".

3. Build the debug APK:

   ```sh
   cd android
   ./gradlew assembleDebug          # Windows: .\gradlew.bat assembleDebug
   ```

   The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

4. A debug build loads its JavaScript from Metro. Start Metro and install the app on a running
   emulator or a USB device:

   ```sh
   npx react-native start
   adb reverse tcp:8081 tcp:8081
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

   (`npx react-native run-android` does the build, install and launch in one step.)

The app's version is set at the top of `android/app/build.gradle` (`VERSION_MAJOR`,
`VERSION_MINOR`, `VERSION_PATCH`, `VERSION_BUILD`). Optional developer settings, such as a local
library export server, go in `.env` (see `.env.example`).

## Tests

```sh
npx jest              # run all tests once
npm test              # watch mode
```

## License

SoferBooks Library is free software under the GNU General Public License, version 3, as was
Sefaria-Mobile, from which it is derived. See [LICENSE](LICENSE). The texts keep their own
licences.
