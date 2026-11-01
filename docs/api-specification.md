# SmartTrade API specification

## Implemented dealer branch and inventory slice

The existing BUSINESS subtype is extended (no duplicate dealer account/profile). Dealer locations, listings, company-issued brand authorization, authenticated discovery and staff business/branch review are implemented. The [dealer API contract](../services/api/dealers/README.md) lists exact paths, fields, permissions, pagination, filters, state transitions and limitations. Earlier planned dealer/business paths below remain planned where they differ from this implemented contract. Discovery requires login and omits private branch contacts. Company authorization and business verification remain separate.

## Implemented company-owned catalogue

The first catalogue slice is implemented: public product/category browsing; verified active company brand, brand/category, product and variant APIs; staff category creation and audited product moderation. See the [catalogue API contract](../services/api/catalogue/README.md) for exact paths, request fields, pagination, filters, validation, permissions, storage choices and deferred items. Earlier planned catalogue endpoints below remain planned where their paths differ from that contract. Dealer inventory and prices are not implemented by this slice.

Paths use `/api/v1`. Account registration/authentication and the initial company registration/verification workflow are implemented; catalogue, dealer, business verification, representative, and other staff endpoints below remain planned unless listed in the implemented section. All ownership, role, account-state, verification, and representative permissions are checked by the backend. Client-supplied owner IDs, account types after registration, verification decisions, moderation status, authorization actor, or audit fields are rejected/ignored. The API derives audit actors from the authenticated identity.

**ID convention:** `account_id` identifies `Account`; `business_id` identifies `BusinessProfile.id`; `company_id` identifies `CompanyProfile.id`; `location_id` identifies `DealerLocation.id`; `product_id`, `variant_id`, and `listing_id` identify their corresponding row PKs. `CompanyRepresentative.account_id` is a login identity, not a company resource ID. A dealer business ID is never interchangeable with a dealer location ID.

## Authentication and access rules

- One canonical E.164 mobile number maps to one immutable `Account.account_type` (`PERSONAL`, `BUSINESS`, `COMPANY`, `STAFF`). `POST /auth/register` accepts only `PERSONAL`, `BUSINESS`, and `COMPANY`; staff creation is restricted to the controlled `bootstrap_superadmin` management command or a future authorized staff workflow.
- OTP login uses an adapter selected by `SMARTTRADE_OTP_PROVIDER`. No provider is configured by default. Registration remains mobile-unverified; OTP request/login return `503 AUTH_PROVIDER_UNAVAILABLE` until a real adapter is configured. The API never creates, stores, returns, or logs OTP codes.
- Successful provider verification issues access/refresh JWTs using Simple JWT. Tokens are not persisted. Every authenticated request checks current account state and token version; blocking or logout increments the token version, so old access/refresh tokens stay invalid after restoration.
- An account must be active to use authenticated endpoints. Pending company owners may edit their own profile and upload/read their own verification documents before submission. A submitted profile is locked for staff review. They cannot publish products or appear as verified dealers.
- Verified business accounts manage only their own locations and location-specific listings. Verified company accounts manage only brands/products owned through their company while that company's activity state is `ACTIVE`; verified companies may publish immediately subject to admin moderation.
- An independently `BLOCKED` account is denied normal protected features until staff restores that account. Company verification rejection and company activity suspension are separate and do not automatically block linked accounts. Company activity suspension hides the catalogue and denies company-scoped writes while preserving records; it does not revoke linked users' sessions. Every request checks current account and company activity states on the backend. An otherwise active company owner may view suspension status and submit a restricted company review request. Blocking an account revokes its active sessions and refresh tokens; restoration does not revive old tokens. Company restoration never clears an independent account block.
- Staff endpoints require `STAFF` account type, active status, and the corresponding assigned permission. No ordinary account can receive staff permissions.
- Product catalogue browse endpoints are public but return only eligible published products and approved public assets. Dealer browse/search/detail endpoints require login.
- File upload size/type limits are configuration values. Private files are stored outside public access and every upload/download is authorized and audited. A documented retention policy is required; actual periods and temporary-link lifetime remain unresolved configuration values.

