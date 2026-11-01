# Phase 3 — Company-to-dealer authorization

Validated locally on 2026-11-01. Scope is authorization only, not Phase 4 inventory development.

## Existing implementation reused

AuthorizedDealerGrant already had immutable company/brand/business scope and a unique constraint. PostgreSQL guards enforce eligible owning-company actors, eligible dealer targets and immutable audit events. Company grant/revoke, dealer read-only authorization status, and dynamic listing eligibility existed. Existing business verification, JWT/development OTP and company verification were reused. No models or migrations were added or changed.

## Changes

- Company writes retain the existing POST route and explicit brand/business/active/reason body. Company and business row locks serialize state transitions; database scope uniqueness remains authoritative.
- Repeated active/revoked states return 409 AUTHORIZATION_UNCHANGED without changing the grant or audit. Revoking a nonexistent scope returns 404 AUTHORIZATION_NOT_FOUND without creating a phantom row. Reactivation reuses the same scope row and appends a new event.
- Unknown/read-only body fields (including actor and company) are rejected. The server always derives the owning company and actor. The target must be a separate BUSINESS account; active grants require a verified, active dealer. Only verified active companies with active owner accounts can grant/revoke. Suspended company/account rules remain separate.
- Added privacy-limited company dealer search: only eligible dealer business ID, legal name and verification state. No account mobiles or branch/private contacts are exposed.
- Grant reads add company/brand/dealer names, verification/activity states and current eligibility. Active grant and eligible listing status remain separate concepts.
- Added read-only staff authorization filters and grant-specific append-only history, using existing REVIEW_BUSINESS and READ_AUDIT permissions respectively. Staff cannot grant or revoke through these inspection endpoints.
- Authorization and authenticated discovery reads add private/no-store headers so clients reload eligibility. Revocation continues to exclude existing published listings dynamically, without deleting stock or blocking dealer accounts.

## Mobile

Company: My account → Company dashboard → Dealers. Find dealers by name or business ID, select an owned brand, confirm a reason-required grant; inspect/search/filter owned authorization records; revoke/reactivate a retained scope. Loading, empty, error/retry and confirmed success states use actual responses. Restricted companies can inspect preserved own records but cannot search eligible targets or perform writes. Company eligibility refresh and token-refresh workspace retention follow Phase 2 behavior.

Dealer: My account → Dealer dashboard → Authorization. The existing screen was reused unchanged. It displays owning company, brand, active/revoked status and current eligibility, with no self-grant controls. Refresh reads current server state.

## Admin

Dealer network now includes a read-only authorization panel with company/brand/business IDs, text search and active/revoked filtering, pagination, current eligibility and reasons. The separate audit panel supports grant selection, pagination and immutable snapshots with actual actors, timestamps, actions and reasons. The combined global audit page points to these scoped viewers rather than claiming a global viewer exists.

## API contracts

All paths below start with /api/v1; existing JWT and account-state checks apply.

| Endpoint | Access / behavior |
| --- | --- |
| GET /companies/me/dealers | New; verified active company only. search matches dealer name or numeric business ID. Paginated minimal eligible dealer identities. |
| GET /companies/me/dealer-authorizations | Existing owned records, including revoked/history-preserved rows. Added search, brand/business IDs and active=true/false filters. |
| POST /companies/me/dealer-authorizations | Existing company-owner transition. Body: brand, business, Boolean active, nonblank reason (up to existing 4000-character limit). Returns actual grant; denied state/role 403, invalid input/foreign brand 400, nonexistent revoke 404, no-op duplicate 409. |
| GET /businesses/me | Existing BUSINESS owner context; authorization status and eligibility recalculated on every request. |
| GET /staff/dealers/authorizations | New; REVIEW_BUSINESS. Filters: search, company, brand, business, active. Read-only. |
| GET /staff/dealers/authorization-audit | New; READ_AUDIT. Filters: grant, company, brand, business. Only authorization events, never unrelated private branch-contact snapshots. |
| GET /dealers/listings and /dealers/listings/{id} | Existing authenticated discovery. Current active grant and all other eligibility rules remain authoritative; added no-store headers. |

Pagination retains count/next/previous/results, default 20 and existing maximum 100 per page. No arbitrary provider, search radius, identity policy or new staff privileges were introduced.

## Actual live testing

Confirmed actual connection: smarttrade_dev / smarttrade_app. Used the existing controlled COMPANY account, its Phase 2 brand, existing reserved-number BUSINESS account and designated STAFF administrator. No credentials, mobiles, OTPs or tokens are included here.

The controlled dealer was initially pending with an empty profile. Its legal name was completed only because it was blank; the existing admin business-review form then approved it with a Phase 3 test reason. This was an authorized local prerequisite, not a verification bypass. The controlled profile remains VERIFIED for future testing. No live dealer locations or listings were created.

