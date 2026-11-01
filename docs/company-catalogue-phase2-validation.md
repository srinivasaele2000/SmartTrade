# Phase 2 — Company brands and product catalogue

Validated locally on 2026-11-01. No dealer authorization or inventory work was performed.

## Existing implementation reused

The catalogue already had Brand, Category, BrandCategory, Product, ProductVariant and append-only CatalogueAudit models; owner write guards; public product/category APIs; DRAFT/PUBLISHED/ARCHIVED publication; HIDDEN/SUSPENDED/VISIBLE product moderation; per-product SKU uniqueness; PostgreSQL ownership and company-eligibility triggers. These structures were extended, not duplicated. Phase 1 authentication, company verification and private-document functionality remain intact.

## Mobile screens

Open My account → Company dashboard → Catalogue. Buyer navigation is unchanged.

- Brands: owner-only list, create/edit name, real company verification/activity status and associated categories. No unsupported brand activation state is claimed.
- Categories: browse active taxonomy, select an owned brand, associate it with a category, see existing associations and prevent duplicate association attempts. Associations remain immutable under existing rules.
- Products: searchable/paginated owner list; create/edit name, code, description, unit, object-valued JSON specifications, optional catalogue price with explicit currency, and DRAFT/PUBLISHED/ARCHIVED state. Existing product association is locked; new products select a company-owned brand/category association.
- Variants/SKUs: create/edit name, per-product SKU, JSON attributes and active state. Product identity is immutable; duplicate rejection is authoritative on the backend.
- Loading, empty, retry, denied-access, validation and confirmed-success states use actual API results. Save feedback scrolls into view on long forms. Token-refresh loading preserves the company catalogue component and unsaved form state; failed context loads/sign-out do not reuse permission context. Catalogue refresh also reloads company eligibility.

JSON object editors reflect the backend's existing unstructured specification/attribute contract. No attribute taxonomy or image-upload contract was invented.

## Admin screens

The existing Catalogue section now includes:

- Product details, specifications, variant attributes, company catalogue prices and publication/moderation states.
- Existing reason-required Hide/Suspend/Restore product moderation, with response confirmation before success feedback.
- Paginated company-owned brand inspection, including category associations and actual company eligibility.
- Category list, existing creation, and reason-required editing/activation/deactivation with MANAGE_TAXONOMY enforcement. Inactive categories make associated products ineligible publicly without deleting records.
- Paginated catalogue-only audit history, optional product-ID filter, actual subjects/actors/actions/timestamps/reasons and expandable immutable snapshots. READ_AUDIT permission is separate from product moderation permission. The combined company/dealer audit viewer remains outside this phase.

## API contracts

All paths below are under /api/v1. Existing company routes require active COMPANY authentication; writes additionally require the owned company to be VERIFIED and ACTIVE. Reads preserve access to owned historical records while company writes are restricted. Blocked accounts remain denied.

| Endpoint | Purpose / permission |
| --- | --- |
| GET/POST /companies/me/catalogue/brands | Owned brands / create under eligible company |
| PATCH /companies/me/catalogue/brands/{id} | New owned brand-name edit, immutable company, audited |
| GET/POST /companies/me/catalogue/brand-categories | Owned associations / associate owned brand with active category |
| GET/POST /companies/me/catalogue/products | Owned paginated products / create. GET now supports search and state filters |
| PATCH /companies/me/catalogue/products/{id} | Edit owned product and publication, never client-controlled moderation |
| POST /companies/me/catalogue/products/{id}/variants | Create SKU under owned product |
| PATCH /companies/me/catalogue/products/{id}/variants/{variant_id} | Edit owned product's variant |
| GET /catalogue/categories | Public active taxonomy |
| GET /catalogue/products and /catalogue/products/{id} | Existing public eligible catalogue used to verify visibility |
| GET /staff/catalogue/brands | New paginated inspection; MODERATE_PRODUCTS |
| GET/POST /staff/catalogue/categories | Existing taxonomy list/create; MANAGE_TAXONOMY |
| PATCH /staff/catalogue/categories/{id} | New taxonomy edit, reason required; MANAGE_TAXONOMY |
| GET /staff/catalogue/products | Existing inspection; MODERATE_PRODUCTS |
| POST /staff/catalogue/products/{id}/moderation | Existing HIDE/SUSPEND/RESTORE plus reason; MODERATE_PRODUCTS |
| GET /staff/catalogue/audit | New paginated read-only history, company/brand/product ID filters; READ_AUDIT |

Brand responses add read-only company_name, company_verification, company_activity and categories metadata. No image/storage URL is returned. Catalogue audit responses expose only the existing catalogue audit schema, not account credentials or verification documents. List pagination keeps the existing 20 default/100 maximum page size. Errors preserve existing DRF validation/authentication/authorization conventions; uniqueness conflicts return 400, forbidden ownership/state changes 403 or scoped 404.

## Actual local workflow tests