## Implemented company registration and verification endpoints

| Method/path | Permission | Current behavior |
|---|---|---|
| `POST /api/v1/companies/register` | Active `COMPANY` account | Creates one organization owned by the authenticated account. `owner_account` is never client supplied. Initial state is verification `PENDING`, activity `ACTIVE`. A linked owner cannot create a second company. |
| `GET /api/v1/companies/me` | Active owning `COMPANY` account | Returns company registration fields, email verification timestamp, verification state, activity state, and `can_publish_catalogue`. Works during company activity suspension unless the account itself is blocked. |
| `PATCH /api/v1/companies/me` | Active owning account; company active and profile not under review | Updates allowed registration fields only. Owner and status fields are read-only. Changing company email clears its verified timestamp. |
| `POST /api/v1/companies/me/email-verification/request` and `/confirm` | Active owning account | Uses `SMARTTRADE_COMPANY_EMAIL_PROVIDER`. No provider or a provider failure returns `503`; no fake verification is performed. |
| `POST /api/v1/companies/me/documents` | Active owner; company active, pre-review; configured file policy | Multipart upload. `SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES`, `SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES`, and `SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES` must be explicitly configured. Empty configuration disables upload. Only configured supported file types with matching extension and signature are accepted. |
| `GET /api/v1/companies/me/documents/{document_id}` | Owning account | Streams the private file after checking company ownership and records an access audit event. No public file URL or storage key is returned. |
| `POST /api/v1/companies/me/verification-submissions` | Active owner; verified company email; required document policy and documents complete | Creates a pending case and binds unassigned company documents. A rejected company cannot resubmit through the current API; reopen/resubmission policy remains open. |
| `POST /api/v1/companies/me/review-requests` | Active owning account; company rejected or activity suspended | Stores a restricted request and reason; it does not change verification, activity, account access, or tokens. |
| `GET /api/v1/staff/companies/verification-queue` | Active staff with `REVIEW_COMPANY` | Lists pending cases with the registered company profile, case status/submission time/reviewer account ID, and document metadata (`id`, type, original filename, content type, size, upload time). This metadata does not grant file access; private file download separately requires `VIEW_PRIVATE_DOCUMENTS` and case assignment. |
| `POST /api/v1/staff/companies/{company_id}/claim` | Active staff with `REVIEW_COMPANY` | Claims an unassigned pending case for the authenticated reviewer. Only the assigned reviewer may decide it or read its private documents. |
| `POST /api/v1/staff/companies/{company_id}/verification-decision` | Active staff with `REVIEW_COMPANY` | Body: `decision` (`APPROVE` or `REJECT`) and required `reason`. Records reviewer and timestamp. Does not change account access or activity suspension. Same-account self-review is denied. |
| `POST /api/v1/staff/companies/{company_id}/suspend` / `/restore` | Active staff with `SUSPEND_COMPANY` / `RESTORE_COMPANY` respectively | Body requires `reason`. Changes company activity only, audits actor/action/time/reason, and does not block or unblock the owner account. A suspended company cannot perform company-scoped writes. |
| `GET /api/v1/staff/companies/{company_id}/documents/{document_id}` | Assigned case reviewer with `VIEW_PRIVATE_DOCUMENTS` | Streams only a document belonging to the path company and assigned case; audits access. |
| `GET /api/v1/staff/companies/review-requests` and `POST /api/v1/staff/companies/review-requests/{request_id}/resolve` | Active staff with `HANDLE_REVIEW_REQUESTS` | Lists open company review requests and records a required resolution reason. Resolution does not restore company activity or account access. |

Company verification (`PENDING/VERIFIED/REJECTED`), company activity (`ACTIVE/SUSPENDED`), account access (`ACTIVE/BLOCKED`), and authorized-dealer status are independent. No product/catalogue endpoints are implemented in this milestone; the company model's eligibility property requires verified, active company state and an active owner account.

