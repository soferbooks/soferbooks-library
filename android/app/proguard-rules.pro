# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# react-native-config finds BuildConfig by reflection (see build_config_package in build.gradle)
-keep class org.sefaria.sefaria.BuildConfig { *; }

# react-native-inappbrowser-reborn finds its @Subscribe onEvent through EventBus by reflection;
# without these rules R8 drops it, EventBus.register() throws and links open in the full browser
# instead of the in-app Custom Tab (EventBus's own documented rules)
-keepattributes *Annotation*
-keepclassmembers class * {
    @org.greenrobot.eventbus.Subscribe <methods>;
}
-keep enum org.greenrobot.eventbus.ThreadMode { *; }
