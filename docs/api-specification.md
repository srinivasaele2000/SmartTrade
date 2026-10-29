# SmartTrade API specification (planned)

Planning-level REST contract; no endpoints are implemented. Paths use `/api/v1`. All ownership, role, account-state, verification, and representative permissions are checked by the backend. Client-supplied owner IDs, account types, verification decisions, moderation status, authorization actor, or audit fields are rejected/ignored. The API derives audit actors from the authenticated identity.

**ID convention:** `account_id` identifies `Account`; `business_id` identifies `BusinessProfile.id`; `company_id` identifies `CompanyProfile.id`; `location_id` identifies `DealerLocation.id`; `product_id`, `variant_id`, and `listing_id` identify their corresponding row PKs. `CompanyRepresentative.account_id` is a login identity, not a company resource ID. A dealer business ID is never interchangeable with a dealer location ID.

## Authentication and access rules

- One normalized mobile number maps to one immutable `Account.account_type` (`PERSONAL`, `BUSINESS`, `COMPANY`, `STAFF`). `POST /accounts` accepts only marketplace types. Staff creation/permission assignment is restricted to platform administrators.
- An account must be active to use authenticated endpoints. Pending business/company accounts may edit their own registration profiles and upload/read their own verification documents. They cannot publish products, create public dealer listings, or appear as verified dealers.
- Verified business accounts manage only their own locations and location-specific listings. Verified company accounts manage only brands/products owned through their company and may publish immediately.
- Rejected/suspended business accounts are blocked from all authenticated operations. Rejected/suspended company organizations block all active company membership accounts; Release 1 allows each company account only one active organization membership. Revoked historical memberships are not blocked by that organization. Rejected restores to pending; suspended restores to its recorded pre-suspension state (pending or verified). Restoration is staff-only, requires a reason, is audited, and invalidates existing sessions. The one-active-membership limit is a recommendation pending owner confirmation.
- Staff endpoints require `STAFF` account type, active status, and the corresponding assigned permission. No ordinary account can receive staff permissions.
- Dealer browse/search/detail endpoints require login. Product catalogue browsing is proposed as public; authenticated access is also accepted. If product browsing should require login, change this rule before implementation.

## Endpoint plan