## Planned additional endpoints

| Method/path | Permission | Contract summary |
|---|---|---|
| `POST /auth/register` | Public | Body: `mobile_e164`, `account_type` (`PERSONAL`, `BUSINESS`, or `COMPANY`). Creates one account and its matching pending subtype profile without marking the number verified or returning a token. Duplicate mobile: `409 MOBILE_ALREADY_REGISTERED`. |
| `POST /auth/otp/request` | Public | Body: `mobile_e164`. Sends only through the configured real provider. Unknown, blocked, or provider delivery-failure cases receive the same `202 accepted` acknowledgement to reduce account enumeration. No provider/configuration: `503 AUTH_PROVIDER_UNAVAILABLE`. OTP is never returned or stored by SmartTrade. |
| `POST /auth/login` | Public | Body: `mobile_e164`, `code`. Provider must confirm the code before mobile verification is recorded and JWTs are issued. Invalid code/account: safe `401`; blocked account gets `401 ACCOUNT_BLOCKED`; unavailable provider gets `503`. |
| `POST /auth/refresh` | Public with refresh token | Returns a new access JWT only while account is active and the token version is current; invalid/blocked/revoked token returns safe `401 INVALID_TOKEN`. |
| `POST /auth/logout` | Active authenticated account | Increments token version, invalidating all issued access and refresh tokens for that account. |
| `GET /auth/me` | Active authenticated account | Return account type, access state, and whether real provider verification has occurred. Anonymous/blocked requests are denied. |
| `POST /companies/me/email-verification/request`, `/confirm` | Active owning `COMPANY` account | Implemented company-email flow above; provider required, no verification secret returned. |
| `python manage.py bootstrap_superadmin` (not an API route) | Controlled local operator with database access | Prompt for the first staff mobile and create a `PLATFORM_ADMIN` permission assignment. Mobile stays unverified until a real OTP provider verifies it. Refuses if an active platform admin already exists. |
| `POST /staff/accounts` | `STAFF` account with `MANAGE_STAFF` | Provision a separate staff account; body includes mobile and initial staff identity, not a client-selected privilege. Staff grants are assigned in a separate audited operation. |
| `PUT /staff/accounts/{account_id}/roles` | `STAFF` with `MANAGE_STAFF` | Replace staff role assignments; target must be `STAFF`. Cannot assign staff permissions to a marketplace account. |
| `POST /staff/accounts/{account_id}/disable` / `POST .../restore` | `STAFF` with `MANAGE_STAFF` | Disable/restore staff access with required reason; records actor/time and invalidates sessions. |
| `GET /me` | Active authenticated account | Return account type, access state, profile summary, and separate verification states. Blocked accounts receive no ordinary session. |
| `PUT /me/business-profile` | Business, pending or verified, own | Create/update own business name, owner, GST/license, contact, address, categories, and trade-worker contacts; server ignores status/owner fields. Verification submission requires at least ten trade-worker contacts per source requirements. |
| `POST /companies/register`, `GET /companies/me`, `PATCH /companies/me` | Active owning `COMPANY` account | Implemented above; only the owner account is supported in this milestone. Representative management remains future work. |
| `POST /me/business/verification-cases` | Business, pending, own | Submit/update a business verification case and its documents. |
| `POST /companies/me/verification-submissions` | Company owner with verified email and configured documents | Implemented above. Business verification remains planned. |
| `GET /me/verification-cases` | Owner; authorized staff | Return own case status/history or staff review queue record. |
| `GET /staff/companies/verification-queue` | Staff `REVIEW_COMPANY` | Implemented company queue; private files require separate `VIEW_PRIVATE_DOCUMENTS`. Business verification remains planned. |
| `POST /staff/business-verification-cases/{case_id}/decision` | Staff with matching review permission | Approve/reject/suspend with required decision and reason. Rejected/suspended blocks the business account. Response includes new state; reviewer is server-derived. |
| `POST /staff/companies/{company_id}/verification-decision` | Staff `REVIEW_COMPANY` | Implemented approval/rejection with required reason; does not alter company activity or account access state. |
| `POST /staff/business-verification-cases/{case_id}/restore-access` | Staff with matching review permission | Restore business access only through a valid staff-authorized state transition. Requires reason and audit. Old tokens remain revoked; the user must authenticate again. |
| `POST /staff/companies/{company_id}/suspend`, `/restore` | Staff `SUSPEND_COMPANY` / `RESTORE_COMPANY` | Implemented activity-only changes, with reason and audit; no account state change. |
| `POST /review-requests` | Restricted recovery-only identity proof; no marketplace session | Accept a request for a rejected/suspended case after verifying control of the registered contact through the configured recovery challenge. Bind the request and audit actor to the existing account; do not issue an ordinary session. Rate limits and anti-abuse controls apply. Response is acknowledgement only; it cannot restore access, reveal private case details, or alter verification state. |
| `POST /companies/me/review-requests` | Active owner of rejected/suspended company | Implemented restricted company review request; no state restoration. |
| `POST /staff/review-requests/{request_id}/decision` | Staff with `HANDLE_REVIEW_REQUESTS` and case access | Record handling outcome and reason; a request decision is not account restoration. Use the separate audited restore endpoint for restoration. |
| `GET /categories`, `GET /brands?category_id=` | Public or authenticated | List active categories/brands. Only brands of verified and active companies are public. |
| `GET /staff/categories`, `POST /staff/categories`, `PATCH /staff/categories/{category_id}` | Staff `MANAGE_TAXONOMY` | List/create/update category taxonomy. Deactivate rather than hard-delete used categories. |
| `GET /staff/brand-suggestions`, `POST /staff/brand-suggestions/{suggestion_id}/decision` | Staff `MANAGE_TAXONOMY` | Review a business-submitted brand suggestion. Approval must identify a verified owning company and record the evidence/decision; it cannot create a brand without company ownership. Ownership-evidence process is pending confirmation. |
| `POST /companies/{company_id}/brands` | Verified company owner or representative with `MANAGE_CATALOGUE` for that company | Create canonical brand owned by path company. Company ID must be an active relationship of actor. A brand cannot be transferred by client request. |
| `POST /me/business/brand-suggestions` | Pending or verified business, own | Submit “Other” brand suggestion; remains a suggestion until staff accepts it. |
| `GET /me/business/trade-worker-contacts`, `PUT /me/business/trade-worker-contacts` | Business, pending or verified, own | List/replace own registration contacts; submission requires business-level confirmation that permission was obtained. Each contact has name, mobile, trade, optional location, and separate opt-in state/evidence. Contacts remain private; opt-in alone does not create a public profile. Service-provider profile creation is deferred and requires that contact's separate opt-in. |
| `GET /products`, `GET /products/{product_id}` | Public | Search/read products only while the owning company is verified and active, product moderation is `PUBLISHED`, and public assets are approved. Company catalogue price is explicit. |
| `POST /companies/{company_id}/brands/{brand_id}/products` | Verified company owner/representative with `MANAGE_CATALOGUE` for that company | Create company-owned product and optional variants/assets; brand must belong to path company. Verified company publication is immediate unless a moderation restriction exists. |
| `PATCH /companies/{company_id}/products/{product_id}` | Verified owning company / representative `MANAGE_CATALOGUE` | Update own catalogue fields and catalogue price; product brand must belong to path company. Cannot set owner, moderation status, or audit actor. Version history is recorded. |
| `POST /companies/{company_id}/products/{product_id}/variants` | Verified owning company / representative `MANAGE_CATALOGUE` | Create variant belonging to product and path company. |
| `POST /staff/products/{product_id}/moderation` | Staff `MODERATE_PRODUCTS` | Hide, suspend, or restore; reason required; does not change company/business verification or product owner. |
| `POST /staff/companies/{company_id}/suspension` / `restoration` | Staff `SUSPEND_COMPANY` / `RESTORE_COMPANY` | Legacy planned names. Implemented paths are `/staff/companies/{company_id}/suspend` and `/restore`; catalogue filtering remains future work. |
| `GET /me/dealer-locations` | Pending or verified business owner | List own locations, including private drafts. |
| `POST /me/dealer-locations` | Pending or verified business owner | Create own location. Pending locations default to private draft and are not searchable; verified owners may publish a location. Multiple locations are supported. |
| `PATCH /me/dealer-locations/{location_id}/visibility` | Verified owner of location's business | Set an owned location `VISIBLE` or `PRIVATE_DRAFT`; pending businesses cannot publish locations. Change is audited. |
| `GET /dealer-businesses/{business_id}/locations` | Authenticated | Return eligible locations for a business. Business ID is distinct from location ID. |
| `GET /dealer-locations/{location_id}` | Authenticated | Read eligible location information; authorization and business visibility are checked. |
| `GET /dealer-locations/{location_id}/listings` | Authenticated users for eligible visible listings; verified location owner sees all; staff with read permission | List eligible listings; private/inactive entries are only visible to the owner/staff. |
| `POST /dealer-locations/{location_id}/listings` | Verified owner of the location | Create a listing with `product_id`, optional `variant_id`, `selling_price`, `stock_quantity`, and `availability_status`. Duplicate location/product/variant returns `409 LISTING_ALREADY_EXISTS`. |
| `GET /dealer-locations/{location_id}/listings/{listing_id}` | Authenticated for eligible listing; verified owner/staff may read private listing | Read listing; listing ID must belong to path location. |
| `PATCH /dealer-locations/{location_id}/listings/{listing_id}` | Verified owner | Update only dealer-owned price/stock/availability. Catalogue fields and company price are read-only. |
| `DELETE /dealer-locations/{location_id}/listings/{listing_id}` | Verified owner | Deactivate listing (soft delete) so history/audit remains. |
| `GET /dealer-search?product_id=&pin_code=&locality=&district=&latitude=&longitude=` | Active authenticated account | Match PIN code first, then locality, then district. Results require verified business, visible location, eligible listing, and currently verified/active product-owning company. Results distinguish business ID, location ID, business verification, company-authorized brand status, catalogue price, and dealer selling price. Optional GPS may provide a clearly labelled nearby fallback when direct location matches are unavailable; radius and coordinate policy remain configuration decisions. |
| `GET /companies/{company_id}/representatives` | Company owner; staff read | List path company's representatives and permissions. |
| `POST /companies/{company_id}/representatives` | Verified company owner | Add a verified company-type account as representative with explicit permission set. Owner identity is not client-selected; an account already linked to a company cannot be linked to another. |
| `PATCH /companies/{company_id}/representatives/{account_id}` / `DELETE ...` | Company owner | Change/revoke representative permissions. Changes are audited; revoked representatives lose access immediately. |
| `GET /companies/{company_id}/authorized-dealer-grants` | Company owner or representative with `MANAGE_AUTHORIZED_DEALERS`; staff read | List path company's brand + dealer business grants. |
| `POST /companies/{company_id}/authorized-dealer-grants` | Verified company representative with `MANAGE_AUTHORIZED_DEALERS` | Grant body contains `brand_id`, `dealer_business_id`, optional reason/evidence reference. Path company and actor are validated from auth. Brand must belong to that company and dealer business must be verified. Duplicate active scope returns `409 GRANT_ALREADY_ACTIVE`. |
| `POST /companies/{company_id}/authorized-dealer-grants/{grant_id}/revoke` | Same company permission | Revoke with reason; record revoker/time and audit. Cannot revoke another company's grant. |
| `POST /companies/me/documents` | Company owner with configured file policy | Implemented private upload; required document types, allowed MIME types, and max bytes must be configured. |
| `PUT /me/business/documents/{document_id}` / `PUT /me/company/documents/{document_id}` | Matching owner account | Replace by adding a new document version; original remains linked to its case and audit history. |
| `GET /companies/me/documents/{document_id}`, `GET /staff/companies/{company_id}/documents/{document_id}` | Company owner / staff `VIEW_PRIVATE_DOCUMENTS` | Implemented private streaming after ownership checks; downloads are audited and no storage URL is returned. |
| `POST /companies/{company_id}/assets` | Company owner (pending or verified); verified representative with `MANAGE_COMPANY_PROFILE` | Upload company logo/profile asset; binds to path company. Pending asset is private until company and asset approval. |
| `GET /companies/{company_id}/assets/{asset_id}/download` | Owning account/authorized representative or assigned staff; public only if approved | Authorize each read and return stream or short-lived signed URL; never return storage key. |
| `PUT /companies/{company_id}/assets/{asset_id}` / `DELETE /companies/{company_id}/assets/{asset_id}` | Same owning company permission | Replace as new version or deactivate; each action audited. |
| `POST /companies/{company_id}/products/{product_id}/assets` | Verified product owner/representative with `MANAGE_CATALOGUE` | Upload product asset and bind directly to product. Publication visibility follows asset approval/product moderation policy. |
| `PUT /companies/{company_id}/products/{product_id}/assets/{asset_id}` / `DELETE /companies/{company_id}/products/{product_id}/assets/{asset_id}` | Verified product owner/representative with `MANAGE_CATALOGUE` | Replace as new version or soft-deactivate an owned asset; audit actor is server-derived. |
| `GET /staff/audit-events` | Staff `READ_AUDIT` | Search audit history; filtered fields never include secrets or file contents. |
| `GET /staff/users`, `/staff/products`, `/staff/dealers`, `/staff/reports/summary` | Staff with corresponding read permission | Admin panel resources, moderation/review-safe views and agreed counts. |

