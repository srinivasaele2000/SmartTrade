# Stage D — reliability bug fixes

03-11-2026 IST. Scope: STC-001/002/003 only. Read Stage C, Stage B and Phase 8 documents first. Existing working-tree changes preserved. No backend/data/schema changes, dependencies, external services, cloud storage or automatic uploads. No local files or business records deleted. No commits/pushes/deployments.

## Root causes and changes

### STC-001 — expired access on restore

Restore previously used only the saved access token for /auth/me and deleted SecureStore on any non-network failure. The refresh timer could not rescue this because it began only after successful restoration.

Added `apps/mobile/src/session-recovery.ts`: validate current access; on 401/403 attempt existing /auth/refresh with stored refresh; validate new access through /auth/me before admission. Preserve rotated refresh when returned. Refresh 400/401/403 or rejected refreshed account raises SessionRejected. Network, 5xx and malformed/unconfirmed responses remain retryable without clearing credentials. No custom token or cryptography implementation.

`session.tsx` uses that recovery path during startup. Structurally corrupt saved data still clears; logout still clears locally before its backend request. A signed-out session is not silently recreated. No server permission/blocking/token-version checks changed.

### STC-002 — outage clears Company/offline session

Refresh previously caught every failure and deleted session. Now only definitive SessionRejected does so. Temporary failures retain encrypted credentials and cached identity for account-scoped local files, show an explicit server-unavailable message, retry every 15 seconds and on foreground. Healthy sessions revalidate/refresh at up to 60-second intervals. Successful retry validates the server account, persists credentials, and clears offline message. Protected endpoints continue enforcing server permissions on every request; cached state never proves server authorization.

Protected-screen 401 callbacks previously called clearSession directly. CompanyScreen, DealerWorkspace, EnquiryWorkspace, OrderWorkspace and App dealer discovery now request revalidation. They do not replay writes; the user retries a failed operation after authentication recovers. A stable runner serializes revalidation within the provider effect so concurrent expiry callbacks do not initiate overlapping refresh calls.

### STC-003 — Dealer document vault requires business API

Moved LocalFileVault outside DealerWorkspace's loaded-profile conditional. It remains behind BUSINESS-account/session gating, uses `account-{id}-dealer-documents`, and passes legacy business scope only when profile data exists. It performs no API calls or remote uploads; private path and existing file access rules remain unchanged. No file migration/deletion mechanism added.

## Files changed in Stage D

- `apps/mobile/src/session-recovery.ts` (new), `src/session.tsx`.
- `apps/mobile/src/DealerWorkspace.tsx`, `src/CompanyScreen.tsx`, `src/EnquiryWorkspace.tsx`, `src/OrderWorkspace.tsx`, `App.tsx` (401 recovery callback routing; Dealer vault placement).
- `apps/mobile/tests/session-recovery.test.mjs` (new), `tests/dealer-component.test.mjs`.
- This report and screenshots under `docs/evidence/stage-d/`.

## Automated validation actually run

| Check | Final result |
|---|---|
| Mobile npm test | 90 passed; zero failed/skipped |
| Mobile npm run typecheck | Passed |
| Django check | Passed |
| PostgreSQL accounts suite | 48 passed; zero skipped; disposable test DB only |
| Admin npm test | 25 passed; zero failed/skipped |
| Admin npm run build (includes TypeScript) | Passed; 30 modules |
| Android Hermes export | Passed; 665 modules, 1.9 MB .hbc under ignored tmp/stage-d-hermes |
| git diff --check | Passed (existing line-ending notices only) |

Hermes initially failed generating bytecode in sandbox temporary storage; same command rerun with approved execution access succeeded. Existing Node module-type and NO_COLOR notices remain. No full marketplace backend rerun: backend code unchanged; account security suite selected for relevance.

Regression tests exercise expired-access → refresh → /me; unrotated/rotated refresh; network/503/malformed response preservation; refresh 400/401/403 rejection; rejected refreshed profile; Dealer Documents render despite profile API error; non-BUSINESS identity denial. These are transport/component tests, not SecureStore-on-device revocation tests.

## Actual Pixel_10_Pro/local API verification

1. Reopened existing Expo Go → SmartTrade after long absence. Existing controlled BUSINESS session was admitted without re-entering OTP; My account showed BUSINESS/ACTIVE and actual Dealer dashboard loaded. No token was extracted, so exact original token age is inferred from elapsed test history rather than decoded JWT evidence.
2. Identified local API PID 9076 by its SmartTrade runserver command, then stopped only that process. Dealer Refresh showed connection failure. Opened Documents: LocalFileVault rendered despite missing business API data. Session refresh produced **'Server unavailable: local session retained for device files. Server revalidation will retry.'**, not sign-out. Stage C synthetic PDF remained listed with application/pdf, 1 KB, Available offline. [Actual offline evidence](evidence/stage-d/dealer-vault-offline.png).
3. Restarted API using existing .venv on 127.0.0.1:8000. Health returned 200. Without login the offline message cleared automatically and document view remained accessible. After final development Fast Refresh, app remained authenticated on catalogue; [saved authenticated screen](evidence/stage-d/dealer-vault-recovered.png). That latter screenshot is catalogue after Fast Refresh, not the document card.
4. Existing synthetic document and all existing business records preserved. API, Metro and emulator left running. No mutation submitted during outage/recovery.

## Limits and remaining verification

Company uses the same corrected SessionProvider and 401 recovery path; prolonged-outage retention was observed on Dealer rather than separately repeated under COMPANY in this pass. Rejected-refresh and blocked-account behavior was verified by transport regressions and backend security tests, not by revoking a live user's session on-device. No claim of on-device forced refresh rejection. Local PDF presence verified; a full fresh force-stop/file-viewer test remains part of Stage C reliability coverage, not these fixes. No low-space/missing-file fault injection.

Definitive revocation clears credentials when the server rejects revalidation; offline clients cannot discover revocation until a server response arrives. The UI labels server unavailability and backend remains authoritative. Retry does not automatically resubmit writes or refresh every business screen's data: affected screens retain explicit retry controls. No unresolved automated failures; stop after Stage D.
