# SmartTrade decisions and open questions

Confirmed project decisions, architecture recommendations, and unresolved questions are separated below. A recommendation is not a confirmed business rule unless approved by the owner.

## Confirmed decisions

| ID | Decision | Consequence |
|---|---|---|
| D-001 | One account per mobile number; a person needing another role uses a separate account. | Global unique normalized mobile constraint. |
| D-002 | Pending users may complete profiles/upload verification docs, but cannot publish catalogues or appear as verified dealers. | Pending workflows are limited and private. |
| D-003 | Admin manually verifies business and company registrations. | Human staff review is required. |
| D-004 | Verified companies publish products immediately; admins can hide, suspend, and restore products. | Publication and moderation are separate from company verification. |
| D-005 | Business verification, company verification, and company-authorized-dealer status are separate. | Separate data, permissions, and UI/API fields. |
| D-006 | Dealer search uses PIN code, area, and district; GPS is optional for nearby distance. | GPS is not required for search. |
| D-007 | Company catalogue price and dealer selling price are distinct; dealers maintain their own stock, price, and availability. | Company product and location listing have separate price fields. |
| D-008 | Release 1 covers catalogue, company/dealer verification, dealer discovery, and web admin panel. | Defines core release scope. |
| D-009 | Quotations/invoices follow the core marketplace; service providers, job seekers, and employers are deferred. | Not Release 1 features. |
| D-010 | OTP/cloud providers are configurable and credentials are never hardcoded. | Provider adapters and external secrets/configuration. |
| D-011 | Later, customers can receive/approve quotations through secure links without mandatory registration. | Deferred; link security policy precedes implementation. |
| D-012 | Proposed stack is Expo React Native/TypeScript, React/TypeScript admin, Django REST Framework, PostgreSQL, Git/private GitHub. | Baseline stack; implementation awaits architecture approval. |
| D-013 | Users must log in to browse dealers. | Dealer search/detail endpoints require authentication. |
| D-014 | Rejected and suspended accounts are fully blocked until an administrator restores access. | No self-service protected access while blocked; restoration is staff-only. |
| D-015 | Dealer businesses may have multiple locations; each location owns its availability, stock, and selling prices. | Listings reference a specific dealer location. |
| D-016 | Administrators/staff use a separate staff/admin account type with separate permissions. | Staff is not a marketplace profile or client-editable role. |
| D-017 | Each brand belongs to exactly one verified company; a verified company may own multiple brands. | Brand has one required verified-company FK. |
| D-018 | Authorized-dealer status is scoped to company + brand + dealer business. Only that company's authorized representatives may grant/revoke. | Grant scope and actor permissions are explicit and audited. |
| D-019 | A listing is unique per dealer location + product + optional variant, including products without variants. | Two partial unique indexes handle NULL and non-NULL variants. |
| D-020 | Files have explicit owning-entity relationships and access control; audit history is retained. | No unprotected polymorphic file owner; document a retention policy without inventing periods or purge rules. |
| D-021 | A company account can be linked to only one company; a company may have multiple separately authenticated representatives. | Unique company membership per account for its lifetime, including revoked memberships. |
| D-022 | Catalogue browsing is public; dealer discovery/details require login. | Public API returns only eligible published catalogue data and approved public assets. |
| D-023 | Rejected/suspended accounts remain blocked until admin restoration; a restricted review-request process is allowed without marketplace access. | Blocked accounts may use only explicit recovery/review routes; requests do not restore access or change state. |
| D-024 | Staff/admin identities are separate and least-privileged; initial super-admin provisioning is secure and controlled. | No public staff signup; bootstrap mechanism and operator procedure must be specified before deployment. |
| D-025 | Company suspension hides its catalogue and disables new company-scoped activity while preserving all records and audit history. | Does not block associated accounts; permitted sign-in/account-level functions, suspension status, and restricted review request remain available unless an account is independently blocked. |
| D-026 | File limits are configurable, private-file access is authorized and audited, and a retention policy is documented. | Do not invent size/type limits, retention periods, or temporary-link lifetime. |
| D-027 | Business permission confirmation is required to submit trade-worker contacts; each contact must separately opt in before becoming a public service-provider profile. | Release 1 stores contacts privately and never creates public profiles automatically; service-provider profiles remain deferred. |
| D-028 | Dealer discovery matches PIN code first, then locality, then district; optional GPS nearby fallback must be clearly labelled. | Do not invent search radius or coordinate/permission behavior. |
| D-029 | Registration fee collection is disabled in Release 1; retain future configurable-fee capability. | No Release 1 payment/fee collection or access gating. |
| D-030 | Company suspension does not revoke otherwise valid sessions; account blocking revokes active sessions and refresh tokens. | Backend checks current account/company state on every request. Restoration does not revive old tokens or clear an independent account block; re-authentication is required after account restoration. |
| D-031 | Company verification state (`PENDING/VERIFIED/REJECTED`), company activity (`ACTIVE/SUSPENDED`), account access (`ACTIVE/BLOCKED`), and authorized-dealer status are independent. | Rejected or activity-suspended companies are not catalogue eligible; neither state automatically blocks the owning account. |

