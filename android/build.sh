#!/bin/bash
# Сборка APK без Android Studio: aapt (Ubuntu), android.jar API 34, javac, dx, zipalign, apksigner.
set -e
cd "$(dirname "$0")"
JAR=${ANDROID_JAR:-../sdk/android-34.jar}
KS=${KEYSTORE:-../key/premiumvpn.jks}
rm -rf build && mkdir -p build/gen build/classes build/apk/lib/arm64-v8a
aapt package -f -m -M AndroidManifest.xml -S res -A assets -I "$JAR" -J build/gen -F build/res.apk
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$JAR" -d build/classes $(find src build/gen -name '*.java')
dalvik-exchange --dex --min-sdk-version=26 --output=build/apk/classes.dex build/classes
cp ../core/libpvcore.so build/apk/lib/arm64-v8a/libpvcore.so
cp build/res.apk build/unsigned.apk
(cd build/apk && zip -q -r ../unsigned.apk classes.dex lib)
zipalign -f -p 4 build/unsigned.apk build/aligned.apk
apksigner sign --ks "$KS" --ks-pass env:KS_PASS --out build/PremiumVPN.apk build/aligned.apk
apksigner verify --print-certs build/PremiumVPN.apk | head -3
ls -la build/PremiumVPN.apk
