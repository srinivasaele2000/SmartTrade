# Company onboarding — Phase 1 validation

Validation date: 2026-11-01. Scope: Company onboarding and verification only.

## Existing implementation reused

Existing account registration/development OTP/JWT/session handling, COMPANY-only workspace, one-company owner profile, private file API, verification cases, reviewer claiming, reason-required decisions, suspension/restoration, restricted review requests and append-only audit events were retained. The existing designated STAFF administrator was used. No account/role bootstrap, marketplace records, dependency installation or migrations were needed.

## Changes

- Added `SMARTTRADE_ENABLE_DEV_EMAIL` (default false), gated by DEBUG and loopback peer/Host/Origin. No external delivery occurs. Any non-empty development code records separate audit evidence, not real email ownership. `email_verified_at` stays null. Email changes invalidate simulation evidence even if changed back. Disabling the flag or DEBUG invalidates its use for submission.
- Owner context exposes `email_verification_mode`, `email_ready` and `can_verify_email`; staff queue labels simulated evidence. Mobile clearly distinguishes simulation from verified ownership.
- Company row locks serialize profile changes, email confirmation, uploads and submission. Duplicate submissions return conflict, documents cannot be attached after a concurrent submission, and audit document counts are recorded before updating the queryset.
- Private downloads are authorized as before and now add `private, no-store` plus `nosniff` response headers.
- Admin restricted reviews provide a separate reason-required restore-activity action only when the loaded STAFF permissions include RESTORE_COMPANY. Backend permissions remain authoritative. Restoration does not resolve the request, approve a rejected company or unblock an account. Incomplete/failed responses cannot display restoration success.
- Mobile application guidance distinguishes already pending, approved, rejected and suspended states. Explicit refresh clears stale action feedback.

## Local configuration

Actual connection identity was checked before live writes: database `smarttrade_dev`, application role `smarttrade_app`. Root `.env` remains Git-ignored; existing credentials and unrelated settings were preserved. Existing development OTP and designated STAFF login remain enabled. No secret values appear here.

Local-only synthetic-document test policy, deliberately not a production business requirement:

- SMARTTRADE_ENABLE_DEV_EMAIL=true, with DJANGO_DEBUG=true.
- SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES=1048576.
- SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES=application/pdf,image/png,image/jpeg.
- SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES=REGISTRATION,ADDRESS_PROOF.
- Existing ignored local private storage; no public media route.

Production document taxonomy, limits, retention period and consent wording remain undecided. Do not promote these test values into production defaults. To disable local email simulation, set SMARTTRADE_ENABLE_DEV_EMAIL=false and restart Django. DEBUG=false also disables it regardless of the flag. Real providers remain deferred.

## Actual live testing

Three separately named controlled COMPANY accounts/profiles were used: primary approval/suspension scenario, rejection scenario, and ownership/account-blocking boundary scenario. Reserved fictitious numbers and `.test` addresses were used without exposing login values here. Existing user company data was preserved. Synthetic PDF documents contain no real registration or personal information. Test records/audit history were preserved, not deleted.

| Workflow/check | Evidence and result |
| --- | --- |
| Account registration and company profile creation | Real HTTP APIs against PostgreSQL; created separate controlled COMPANY profiles; PASS. Native registration/profile creation were not repeated end to end in this run. |
| Company sign-in and workspace | Pixel_10_Pro, supported local OTP, actual authenticated account; PASS. |
| Profile view/edit/save | Android edited trading name, backend persisted it, staff browser displayed it; PASS. |
| Local email request/confirmation | Android used the labelled simulation UI; PostgreSQL retained separate audit evidence and no real email_verified_at; PASS. |
| Required document policy/status | Real GET owner context returned configured policy and missing types; Android displayed policy and upload metadata; PASS. |
| Native private upload | Android document picker selected the synthetic PDF for both required types; real multipart upload succeeded; PASS. |
| Verification submission | Android submitted; real staff browser queue received the two-document application; PASS. |
| Admin document access | Browser claimed case and downloaded through protected endpoint; download audit recorded. Independent HTTP byte comparison matched the PDF fixture. This verifies download access, not an embedded PDF viewer. PASS. |
| Approval | Browser required a reason and approved; Android refreshed to Approved / verified; PASS. |
| Rejection | Separate case prepared through APIs; browser claimed/rejected with mandatory reason; owner API retained REJECTED; PASS. Rejected screen behavior also covered by headless component tests. |
| Suspension | Authorized staff HTTP action; Android showed Suspended, approved application and restricted review form; account session/status remained usable; profile/email/upload/submission writes returned 403; PASS. |
| Review and restoration | Android submitted suspension review. Browser loaded real request, restored company activity with reason, then separately recorded resolution. Android refreshed to approved ACTIVE; PASS. |
| Rejected restrictions | Profile edit/upload/resubmission returned 409, restricted review request accepted; PASS. |
| Missing required documents | Live submission returned 400; PASS. |
| Invalid MIME and oversized file | Live uploads both returned 400; PASS. |
| Duplicate submission | Live second submission returned 409; PASS. |
| Unauthorized private document | Unauthenticated 401, other company 404; PASS. |
| Non-owner company access/staff access | Foreign company-by-ID route unavailable (404), company calling staff queue denied (403); owner-only routes do not accept a target owner ID; PASS. |
| Account blocking | Controlled boundary account blocked using existing model behavior. Existing token, login and review request returned 401. Company restoration left account blocked. Account returned to original ACTIVE state afterward; PASS. |
| Audit preservation | Submission document count two; approval, suspension, restoration and resolution retained actor, timestamp and reason. No records removed; PASS. |

