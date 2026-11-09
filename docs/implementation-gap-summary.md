# Implementation gap summary

04-11-2026 IST. Read-only audit of the actual uncommitted repository against all 34 pages/42 sections of `docs/SmartTrade document.pdf`. This document supplements the row-level evidence in `requirements-implementation-matrix.md`; no implementation change is authorized or performed here.

## Package A implementation follow-up — 04-11-2026

The audit tables/counts below are retained as the **pre-fix baseline**, not recalculated current completion totals. Package A subsequently authorized only G01, G02 and G04. Their code fixes and automated acceptance checks now pass; see `package-a-implementation-report.md` for exact commands, evidence and device acceptance limits. Do not infer that the remaining invoice-content, onboarding or later-package gaps are fixed.

| Item | Current verified result | Remaining acceptance |
| --- | --- | --- |
| G01 | Same-origin/API-root file resolver replaces duplicate-prefix concatenation; real vault-adapter tests cover successful save, cached repeat, denied/empty/interrupted downloads and metadata failure. Backend ownership contract tests pass. | New APK built/signed; physical owner download/open/repeat remains untested pending phone access. |
| G02 | Explicit Asia/Kolkata helper used for financial year and PDF issue date; UTC persistence unchanged. Boundary and supplier/year sequence tests pass on disposable PostgreSQL. Existing issued records are untouched. | Physical/new-document business-date inspection not performed; do not regenerate old PDFs as a test. |
| G04 | Buyer/Dealer orders and enquiries now have Next/Previous/page/count, current-page retry, page-one refresh and immediate loading/race guards. Actual workspace component tests preserve selected details and unsaved fields across page changes. All four PostgreSQL history APIs pass >20-record pagination fixtures. | Current development data has only four enquiries/four orders, so page 2 cannot be tested on the phone without additional approved disposable records. No size change or live records were manufactured. |

Package A passed its automated checks. Its physical acceptance remains pending. The original matrix remains a dated audit snapshot.

## Package B implementation follow-up — 06-11-2026

G05 now has authenticated Personal profile storage and mobile editing. G06 now has dealer owner and registered address data, declarations, Other-brand review, private permission-backed contacts, and normalized duplicate review. The dedicated submission gate for ten contacts, business evidence, government verification and any new taxonomy proposal process remain separate work. Existing staff require a controlled grant for private contact review. Migrations passed in a disposable database and remain pending on development. Device acceptance is blocked because ADB detected no attached phone. The totals and gap rows below retain their 04-11-2026 audit baseline. See `package-b-implementation-report.md`.

## Totals and meaning

| Classification | Requirement groups |
| --- | ---: |
| Reviewed | **217** |
| Implemented at the stated narrow scope | **71** |
| Partially implemented | **40** |
| Missing | **40** |
| Explicitly deferred | **35** |
| Changed by a later decision | **29** |
| Unverified primary claims | **2** |

These are normalized requirement groups, not raw PDF bullet counts or a percentage of live end-to-end acceptance. Repeated examples/flow restatements map to the same functionality. A field's presence can be implemented while an entire registration journey remains partial. **71 implemented does not mean 71 freshly device-verified flows.** Every row distinguishes code/test inspection, fresh frontend tests, recorded historical execution and fresh read-only probes. The two Unverified rows concern iOS and measured business value; many other implemented rows still lack complete current device/reliability coverage.

The core platform is substantial: immutable account types; company verification state and separate activity/account restrictions; owned text catalogues/variants; explicit company brand authorization; multi-branch listings and INR stock/prices; protected discovery; enquiry quotation revisions/responses; order lifecycle; invoice generation primitives; and staff inspection/audit workflows. This is not evidence that the original full commercial specification is finished.

## All missing and partial requirement groups

The following list accounts for **every Missing/Partial row** in the matrix. Grouping does not create additional requirements or count a repeated reference twice. Severity describes delivery impact, not a claim of an exploited security vulnerability.

