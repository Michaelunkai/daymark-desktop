# Daymark Android Release

## Mandatory signing protection

Before any Daymark Android release, run `.\Protect-DaymarkSigningKey.ps1`.
It accepts only the signing key whose certificate matches the installed
Daymark app, creates two independent hash-verified backups outside the
repository, and refuses to overwrite a different key.

Before publishing an APK, run
`.\Test-DaymarkReleaseReadiness.ps1 -ApkPath <apk-path> -ExpectedCommit <git-commit>`.
It refuses publication unless both protected backups, the repository commit,
and the APK signer match. Never uninstall the installed app, clear its data,
or publish an incompatible replacement merely to bypass a signing mismatch.

GitHub release `v1.4.35` republishes the byte-identical
`daymark-android-1.4.20.apk` as `Daymark-Android-Install.apk`. This is the
latest verified APK signed with the reference Android installation's
certificate. The native shell loads the current production Daymark
application, including the latest date and Order transfer controls, smooth
mobile scrolling, and cross-device synchronization.

`1.4.34` is the pending Android parity release for the same shared Daymark
application used by Windows and the deployed website. Every editable task,
including tasks under projects and every Order lane, exposes direct Move to
date and Copy to date actions backed by a full six-week calendar. Mobile task
and Order editors retain independent momentum scrolling, 44-pixel calendar
targets, safe-area-aware height limits, and reachable actions instead of
cropping content. A release APK is deliberately not produced until
`Verify-DaymarkRelease.ps1` confirms that it uses the original signer of the
installed Daymark app.

`daymark-android-1.4.21.apk` is the Android Order completion and touch-navigation update.
Removing or completing an Order item now immediately preserves it as a completed
task, including its title, details, and priority. The Order workspace has
thumb-sized completion, lane, ordering, and editor controls for Android while
using the same shared web application as the deployed site. It uses package
`com.michaelunkai.daymark`, version code `25`, and version name `1.4.21`.
The tracked APK SHA-256 is
`1038B508198DADC00EC68955D3C317B416349DCD6073F383674C09C04BF06E94`.

`daymark-android-1.4.20.apk` is the verified Android update for the
incomplete-task rollover and cache-first launcher improvements. On every app
open, incomplete scheduled tasks from earlier dates are moved to the current
local day while completed and unscheduled tasks remain unchanged. The native
shell no longer forces WebView cache bypass and enables offscreen preraster to
reduce avoidable repeat-launch work. It uses package
`com.michaelunkai.daymark`, version code `24`, and version name `1.4.20`.
The tracked APK SHA-256 is
`45F017CF6219C3EC076E72BFBF886BF1049D82659589110CC537FC52ABDD7AE0`.

`daymark-android-1.4.19.apk` removes the unnecessary Order-item choice from
task-to-Order moves and copies. Choosing Do now, Later, or After is now a
complete destination, and After no longer creates an item relation. It uses
package `com.michaelunkai.daymark`, version code `23`, and version name
`1.4.19`. The tracked APK SHA-256 is
`84DD15CF5289747038A0246E52C1A30A9FC6B2133DB85F1A35CD309A319F7B3A`.

`daymark-android-1.4.18.apk` is the verified transfer and launcher-icon
release. Android transfer dropdowns retain their selected project, section,
Order lane, and related item values before React schedules state updates, and
the final transfer action cannot be triggered by a native-select click-through.
Successful transfers clear stale search filters so destination projects keep
showing their older items alongside the transferred item. It uses package
`com.michaelunkai.daymark`, version code `22`, and version name `1.4.18`. The
tracked APK SHA-256 is
`8C7816A1BD21CC3E5B6A56E0C32AA269EA07DE5891AE669E90AB34567025A2A2`.

