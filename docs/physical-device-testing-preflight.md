# Physical Android testing preflight

Date: 03-11-2026. Inspection only; this report is the only intended file change. No tunnel, build, installation, configuration edit or database write was performed. Existing uncommitted work was preserved.

## Current backend configuration

- Read effective settings from the ignored root environment without displaying secrets. `DEBUG=True`; allowed hosts are `localhost,127.0.0.1`.
- Development auth, OTP and email simulation flags are enabled locally. All require DEBUG; OTP/login/refresh and development-token authenticated requests also enforce loopback peer and Host checks. Email simulation requires the same local-request boundary. They fail closed when DEBUG is false. STAFF remains explicitly designated and permission checked.
- `local_request` ignores forwarded client IP for its decision. Its own source explicitly prohibits publishing these routes through a proxy/tunnel. A tunnel connects from localhost: rewriting its origin Host to localhost would defeat the intended remote-client boundary. Do not use that workaround.
- No CORS middleware or origin allowlist is configured; CSRF trusted origins are empty and CsrfViewMiddleware is absent. APIs use Authorization Bearer JWT, not Django cookie/session authentication. Native Android fetch does not need browser CORS; CORS would not secure a public API. Reassess CSRF if cookie authentication is introduced.
- SSL redirect is false, HSTS is zero, secure session/CSRF cookie flags are false, proxy SSL header is unset, content-type nosniff is true. These are development settings, not an internet-ready deployment configuration. DEBUG tracebacks must not be exposed.
- SimpleJWT effective defaults: HS256, 5-minute access, 1-day refresh, no refresh rotation or blacklist, no issuer/audience, signing key uses Django secret. Existing authentication checks current account and token version; logout invalidates account tokens. No global DRF throttling is configured in the inspected settings.
- Django secret is required from environment; database password is environment supplied. Root `.env` is ignored and not tracked. Public mobile variables must contain no credentials. No secret values were printed. This was a targeted configuration audit, not a complete repository/history secret scan or filesystem ACL audit.
- Confirmed live connection: `smarttrade_dev` / `smarttrade_app` at `127.0.0.1:5432`. Read-only SQL reports `listen_addresses=*`, SSL off, password encryption SCRAM-SHA-256. Actual listeners are `0.0.0.0:5432` and `[::]:5432`. **Database is not loopback-bound.** Firewall rules, router forwarding and pg_hba reachability were not established, so network isolation cannot be claimed.
- API listener `127.0.0.1:8000`; actual `GET http://127.0.0.1:8000/api/v1/health` returned 200. Health is a liveness check, not proof every business API is healthy. Admin `127.0.0.1:5173`, Metro `127.0.0.1:8081`. Vite proxies `/api` to loopback API with changeOrigin enabled.
- Initial sandbox SQL connection was denied by Windows/socket permissions; approved read-only execution outside the sandbox succeeded. No PostgreSQL settings were changed.

## Mobile configuration and security

- Existing Expo project: SDK `~58.0.0`, React Native `0.88.0`, React `19.3.0`, TypeScript `~5.9.3`; existing dependency versions were not changed.
- `app.json` has name/slug/version, new architecture, SecureStore and Sharing plugins. It has **no `android.package`**, Android versionCode, explicit permission allowlist, EAS project/build profile or checked-in native Android directory.
- `EXPO_PUBLIC_API_URL` is read in App.tsx and embedded at bundle/build time. Current ignored `.env.local` points to `http://127.0.0.1:8000/api/v1`. On a phone this is the phone itself unless USB adb reverse is active. Emulator `10.0.2.2` is not a physical-device address.
- No dedicated release/staging environment selection is configured. A build needs its intended API URL set before bundling; changing laptop environment afterwards does not update an installed bundle. The client accepts HTTP and HTTPS, so release HTTPS enforcement is not currently established.
- Tokens and cached account identity persist in Expo SecureStore. Startup revalidates; expired access attempts refresh. Retryable network errors retain local credentials; definitive authentication rejection clears them. Foreground/timed retries are implemented. Logout clears local session before requesting server invalidation; offline server logout cannot be guaranteed. Account-scoped local files intentionally survive logout; SecureStore does not itself encrypt file contents.
- Local file selection/import uses device storage; do not infer upload/admin availability. Preserve the existing local-only limitations during phone testing.
- Actual standalone manifest permissions, backup rules, cleartext policy, signing and release debuggability cannot be certified without generating and inspecting the Android project/APK. Existing Expo Go operation is not standalone APK validation. Avoid requesting broad storage access; use the current document-picker/app-private approach.
- Stage E still records blocked device restart/persistence/storage-failure checks following emulator unresponsiveness. This preflight does not close them.