The listing is addressed by `location_id + listing_id` for reads/updates. Creation uniqueness is `(location_id, product_id, variant_id)`: one partial unique index handles NULL variant and another handles non-NULL variant. The API returns listing ID after creation; duplicate submissions do not silently overwrite an existing listing.

## Representative request/response shapes

Document lifecycle endpoints in addition to the endpoint table:

- `GET /me/business/documents` and `GET /me/company/documents`: owner-only metadata list; no storage keys.
- `PUT /me/business/documents/{document_id}` and `PUT /me/company/documents/{document_id}`: owner-only replacement as a new version; prior evidence is retained.
- `POST /staff/business-documents/{document_id}/withdraw` and `POST /staff/company-documents/{document_id}/withdraw`: matching assigned reviewer only; requires reason and records an audit event. Physical deletion is controlled by the retention policy, not a normal endpoint.
- `POST /companies/{company_id}/assets`, `PUT /companies/{company_id}/assets/{asset_id}`, and `DELETE /companies/{company_id}/assets/{asset_id}`: company owner or representative with `MANAGE_COMPANY_PROFILE`; create, version, or deactivate company logo/profile assets.
- `PUT /companies/{company_id}/products/{product_id}/assets/{asset_id}` and `DELETE /companies/{company_id}/products/{product_id}/assets/{asset_id}`: verified product owner or `MANAGE_CATALOGUE` representative; replace as a new version or soft-deactivate an asset.