| Gap | Priority | Requirement IDs | Actual limitation and required outcome |
| --- | --- | --- | --- |
| G01 Mobile invoice retrieval | High, immediate | R135 | `InvoiceSerializer.get_download_url` returns `/api/v1/orders/{id}/invoice/download`; `OrderWorkspace.downloadInvoice` passes `api.base + download_url`, while api.base already ends `/api/v1`. This constructs a non-existent duplicate-prefix route. `local-files.ts` forwards the URL without repair. Fix contract composition and verify an owner-session download, durable save and share without weakening authorization. |
| G02 India invoice dates/FY | High, immediate | R137 | `orders.views.fy` uses `timezone.localtime(now)` with project TIME_ZONE=UTC. `orders/pdf.py` formats issued_at without explicit IST conversion. A read-only source-function probe maps 2026-03-31 20:00 UTC (01-04-2026 01:30 IST) to FY 2025-26 instead of the function's April-start India FY 2026-27. UTC storage is correct; business-calendar selection/display needs explicit IST. No invoice was created to reproduce this. |
| G03 Invoice content/layout | High before client commercial use | R065, R140, R141, R143, R145, R146, R151, R152, R153 | Supplier address, full buyer details, brand, description, terms and manual payment-status field absent; product code exists in snapshot but is not printed. PDF renderer uses one page and unwrapped drawString calls, with no overflow/page break handling. Tax amounts/HSN/discount inputs do exist; do not report them missing. Complete immutable document data and layout, then visually verify long/multi-item invoices. A PDF signature/header test is insufficient. Statutory/legal suitability is not established by this audit. |
| G04 Incomplete mobile histories | Medium, immediate integration | R206, R207 | OrderWorkspace requests page 1 and has no pagination controls. EnquiryWorkspace has a page state but never calls its setter or renders next/previous controls. Records beyond the first API page cannot be reached through these screens. Backend/admin pagination is not a substitute. |
| G05 Personal onboarding/profile | High source-scope gap | R011, R014, R015, R016 | PersonalProfile holds only its account relationship. Full name, occupation, profile PIN/locality/district/state lack API storage and mobile profile screens. Login/mobile uniqueness are implemented. This also prevents complete named quotation/invoice recipients. |
| G06 Dealer onboarding/evidence | High source-scope gap | R038, R040, R041, R042, R043, R044, R045, R046, R047, R048, R050, R051, R052, R053, R069 | Business name, registration string, optional GSTIN/PAN and branch addresses exist, including mobile GSTIN/PAN fields. Business owner name, organization email/address completeness, declared categories/brands, Other-brand suggestions/review, ten consent-backed private trade-worker contacts, business-document submission/case and robust duplicate identity checking do not. Staff can change verification status after a name check, but that does not prove the originally required evidence was collected. Company grants are not dealer brand declarations. |
| G07 Safe buyer dealer details | Medium | R031, R032, R033 | Buyer sees branch identity/address/price/stock, but no separately consented public contact/action or explicit verified/authorized badge. Private contact fields are correctly excluded. Add only an approved public-contact projection; never expose private stored contacts to fill this gap. |
| G08 Geographic discovery | Optional, decision-dependent | R029, R035 | PIN/locality/district matching and labelled fallbacks work. No GPS coordinates, distance computation or true nearby suggestions. GPS is optional under current decisions, so this is not a current-login blocker. Radius, coordinates and consent wording remain unspecified. |
| G09 Original dealer quotation workflow | High, substantial scope | R058, R060, R061, R062, R064, R116, R117, R119, R120, R121, R122, R125, R126, R128, R129, R130, R133 | Current dealer quotes answer a buyer enquiry; there is no proactive dealer catalogue-cart/customer drafting workflow. No quotation PDF/download/share, structured source list-price/discount/HSN/GST, complete supplier/customer document identity, dedicated quotation number or terms snapshot. Notes are not a complete commercial document. Existing unit prices, quantities, totals, revision acceptance/rejection/expiry are implemented. Guest access remains separately deferred. |
| G10 Catalogue metadata/reference | Medium, decision-dependent | R072, R076, R077, R078 | Variant SKU/name/attributes do not provide a distinct model-number contract; Product lacks typed HSN/GST metadata and catalogue-PDF/reference binding. Generic specifications must not be treated as validated tax configuration. No shared image/PDF pipeline should be added against the local-only decision. |
| G11 Company registration completeness | Medium | R085, R089, R092, R094, R096, R100 | Logo missing; brands appear after verification, not initial registration. Registration detail evidence, public/role-specific contact policy, GST evidence and mandatory-field completion differ from PDF. Address/authorized-person/website/GSTIN/PAN are supported fields, not missing. Optional tax identifiers are intentional; required applicability must be decided before adding gates. |
| G12 Duplicate identification/review | Medium | R081, R098, R113 | Product code uniqueness is per brand-category pair; brand-name uniqueness is per company; one company per account does not prevent the same company across other accounts. No cross-category product candidate review, canonical company/brand conflict workflow or safe resolution process. Do not invent global legal-name uniqueness or auto-merge records. |
| G13 Admin scope/reporting | Medium | R161, R163, R170, R174, R175, R176 | No general Personal/account user-management directory/block/restore UI/API; company pages center on pending cases/review requests rather than complete lifecycle directory. No canonical HSN administration. Overview is health/workflow links; required account totals/reports/export analytics are not implemented by paginated inspection lists. Business decisions, category management, product moderation and commercial inspection do exist. |
| G14 Local notifications | Medium, optional delivery design | R178, R180, R181, R192 | No in-app notification records/inbox/read-state/service for approvals, catalogue/availability, quotation and invoice events. Reading refreshed status is not a notification system. External SMS/email/push integration is deliberately parked; a local in-app design must remain provider-independent. |
| G15 Original complete journeys | High acceptance gap, not a new module | R193, R194, R196 | Original Personal and dealer flows still contain the gaps above. Existing accepted-order state does not prove purchase/payment/fulfilment; original dealer-created cart/quote flow differs from implemented enquiry flow. Track journey acceptance explicitly after underlying work, without building a payment gateway. |