| Check | Result / evidence |
| --- | --- |
| Company search/grant | Pixel_10_Pro searched the controlled dealer, selected the existing company brand and confirmed a grant with reason. One real grant row created. PASS |
| Dealer active view | Actual supported BUSINESS login in the emulator displayed the brand, owning company, Active and Eligible. No self-grant control. PASS |
| Company revoke | Actual COMPANY login revoked through the mobile confirmation form with reason. Same scope row retained. PASS |
| Dealer revoked view | Actual BUSINESS login displayed Revoked and Not eligible. PASS |
| Admin inspection | Real in-app Chromium browser searched/filtered company, brand, dealer and active/revoked status; displayed the actual same grant. PASS |
| Admin audit | Browser displayed original GRANTED and subsequent REVOKED events with company-owner actor, timestamps and reasons. Live snapshot checks confirmed original active=true and revoked active=false remain distinct. PASS |
| Duplicate grant/revoke | Both live requests returned 409; no extra row or authorization audit event. PASS |
| Unauthorized access | Live dealer/staff grant attempts 403, unauthenticated grant 401, actor-field injection 400. PASS |
| Suspended company | Live grant/revoke/search denied 403. Own historical records stayed readable and current dealer eligibility became false. Company restored through existing authorized staff API. PASS |
| Blocked accounts | Controlled company and dealer accounts temporarily blocked using existing model behavior. Old sessions denied 401; blocked dealer could not receive an active grant (400). Original active account states restored. PASS |
| Ownership | Verified cross-company brand denial and immutable scope covered by PostgreSQL API/constraint tests. Live actor injection and unauthorized role checks also passed. |
| Unauthorized listings / immediate removal | Existing PostgreSQL test fixtures create real disposable listings, revoke authorization, verify discovery/detail exclusion and denied content changes, and preserve records/audits. No live inventory was fabricated; these are automated integration tests, not a claim of a populated live inventory walkthrough. PASS |
| Final state | One controlled revoked grant; two authorization audit events; company/dealer accounts active; company verified/active, dealer verified. Zero live locations/listings. PASS |

The Android logging helper initially encountered Windows cp1252 output encoding for a UI arrow; its ignored helper output was changed to UTF-8 and capture was repeated successfully. No unresolved application failure remains from validation.

## Automated checks

- Full PostgreSQL suite: 135 passed, zero skipped (including previous Phase 1/2 and dealer trigger tests).
- Django system check: PASS; makemigrations --check --dry-run: PASS, no changes.
- Mobile TypeScript: PASS; 66 tests passed, zero skipped; Android Hermes export PASS.
- Admin TypeScript: PASS; 21 tests passed, zero skipped; production build PASS.
- No dependency upgrades or package installations. Existing Node module-type/color notices are non-failing.

Commands from repository root:

```powershell
.\.venv\Scripts\python.exe scripts/manage-local.py check
.\.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe scripts/manage-local.py test --noinput -v 1
```

In apps/mobile: npm run typecheck; npm test; with EXPO_OFFLINE=1, npx expo export --platform android --output-dir .expo/phase3-export.
In apps/admin: npm run typecheck; npm test; npm run build.

Tests use the dedicated disposable PostgreSQL test database. Existing smarttrade_dev records were not deleted/reset. No migration, role/ownership change, external integration, commit, push or deployment was performed.

## Files changed

- services/api/dealers/views.py, serializers.py, urls.py, tests.py, README.md.
- apps/mobile/src/CompanyScreen.tsx; new CompanyAuthorizations.tsx and company-authorizations.ts.
- apps/mobile/tests/company-component.test.mjs and dealer-component.test.mjs; new company-authorizations.test.mjs and company-authorizations-component.test.mjs.
- apps/admin/src/App.tsx and Dealers.tsx; new Authorizations.tsx and tests/authorizations-component.test.mjs.
- README.md, apps/mobile/README.md and this validation report.
- Ignored tmp/phase3_* helpers/screenshots/logs were used only for validation. Existing unrelated uncommitted changes were preserved.

## Limits

- Company owners are supported; representative delegation is not implemented by the existing account model.
- Self-authorization means the BUSINESS role cannot grant and the owner account cannot target itself. Identifying one human behind separate accounts would require a separate approved identity/ownership policy; no external identity verification was added.
- Dealer search exposes identity only, not private contacts/location documents. Only verified active businesses appear as eligible targets.
- Reauthorization, populated listing exclusion and cross-company isolation are covered by real PostgreSQL integration tests; the live retained test scope is left revoked. Live Phase 4 inventory creation/testing was intentionally not started.

Admin: http://127.0.0.1:5173/#dealers. Existing API, Vite, Metro and Pixel_10_Pro emulator remain available locally. Phase 4 was not started.