Dealer-location listing reads require authentication. Other active published listings are visible to authenticated users; the owning verified business and authorized staff may also read non-public/inactive listings. Listing ID must be scoped to the `location_id` in the route.

Listing create request:

```json
{
  "product_id": "prod_123",
  "variant_id": null,
  "selling_price": "1125.00",
  "stock_quantity": "25",
  "availability_status": "available"
}
```

Response includes `listing_id`, `dealer_business_id`, `dealer_location_id`, `product_id`, optional `variant_id`, dealer price/stock/availability, and read-only company catalogue price. Exact currency/decimal precision and stock unit remain open.

Authorized-dealer grant response includes `grant_id`, `company_id`, `brand_id`, `dealer_business_id`, `status`, `granted_by`, and `granted_at`; actor values are server-generated. Revocation adds `revoked_by`, `revoked_at`, and reason.

## Validation and errors

Errors use `{ "code": "...", "message": "...", "field_errors": {}, "request_id": "..." }` where applicable.

| HTTP | Example cases |
|---|---|
| `400` | Invalid field, variant does not belong to product (`INVALID_VARIANT`), brand/company mismatch (`INVALID_COMPANY_BRAND`), dealer location/business mismatch. |
| `401` | Missing/invalid session or OTP; blocked account receives safe `ACCOUNT_BLOCKED` and no protected data; revoked/expired token returns `INVALID_TOKEN`. |
| `403` | Wrong role, unverified account attempting publish/listing, or representative missing permission (`ACCOUNT_STATE_NOT_ALLOWED`, `PERMISSION_DENIED`). |
| `404` | Resource absent or not visible to caller; do not leak private records. |
| `409` | Duplicate mobile (`MOBILE_ALREADY_REGISTERED`), company account already linked (`COMPANY_ACCOUNT_ALREADY_LINKED`), duplicate listing (`LISTING_ALREADY_EXISTS`), active duplicate grant (`GRANT_ALREADY_ACTIVE`), or invalid state transition. |
| `503` | OTP/email provider unavailable or file policy/required document types are not configured; no account/company is marked verified and uploads/submissions fail closed. |
| `413` / `415` | File exceeds configured limit or unsupported configured type. |
| `429` | OTP provider/API throttling; the configured provider adapter is responsible for enforcing its delivery policy. |
| `5xx` | Provider/internal error with request ID; no secrets, stack traces, OTP, or storage keys. |