## Important technical and policy limitations beyond the original row counts

### T01 — Local-only evidence versus company verification

The Phase 8 decision is implemented in mobile: selected company/dealer documents and product images remain on that individual device. `CompanyScreen` no longer uploads them. The backend submission gate still requires configured `CompanyDocument` evidence; the admin correctly cannot inspect phone-only files. A new company with only locally selected documents cannot complete that original evidence-to-admin journey through the mobile app. Historical Phase 1 upload/approval success predates this policy and is not proof of a current local-only end-to-end flow.

This is a **deliberate policy tradeoff requiring a decision**, not grounds to silently restore uploads/cloud storage or fabricate review evidence. Any local demonstration/evidence-inspection mechanism must be explicitly scoped, consented and audited. Already verified controlled accounts can exercise later modules; that does not prove fresh onboarding.

Legacy backend company-file records and authorized APIs remain. `orders.Invoice.pdf` stores generated PDF bytes in PostgreSQL, and mobile downloads a copy. Therefore “all file bytes exist exclusively on phones” is not true for existing/generated backend data. Current no-cloud/mobile-selected-file policy is narrower; clarify whether Phase 8's stronger exclusivity wording is still intended. No data should be purged to reconcile wording.

### T02 — Quotation identity is not fully frozen

Quotation item quantities/prices are immutable through PostgreSQL triggers and revisions are append-only in content. However, serializers resolve product names/SKUs and dealer/branch names through current foreign keys. `BuyerOrders.post` snapshots catalogue identity at **order creation**, rather than copying a frozen identity captured when the quotation was sent/accepted. A catalogue/profile edit between issue/acceptance and order creation can therefore alter the displayed/copied commercial identity. Audit snapshots record historic responses but normal read/order paths do not use them. This is a code-established integrity risk; no live records were renamed to reproduce it. Add an isolated regression before a future fix.

### T03 — Current verification coverage is incomplete

Stage E records blocked device credential clearing after definitive refresh rejection, force-close document persistence and missing/invalid/size/access/low-space fault scenarios. API invalid/revoked-token denial and Company/Dealer outage retention/recovery have evidence; they do not close all on-device storage/revocation tests. The Pixel emulator still had repeated system ANRs during the button redesign; the physical phone's signed APK/catalogue/Company navigation was observed working. iOS has no build/device evidence.

The current invoice tests cover a response/PDF header and calculations, not all original fields or multipage/IST boundaries. Mobile order tests do not exercise the real invoice URL-to-vault path. Passing suites did not detect G01/G02; test counts are not requirements coverage.

### T04 — Planned architecture routes are not implemented contracts

`docs/api-specification.md`, `database-design.md`, `implementation-plan.md` and `decisions.md` contain stale planned routes/subtypes/representative delegation/contact collection and old environment statements. For example, generic `/me/business-profile` or planned trade-worker endpoints are not the actual `/businesses/me` implementation. Company owner is the only implemented company actor; multiple representatives/delegated permissions described in earlier architecture have no working membership model/API/UI. Account-level recovery/review for an independently blocked account is not implemented by company review requests, which require an active account. These are later architecture obligations, not requirements secretly verified by documentation.

### T05 — Operational readiness is not established

Backend source uses PostgreSQL constraints/triggers, JWT token version checks, least-privilege intended app role and fail-closed development simulations. This audit did not inspect live secret values, change roles, inspect business records, run migrations or run DB-mutating backend suites. Previous preflight found PostgreSQL wildcard listeners; network isolation and production security require their own approved review. No production server/cloud/provider readiness is claimed. Local file recovery/retention/backup and operational limits remain unresolved; do not invent values.

## Changed requirements and decision conflicts

**All 29 Changed rows:** R001, R003, R004, R010, R013, R017, R023, R034, R039, R049, R063, R080, R088, R093, R095, R097, R102, R103, R109, R114, R124, R134, R142, R165, R166, R168, R169, R191, R195.

