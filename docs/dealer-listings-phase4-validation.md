# Phase 4 — Dealer listings and stock management

Validated locally on 2026-11-02. Scope is dealer listing lifecycle, inspection and buyer visibility. Phase 5 was not started.

## Existing implementation reused

DealerProductListing, DealerLocation, company grants, canonical catalogue/variants, serializers, publication guards and DealerAudit already existed. The existing dealer forms already selected authorized brands/products/variants, accepted price/currency/stock/quantity, and created/edited/withdrew listings. Existing PostgreSQL scope/quantity/price/variant guards and unique constraints were retained. No model or migration change was needed.

## Implementation

- Dealer mobile adds inventory search/state filters, explicit state-only reactivation, a withdrawal action inside the editor, actual company/SKU metadata and current discovery eligibility. Errors/success feedback scroll into view on long forms. Withdrawal-only remains available to a verified active dealer after upstream revocation/company suspension; it cannot carry content changes.
- Owner and staff listing APIs add search/state/stock filtering. Staff can additionally filter company/brand/business/location/product IDs. Search covers product name/code, SKU, business, branch, brand and company. Existing pagination remains unchanged.
- Responses add company_name, product_code, variant_sku, variant_name and read-only eligible. Management queries annotate current eligibility using the same live query as buyer discovery, rather than inferring visibility from PUBLISHED alone. Clients cannot write these fields.
- Admin Price and stock displays dealer, branch, owning company/brand, canonical product/SKU, independent catalogue/selling prices, currency, stock, quantity and actual eligibility. It links to existing reason-required branch visibility moderation. Staff cannot impersonate dealer stock edits.
- Added READ_AUDIT-protected, read-only listing history with immutable actor/timestamp/action/snapshot data, filters and pagination. Inventory changes have no invented mandatory-reason policy; existing staff branch moderation requires a reason and remains separately audited.
- Buyer discovery now filters numeric variant IDs before pagination. The mobile journey sends the selected SKU/variant and displays counts for that server-filtered set. Product-level/all-variant browsing remains supported. The existing public-location projection excludes private contacts.

## APIs

All paths are under /api/v1 and preserve existing JWT/account-state checks.

| Endpoint | Behavior |
| --- | --- |
| GET/PATCH /businesses/me | Existing own profile/workspace and current company grants. No new verification bypass. |
| GET/POST /businesses/me/locations | Existing own branches; used for controlled live prerequisites. |
| GET/PATCH /businesses/me/locations/{id} | Existing own branch management, identity immutable. |
| GET/POST /businesses/me/listings | Existing own inventory/create; GET adds search, state, stock_status (retains location/product). |
| GET/PATCH /businesses/me/listings/{id} | Existing owner-only edit/publication/withdrawal/reactivation; branch/product/variant immutable. |
| GET /staff/dealers/listings | REVIEW_BUSINESS; search, business/location/product/company/brand, state and stock_status filters. Inspection only. |
| GET /staff/dealers/listing-audit | New; READ_AUDIT. Filters listing, business, location; newest-first pagination. No private branch-contact snapshots. |
| POST /staff/dealers/locations/{id}/moderation | Existing REVIEW_BUSINESS branch hide/restore and mandatory reason. Response checked before success feedback. |
| GET /dealers/listings and /dealers/listings/{id} | Existing login-required live eligibility; collection now supports numeric variant filter before pagination. |

Reads preserve withdrawn/ineligible records only in authorized management views. Buyer discovery requires PUBLISHED, eligible business/account/branch, exact active company/brand grant, verified active company/account, active category, published/unmoderated product and active variant when present. Content writes recheck these conditions. Only the exact state-only WITHDRAWN patch uses the existing withdrawal exception.

No tax, shipping, discount, stock reservation, deduction engine, currency conversion or regional rounding rules were added. Currency remains the existing explicit three-uppercase-letter format; amounts/quantity retain existing decimal precision. Null-variant and variant listings retain their separate deliberate unique constraints.

## Live PostgreSQL and emulator/browser validation

The actual database connection was confirmed as smarttrade_dev / smarttrade_app before writes. Used the existing controlled BUSINESS/COMPANY accounts, existing Phase 2 catalogue product/SKU and designated development STAFF administrator. The retained company grant was reauthorized through the existing owning-company API with a Phase 4 test reason.

Two controlled visible branches were created through existing owner APIs: Phase 4 Central and Phase 4 North, with synthetic test address/PIN values and no private contacts. These are scoped validation data, not unrelated sample merchandise.

