# Dealer branches, company authorization and inventory

This slice extends the existing `accounts.BusinessProfile` BUSINESS subtype with legal name and registration number. It does not create another account/profile concept. `DealerLocation` belongs to that business; `DealerProductListing` references a canonical catalogue Product and optional ProductVariant. Company catalogue price and dealer branch selling price are separate fields and may use different explicit currencies. No price conversion, tax, shipping, discount, reservation or aggregate-stock behavior is inferred.

## Implemented endpoints

All paths start with `/api/v1`, omit a trailing slash, and use existing Bearer JWT authentication. No authentication bypass or new provider exists.

| Path | Methods | Access / body |
| --- | --- | --- |
| `/businesses/me` | GET, PATCH | Active BUSINESS account. Updates `legal_name`, `registration_number`; verification state is read-only. Existing account registration already creates this profile. |
| `/businesses/me/locations` | GET, POST | Own branches only. Create requires `branch_name`, `address`, `pin_code`, `locality`, `district`, `state`, `country`; optional contact fields, `active`, `visibility_state`. |
| `/businesses/me/locations/{id}` | GET, PATCH | Own branch only. `business` and `admin_hidden` are read-only. Deactivate with `active:false`; history remains. |
| `/businesses/me/listings` | GET, POST | Own inventory; filter GET by numeric `location`/`product`. Create requires `location`, `product`, `selling_price`, `currency`; optional `variant`, `quantity`, `stock_status`, `state`. |
| `/businesses/me/listings/{id}` | GET, PATCH | Own listing only. Identity (branch/product/variant) is immutable. Withdraw with only `state:WITHDRAWN`; reactivate the retained row via PATCH when eligible. |
| `/companies/me/dealer-authorizations` | GET, POST | Company owner only. POST changes the retained unique scope using `brand`, `business`, explicit Boolean `active`, required `reason` up to 4000 characters. Company and actor are derived. Staff and dealers cannot grant/revoke authorization. |
| `/dealers/listings` | GET | Read-only marketplace discovery **requires login**, preserving the approved dealer-discovery rule. Filters: `pin_code`, `locality`, `district`, numeric `product`, numeric `brand`, `stock_status`. |
| `/dealers/listings/{id}` | GET | Same authenticated live eligibility filters as discovery; inaccessible/withdrawn records return 404. |
| `/staff/dealers/businesses` | GET | Staff `REVIEW_BUSINESS`; optional `verification_state` filter. |
| `/staff/dealers/businesses/{id}/decision` | POST | `REVIEW_BUSINESS`; `action` APPROVE/REJECT/SUSPEND/RESTORE and required `reason`. |
| `/staff/dealers/locations` | GET | `REVIEW_BUSINESS`; optional numeric `business` filter. Private contacts are available to authorized staff reviewers only. |
| `/staff/dealers/locations/{id}/moderation` | POST | `REVIEW_BUSINESS`; explicit Boolean `hidden`, required `reason`. Staff visibility restriction is independent of owner activation. |
| `/staff/dealers/listings` | GET | `REVIEW_BUSINESS`; optional numeric `business` and `location` filters. Staff inspect stock/prices but cannot impersonate dealer inventory edits. |

Lists use `count`, `next`, `previous`, `results`, default 20 per page with `page_size` up to 100. Discovery also returns `match_level`: PIN_CODE, LOCALITY, DISTRICT, NO_LOCATION_MATCH or UNFILTERED. Provided PIN matches take priority; if absent/unmatched, a provided locality is tried, then a provided district. No undisclosed geographic expansion occurs; no GPS radius is assumed. Product/brand/stock filters remain applied through fallback. Search/store normalization applies NFKC, uppercase and collapsed whitespace to location search fields; PIN codes also remove whitespace. Country uses a two-letter uppercase format check, not a complete country registry. Contact phone, when supplied, requires E.164.

## Eligibility and retained history

