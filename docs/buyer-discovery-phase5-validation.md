# Phase 5 — Buyer discovery experience

Validated locally on 2026-11-02. Scope is public catalogue browsing and authenticated buyer-to-dealer discovery. Phase 6 was not started.

## Reused implementation

The existing public product/category APIs, product detail screen, JWT session, PIN/locality/district discovery, canonical variants, branch-specific listing projection and Phase 4 eligibility query were retained. Existing backend rules already excluded withdrawn listings, inactive/hidden branches, unverified or blocked dealers, missing/revoked grants, suspended/unverified companies, unpublished/moderated products, inactive categories and inactive variants. No model, migration, dependency or authentication change was required.

## Changes

- Added `GET /api/v1/catalogue/brands`, a public paginated minimal projection of brands that currently have at least one eligible public product. It supports numeric category and brand/company text search. Its categories are limited to active associations containing eligible products.
- Expanded `GET /api/v1/catalogue/products` search. Whitespace-separated terms combine with AND semantics; each term can match product name, product code, description, brand, category, or an active variant name/SKU. Existing numeric company/category/brand filters and pagination compose with search. Inactive SKUs cannot make a product appear.
- Replaced mobile numeric brand-ID entry with real public brand browsing. Category selection narrows the brand list and clears an incompatible brand selection. Search, category, brand and product pagination reset only where needed.
- Product details retain specifications and active variant/SKU selection, with clearer no-active-variant and selected-SKU actions.
- Selected variants continue to be sent to dealer discovery before backend pagination. Loading, retry, no-location, no-eligible-listing and out-of-stock states remain distinct. Requests are abortable, preventing an older response from replacing newer filter/page state.
- Public branch responses continue to omit owner-only phone/email contacts. The current data model has no separately consented public-contact fields, so no contact information was newly exposed.

## API and security behavior

| Endpoint | Result |
| --- | --- |
| `GET /catalogue/categories` | Public active categories, paginated. |
| `GET /catalogue/brands` | Public eligible brands, minimal fields, category/search filters and pagination. |
| `GET /catalogue/products` | Public eligible products; combined search/company/category/brand/page filters. |
| `GET /catalogue/products/{id}` | Public eligible product detail with active variants only; unavailable/ineligible records return 404. |
| `GET /dealers/listings` | Active authenticated account required. Product/brand/variant/stock filters apply before pagination. Location matching is PIN first, then locality, then district. |
| `GET /dealers/listings/{id}` | Active authenticated account required; only currently eligible listings resolve. |

Catalogue browsing remains public. Dealer discovery returned 401 without a token during live validation. The listing response contains business identity, branch public address, selling price/currency, stock/quantity and canonical product context; private branch contact fields are absent.

## Actual validation

The configured connection was asserted as `smarttrade_dev` / `smarttrade_app` before controlled writes. Existing controlled Phase 2–4 records were reused; no new marketplace records were created.

- Live public API search found the retained product by name, product code and SKU while brand/category filters and `page_size=1` were applied. Public brand pagination returned the eligible retained brand.
- Live discovery without authentication returned 401. Supported local OTP authenticated the existing controlled BUSINESS account; no phone ownership claim or staff privilege was created.
- A live query supplying an exact PIN and a deliberately wrong locality returned `PIN_CODE` and only Central. A missing PIN with the correct locality returned `LOCALITY` and both branches.
- A selected variant with `page_size=1` returned the one canonical SKU listing with a correct total count. Public branch objects contained no private phone/email fields.
- Temporarily deactivating Central through its owner API removed the SKU result immediately; reactivation restored it. Temporarily revoking the exact company-brand-dealer grant removed all product results; company reauthorization restored both. All changes used existing APIs, were restored in `finally` blocks, and retained audit history.
- Pixel_10_Pro rendered real categories, the public brand selector and the retained product after an SKU search. Product detail showed specifications and the active SKU. Dealer discovery first showed the sign-in-required state, then used supported local OTP, selected the SKU and PIN, and displayed Central at INR 18.5000, in stock with quantity 5. All-product comparison displayed Central and North independently; North uses INR 20.5000 after the India-only audit and out of stock.
- Screenshots used for local evidence are ignored files under `tmp/phase5-*.png`; they show the actual emulator application, not generated mockups.

Automated PostgreSQL coverage also exercises suspension, product moderation, account blocking, grant revocation, branch hiding/deactivation, withdrawal, invalid filters, privacy projection, filter-before-pagination and public product eligibility. Pagination with multiple fixture records is automated; the controlled live catalogue contains only one eligible product and therefore cannot visually enable a second product page without inventing sample data.

## Final checks

- Django system check: PASS.
- Migration consistency: PASS, no changes detected.
- Full PostgreSQL Django suite: **143 passed, zero skipped**.
- Mobile TypeScript: PASS; **75 passed, zero skipped**.
- Android Hermes export: PASS, 630 modules, `.expo/phase5-export`.
- Admin TypeScript: PASS; **22 passed, zero skipped**; production build PASS.
- The first sandboxed Hermes attempt was blocked from writing Expo's temporary bytecode file. The same export was rerun with approved filesystem access and passed; this was an environment permission issue, not an application failure.

Existing Node module-type notices and headless React read-only-field warnings are non-failing and pre-existing. No package upgrade or audit fix was applied.

## Files changed

- `services/api/catalogue/views.py`, `serializers.py`, `urls.py`, `tests.py`, `README.md`.
- `apps/mobile/App.tsx`, `src/api.ts`, `tests/api.test.mjs`, new `tests/buyer-component.test.mjs`, `README.md`.
- Root `README.md` and this report.

Unrelated working-tree changes were preserved. No stage, commit, push or deployment was performed.

## Remaining limits

- Public contacts are intentionally absent until the business defines separately public fields/consent; existing dealer branch contacts remain owner/staff-private.
- Search is catalogue-field substring matching, not ranking, stemming, typo correction or an external search engine.
- GPS/nearby radius, maps, currency conversion, cart, order, quotation, reservation and payment behavior remain outside Phase 5.