| Check | Actual evidence/result |
| --- | --- |
| Create SKU listing | Pixel_10_Pro selected Central, its authorized company brand, existing product and SKU; saved explicit price/currency/in-stock quantity as WITHDRAWN. PostgreSQL row retained, buyer count zero. PASS |
| Edit/publication | Android changed price/quantity and selected Publish, then saved. Buyer response returned the exact price/quantity. PASS |
| Validation/stock editing | Android rejected negative price visibly, then saved OUT_OF_STOCK with quantity zero and new selling price. PASS |
| Withdrawal | Android withdrawal preserved row/history and immediately removed buyer list/detail (detail 404). PASS |
| Reactivation | Android explicit Reactivate reused the same row and restored buyer discovery. No duplicate listing was created. PASS |
| Multiple branches | Second branch product-level listing was created through the real owner API as the comparison fixture. Central is SKU-specific; North is product-level. Different explicit selling currencies are retained without conversion. PASS |
| Duplicate/invalid data | Live duplicate scope, negative price, lower/empty currency, inconsistent quantity and invalid variant returned 400. Real cross-product variant mismatch, precision/constraint and cross-dealer cases are covered by PostgreSQL tests. PASS |
| Staff write boundary | Live STAFF request to create dealer inventory returned 403. Ordinary dealers cannot inspect staff history. PASS |
| Admin inspection/search | Actual in-app Chromium admin browser searched the canonical SKU, filtered publication state and displayed owning company, dealer, branch, prices, stock and quantity. PASS |
| Admin moderation | Browser hid Central with reason; buyer discovery retained only North and Central content edits returned 403. Branch restoration restored eligibility. Stored moderation audit reason was verified. PASS |
| Revoked authorization | Live revoke hid both branches, denied a valid new authorized-product listing attempt/content edits/reactivation, but allowed exact state-only withdrawal. Mixed withdrawal/content write denied. Reauthorization did not silently republish the withdrawn row. PASS |
| Suspended company | Live staff suspension hid both branches and denied new/content writes. Exact withdrawal remained permitted for the active verified dealer. Company restoration did not silently republish the withdrawn row. PASS |
| Buyer screen | Actual emulator navigated catalogue → product → dealer discovery using the existing authenticated dealer session (the buyer-facing journey is shared by active account types). It displayed Central INR 18.5000 in stock/5 and North USD 20.5000 out of stock, with public synthetic locations and no private contacts. PASS |
| Variant pagination | Real PostgreSQL tests with multiple branches prove filtering happens before pagination/count. Mobile API test verifies the variant parameter; actual emulator selection returned exactly the Central SKU branch with a count of one and the server-filtered message. PASS |
| Audit history | Real listing creation/edit/withdrawal snapshots remain append-only. Admin listing-specific audit read is permissioned. Existing PostgreSQL audit UPDATE/DELETE guards are covered by the full suite. PASS |

The primary listing lifecycle was exercised through actual native UI. The second comparison listing and adverse-state checks used real HTTP APIs against controlled development records; these are not claims of every failure case being tapped in the emulator. Automated fixtures use the separate disposable PostgreSQL test database.

Final intended state: company and business/accounts active and verified; authorization active; both branches active/visible/unhidden; Central SKU listing PUBLISHED/IN_STOCK/5 at INR 18.5000; North product-level listing PUBLISHED/OUT_OF_STOCK/0 at USD 20.5000. No record/history was deleted or reset. No production database, external provider, external credentials, role changes or deployment was involved.

## Checks

- PostgreSQL backend: 141 passed, zero skipped.
- Django check: PASS; makemigrations --check --dry-run: PASS, no changes.
- Mobile: TypeScript PASS; 70 tests passed, zero skipped; Android Hermes export PASS.
- Admin: TypeScript PASS; 22 tests passed, zero skipped; production build PASS.
- Existing Node module-type notices are non-failing; no dependencies were installed/upgraded.

From repository root:

```powershell
.\.venv\Scripts\python.exe scripts/manage-local.py check
.\.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe scripts/manage-local.py test --noinput -v 1
```

In apps/mobile: npm run typecheck; npm test; with EXPO_OFFLINE=1, npx expo export --platform android --output-dir .expo/phase4-export.
In apps/admin: npm run typecheck; npm test; npm run build.

## Files changed

- services/api/dealers/views.py, serializers.py, urls.py, tests.py, README.md.
- apps/mobile/src/dealer.ts, DealerWorkspace.tsx, api.ts and apps/mobile/App.tsx.
- apps/mobile/tests/dealer.test.mjs, dealer-component.test.mjs, api.test.mjs.
- apps/admin/src/Dealers.tsx; new ListingAudit.tsx and tests/listing-audit-component.test.mjs.
- README.md, apps/mobile/README.md and this report.
- Ignored tmp/phase4_* validation records/logs/screenshots contain only controlled fixture metadata, not credentials.

No dependency manifests, model fields, migrations, authentication or authorization-provider configuration were changed. Existing unrelated uncommitted changes were preserved. No stage/commit/push/deployment was performed.

## Limits

- There is no independent listing-level staff moderation state in the current model. Existing branch visibility moderation is used and affects all eligible listings in that branch; it is labelled accordingly. Dealer withdrawal remains a separate owner action.
- Inventory is explicit current stock, not an order/reservation or stock-movement ledger. Those workflows were not introduced in Phase 4.
- Currency is format-validated, not an external ISO registry integration; no conversion/rounding/tax rules are inferred.

Open Dealer dashboard → Listings, or the buyer product-to-dealer journey in the existing Pixel_10_Pro app. Admin: http://127.0.0.1:5173/#dealers → Price and stock. Existing local services/emulator are retained. Stop after Phase 4; Phase 5 was not started.

Final source/diff and health results are recorded in the completion report. A closed/expired admin test tab was reopened and authenticated normally for final inspection; this did not affect stored application data.
