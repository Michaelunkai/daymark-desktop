# Daymark Android

This module builds a native Android shell around the same deployed Daymark web
application used on Windows and mobile browsers.

## Build

From this directory:

```powershell
gradle assembleRelease
```

The installable artifact is emitted at:

`app/build/outputs/apk/release/app-release.apk`

The shell targets Android 6.0+ (`minSdk 23`), keeps WebView DOM storage and
cache enabled for the local-first app, synchronizes native system-bar colors
with the web theme, and preserves the same responsive navigation drawer and
menu behavior as the web client.