## APK build requirements

- Detected JDK: Temurin 17.0.19.10. adb, Node and npm are available. Android SDK contains platforms/build-tools, emulator, NDK and CMake; build-tools versions 34, 35 and 36 are installed. Exact generated SDK/Gradle/JDK compatibility and licenses/dependency downloads remain unverified until a controlled build.
- No `eas` or `cloudflared` executable was found on PATH; this does not prove there is no copy elsewhere.
- A standalone APK is feasible in principle, **not ready or generated in this audit**. Select a stable unique Android application ID and signing policy first.
- Recommended local path after approval: preserve working tree, configure package/build environment, use installed Expo CLI to prebuild Android, resolve only required build prerequisites, then assemble a signed release APK with Gradle. Prebuild generates files and must not run during this audit. Debug APKs may require Metro; do not present one as an independent release artifact.
- EAS is optional: it would require explicit EAS configuration, an APK/internal-distribution profile (rather than default AAB), signing credentials and potentially Expo account/cloud build access. It is an external service and is not necessary for a local Gradle build. No EAS/cloud integration is proposed without approval.
- Never put signing passwords, private keys, API tokens or database credentials into EXPO_PUBLIC variables or source control. Inspect merged manifest and APK for permissions, backup exclusions, debuggability, embedded endpoint and accidental secrets, then install/test on the actual phone.

## Temporary internet access assessment

Cloudflare Tunnel can map a public HTTPS hostname to only `http://127.0.0.1:8000`, without publishing PostgreSQL or Vite. This is a capability, **not a confirmation that the current application is safe to expose**. See official [Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/) and [routing](https://developers.cloudflare.com/tunnel/concepts/routing/). No tunnel was started.

- Never forward PostgreSQL, Vite, Metro, filesystem/static private documents, or broad private-network routes. An API tunnel still exposes every routed API path unless explicit ingress/path restrictions are added. End with deny/unmatched handling; do not configure wildcard hosts/services.
- Current loopback-only simulated authentication will reject the real tunnel Host. Turning DEBUG off also disables development tokens/simulations. Thus existing full login/company simulation flows are **not compatible with a normal public tunnel**. Preserve that safety boundary.
- Do not override origin Host to localhost to make simulation work. A public URL plus arbitrary-OTP login can expose controlled accounts and business data; a random tunnel URL is not access control.
- Internet testing would need an approved isolated testing security design: authenticated device/access boundary compatible with native fetch, strict test account scope, rate limits, exact host allowlist, correct trusted-proxy HTTPS handling, no public debug errors, and verified denial of development shortcuts from untrusted requests. Browser/email Access login is not automatically compatible with the native app and conflicts with the current no-external-provider policy; never embed a shared Access service secret into an APK.
- Keep admin local. A tunnel does not itself publish port 5432, but existing database wildcard binding is a separate network risk. Verify Windows firewall/router configuration and approve loopback binding before claiming isolation.

## Recommended setup sequence and required changes

1. Prefer **USB-only phone testing** first: explicit device authorization and adb reverse for port 8000 preserves the backend's loopback boundary without public exposure. Current local mobile URL can then remain loopback. Verify actual peer/Host behavior and login on device; do not assume success. Expo Go over USB/Metro can test functionality before a standalone APK.
2. With approval, inspect and restrict PostgreSQL network access to loopback where compatible with other local uses; verify firewall and no router forwarding. Never change unrelated services/databases.
3. Choose Android package ID, test build type, signing ownership and APK distribution scope. Configure a separate test build environment, preserve current versions, generate/build and inspect native artifacts.
4. Install on the authorized physical phone; check health, controlled login, refresh/logout, role boundaries, local document access and offline/restart behavior. USB disconnection removes reverse forwarding; the app must report offline rather than lose session.
5. Only if off-laptop-network access is essential, approve a tunnel-specific access design and reconcile it with development simulations before installing/configuring cloudflared. Route API only, set exact hostname and secure proxy behavior, validate forbidden routes and database/admin isolation, and define shutdown/revocation procedure. Do not simply expose current DEBUG runserver.

## Blockers and audit limits

- Public tunnel plus current local-only simulated authentication is a concrete security/design blocker; no bypass recommended.
- PostgreSQL wildcard listeners; firewall/pg_hba/router reachability not yet audited.
- Missing Android package ID, standalone build/signing configuration and generated-artifact validation.
- No physical phone connection or installation was tested; no build, tests, migrations, deployment or listener changes were performed.
- Full secret scanning, Windows ACL inspection, production security certification and business endpoint penetration testing were outside this preflight.
- Existing Stage E device reliability gaps remain. USB-first testing is the lowest-change recommendation; await approval before applying configuration/build/network changes.