| Decision family | Original versus current treatment |
| --- | --- |
| Roles | Six marketplace types in PDF versus four current core roles including separate Platform Admin; provider/jobs/employer features deferred. |
| Fees | Dealer/company minimal fees disabled; no fee collection or access gate in current release. |
| Catalogue/discovery | Public catalogue; authenticated dealer discovery. PIN-first/locality/district; GPS optional. No-results copy avoids falsely asserting universal inventory absence. |
| Ownership/publication | One verified owning company per brand; separate dealer selling price/stock; brand-scoped company-confirmed grants; immediate eligible company publication with staff moderation rather than universal preapproval. |
| Verification | Local-only phone/email simulations do not verify ownership; tax identifiers optional where applicable, not forced for all organizations. |
| Worker contacts | Minimum requirement moved to business verification submission with permission/individual opt-in controls; private collection is still missing, while public service-provider creation is deferred. |
| Commercial flow | Approved quotation leads through buyer order and dealer confirmation before invoice, not direct dealer conversion. Phases 6/7 authorize these features despite old Release 1 documents still calling them future. |
| Files | Company documents/images/catalogue PDFs are no longer automatically shared/uploaded by mobile; local copies do not satisfy staff evidence or appear cross-device. Historical/backend-generated files still exist. |

India-only/INR-only are later constraints, not a reason to implement multiple currencies or foreign addressing. PostgreSQL is an allowed source-PDF alternative, so not supporting MySQL is not a gap. Android status tracking/order histories were brought forward from PDF future enhancements; their actual current coverage is reported rather than reflexively deferred.

## Deliberate deferrals, not implementation defects

The matrix's **35 Deferred rows** cover service-provider/jobs/employer modules and their admin/report/notification functions; real OTP/external notification delivery; optional commercial hosting/monetization/premium/promotion offerings; cloud hosting; payments; WhatsApp quotation integration; ratings; advanced stock/inventory; procurement purchase orders; delivery tracking; translations; AI; ERP/GST-portal/company-system integrations; advanced analytics/automated dealer management.

Source §39/§40 future-phase labels do not authorize those features now. Guest quotation links are additionally deferred by D-011 and have no implemented model/token/route/UI. A missing **manual invoice payment-status field** (R151) is not automatically deferred just because payment gateways are deferred; decide that narrow scope explicitly. Likewise, basic required reports and private worker contacts are not excused by advanced-analytics/service-provider deferral.

## Five highest-priority next gaps

1. **Restore the real mobile invoice download journey (G01)** and add a URL-to-vault regression; small, immediately user-visible integration fix.
2. **Correct India invoice business dates/FY and complete issued document data/layout (G02/G03)** before treating invoices as client-ready. Preserve issued records and obtain required policy/legal review separately.
3. **Complete Personal/dealer onboarding and genuine manual verification prerequisites (G05/G06)** so existing status APIs are backed by the required information/evidence and the commercial recipient model is usable.
4. **Resolve the local-only company evidence decision (T01)** before claiming fresh Company onboarding works end to end. This is a policy gate, not permission for remote uploads.
5. **Complete the dealer quotation workflow and freeze commercial identity (G09/T02)**, including deliberate cart/discount/HSN/terms/numbering/PDF contracts and registered-customer delivery. Guest links/external sharing stay parked.

Mobile history pagination is a small adjacent integration fix worth scheduling with item 1. Optional GPS and future marketplaces are lower priority and require separate approval.

## Actual checks in this audit

- Read/extracted all 34 PDF pages and inspected four rendered sheets; inspected backend apps/models/routes/serializers/views/migrations/tests, mobile screens/clients/tests, admin screens/navigation/tests and relevant dated reports.
- Fresh: `npm test` mobile **97 passed / 0 skipped**, admin **25 passed / 0 skipped**; `npm run typecheck` passed in both apps. Headless tests are not live user journeys.
- Read-only HTTP: health 200; malformed constructed invoice route `/api/v1/api/v1/orders/1/invoice/download` returned 404; correct anonymous route returned 401. No authenticated invoice contents fetched and no login/token mutation.
- Read-only exact-function probe: `fy(2026-03-31T20:00:00Z)` returned `2025-26` under the project's UTC default; India calendar interpretation is `2026-27`. No business record or database was touched.
- No fresh PostgreSQL suites, migration commands, builds, device interactions, provider setup, account provisioning, schema/config changes or production access. Historical passes remain historical. Only requested audit documents are final deliverables.
- Document validation: 217 unique sequential requirement IDs, all 42 source-section crosswalk entries, consistent category totals, all 80 Missing/Partial IDs covered in the gap table, valid table columns/code fences and no trailing-whitespace errors. New files were checked using no-index diff against NUL; exit 1 denotes differing content in that mode, not a whitespace defect.

### Package A phone follow-up - 05-11-2026

Signed APK update/launch and USB API forwarding passed on physical phone 5e106900. Public catalogue calls returned 200; development OTP request returned 202. Saved credentials were already rejected (me/refresh 401). Android UI inspection could not reach idle state and Buyer login did not complete; invoice open/repeat and Company session restoration remain blocked/unverified. No business records changed. Automated passes are not completed device acceptance. See the Package A implementation report.
