# SmartTrade implementation plan

The phases below are a proposed order for Release 1. The phase scope, DB invariants, authorization boundaries, test requirements, and acceptance criteria are documented before implementation. No code or tests are created by this document.

## Phase 0 — Architecture approval and remaining policy decisions

**Scope:** Approve this architecture and resolve decisions marked as blockers in `decisions.md`.

**Acceptance criteria:**

- Account role/profile enforcement, account restoration transitions, product browsing visibility, file limits, representative administration, and audit retention policy are approved or explicitly assigned.
- DB uniqueness/FK rules and API permission matrix are approved.
- Release 1 scope is confirmed; deferred features remain out of scope.

## Phase 1 — Monorepo and configuration foundation

**Scope:** Create approved mobile/admin/API project foundations and safe local configuration templates.

**Acceptance criteria:**

- Mobile, admin, and API start locally with documented configuration.
- No secrets or provider credentials are committed; missing configuration fails clearly.
- Staff account configuration is not available through ordinary client flows.

## Phase 2 — Identity, account subtype, sessions, and OTP

**Scope:** Account model, normalized mobile registration, OTP adapter, company email verification, authentication, account-type profiles, staff provisioning, and session invalidation.

**Testing requirements:** DB constraint tests for global normalized-mobile uniqueness and exactly-one-matching-profile invariant; API tests for immutable account type, OTP/email-verification lifecycle, ten-contact registration validation, and preventing staff privilege escalation.

**Acceptance criteria:**

- Duplicate mobile registration across any two account types is rejected by the database/API.
- Account type is exactly one enum value and cannot be changed by users.
- A deferred DB constraint prevents missing or mismatched subtype profiles at commit.
- Staff accounts are separate `STAFF` type with permission assignments and cannot be created/promoted by marketplace users.
- Business profile registration captures at least ten trade-worker contacts before verification submission; company verification submission is blocked until its registration email is verified.
- Blocking an account invalidates sessions; blocked account cannot call protected APIs.

## Phase 3 — Verification workflow, files, staff RBAC, and audit foundation

**Scope:** Separate business/company verification cases, staff queue/decisions, representative-ready staff permission model, private file handling, and append-only audit.

**Testing requirements:** permission matrix tests for every account type/status; FK/ownership tests for document-case/profile alignment; unauthorized download tests; audit subject/actor and immutability tests; blocked/restore state transition tests.

**Acceptance criteria:**

- Pending users can edit own registration profiles and upload/read only their own case files.
- Company verification submission requires a verified registration email; business verification submission includes at least ten trade-worker contacts required by the source document.
- Admin manually approves/rejects/suspends business and company separately; actor, decision, reason, and timestamps are persisted.
- Rejected/suspended accounts are fully blocked; only authorized staff can restore using approved transition rules.
- Company rejection/suspension blocks every account in that company's owner/representative membership set; restoration updates the organization and linked account access states transactionally.
- Trade-worker contacts collected for business registration remain private and do not activate the deferred service-provider marketplace.
- File bytes are private; endpoint authorization occurs before any stream/signed URL; direct URL secrecy is not relied on.
- Audit events have real actor and subject FKs and cannot be updated/deleted through application/admin APIs.

## Phase 4 — Taxonomy, brands, company catalogue, and product moderation

**Scope:** Categories, verified company-owned brands, products/variants/assets, catalogue pricing/version history, and staff moderation.

**Testing requirements:** FK tests for brand owner/product/variant relationships; tests that pending companies cannot create canonical brands/products; tests for immediate publish by verified company and hide/suspend/restore by staff; ownership authorization tests.

**Acceptance criteria:**

- Brand has exactly one verified company owner; a verified company can own multiple brands.
- Product ownership derives from brand/company; client cannot set owner or moderation state.
- Verified company products publish immediately, while staff can hide, suspend, and restore without changing verification status.
- Catalogue price and product changes are versioned/audited; duplicate detection is reviewable without an unapproved auto-merge rule.

## Phase 5 — Dealer businesses, multiple locations, listings, and authorizations

**Scope:** Business category/brand data, multiple locations, per-location listings, availability, stock, selling prices, company representatives, and brand authorization grants.

**Testing requirements:** Tests for business-to-location ownership; product/variant composite FK; partial unique indexes for variant and NULL-variant listing; duplicate conflict response; separate company/dealer prices; representative permission and cross-company grant denial; grant/revoke audit.

**Acceptance criteria:**

- A business can create/manage multiple locations; each listing points to exactly one location.
- At most one listing exists per location/product/variant, including exactly one no-variant listing per location/product.
- Invalid variant/product combinations and foreign-business locations are rejected.
- Selling price, stock, and availability are stored per location and never overwrite catalogue price.
- Only active authorized company representatives can grant/revoke their company's brand-to-business authorization; every action is audited.

## Phase 6 — Authenticated discovery and admin web panel completion

**Scope:** Product discovery under approved public/auth policy; authenticated dealer search and details by PIN/area/district; staff user, verification, catalogue, dealer, audit, and report screens.

**Testing requirements:** Auth-required dealer endpoint tests; public response privacy tests; search tests for location fields; result field tests proving company verification, business verification, authorized-dealer status, catalogue price, and dealer price remain distinct.

**Acceptance criteria:**

- Dealer search/detail endpoints reject anonymous requests.
- Results identify dealer business and dealer location separately and only show eligible locations/listings.
- Pending, rejected, and suspended accounts cannot be represented as verified dealers; rejected/suspended users cannot use protected APIs.
- GPS is optional and not required for PIN/area/district search.
- Staff screens expose only functions allowed by staff permissions; sensitive file viewing is audited.

## Phase 7 — Release hardening

**Scope:** Security/privacy review, accessibility, operational documentation, backup/monitoring plan, and owner acceptance.

**Acceptance criteria:**

- Account, role/profile, listing uniqueness, FK, authorization, document access, moderation, and audit acceptance tests pass.
- OTP/cloud/storage providers are configurable and credentials remain outside code.
- Runbook and approved retention/file policies exist.
- Release contains no quotations, invoices, jobs, service-provider features, or unapproved future enhancements.

## Later phases

1. Quotations and invoices, including secure customer approval links without mandatory registration.
2. Service providers, job seekers, and employers.
3. Payments, WhatsApp, ratings, order/delivery tracking, advanced inventory, multilingual support, AI recommendations, ERP/GST integrations, and analytics as separately prioritized.
