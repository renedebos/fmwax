# The fmwax TV app

A small Android TV app: the house's TV page full screen in a WebView, with
its own tile on the TV's home screen, voice on the remote's Guide key and Talk
with the TV's microphone. Java, no Gradle, about 36 KB. To put it on a TV,
see [On your TV](../../../docs/install/tv.md); this page is for reading the
code and building it yourself.

## What it does, and may do

- **One address, asked once.** The first start asks for the TV page's address
  (`https://…/buttons/<key>/tv`), pasted with the Google TV phone app's
  keyboard. It is kept in the app's own settings, which are out of Google's
  backups and of a copy to a new TV (`allowBackup="false"` and
  `res/xml/data_extraction_rules.xml`). Back held about a second asks again.
- **Only the house's pages.** A link to any other site is not opened. The
  check is the address's scheme, host and port against the saved one
  (`Main.ours`).
- **The microphone, for two things.** Guide pressed: the TV's own speech
  recognition listens, and the words go to the house's `…/tv/say?q=`. Talk on
  the TV: the house's own pages may have the microphone (`onPermissionRequest`),
  no other page. Android asks the TV's owner first, once. The words are never
  logged. Nothing listens off the screen: when the app leaves it (Home,
  standby), Guide's listening is cancelled and the WebView is told it is
  hidden, so Talk hangs up (once the desk has finished, if it was busy).
- **What the page may ask of the app** (`window.fmwaxTV`, acted on only while
  the house's page is open): `sound()` (is a receiver set), `talk(on)` (a Talk
  line opened or closed: the receiver to TV and back), `talkKeys(on)` (only
  the Talk screen, `…/tv/talk`: Guide's down and up go to the page as Talk's
  hold, `window.fmwaxGuide`). Back asks the page first (`window.fmwaxBack`:
  an open view closes).
- **The receiver** (`Denon.java`, optional). A Denon on the home network, by
  its own commands on port 23: while a Talk line is open it goes to its TV
  input, and back when the line closes, only if it is still on TV. The one
  thing another app may set, a private IPv4 address only:
  `adb shell am start -n house.fmwax.tv/.Main -e denon 192.168.1.50`
  (`-e denon none` forgets it).
- **Permissions:** the internet, the microphone, and audio settings (for
  WebRTC, Talk's line). No storage, no location, no camera.
- **Its version** goes in the user agent (`fmwaxTV/1.6`). The house uses it
  to give Talk to the app only (a TV's browser gives a page no microphone) and
  About fmwax shows it.

## Build it

A JDK (17 or later) and the Android SDK's command-line tools, with
build-tools 35 and platform 34:

    sdkmanager "build-tools;35.0.0" "platforms;android-34"
    ./build.sh

The SDK is looked for in `~/android-sdk`, or `$ANDROID_HOME`. The build makes
`fmwax-tv.apk` here.

**The signing key** is made on the first build in `~/.config/fmwax-tv/` (or
`$FMWAX_TV_KEYS`): `release.keystore` and a random password beside it. Keep
that folder. A new version installs over the old one only when signed with
the same key; with another key the app must be uninstalled first, and the
address pasted again. So your own build and the author's download cannot
install over each other either.

## Put it on the TV with a computer

Turn on the TV's developer options and debugging (on Google TV: Settings,
System, About, press **Android TV OS build** seven times; then Developer
options, **USB debugging**, which on many TVs, the Bravia too, also opens it
over the network), then:

    adb connect <the TV's address>:5555
    adb install -r fmwax-tv.apk

`-r` installs over the old version and keeps the address.

## Measured on a Sony Bravia (Google TV)

- The remote's **Guide** key reaches the app, one down and one up for a hold
  (Android repeats between them). The remote's **microphone** button does
  not: it is the TV's assistant's.
- The TV's built-in microphone works for a page only with the TV's own
  microphone switch on and the TV restarted once after.
- Google's voice screen (`RecognizerIntent`) heard the words but never handed
  them back, so the app listens itself through `SpeechRecognizer`.
