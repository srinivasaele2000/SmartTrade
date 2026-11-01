# SmartTrade implementation plan

The phases below are the approved Release 1 order. Code is underway. As of 2026-10-29, the mobile/admin shells, account/authentication foundation, and initial company registration/email verification/document submission/staff review/suspension workflow are implemented. PostgreSQL-only triggers remain unverified because no PostgreSQL server is available.

## Phase 0 — Architecture approval and remaining policy decisions

**Scope:** Approve this architecture and resolve decisions marked as blockers in `decisions.md`.

**Acceptance criteria:**

- Account role/profile enforcement, rejected/suspended review and restoration transitions, configurable file limits and retention policy, secure staff bootstrap, representative administration, and audit retention policy are approved or explicitly assigned.
- Public catalogue access and authenticated dealer discovery are implemented as approved; PIN-first/locality/district ordering and clearly labelled nearby fallback behavior are agreed without hardcoding an unapproved radius.
- DB uniqueness/FK rules and API permission matrix are approved.
- Release 1 scope is confirmed; deferred features remain out of scope.

## Phase 1 — Monorepo and configuration foundation

**Scope:** Create approved mobile/admin/API project foundations and safe local configuration templates.

**Acceptance criteria:**

- Mobile, admin, and API start locally with documented configuration.
- No secrets or provider credentials are committed; missing configuration fails clearly.
- Staff account configuration is not available through ordinary client flows.

## Phase 2 — Identity, account subtype, sessions, and OTP

**Scope:** Account model, normalized mobile registration, OTP adapter, company email verification, authentication, account-type profiles, staff provisioning, company owner profile, active-session/refresh-token revocation for blocked accounts, and re-authentication after restoration.

**Testing requirements:** DB constraint tests for global normalized-mobile uniqueness and exactly-one-matching-profile invariant; API tests for immutable account type, OTP/email-verification lifecycle, ten-contact registration validation, and preventing staff privilege escalation.

**Acceptance criteria:**

- Duplicate mobile registration across any two account types is rejected by the database/API.
- A company-type account can be linked to only one company, while companies can have multiple separately authenticated representative accounts.
- Account type is exactly one enum value and cannot be changed by users.
- A deferred DB constraint prevents missing or mismatched subtype profiles at commit.
- Staff accounts are separate `STAFF` type with permission assignments and cannot be created/promoted by marketplace users.
- Business profile registration captures at least ten trade-worker contacts before verification submission and records the business permission confirmation; each contact's opt-in is recorded separately. No public service-provider profiles are created in Release 1.
- Blocking an account revokes active sessions and refresh tokens; restoration does not revive old tokens and requires re-authentication. Backend state checks reject stale credentials regardless of frontend state.

## Phase 3 — Verification workflow, files, staff RBAC, and audit foundation

**Scope:** Separate business/company verification cases, staff queue/decisions, representative-ready staff permission model, private file handling, and append-only audit. The initial company workflow is implemented; business verification and broader audit/file policy work remain.

**Testing requirements:** permission matrix tests for every account type/status; FK/ownership tests for document-case/profile alignment; unauthorized download tests; audit subject/actor and immutability tests; blocked/restore state transition tests.

**Acceptance criteria:**

- Pending users can edit own registration profiles and upload/read only their own files before submission; a submitted company profile is locked during review. Rejected/suspended accounts have no marketplace access; a restricted review request cannot restore access.
- Company-associated accounts can view suspension status and submit a restricted company review request while the company is suspended, provided the account is not independently blocked.
- Company verification submission requires a verified registration email; business verification submission includes at least ten trade-worker contacts required by the source document and business permission confirmation.
- Admin manually approves/rejects/suspends business and company separately; actor, decision, reason, and timestamps are persisted.
- Rejected/suspended accounts are fully blocked; only authorized staff can restore using approved transition rules.
- Rejected/suspended company accounts remain blocked. Separately, company activity suspension hides the catalogue and denies publishing and other company-scoped writes while preserving company, catalogue, product, dealer-mapping, membership, and audit history. It does not block associated accounts or revoke their sessions. Restoration is authorized, audited, and does not clear independent account blocks.
- Tests verify that company suspension blocks company writes server-side while allowing permitted account-level status/review functions; independently blocked accounts remain restricted.
- Tests verify suspension/restoration audit actor, action, timestamp, and reason; company restoration leaves independent account blocks and revoked tokens unchanged.
- Trade-worker contacts require business permission confirmation and separate per-contact opt-in before any later profile creation. Contacts remain private and no public service-provider profiles are created automatically; the service-provider marketplace is deferred.
- File bytes are private; endpoint authorization occurs before any stream/signed URL; direct URL secrecy is not relied on. Limits are configurable, and a documented access/retention policy exists without invented values.
- Audit events have real actor and subject FKs and cannot be updated/deleted through application/admin APIs.
- Company registration creates one `CompanyProfile` for the authenticated COMPANY owner. Company verification and activity suspension are separate; neither automatically changes owner account access.
- Company email verification and file upload fail closed until an actual email provider and explicit file-size/type/required-document configuration are supplied. The concrete production values remain open.
- Company-profile, case, document, review-request, and audit PostgreSQL trigger SQL has not been applied or tested against PostgreSQL in this environment.

