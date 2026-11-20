#!/bin/bash
# Builds fmwax-tv.apk without Gradle: aapt2, javac, d8, zipalign, apksigner.
# Needs a JDK (17+) and the Android SDK at ~/android-sdk (or $ANDROID_HOME)
# with build-tools 35 and platforms;android-34.
#
# THE SIGNING KEY is made on the first build and kept out of git, in
# ~/.config/fmwax-tv/ (or $FMWAX_TV_KEYS): release.keystore and its password,
# a random one in the file `password`. Keep both: an app signed with another
# key cannot install over this one, so a lost key means uninstalling the app
# (and pasting the address again) before the next version. A key of your own
# also means the author's download cannot install over your build, nor yours
# over it. (Until 2026-11-19 the password was written in this script.)
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-$HOME/android-sdk}
BT=$SDK/build-tools/35.0.0
JAR=$SDK/platforms/android-34/android.jar
OUT=build
KEYS=${FMWAX_TV_KEYS:-$HOME/.config/fmwax-tv}
KS=$KEYS/release.keystore
PW=$KEYS/password
rm -rf $OUT && mkdir -p $OUT/res $OUT/classes $OUT/dex
$BT/aapt2 compile --dir res -o $OUT/res.zip
$BT/aapt2 link -o $OUT/unsigned.apk -I $JAR --manifest AndroidManifest.xml $OUT/res.zip --java $OUT/gen
# A compile error stops the build (its notes and warnings are left out).
javac --release 8 -nowarn -Xlint:-options -classpath $JAR -d $OUT/classes $(find src $OUT/gen -name '*.java') > $OUT/javac.log 2>&1 \
  || { cat $OUT/javac.log; exit 1; }
(cd $OUT/classes && jar cf ../classes.jar .)
$BT/d8 --release --min-api 24 --lib $JAR --output $OUT/dex $OUT/classes.jar
(cd $OUT/dex && zip -q ../unsigned.apk classes.dex)
$BT/zipalign -f 4 $OUT/unsigned.apk $OUT/aligned.apk
if [ ! -f "$KS" ]; then
  (umask 077 && mkdir -p "$KEYS" && head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > "$PW")
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -storepass:file "$PW" -alias fmwax \
    -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=fmwax TV" >/dev/null 2>&1
  chmod 600 "$KS"
  echo "made a signing key in $KEYS: keep that folder"
fi
[ -f "$PW" ] || { echo "no password file beside the key: $PW"; exit 1; }
$BT/apksigner sign --ks "$KS" --ks-pass "file:$PW" --out fmwax-tv.apk $OUT/aligned.apk
rm -f fmwax-tv.apk.idsig
echo "built $(pwd)/fmwax-tv.apk ($(du -k fmwax-tv.apk | cut -f1) KB)"