`daymark-android-1.4.13.apk` fixes the Android black-screen failure: a
transient WebView load error can no longer replace a visible Daymark workspace
with a blank fallback. A genuine first-load failure stays visible as an
explicit retry screen instead. It uses package `com.michaelunkai.daymark`,
version code `17`, and version name `1.4.13`. The tracked APK SHA-256 is
`D9D878535F58945C7EAAC1AE7D493BB92AD07DE35D4F7233D0F2281FFE3C9E8C`.

`daymark-android-1.4.12.apk` protects an open task and Order transfer from
incoming workspace replacement. Remote sync changes are deferred until the
transfer closes, then merged, while background refresh uses a stable interval
instead of repeatedly restarting during interaction. It uses package
`com.michaelunkai.daymark`, version code `16`, and version name `1.4.12`. The
tracked APK SHA-256 is
`9BF9996580CFD30449A44BE2C7F71AB5ED401A42ACC4D6E436A726BE3A87E77A`.

`daymark-android-1.4.11.apk` is the Android WebView recovery release. It
recreates the renderer after a process loss, restores the most recent Daymark
address, and replaces a permanent blank loading surface with a visible loading
state. It uses package `com.michaelunkai.daymark`, version code `15`, and
version name `1.4.11`. The tracked APK SHA-256 is recorded after the release
build completes: `0CBE969797CA0C2452756B40F9583663AFDFAD3498838F357D3705A2DD489390`.

`daymark-android-1.4.10.apk` is the transfer-destination release. It uses the
same live Daymark application as the website, including explicit project and
section selection for task moves and copies, explicit Order lane selection for
task-to-Order transfers, and copy-to-Order handling that does not depend on a
task's due date. It uses package `com.michaelunkai.daymark`, version code `14`,
and version name `1.4.10`. The tracked APK SHA-256 is
`C60243A5D380431039A7416F268A02E397738DB4A65711F8561845D156F99C61`.

`daymark-android-1.4.9.apk` is the published VantaBlack companion shell
release and the directly verified installed device version. It uses package
`com.michaelunkai.daymark`, version code `13`, and version name `1.4.9`.
The tracked APK SHA-256 is
`EBCBB1F4415EAF547C771DFD10D5177EDAB1415C2D6FF0C39B0F37A9DFCCADF2`.
The native shell, system bars, launcher icon, offline fallback, and loaded
Daymark web application use black surfaces with pure white text and controls,
while retaining the section task add, edit, and delete controls.

`daymark-android-1.4.8.apk` was the previous companion shell release. It loads
the current Daymark web application, including the section edit and delete
controls, while retaining the viewport-safe app frame and keyboard resizing.

`daymark-android-1.4.7.apk` was the viewport-safe companion shell release. It
uses the live Android viewport for the app frame, keeps each workspace view in
its own vertical scroll region, and resizes around the Android keyboard so
content is not clipped behind it.

`daymark-android-1.4.6.apk` is the previous companion-enabled shell release. It loads
the current Daymark web application and exposes the same live `DaymarkAI`
bridge used by Codex sessions, including workspace reads, task/project
updates, ordered actions, and reversible agent sessions.

`daymark-android-1.4.5.apk` was the previous signed, installable Android package built
from the native WebView shell in this repository. It loads the same public
Daymark application as Windows and mobile browsers, so the navigation drawer,
responsive layout, and current web release stay in one maintained product
surface.

The package supports Android 6.0 and newer. Android WebView must be enabled on
the device. The app keeps the web client's local-first cache available when the
network is temporarily unavailable.

The shell keeps a non-white loading surface visible until the web document
finishes loading, avoids the old `about:blank` teardown flash, and routes Back
through the web app first. The first Back presses close an editor, drawer, or
non-root workspace route; only two quick presses at the root exit the app.

The APK accepts `daymark://sync/<pairing-code>` links generated by the web
client. The pairing code is persisted natively and reused on every later
launcher start, so a paired device cannot silently create a second workspace.
Pairing opens the same remote workspace on Android and Windows while keeping
local-first storage available when offline.