## Phase 4 — Taxonomy, brands, company catalogue, and product moderation

**Scope:** Categories, verified company-owned brands, products/variants/assets, catalogue pricing/version history, and staff moderation.

**Testing requirements:** FK tests for brand owner/product/variant relationships; tests that pending companies cannot create canonical brands/products; tests for immediate publish by verified company and hide/suspend/restore by staff; ownership authorization tests.

**Acceptance criteria:**

- Brand has exactly one verified company owner; a verified company can own multiple brands.
- Product ownership derives from brand/company; client cannot set owner or moderation state.
- Verified company products publish immediately, while staff can hide, suspend, and restore without changing verification status.
- Company activity suspension suppresses public products and new company-scoped writes without deleting products/grants or changing product moderation and account access state.
- Catalogue price and product changes are versioned/audited; duplicate detection is reviewable without an unapproved auto-merge rule.

## Phase 5 — Dealer businesses, multiple locations, listings, and authorizations

**Scope:** Business category/brand data, multiple locations, per-location listings, availability, stock, selling prices, company representatives, and brand authorization grants.

**Testing requirements:** Tests for business-to-location ownership; product/variant composite FK; partial unique indexes for variant and NULL-variant listing; duplicate conflict response; separate company/dealer prices; representative permission and cross-company grant denial; grant/revoke audit.

**Acceptance criteria:**

- A business can create/manage multiple locations; each listing points to exactly one location.
- Company representative membership uniqueness prevents one account from being attached to multiple companies, including through a revoked membership.
- At most one listing exists per location/product/variant, including exactly one no-variant listing per location/product.
- Invalid variant/product combinations and foreign-business locations are rejected.
- Selling price, stock, and availability are stored per location and never overwrite catalogue price.
- Only active authorized company representatives can grant/revoke their company's brand-to-business authorization; every action is audited.

## Phase 6 — Authenticated discovery and admin web panel completion

**Scope:** Public eligible product discovery; authenticated dealer search and details prioritizing PIN, then locality/district; staff user, verification, catalogue, dealer, audit, and report screens.

**Testing requirements:** Auth-required dealer endpoint tests; public response privacy tests; search tests for location fields; result field tests proving company verification, business verification, authorized-dealer status, catalogue price, and dealer price remain distinct.

**Acceptance criteria:**

- Dealer search/detail endpoints reject anonymous requests.
- Results identify dealer business and dealer location separately and only show eligible locations/listings.
- Pending, rejected, and suspended accounts cannot be represented as verified dealers; rejected/suspended users cannot use protected APIs.
- Search prioritizes PIN code, then locality, then district. GPS is optional; any nearby fallback is explicitly labelled and uses no invented default radius.
- Anonymous catalogue browsing returns only eligible products; anonymous dealer search/detail is denied. Nearby fallback results are visibly labelled and do not disclose private files or contact records.
- Staff screens expose only functions allowed by staff permissions; sensitive file viewing is audited.

## Phase 7 — Release hardening

**Scope:** Security/privacy review, accessibility, operational documentation, backup/monitoring plan, and owner acceptance.

**Acceptance criteria:**

- Account, role/profile, listing uniqueness, FK, authorization, document access, moderation, and audit acceptance tests pass.
- OTP/cloud/storage providers are configurable and credentials remain outside code.
- Runbook and approved retention/file policies exist.
- Release 1 does not collect registration fees; the future configurable-fee option is not activated.
- Release contains no quotations, invoices, jobs, service-provider features, or unapproved future enhancements.

## Later phases

1. Quotations and invoices, including secure customer approval links without mandatory registration.
2. Service providers, job seekers, and employers.
3. Payments, WhatsApp, ratings, order/delivery tracking, advanced inventory, multilingual support, AI recommendations, ERP/GST integrations, and analytics as separately prioritized.