## Requirements carried forward from the source document

| Requirement | Release 1 treatment |
|---|---|
| Company registration includes email verification. | Use configurable email verification before submitting a company verification case. |
| Business registration supplies at least ten associated trade-worker contacts (name, mobile, trade, optional location). | Store privately with the business profile and require ten at verification submission; business confirms permission to submit and every contact separately opts in before any later public service-provider profile. No Release 1 profile is auto-created. |

## Provisional recommendations

| ID | Recommendation | Reason / confirmation |
|---|---|---|
| R-001 | Shared `Account` table with immutable type enum and matching account subtype tables; deferred constraint trigger enforces exactly one subtype. `CompanyProfile` is the organization; `CompanyUserProfile` is the account subtype for company owners/representatives. | Provides one global unique mobile and prevents multiple roles without treating every representative as a separate company. Approve subtype enforcement approach. |
| R-002 | Normalize phone to E.164 and enforce a unique non-null DB column. | Prevents formatting variants from bypassing uniqueness; confirm country handling. |
| R-004 | Pending dealers do not appear in dealer discovery; only verified businesses with eligible listings appear. | Applies the confirmed rule that pending users cannot appear as verified dealers. |
| R-006 | Company owner alone appoints/revokes representatives in Release 1; representatives receive explicit `MANAGE_COMPANY_PROFILE`, `MANAGE_CATALOGUE`, and/or `MANAGE_AUTHORIZED_DEALERS` permissions. | Least privilege; confirm whether delegation of representative management is desired later. |
| R-007 | Active authorization requires a verified dealer business. | Avoids displaying authorized status for an unverified business; confirm if mapping may be recorded before verification. |
| R-008 | Use append-only audit events with real actor and explicit subject foreign keys; no application role may modify/delete them. | Preserves integrity. Audit retention duration and legal archival policy still require confirmation. |
| R-009 | Verified company-created product is immediately published unless staff moderation state blocks it; staff moderation is separate from product discontinued status. | Resolves publication and moderation state conflation. |
| R-010 | Monorepo layout is `apps/mobile`, `apps/admin`, `services/api`, and `docs`. | Keeps clients/API/docs together; directory remains proposed. |

## Open questions and blockers

1. **Phone normalization:** Which country/country-code input rules should registration accept before storing E.164?
2. **Restoration transitions:** Define exact post-restoration verification-state transitions. A review request never restores access; the approved token revocation/re-authentication behavior is documented in D-030.
3. **Staff operations:** Approve role bundles/separation-of-duty rules and specify the secure initial super-admin bootstrap operator/procedure.
4. **Representative governance:** Confirm owner-only appointment, permission delegation, and offboarding behavior beyond the approved one-company-per-account rule.
5. **Authorization verification:** Confirm whether grant creation requires dealer business verification and whether a grant may be recorded before verification.
6. **Catalogue price details:** Confirm currency, decimal precision, effective dates, and whether price history is immutable snapshots or version rows.
7. **File policy values:** Set allowed file types/sizes, retention periods, malware-scanning requirements, and temporary-link lifetime before upload implementation. Limits must be configurable; document the policy without assuming values.
8. **Audit retention:** Confirm retention duration, archival method, and legal purge requirements; audit records are immutable through normal application/admin workflows.
9. **Search details:** Specify exact/partial matching, sorting, no-result behavior, nearby radius, coordinate source, and GPS permission wording. PIN/locality/district priority and labelled fallback are confirmed.
10. **Registration fields/fee configuration:** Confirm mandatory launch fields. Fee collection is disabled in Release 1; future configurable fee amount/currency/timing remain unspecified until a later phase.
11. **Product taxonomy/duplicates:** Seed categories/brands, duplicate matching rules, and whether company product code/model uniqueness should be enforced within a brand/company scope.
12. **Trade-worker contacts:** Define business permission confirmation evidence, individual opt-in wording, contact correction/removal process, and retention. No public profile is created in Release 1.
13. **Dealer-suggested brands:** How is the verified company owner of a brand suggestion established? Recommendation: keep it non-canonical until a verified company claims/creates it or staff records ownership evidence.
14. **Company verification resubmission:** After a rejection, the current API requires staff review before a new verification submission. Define whether staff may reopen the case, or the owner may submit a corrected application directly.
15. **Conflict-of-interest identity:** The implementation denies same-account company self-review and resolves roles by separate immutable account types. It cannot identify a person using a separate staff mobile/account from the company owner's account; define a verifiable staff identity/conflict policy before relying on this control operationally.

The implementation plan gates work on architecture approval and on resolving operational specifications before dependent phases. Decisions about quotation/invoice tax, numbering, secure-link expiration/revocation, jobs, service-provider profile operation, and payments can wait for their later phases.