The real browser test used the Codex in-app Chromium browser, not a claim of manually testing a separate Chrome window. Android testing used the existing Pixel_10_Pro emulator with Expo Go and actual local API requests; headless React tests are reported separately.

## Automated verification

Run from the repository root:

```powershell
.\.venv\Scripts\python.exe scripts/manage-local.py check
.\.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe scripts/manage-local.py test --noinput -v 1
```

Run in apps/mobile: `npm run typecheck`, `npm test`, then with EXPO_OFFLINE=1, `npx expo export --platform android --output-dir .expo/phase1-export`.
Run in apps/admin: `npm run typecheck`, `npm test`, `npm run build`.

The launcher uses the separate test role and disposable PostgreSQL test database, never SQLite. Development flags are reset for regression tests; boundary cases explicitly opt in. Final results: 121 PostgreSQL tests passed with zero skips; 48 mobile tests passed; 17 admin tests passed. Django checks, migration consistency, both TypeScript checks, admin production build and Android Hermes export passed. git diff --check passed (existing line-ending notices only). Test fixtures are separate from preserved live controlled records.

## Endpoints exercised

All under `/api/v1`:

- POST `/auth/register`, `/auth/otp/request`, `/auth/login`, `/auth/dev-login`; GET `/auth/me`.
- POST `/companies/register`; GET/PATCH `/companies/me`.
- POST `/companies/me/email-verification/request`, `/companies/me/email-verification/confirm`.
- POST `/companies/me/documents`; GET `/companies/me/documents/{id}`.
- POST `/companies/me/verification-submissions`, `/companies/me/review-requests`.
- GET `/staff/companies/verification-queue`, `/staff/companies/review-requests`.
- POST `/staff/companies/{id}/claim`, `/verification-decision`, `/suspend`, `/restore`.
- GET `/staff/companies/{id}/documents/{document_id}`.
- POST `/staff/companies/review-requests/{id}/resolve`.

## Remaining limitations

- Rejected applications cannot be reopened/resubmitted under current approved rules. An explicit reopening policy is needed before adding that workflow; resolving a request only records handling.
- Admin document inspection uses secure downloads; no embedded PDF preview was added.
- Production verification policy, retention and external provider integration are intentionally out of scope. No new external service is required locally.
- Backend liveness is http://127.0.0.1:8000/api/v1/health. Admin is http://127.0.0.1:5173/. Android uses existing adb reverse ports 8000/8081 and the configured loopback API URL.

No Phase 2 modules, production changes, commits, pushes or deployments were performed.


## Files changed in this Phase 1 task

- `.env.example`; ignored local `.env` (no secrets included in documentation).
- `README.md`; this validation report.
- `services/api/config/settings.py`.
- `services/api/companies/email_verification.py`, `views.py`, `serializers.py`, `tests.py`, `README.md`.
- `scripts/manage-local.py`.
- `apps/mobile/src/company.ts`, `src/CompanyScreen.tsx`, `tests/company.test.mjs`, new `tests/company-component.test.mjs`, `README.md`.
- `apps/admin/src/App.tsx`, `src/ReviewRequests.tsx`, new `src/company-actions.ts`, new `tests/company-actions.test.mjs`.

Ignored `tmp/phase1_*` helpers, synthetic PDF and validation logs/screenshots were used for live checks. Existing unrelated modified/untracked files were preserved. No dependency manifest, database model or migration file was changed.