The live connection was confirmed as smarttrade_dev / smarttrade_app before writes. Used the existing approved controlled COMPANY account and designated STAFF administrator. Created exactly one scoped Phase 2 category, brand, product and SKU; no dealer records or unrelated sample data. Existing user taxonomy was untouched. Controlled test records and audit history were retained.

| Check | Actual verification |
| --- | --- |
| Brand create/edit | Android created Phase 2 Controlled Brand, then edited it to Phase 2 Reviewed Brand. Staff browser displayed the same owned brand. PASS |
| Category association | Admin browser created Phase 2 Validation Tools; Android associated its owned brand. Browser inspected the association. PASS |
| Product create | Android created PHASE2-LOCAL-001 in DRAFT. Live public detail returned 404. PASS |
| Product edit/publication | Android saved description, specifications, explicit USD catalogue price and PUBLISHED state. PostgreSQL values checked; public detail returned 200. PASS |
| Variant create/edit | Android created and edited PHASE2-SKU-001 with attributes; admin displayed the same variant. PASS |
| Duplicate SKU | Actual authenticated create returned 400; original SKU remained intact. Automated tests also cover duplicate edits and immutable product identity. PASS |
| Invalid specifications | Native form rejected malformed JSON without reporting success. Feedback visibility improved. PASS |
| Hide / restore | Browser actions with mandatory reasons changed public detail 200→404→200. Company attempt to write moderation_state returned 400. PASS |
| Product suspension | Browser SUSPEND returned public 404 while preserving product/SKU. PASS |
| Company suspension | Existing authorized staff company action used only as a test prerequisite. Brand create/edit, product publish and variant creation returned 403; owned reads remained available. Emulator showed read-only catalogue. PASS |
| Restoration boundary | Browser restored product moderation while company remained suspended: public detail stayed 404. Restoring company activity returned it to 200. PASS |
| Unverified/foreign company | Existing controlled unverified company could not create brands or edit the other company's brand (403). Verified cross-company 404 isolation covered in PostgreSQL tests. PASS |
| Category deactivate/restore | Browser reason-required changes hid public detail (404), preserved product/SKU, then restored public detail (200). PASS |
| Audit history | Browser displayed real events and snapshots. Live checks confirmed moderation reasons/actors/timestamps/snapshots and category audit events. Ordinary company audit request returned 403. PASS |
| Final state | Controlled company VERIFIED/ACTIVE, test category active, product PUBLISHED/VISIBLE, one retained SKU; public detail 200. PASS |

Browser checks used the actual Codex in-app Chromium browser, not a claim of testing a separate Chrome window. Mobile checks used the existing Pixel_10_Pro emulator and supported development login/OTP through actual HTTP APIs. Headless React render tests are separate from native interaction tests. No authentication/session injection or external provider was used.

## Checks and commands

From repository root:

```powershell
.\.venv\Scripts\python.exe scripts/manage-local.py check
.\.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe scripts/manage-local.py test --noinput -v 1
```

Results: Django check PASS; migration consistency PASS (no changes); 127 PostgreSQL tests PASS, zero skipped. Tests use the dedicated disposable test database, not SQLite or unrelated databases.

In apps/mobile: npm run typecheck; npm test; with EXPO_OFFLINE=1, npx expo export --platform android --output-dir .expo/phase2-export. Results: TypeScript PASS; 58 mobile tests PASS, zero skipped; Android Hermes export PASS.
In apps/admin: npm run typecheck; npm test; npm run build. Results: PASS, 19 tests, production build PASS.

Existing Node module-type / terminal-color notices are non-failing; no dependency upgrades were made.

## Files changed

- services/api/catalogue/views.py, serializers.py, urls.py, tests.py, README.md.
- apps/mobile/src/CompanyScreen.tsx; new src/CompanyCatalogue.tsx and src/company-catalogue.ts.
- apps/mobile/tests/company-component.test.mjs; new company-catalogue.test.mjs and company-catalogue-component.test.mjs.
- apps/admin/src/App.tsx, src/Catalogue.tsx; new src/CatalogueTools.tsx and tests/catalogue-component.test.mjs.
- README.md, apps/mobile/README.md and this validation report.

Ignored tmp/phase2_* helpers and screenshots were used for live validation. No model, migration, dependency, authentication-provider or database-role changes were made. Existing uncommitted work was preserved.

## Explicit limitations / decisions

- Brand activation/deactivation and independent brand moderation do not exist in the current model/API. The screen states this explicitly. Adding brand-level moderation requires approved states/visibility semantics and a justified schema/API extension; it was not simulated by mutating products in bulk.
- Product image models/storage/upload policies are absent. No image endpoint or UI pretending to upload images was added. A separate image contract is needed before implementing this capability.
- Generic specifications/variant attributes are JSON objects because the existing API defines no attribute schema.
- No Phase 3 authorization, dealer stock, dealer pricing, payments or external services were developed.

Open the existing Android app: My account → Company dashboard → Catalogue. Admin: http://127.0.0.1:5173/#catalogue. Existing Django, Vite, Metro and emulator are retained locally.

Final git diff --check: PASS (existing Windows line-ending notices only). API and Vite-proxied health were verified separately; all development listeners remain bound to loopback.