Planned marketplace and staff state changes are transactional with audit event creation. Account registration/profile creation is transactional; the general audit-event module and endpoint write policy are not implemented yet. No client can supply a future audit actor or write audit rows directly.

### Session and token enforcement

Company activity suspension does not revoke otherwise valid account sessions or refresh tokens. The backend checks current company activity state on every company-scoped request and denies publishing and other company writes while suspended; account-level status viewing and restricted review requests remain available. Account blocking revokes active sessions and refresh tokens. Admin restoration clears only the applicable block/state recorded by that restoration action; old tokens remain invalid and the user must authenticate again. Restoring a company activity state never clears an independent account block.

## Deferred API modules

Cart, quotation, secure customer approval links, invoices, payment, jobs, service providers, and employment APIs are later phases.

### Implemented owner company status context

`GET /api/v1/companies/me` retains its `company` object and adds owner-only `verification` metadata for mobile clients: configured document policy (`configured`, `required_types`, `allowed_mime_types`, nullable `max_bytes`), uploaded document metadata with nullable `verification_case_id` (never file/storage URLs), latest nullable application (`id`, `status`, `submitted_at`, `reviewed_at`, `decision_reason`), missing document types, email-provider configuration boolean, allowed-action flags (`can_edit`, `can_upload`, `can_submit`, `can_request_review`) and owner-scoped review requests. The response is `Cache-Control: no-store`. Write endpoints still independently authorize and validate operations. Unconfigured policy has no invented production limits. No new route or account privilege was introduced.

### Implemented dealer mobile read context

`GET /api/v1/businesses/me` retains its profile fields and adds owner-only `workspace`: `branch_count`, `published_listing_count`, `discoverable_listing_count`, `can_edit`, `can_publish_branches`, `can_manage_listings`, and `authorizations`. Each grant contains its ID, canonical brand/company IDs and names, active flag, current company verification/activity state, effective eligibility and update timestamp. Grant actors, private contacts and other businesses' grants are not included. This response is `Cache-Control: no-store`. No workspace write field exists; the strict profile serializer rejects it. Dealers still cannot call the company-owned authorization-write API.

Product responses add read-only `brand_id` and `company_id` for canonical matching. Product ownership and all existing write constraints remain unchanged. These are additive fields on existing URLs; no new endpoint or database migration is required.
