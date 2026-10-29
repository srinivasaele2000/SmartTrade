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
| D-020 | Files have explicit owning-entity relationships and access control; audit history is retained. | No unprotected polymorphic file owner; append-only audit with a retention policy to be approved. |

## Requirements carried forward from the source document

| Requirement | Release 1 treatment |
|---|---|
| Company registration includes email verification. | Use configurable email verification before submitting a company verification case. |
| Business registration supplies at least ten associated trade-worker contacts (name, mobile, trade, optional location). | Store privately with the business profile and require ten at verification submission; this does not enable the deferred service-provider marketplace. |

## Provisional recommendations

| ID | Recommendation | Reason / confirmation |
|---|---|---|
| R-001 | Shared `Account` table with immutable type enum and matching account subtype tables; deferred constraint trigger enforces exactly one subtype. `CompanyProfile` is the organization; `CompanyUserProfile` is the account subtype for company owners/representatives. | Provides one global unique mobile and prevents multiple roles without treating every representative as a separate company. Approve subtype enforcement approach. |
| R-002 | Normalize phone to E.164 and enforce a unique non-null DB column. | Prevents formatting variants from bypassing uniqueness; confirm country handling. |
| R-003 | Product catalogue reads may be public; dealer browse requires login. | Original requirements do not require sign-in for product browsing. Confirm public product access. |
| R-004 | Pending dealers do not appear in dealer discovery; only verified businesses with eligible listings appear. | Avoids exposing incomplete business data. Confirm this visibility policy. |
| R-005 | Admin restoration requires a reason; rejected returns to pending for review, suspended returns to its recorded pre-suspension state (pending or verified), and existing sessions are invalidated. | Deterministic admin-only recovery proposal. Confirm before implementation. |
| R-006 | Company owner alone appoints/revokes representatives in Release 1; representatives receive explicit `MANAGE_COMPANY_PROFILE`, `MANAGE_CATALOGUE`, and/or `MANAGE_AUTHORIZED_DEALERS` permissions. | Least privilege; confirm whether delegation of representative management is desired later. |
| R-007 | Active authorization requires a verified dealer business. | Avoids displaying authorized status for an unverified business; confirm if mapping may be recorded before verification. |
| R-008 | Use append-only audit events with real actor and explicit subject foreign keys; no application role may modify/delete them. | Preserves integrity. Audit retention duration and legal archival policy still require confirmation. |
| R-009 | Verified company-created product is immediately published unless staff moderation state blocks it; staff moderation is separate from product discontinued status. | Resolves publication and moderation state conflation. |
| R-010 | Monorepo layout is `apps/mobile`, `apps/admin`, `services/api`, and `docs`. | Keeps clients/API/docs together; directory remains proposed. |
| R-011 | Limit each company-type account to one active company organization membership in Release 1; an owner is a membership role, not a separate account type. Revoked memberships remain historical. | Makes rejected/suspended organization state and account-wide blocking unambiguous. Confirm this limit before implementation. |

## Open questions and blockers

1. **Phone normalization:** Which country/country-code input rules should registration accept before storing E.164?
2. **Product browsing visibility:** Is public catalogue browsing acceptable, or must product search also require login? Dealer browsing login is confirmed.
3. **Restoration policy:** Confirm the recommended rejected/suspended recovery transitions and whether users can contact support through a non-authenticated route. No self-service restoration is proposed.
4. **Staff permission bundles:** Approve staff roles, separation of duties, and whether a platform admin may both decide verification and modify product moderation.
5. **Representative governance:** Confirm owner-only appointment, permissions, and whether representative delegation is allowed.
6. **Authorization verification:** Confirm whether grant creation requires dealer business verification, and whether authorization can be pre-recorded while a dealer is pending.
7. **Catalogue price details:** Confirm currency, decimal precision, effective dates, and whether price history is immutable snapshots or version rows.
8. **File policy:** Set allowed file types/sizes, replacement/deletion behavior, retention, malware scanning needs, and signed-link lifetime before upload implementation.
9. **Audit retention:** Confirm retention duration, archival method, and any legal purge requirements; records are immutable through normal application/admin workflows.
10. **Search behavior:** Exact vs partial PIN/area/district matching, sorting, no-result behavior, nearby radius, and location coordinate source.
11. **Registration fields/business fee:** Confirm mandatory launch fields and whether the PDF's minimal business/company registration fees are in Release 1. The stack and marketplace workflows do not define fee collection.
12. **Product taxonomy/duplicates:** Seed categories/brands, duplicate matching rules, and whether company product code/model uniqueness should be enforced within a brand/company scope.
13. **Organization membership cardinality and blocking:** The proposed Release 1 schema limits a company account to one active company membership. Confirm whether an account may own/represent multiple companies simultaneously. Multiple active memberships complicate the confirmed rule that rejected/suspended accounts are blocked, because it is unclear whether blocking one organization blocks every organization accessible through that account.
14. **Trade-worker contacts:** Confirm consent language, correction/removal process, and retention for the ten business registration contacts. They remain private and are not searchable in Release 1.
15. **Company suspension visibility:** Confirm whether products and active dealer authorization labels should be hidden from discovery while the owning company is rejected/suspended. The recommendation is to suppress them until company verification is restored, without changing moderation/grant history.
16. **Initial staff bootstrap:** How is the first `PLATFORM_ADMIN` account securely created before staff APIs exist? Recommend a one-time controlled bootstrap outside ordinary signup; do not add a public staff-registration route.
17. **Dealer-suggested brands:** How is the verified company owner of a brand suggestion established? Recommendation: keep it non-canonical until a verified company claims/creates it or staff records ownership evidence.

The implementation plan gates work on architecture approval and on resolving questions before their dependent phases. Decisions about quotation/invoice tax, numbering, secure-link expiration/revocation, jobs, service providers, and payments can wait for their later phases.
