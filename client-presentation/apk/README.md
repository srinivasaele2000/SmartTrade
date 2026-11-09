# SmartTrade USB-local Android APK

Application: SmartTrade, `in.smarttrade.localtest`, version 0.1.0 (1).
Target ABI: arm64-v8a. Intended phone: `5e106900` only.

## Current result

**04-11-2026: signed ARM64 release APK built, verified, installed and launched on physical phone `5e106900`.** No installation or forwarding changes were made on `emulator-5554` during this task.

Output: `C:\Projects\SmartTrade\client-presentation\apk\SmartTrade-0.1.0-usb-arm64-release.apk` (22,445,982 bytes).

APK SHA-256: `7e9b94c59d36d46d6e1c77c19c2e1f689b07e6e42984b94af69ab458657eb2c1`.

`apksigner verify --verbose --print-certs` passed: one RSA-3072 local-testing certificate, APK Signature Scheme v2 verified. Certificate SHA-256: `9652a7f19494241d2e5467f02fd8f9649129c8ef85d3ef6ea98ec30490e3545e` (public certificate fingerprint, not a private credential).

`aapt dump badging` confirms package `in.smarttrade.localtest`, version 0.1.0 (1), only `arm64-v8a`, minimum SDK 24, target SDK 36. Generated BuildConfig confirms `DEBUG=false`, `BUILD_TYPE=release`, Hermes enabled. Packaged manifest has backup disabled, the reviewed network security configuration, and no debuggable attribute.

`adb -s 5e106900 install -r <APK>` returned **Success**. Explicit `am start -W -n in.smarttrade.localtest/.MainActivity` returned **Status: ok**, cold launch 650ms. Actual phone screenshot [phone-first-launch.png](phone-first-launch.png) was captured and visually inspected: the installed app displays actual API-loaded categories, company brand and the existing product/INR price. This fresh standalone installation has no bundled sample catalogue and does not require Metro. No login or business-record mutation was performed. The phone status/USB overlay partially overlaps the top header; this task did not change application layout.

USB forwarding on this phone reports `tcp:8000 tcp:8000`. A separate shell netcat health probe returned no output and is **not** counted as HTTP verification; successful real-app catalogue loading is the phone-side connection evidence. Earlier laptop health was 200. No crash/network-failure entry appeared in the inspected app-process log window; this is a launch smoke test, not complete workflow or long-duration stability testing.

## Download diagnosis and build validation

The prior attempt failed with Java `SocketTimeoutException: Connect timed out`, and both official HEAD probes had timed out. On this continuation, DNS resolved both official Gradle hosts, curl followed the official service → Gradle GitHub release → release-assets chain to HTTP 200. Checked HTTP/HTTPS/ALL proxy variables and Java/Gradle options were absent; WinHTTP reported direct access. Current evidence does not establish a specific firewall rule or DNS failure as the historical cause: it was an earlier connection timeout, now cleared. No system network/security settings were changed.

Existing complete cached distributions were 8.9 and 8.14.3; 9.4.1 contained only partial/lock files. Project React Native Gradle plugin declares AGP 9.2.1. The official [AGP compatibility guidance](https://developer.android.com/build/releases/agp-9-2-0-release-notes) requires Gradle 9.4.1 for AGP 9.2, so the cached Gradle 8 versions were not substituted.

Downloaded the unchanged 9.4.1 binary from the official Gradle service with curl and verified the official SHA-256: `2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb`. Seeded the wrapper cache and pinned `distributionSha256Sum` to the verified value. TLS verification remained enabled; no unofficial mirrors or version changes were used.

Gradle `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain --no-daemon` reported **BUILD SUCCESSFUL in 15m 19s**, 273 actionable tasks executed. The project installed required official Android SDK Platform 37 and Build-Tools 37 using existing accepted licenses. JDK remained Temurin 17. React Native remained 0.88.0; Expo's precompiled native libraries target 0.88.1, so native modules compiled from source. Release JavaScript bundled 665 modules. App release lint passed; several dependency lint/configuration tasks were SKIPPED by their plugins and are not represented as executed tests. Dependency deprecation warnings remain (including APIs slated for Gradle 10/AGP 10 removal); no upgrade was attempted.

`npm run typecheck`: PASS. `npm test`: **90 passed, zero failed, zero skipped**. Build-script syntax: PASS. An outer log-read command initially returned an error because the build script changed caller working directory, after the APK had already built successfully. Fixed the script with Push-Location/finally Pop-Location and verified its PowerShell syntax; the native build was not needlessly repeated for this shell-only correction. Build log: ignored `tmp/android-release-build.log`.

Signing files, their passwords, private USB build environment and generated APK are confirmed Git-ignored. No backend settings, database ownership or business records were changed. No public service exposure, commits or pushes occurred.

## Build after official dependency access is restored

From the repository root in PowerShell:

```powershell
& .\apps\mobile\scripts\build-usb-apk.ps1
```

This uses existing project dependencies and generated native Android project. It creates/reuses a private local signing key and random passwords in ignored `local-secrets/android`, protects that directory with Windows ACLs, loads the separate private `usb-build.env`, disables automatic Expo dotenv loading for the build, and runs `:app:assembleRelease` for arm64-v8a. It refuses to overwrite a previous presentation APK. Back up the private signing materials securely: subsequent updates require the same key. These are local testing keys, not Play Store credentials.

Existing verified output: `client-presentation/apk/SmartTrade-0.1.0-usb-arm64-release.apk`. The build script intentionally refuses to overwrite it.

The generated release signing configuration never falls back to the template debug key. Release is explicitly non-debuggable. HTTP is allowed only for loopback via Android network security config; all other hosts require HTTPS. Android app backup is disabled. Do not run `expo prebuild --clean`: it could overwrite the reviewed native signing/network changes. Existing Expo Go scripts and `.env.local` were preserved.

The API URL comes from private build environment, not application source. USB-only testing necessarily resolves the API through phone loopback. This is a release-mode local-test binary, **not an internet/production release**. A different deployment requires an explicit HTTPS environment and a separate authentication/security design. Backend security settings were not changed.

## Phone connection and installation

```powershell
adb -s 5e106900 reverse tcp:8000 tcp:8000
adb -s 5e106900 reverse --list
```

Keep Django on laptop `127.0.0.1:8000`. Reapply reverse after phone reconnect/reboot. This does not expose the API publicly. No emulator install/reverse command is used.

After a successful build, verify using the installed Android SDK `apksigner verify --verbose --print-certs` and `aapt dump badging`/`aapt dump xmltree` against the output APK. Confirm package/version, arm64-v8a, no debuggable flag, bundled JavaScript and release signing certificate. Then install only with:

```powershell
adb -s 5e106900 install -r .\client-presentation\apk\SmartTrade-0.1.0-usb-arm64-release.apk
```

Do not uninstall or clear an existing installation to bypass a signature mismatch; inspect it first. First installation may require the phone owner's USB-install approval. Authentication must continue through existing local-development rules. No business records are created by the build or install.