| Method/path | Permission | Contract summary |
|---|---|---|
| `POST /auth/otp/request` | Public | Request OTP; body has mobile and flow; response gives safe delivery/retry metadata, never OTP. |
| `POST /auth/otp/verify` | Public | Verify mobile/OTP; returns auth/session result. Rate limits and OTP lifecycle to be configured. |
| `POST /auth/email-verification/request`, `POST /auth/email-verification/confirm` | Public/authenticated registration flow | Send and confirm company registration email verification using the configurable email provider. Never return verification secrets. |
| `POST /accounts` | Public after OTP | Create exactly one marketplace account type. Duplicate normalized mobile: `409 MOBILE_ALREADY_REGISTERED`. Account type cannot be changed later. |
| `POST /staff/accounts` | `STAFF` account with `MANAGE_STAFF` | Provision a separate staff account; body includes mobile and initial staff identity, not a client-selected privilege. Staff grants are assigned in a separate audited operation. |
| `PUT /staff/accounts/{account_id}/roles` | `STAFF` with `MANAGE_STAFF` | Replace staff role assignments; target must be `STAFF`. Cannot assign staff permissions to a marketplace account. |
| `POST /staff/accounts/{account_id}/disable` / `POST .../restore` | `STAFF` with `MANAGE_STAFF` | Disable/restore staff access with required reason; records actor/time and invalidates sessions. |
| `GET /me` | Active authenticated account | Return account type, access state, profile summary, and separate verification states. Blocked accounts receive no ordinary session. |
| `PUT /me/business-profile` | Business, pending or verified, own | Create/update own business name, owner, GST/license, contact, address, categories, and trade-worker contacts; server ignores status/owner fields. Verification submission requires at least ten trade-worker contacts per source requirements. |
| `GET /me/companies` | Active `COMPANY` account | List organizations owned or represented by the authenticated account. |
| `POST /me/companies` | Active `COMPANY` account after mobile OTP and email confirmation | Create an organization with caller as `OWNER` membership; status starts pending. Request includes company name, brand names, authorized person, GST/registration data, email, registered address, PIN/area/district/state, website/logo/documents as applicable. Owner account is server-derived. Existing company membership returns `409 COMPANY_MEMBERSHIP_EXISTS`. |
| `GET /companies/{company_id}` | Owner/active representative; authorized staff | Read company organization profile and verification state. |
| `PATCH /companies/{company_id}` | Owner or representative with `MANAGE_COMPANY_PROFILE`; pending owner may complete own registration | Update company profile only; cannot set verification state or owner. |
| `POST /me/business/verification-cases` | Business, pending, own | Submit/update a business verification case and its documents. |
| `POST /me/company/verification-cases` | Company, pending, own with verified registration email | Submit/update a company verification case and its documents. |
| `GET /me/verification-cases` | Owner; authorized staff | Return own case status/history or staff review queue record. |
| `GET /staff/business-verification-cases`, `GET /staff/company-verification-cases` | Staff `REVIEW_BUSINESS` / `REVIEW_COMPANY` | List/search queues and case details. Sensitive files require separate file permission. |
| `POST /staff/business-verification-cases/{case_id}/decision` | Staff with matching review permission | Approve/reject/suspend with required decision and reason. Rejected/suspended blocks the business account. Response includes new state; reviewer is server-derived. |
| `POST /staff/company-verification-cases/{case_id}/decision` | Staff with matching review permission | Same for company; reject/suspend blocks every company membership account; does not change business state. |
| `POST /staff/business-verification-cases/{case_id}/restore-access` | Staff with matching review permission | Rejected returns to pending; suspended returns to recorded pre-suspension state. Requires reason, clears the block, invalidates old sessions, and audits. |
| `POST /staff/company-verification-cases/{case_id}/restore-access` | Staff with matching review permission | Same company transitions; clears blocks for its owner/representative accounts and invalidates their sessions. Requires reason and audit. |
| `GET /categories`, `GET /brands?category_id=` | Public or authenticated | List active categories/brands. Only brands of verified companies are public. |
| `GET /staff/categories`, `POST /staff/categories`, `PATCH /staff/categories/{category_id}` | Staff `MANAGE_TAXONOMY` | List/create/update category taxonomy. Deactivate rather than hard-delete used categories. |
| `GET /staff/brand-suggestions`, `POST /staff/brand-suggestions/{suggestion_id}/decision` | Staff `MANAGE_TAXONOMY` | Review a business-submitted brand suggestion. Approval must identify a verified owning company and record the evidence/decision; it cannot create a brand without company ownership. Ownership-evidence process is pending confirmation. |
| `POST /companies/{company_id}/brands` | Verified company owner or representative with `MANAGE_CATALOGUE` for that company | Create canonical brand owned by path company. Company ID must be an active relationship of actor. A brand cannot be transferred by client request. |
| `POST /me/business/brand-suggestions` | Pending or verified business, own | Submit “Other” brand suggestion; remains a suggestion until staff accepts it. |
| `GET /me/business/trade-worker-contacts`, `PUT /me/business/trade-worker-contacts` | Business, pending or verified, own | List/replace own registration contacts; each row has name, mobile, trade, and optional location. Contacts remain private to owner/reviewer and do not create service-provider listings. |
| `GET /products`, `GET /products/{product_id}` | Proposed public; optionally authenticated | Search/read products only while the owning company is verified, product moderation is `PUBLISHED`, and public assets are approved. Company catalogue price is explicit. |
| `POST /companies/{company_id}/brands/{brand_id}/products` | Verified company owner/representative with `MANAGE_CATALOGUE` for that company | Create company-owned product and optional variants/assets; brand must belong to path company. Verified company publication is immediate unless a moderation restriction exists. |
| `PATCH /companies/{company_id}/products/{product_id}` | Verified owning company / representative `MANAGE_CATALOGUE` | Update own catalogue fields and catalogue price; product brand must belong to path company. Cannot set owner, moderation status, or audit actor. Version history is recorded. |
| `POST /companies/{company_id}/products/{product_id}/variants` | Verified owning company / representative `MANAGE_CATALOGUE` | Create variant belonging to product and path company. |
| `POST /staff/products/{product_id}/moderation` | Staff `MODERATE_PRODUCTS` | Hide, suspend, or restore; reason required; does not change company/business verification or product owner. |
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
| `GET /dealer-search?product_id=&pin_code=&area=&district=` | Active authenticated account | Search by location fields. Results require verified business, visible location, eligible listing, and currently verified product-owning company. Results distinguish business ID, location ID, business verification, company-authorized brand status, catalogue price, and dealer selling price. GPS distance is optional and only computed with permission/coordinates. |
| `GET /companies/{company_id}/representatives` | Company owner; staff read | List path company's representatives and permissions. |
| `POST /companies/{company_id}/representatives` | Verified company owner | Add a verified company-type account as representative with explicit permission set. Owner identity is not client-selected. |
| `PATCH /companies/{company_id}/representatives/{account_id}` / `DELETE ...` | Company owner | Change/revoke representative permissions. Changes are audited; revoked representatives lose access immediately. |
| `GET /companies/{company_id}/authorized-dealer-grants` | Company owner or representative with `MANAGE_AUTHORIZED_DEALERS`; staff read | List path company's brand + dealer business grants. |
| `POST /companies/{company_id}/authorized-dealer-grants` | Verified company representative with `MANAGE_AUTHORIZED_DEALERS` | Grant body contains `brand_id`, `dealer_business_id`, optional reason/evidence reference. Path company and actor are validated from auth. Brand must belong to that company and dealer business must be verified. Duplicate active scope returns `409 GRANT_ALREADY_ACTIVE`. |
| `POST /companies/{company_id}/authorized-dealer-grants/{grant_id}/revoke` | Same company permission | Revoke with reason; record revoker/time and audit. Cannot revoke another company's grant. |
| `POST /me/business/documents` / `POST /me/company/documents` | Matching owner account, pending or verified as appropriate | Upload verification file; server binds business/company and case. No public URL returned. |
| `PUT /me/business/documents/{document_id}` / `PUT /me/company/documents/{document_id}` | Matching owner account | Replace by adding a new document version; original remains linked to its case and audit history. |
| `GET /me/business/documents/{document_id}/download`, `GET /me/company/documents/{document_id}/download` | Matching owner or authorized staff reviewer | Auth check then stream or short-lived signed URL. Access logged. Document ID must belong to authenticated profile/case. |
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
| `401` | Missing/invalid session; blocked account receives safe `ACCOUNT_BLOCKED` and no protected data. |
| `403` | Wrong role, unverified account attempting publish/listing, or representative missing permission (`ACCOUNT_STATE_NOT_ALLOWED`, `PERMISSION_DENIED`). |
| `404` | Resource absent or not visible to caller; do not leak private records. |
| `409` | Duplicate mobile (`MOBILE_ALREADY_REGISTERED`), existing company membership (`COMPANY_MEMBERSHIP_EXISTS`), duplicate listing (`LISTING_ALREADY_EXISTS`), active duplicate grant (`GRANT_ALREADY_ACTIVE`), or invalid state transition. |
| `413` / `415` | File too large or unsupported type; limits configured before upload implementation. |
| `429` | OTP/API throttling. |
| `5xx` | Provider/internal error with request ID; no secrets, stack traces, OTP, or storage keys. |

All state-changing endpoints are transactional with audit event creation. Failure to create the required audit record fails the operation. No client can supply the audit actor or write audit rows directly.

## Deferred API modules

Cart, quotation, secure customer approval links, invoices, payment, jobs, service providers, and employment APIs are later phases.
