# Daymark Android Release

`daymark-android-1.0.0.apk` is a signed, installable Android package built
from the native WebView shell in this repository. It loads the same public
Daymark application as Windows and mobile browsers, so the navigation drawer,
responsive layout, and current web release stay in one maintained product
surface.

The package supports Android 6.0 and newer. Android WebView must be enabled on
the device. The app keeps the web client's local-first cache available when the
network is temporarily unavailable.

The website and APK currently share the same deployed application code, but
they do not yet share a cross-device account or server-side data store. The
local workspace remains device-local until the remote sync service is added.