- Pending businesses can complete their profiles and manage PRIVATE_DRAFT branches. Only VERIFIED businesses may set VISIBLE or manage inventory. REJECTED/SUSPENDED businesses cannot perform normal owner writes. Account blocking remains independently enforced by JWT/current account state. Own read-only history/status remains available to active account owners.
- Business decisions: PENDING → VERIFIED/REJECTED; VERIFIED → SUSPENDED; REJECTED/SUSPENDED → VERIFIED by authorized staff RESTORE. All require reasons, and approval/restoration requires a nonblank legal name. These are manual decisions; registration evidence collection/private business-document workflows are not implemented in this slice. Staff must independently check evidence before approving; the API never claims an automated registration check.
- Branch state defaults to active PRIVATE_DRAFT. Discovery requires active VISIBLE and not staff-hidden. Dealers cannot clear a staff-hidden flag. Staff restoration of a branch does not activate an owner-deactivated branch.
- Authorization is company + brand + business, not location or product. The company must be verified/active with an active owner. Only that authenticated company owner can currently grant/revoke (representative delegation is not implemented). A new active grant requires a verified business with an active account. Revocation is retained on the same unique scope row and has its own audit event.
- Creation/content edits of inventory require verified dealer, active visible branch, eligible published company product, active variant when supplied, and an active grant for that product's exact owning brand/company. Withdrawal-only PATCH remains allowed for verified active dealers after upstream revocation, company suspension or branch deactivation. No other edits are accepted through that exception.
- Discovery/detail always recalculate business/account state, branch activation/moderation/visibility, grant activity, company/account eligibility, product publication/moderation/category and variant activity. Suspensions and revocations hide retained records immediately without deleting inventory. Restoration does not unblock accounts; no grant is silently created.
- Discovery exposes business identity, branch address/search fields and listing price/stock; it omits branch contact names, phone numbers, email addresses and account mobiles. Company catalogue information is read-only and comes from canonical product references.

## Stock, constraints and audit

Prices use the catalogue's technical storage precision of 18 digits/four decimal places, nonnegative amounts, and explicit uppercase three-letter currency format. This is not ISO registry validation or a regional rounding policy. Quantity uses the same precision and is optional. IN_STOCK quantity, if supplied, must be positive; OUT_OF_STOCK quantity, if supplied, must be zero; UNKNOWN must omit quantity. There is no reservation or stock deduction engine. Listing state defaults to WITHDRAWN.

Two partial unique constraints handle nullable variants deliberately: `(location, product)` without variant and `(location, product, variant)` with variant. A product-level row and variant rows do not imply aggregated stock. PostgreSQL guards enforce immutable ownership/identity, variant-product consistency, company-brand grant consistency, company-owner grant actor and current publication eligibility. These supplement backend checks; no client-supplied owner or audit actor is trusted.

DealerAudit stores explicit business/location/listing/grant subjects as applicable, actor, action, timestamp, reason for decisions/grants/moderation, and an immutable snapshot. PostgreSQL rejects audit UPDATE/DELETE. Protected FKs and withdrawal/deactivation APIs preserve history; no delete endpoints exist. Audit snapshots and management responses can contain private branch contacts and are not public discovery data. Operational retention periods remain undecided.

The staff Dealer section supports business review with reasons, branch inspection and hide/restore, and branch-specific catalogue/selling-price/stock inspection with pagination/filtering. Company authorization mobile controls and admin record/audit inspection are now connected and locally tested; the existing dealer authorization view remains read-only. Delegated representatives, private business-document workflows, map/GPS features and dealer recovery/resubmission policy remain outside this milestone. Local controlled OTP is used; no external provider is required. Existing inventory APIs/UI were not extended in Phase 3.


## Phase 3 authorization completion

Added GET /companies/me/dealers (minimal verified/active dealer identities), GET /staff/dealers/authorizations (REVIEW_BUSINESS) and GET /staff/dealers/authorization-audit (READ_AUDIT). Company grant state changes still use the existing POST route; duplicate states return 409 without extra audit, and nonexistent revocations return 404 without creating a row. Unknown company/actor fields are rejected. Authorized reads and discovery use no-store headers; current eligibility remains a per-request check.

See [Phase 3 validation](../../../docs/company-dealer-phase3-validation.md) for filters, payloads, real Android/browser tests, retained controlled data and limitations.


## Phase 4 listing validation

Existing owner listing lifecycle is now verified through Android creation, editing, publication, withdrawal and state-only reactivation. Listing responses add canonical company/product/SKU names and read-only live eligibility; owner/staff lists support search/state/stock filtering. Buyer discovery supports numeric variant filtering before pagination. New GET /staff/dealers/listing-audit requires READ_AUDIT and filters by listing/business/location. Existing reason-required branch moderation remains the supported staff visibility action; no listing-level moderation model was invented.

See [Phase 4 validation](../../../docs/dealer-listings-phase4-validation.md) for exact live versus automated coverage, retained controlled data, changed files and limitations.
