# Original requirements versus current implementation

Audit date: 04-11-2026 IST. Source: `docs/SmartTrade document.pdf`, **34 physical PDF pages, 42 numbered sections**. Page numbers below are PDF page indices starting at 1, not section numbers. All pages were text-extracted and visually checked in four rendered inspection sheets; the source has no embedded images. No application, configuration, schema or business-data changes were made.

## How to read this matrix

The 04-11-2026 rows and totals below preserve the original audit. The following Package B entries supersede the earlier implementation descriptions for these requirement IDs. They describe code and automated verification on 06-11-2026. Both migrations are pending on the development database, and the physical device was unavailable. See `package-b-implementation-report.md` for the verification boundary.

| Requirement IDs | Package B status | Evidence and residual scope |
| --- | --- | --- |
| R011, R014–R016 | Implemented for profile editing | Personal profile API and mobile form. Mandatory onboarding completion remains a separate decision. |
| R017 | Changed | Manual location fields are supported. Optional GPS remains unimplemented. |
| R038, R041, R042 | Implemented for profile editing | Dealer owner, business email and separately registered address. Branches retain their existing operational data. |
| R039, R040, R050–R052 | Changed or partial | GSTIN/PAN and registration reference retain optional format validation. Evidence submission and completeness gating remain outside Package B. |
| R043–R045, R069 | Implemented | Multi-select dealer declarations and catalogue-linked brand selection. Dealer declarations and company grants remain separate. |
| R046–R047 | Implemented for suggestion review | Staff approve for follow-up, reject, or map with a reason. Canonical ownership and brand creation follow the existing company process. |
| R048–R049 | Partial under changed timing policy | Private permission-backed contact management and minimum-count progress exist. Minimum enforcement awaits the dealer verification submission workflow. |
| R053 | Implemented for non-blocking review | Normalized identity candidates and auditable staff decisions. Existing login uniqueness remains enforced. |

The rows are **normalized requirement groups**, not a count of every repeated sentence/bullet. Related fields with the same outcome are named together. Repeated objectives, examples, module lists and flow diagrams cross-reference the same requirements rather than inflating completion counts. Example commercial brands are illustrations, not an instruction to seed those companies into the database. Every source section is covered in the crosswalk at the end.

Each row has one primary classification:

- **Implemented**: inspected code covers the stated narrow requirement and has relevant test/source or recorded execution evidence. This means implemented at the audited granularity; it is **not** a claim that every path was freshly exercised end to end.
- **Partial**: some functionality exists, but a stated field, workflow, client integration, validation or verification coverage is incomplete.
- **Missing**: no matching functional implementation was found. A planned endpoint/table in prose does not qualify.
- **Deferred**: explicitly future scope in the PDF or later approved decisions. Not an implementation defect or authorization to build it now.
- **Changed**: a later decision replaces the original behavior. The row describes what actually exists and any residual limitation; it is not also counted as a defect category.
- **Unverified**: the claim cannot be established from code/tests or the available runtime evidence; no unsupported pass is inferred.

Evidence suffixes: **K** = code/migration/test-source inspection only; **F** = fresh read-only frontend tests/typechecks in this audit; **H** = historical live/automated evidence, not repeated; **P** = fresh isolated read-only probe. Absence claims are based on inspecting installed apps, models, routes, serializers and the relevant clients, not merely searching documentation.

| Reviewed groups | Implemented | Partial | Missing | Deferred | Changed | Unverified |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 217 | 71 | 40 | 40 | 35 | 29 | 2 |

## Evidence and code registry

All API paths below are relative to `/api/v1`; route prefixes were checked in `services/api/config/urls.py`.

| Key | Actual implementation and supporting evidence |
| --- | --- |
| AC | `services/api/accounts/{models,serializers,views,authentication,dev_auth,dev_otp,urls}.py`; migrations 0001–0003; `apps/mobile/src/{AuthScreen,auth,session,session-recovery}.tsx/.ts` (actual extensions as present). Tests: `accounts/tests.py` uniqueness, immutable type, blocked login/logout; `test_dev_auth.py`, `test_dev_otp.py`, `test_dev_provisioning.py`. K; F auth/session client tests; H Stage A/E. PersonalProfile has only its account FK. |
| CO | `services/api/companies/{models,serializers,views,permissions,email_verification,urls}.py`, migrations 0001–0003; mobile `CompanyScreen.tsx`, `company.ts`; admin `App.tsx`, `ReviewRequests.tsx`. `companies/tests.py`: missing documents, file signature/type/size, staff decision reason, ownership, suspension, audit, simulation boundaries; `test_mobile_context.py`. K/F; H `company-phase1-validation.md`, Stage A/B/E, with the later Phase 8 file-policy override. |
| CAT | `services/api/catalogue/{models,serializers,views,urls}.py`, migrations 0001–0005; mobile `App.tsx`, `CompanyCatalogue.tsx`, `company-catalogue.ts`; admin `Catalogue.tsx`, `CatalogueTools.tsx`. `catalogue/tests.py`: search/filters, owned writes, duplicate SKU, direct DB guards, archive, moderation/audit. K/F; H Phase 2/5 validation and real phone screenshots in `docs/evidence/button-redesign`. |
| DE | `services/api/dealers/{models,serializers,views,urls}.py`, migrations 0001–0003; mobile `DealerWorkspace.tsx`, `CompanyAuthorizations.tsx`, `dealer.ts`, `company-authorizations.ts`; admin `Dealers.tsx`, `Authorizations.tsx`, `ListingAudit.tsx`. `dealers/tests.py`: multibranch privacy, grants, revocation, suspension, ownership, PIN validation, uniqueness, publication; `test_mobile_workspace.py`. K/F; H Phase 3/4/5 and Stage A/B. |
| EQ | `services/api/enquiries/{models,serializers,views,urls}.py`, migration 0001; mobile `EnquiryWorkspace.tsx`, `enquiries.ts`; admin `Enquiries.tsx`. `enquiries/tests.py`: multi-item revision/reject/accept, expiry, quantities/INR, ownership, eligibility, append-only audit. K/F; H Stage A existing-record journeys. No quotation PDF renderer, cart model or quotation-specific discount/tax fields. |
| OR | `services/api/orders/{models,serializers,views,pdf,urls}.py`, migrations 0001–0002; mobile `OrderWorkspace.tsx`, `orders.ts`; admin `Orders.tsx`. `orders/tests.py`: immutable order snapshots, transitions, duplicate prevention, tax/bill-of-supply, PDF response, unauthorized access. K/F; H Stage A download API and existing order inspection. Fresh P confirms duplicate-prefix download URL is 404 and FY boundary calculation is UTC-based. |
| LF | `apps/mobile/src/{LocalFileVault.tsx,local-files.ts,local-file-model.ts,session.tsx,session-recovery.ts}`; tests `local-files.test.mjs`, `session-recovery.test.mjs`; `docs/phase8-local-storage-readiness.md`, Stage C/D/E. K/F/H. Files are app-private; metadata is separate; no automatic upload. Stage E restart/storage-failure cases remain blocked. |
| ADM | `apps/admin/src/{App,ReviewRequests,Catalogue,CatalogueTools,Dealers,Authorizations,ListingAudit,Enquiries,Orders,AuditHistory}.tsx`, `navigation.ts`; tests `integration`, `stage-b`, `company-actions`, `india` and auth test files. K/F/H. Audit hub has three sources, not a complete platform log; Overview is workflow/health navigation, not analytics. |
| DEC | `docs/decisions.md` D-001–D-031 and later user-approved India-only, development-provider policy, Phases 6/7/8, local-file policy. Older prose still describing quotations as future or PostgreSQL as unavailable is stale; current source and dated validation take precedence. No external integration is authorized by this audit. |
| RUN | Fresh mobile: 97 tests passed, zero skipped; admin: 25 passed, zero skipped; both `npm run typecheck` passed. Test commands used Node tests and `tsc --noEmit` only. No backend DB tests/migrations were run because this audit must not create/drop/modify databases. Historical Stage B reports 164 PostgreSQL tests, not a new run. GET health 200, doubled invoice URL 404, correct anonymous invoice route 401. No staff/customer login or authenticated data mutation was performed. |

## Requirement matrix

| ID | PDF section; page | Original requirement | Status | Actual code / screen / API and evidence | Remaining work / decision |
| --- | --- | --- | --- | --- | --- |
| R001 | 1–2,42; 1–2,33–34 | Connect customers, dealers, companies, service providers, job seekers and employers | Changed | AC AccountType is PERSONAL/BUSINESS/COMPANY/STAFF; DEC four-role scope, K | Provider/jobs ecosystem explicitly deferred; keep core roles |
| R002 | 2.1,4.1,34; 2–3,25 | Free Personal registration | Implemented | AC POST /auth/register; no fee gate; K/F/H | No payment prerequisite |
| R003 | 2.2,7,34; 2,6,25 | Minimal dealer registration fee | Changed | DEC D-029 disables fees; AC has no fee collection; K | Future fee policy only after explicit approval |
| R004 | 2.3,34; 2,26 | Nominal company registration/service fee | Changed | DEC D-029; /auth/register and /companies/register have no fee gate; K | Do not treat disabled billing as a defect |
| R005 | 2.4; 2 | Paid service-provider registration | Deferred | DEC D-009; no service-provider subtype/routes; K | Await explicit scope/consent approval |
| R006 | 2.5; 2 | Paid job-seeker registration | Deferred | DEC D-009; no job-seeker subtype/routes; K | No jobs work authorized |
| R007 | 2.6; 2 | Employer registration/user capability | Deferred | DEC D-009; no employer subtype/routes; K | No recruitment work authorized |
| R008 | 2.3,12,16; 2,10,13 | Companies maintain official company-owned catalogues | Implemented | CAT Brand.company, Product.brand_category, owner-scoped writes; K/F/H | Continue ownership enforcement |
| R009 | 1,7,15; 1,6,12 | Support electrical, plumbing, cement, iron/steel, hardware, paints, construction and related categories | Implemented | CAT generic Category/BrandCategory and admin taxonomy CRUD; K/F/H | Approved launch taxonomy data not certified; examples are not mandatory seed records |
| R010 | 3,12,16; 2–3,10,13 | Catalogue availability to Personal/business registered users | Changed | CAT public AllowAny catalogue; DEC D-022; K/F/H | Public catalogue is approved; discovery stays authenticated |
| R011 | 4.2; 3 | Personal full name | Missing | AC PersonalProfile has no name field; AuthScreen registers mobile/type only; K | Define profile capture/API/UI |
| R012 | 4.2–4.3; 3–4 | Unique mobile number | Implemented | AC mobile_e164 unique; account_indian_mobile DB constraint; uniqueness tests K/F/H | Canonical Indian +91 only |
| R013 | 4.2–4.3,7,10,17; 3–4,6,9,14 | Mandatory real mobile OTP verification | Changed | AC DEBUG/loopback development OTP, phone remains unverified; K/F/H | Real delivery/ownership verification intentionally parked |
| R014 | 4.2; 3 | Personal occupation/profession | Missing | AC no Personal profile attribute or mobile form; K | Add only after required-field policy agreed |
| R015 | 4.2; 3 | Personal profile PIN code | Missing | AC no stored Personal PIN; discovery PIN input is not a profile; K | Add profile field and India validation |
| R016 | 4.2; 3 | Personal area, district and state | Missing | AC PersonalProfile only account FK; K | Profile storage/form/read/edit missing |
| R017 | 4.2,5; 3–4 | Personal location capture | Changed | DEC D-006 makes GPS optional; no geolocation client/model; K | Define whether non-GPS profile location is required; do not force GPS |
| R018 | 4.3; 3–4 | Duplicate account registration prevention | Implemented | AC DB uniqueness and registration conflict response; K/F/H | Same person across separate mobiles is not deduplicated |
| R019 | 3,5; 3–4 | Product-name search | Implemented | CAT GET /catalogue/products?search=; App CatalogueScreen; tests K/F/H | No full-text relevance promise |
| R020 | 3,5; 3–4 | Search product code/model/SKU | Implemented | CAT search covers code and active variant SKU/name; K/F/H | Separate model-number metadata assessed at R072 |
| R021 | 5; 4 | Brand search/filter/browse | Implemented | CAT /catalogue/brands and product brand filter, App selectors; K/F/H | None for stated filter behavior |
| R022 | 5; 4 | Category-wise product browse | Implemented | CAT /catalogue/categories and product category filter; K/F/H | None for stated filter behavior |
| R023 | 3,5; 3–4 | Customers view product images | Changed | LF private product-image attachments; App public product UI has no shared images; K/F, DEC Phase 8 | Shared image delivery unavailable under current policy |
| R024 | 3,5; 3–4 | Company/brand catalogue information | Implemented | CAT public company_name/brand_name/category, ProductScreen; K/F/H | Full public company profile is separate |
| R025 | 3,5; 3–4 | Product description/specifications | Implemented | CAT Product.description/specifications and detail screen; K/F/H | None for text details |
| R026 | 3,5; 3–4 | Applicable catalogue/list price | Implemented | CAT catalogue_price/currency; explicit unavailable-price state and INR display; K/F/H | Commercial price history/rounding policy beyond snapshots remains open |
| R027 | 3,5,22; 3–5,17 | Search dealers by PIN | Implemented | DE /dealers/listings pin_code validation and PIN-first matching; K/F/H Stage B live 400/200 | Discovery is login-required |
| R028 | 3,5,22; 3–5,17 | Search dealers by locality/area and district | Implemented | DE fallback order PIN→locality→district with match_level; K/F/H | No distance inference |
| R029 | 5,22; 4,17 | GPS/location/distance-based dealer discovery | Missing | DE no coordinates/distance calculation; optional GPS in DEC; K | Optional feature, not a required-login/location blocker; approve radius/consent first |
| R030 | 3,5,22; 3–5,17 | Dealer/shop identity and public branch address/location/PIN | Implemented | DE DiscoverySerializer.branch projection; App DealerResults; K/F/H | Branch-specific results, not private owner data |
| R031 | 3,5,22; 3,5,17 | Show permitted dealer contact number and contact action | Missing | DE deliberately excludes private contact_phone/email; no consented public-contact field/action in App; K/F | Define opt-in public contact policy; never expose existing private fields |
| R032 | 5,22; 5,17 | Display dealer verification status to buyer | Partial | DE eligibility requires verified business, but buyer result lacks explicit verification badge/state; K/F/H | Return safe status projection and label it |
| R033 | 5,19,22; 5,15,17 | Display company-confirmed authorized-dealer status to buyer | Partial | DE grant filters protect results; Company/Dealer show grants, buyer view lacks explicit badge; K/F | Expose scoped confirmation safely rather than infer badge from every business |
| R034 | 5; 5 | Explain product unavailability in selected location | Changed | App says no eligible listings matched, not that all inventory is unavailable; K/F | Preserve accurate distinction between no results and out-of-stock |
| R035 | 5; 5 | Optional nearby-location suggestions | Partial | DE locality/district fallback is labelled, no geographic proximity or nearby radius; K/F/H | Do not call fallback physically nearby without distance data |
| R036 | 6; 5–6 | Dealer can work across multiple manufacturer catalogues | Implemented | CAT canonical products; DE independent brand grants/listings; K/F/H | No duplication of manufacturer products |
| R037 | 7.1; 6 | Business name | Implemented | AC BusinessProfile.legal_name; DE /businesses/me and Dealer Profile; K/F/H | Verification requires legal name |
| R038 | 7.1; 6 | Business owner/authorized-person name | Missing | BusinessProfile lacks this field; branch contact_name is not business owner identity; K | Add reviewed business identity contract |
| R039 | 7.1; 6 | GST number required for every business | Changed | GSTIN/PAN supported but optional and format-validated in DE/mobile; India policy avoids unjustified mandatory GST; K/F | Confirm applicable-required conditions; no assumed GST registration |
| R040 | 7.1; 6 | Trade license/firm/applicable license number | Partial | BusinessProfile.registration_number is editable optional free text; K/F | Required applicability, type and evidence workflow not defined/enforced |
| R041 | 7.1; 6 | Business email address | Partial | DealerLocation.contact_email exists privately; no business-level email field/registration form; K | Decide organization vs branch contact ownership |
| R042 | 7.1; 6 | Business address, PIN, area, district and state | Partial | DE branch addresses validated; initial business registration does not require an address/branch; K/F/H | Define primary/registered address and onboarding completion |
| R043 | 7.1,8; 6–7 | Select business categories at registration | Missing | No business-category relationship or registration selector; K | Reuse canonical taxonomy after business policy approval |
| R044 | 8; 7 | Select multiple brands the dealer sells | Missing | Company authorization grants are not dealer-declared brand selections; K | Separate declaration from company authorization |
| R045 | 8; 7 | Show available brands for selected business category | Missing | CAT supports brand/category associations, but no dealer onboarding selector; K | Add client/contract without granting authorization |
| R046 | 8; 7 | Enter Other brand name | Missing | No dealer brand-suggestion entity/API/UI; K | Noncanonical suggestion only; prevent ownership bypass |
| R047 | 8; 8 | Admin reviews/verifies submitted unknown brands | Missing | No suggestions queue/state/audit workflow; K | Define verified company ownership before canonical creation |
| R048 | 9; 8–9 | Collect at least ten private trade-worker contacts: name, mobile, trade, optional area/location | Missing | No contact model, serializer, UI or submission count check; K | D-027 retains private collection with permission/consent; service-provider deferral does not defer these contacts |
| R049 | 9; 8–9 | Collect worker contacts during registration | Changed | DEC moves minimum validation to business verification submission and adds business permission confirmation/individual opt-in; K | Actual collection/submission mechanism still missing (R048) |
| R050 | 10,31; 9,23 | Validate business GST information | Partial | GSTIN shape checks plus staff business state decision; no dedicated evidence checklist/verification result; K | Manual evidence review, no external GST portal integration |
| R051 | 10,31; 9,23 | Validate trade/firm license | Partial | Optional registration string; no business-document submission/case/checklist; K | Local-only evidence decision needed before claiming verified documents |
| R052 | 10; 9 | Validate complete business registration information | Partial | Legal-name checks and branch/identifier validators exist; owner/email/categories/contacts absent; K/F | Completion rules and submission gate missing |
| R053 | 10; 9 | Prevent duplicate business registration | Partial | Mobile uniqueness only; no reviewed GST/license/identity duplicate matching; K | Avoid arbitrary legal-name uniqueness; define business dedupe scope |
| R054 | 10; 9 | Admin approve/reject business | Implemented | DE /staff/dealers/businesses/{id}/decision; reasons, permission and transition checks; K/F/H | Status operation exists; evidence completeness remains R050–052 |
| R055 | 10; 9 | Admin suspend/restore business | Implemented | Same DE decision API; retained data and audit; K/F/H | Account blocking is separate |
| R056 | 10; 9 | Maintain Pending/Verified/Rejected/Suspended business states | Implemented | AC BusinessProfile.verification_state; UI/server eligibility; K/F/H | No self-verification |
| R057 | 11; 9–10 | Dealer catalogue browse/search by brand/product code | Implemented | Shared public CAT APIs and authorized-product listing selector; K/F/H | Proactive quotation selection is not implemented by this selector |
| R058 | 11,23–24; 10,17–18 | Dealer selects company products into a cart | Missing | No cart model/API/dealer workspace; buyer enquiry draft is not a dealer cart; K/F | Design dealer cart without repurposing enquiry incorrectly |
| R059 | 11; 10 | Select quotation quantities | Implemented | EQ enquiry/quotation quantity input and validation; K/F/H | Reactive enquiry quotation flow only |
| R060 | 11,24; 10,18 | Apply discounts while preparing quotations | Missing | EQ QuotationItem has unit_price but no discount/list-price calculation; K | Explicit discount rules; invoice discount is not quotation discount |
| R061 | 11,24; 10,18–19 | Dealer creates quotation from chosen catalogue products | Partial | /businesses/me/enquiries/{id}/quotations responds to an existing buyer enquiry; K/F/H | No dealer-initiated quotation/customer draft flow |
| R062 | 11,24; 10,19 | Send/share quotation to customer | Partial | EQ registered buyer reads/replies in app; no PDF/native share/guest channel; K/F/H | PDF sharing missing; guest links explicitly later |
| R063 | 11,26; 10,20 | Convert customer-approved quotation directly to invoice | Changed | Phase 7 inserts buyer-created order and dealer confirmation before invoice; OR/EQ K/F/H | Preserve approved order lifecycle; do not bypass it |
| R064 | 11,25; 10,19 | Generate, download and share quotation PDF | Missing | No quotation PDF model/renderer/route; EQ/OR source contrast; K | Approved local generation/distribution contract required |
| R065 | 11,26; 10,20 | Generate usable PDF invoices | Partial | OR invoice_pdf exists; no page-break/wrapping handling and fields omitted; mobile URL defect; K/P/H | Complete document layout/content/download before sign-off |
| R066 | 11,21; 10,16–17 | Maintain product availability/status | Implemented | DE stock_status and eligible published listing projection; K/F/H | Availability is branch-specific |
| R067 | 11,21; 10,16–17 | Maintain stock quantity | Implemented | DE optional quantity with stock-consistency constraints; K/F/H | No reservations/automatic depletion implied |
| R068 | 11,21; 10,16–17 | Maintain dealer selling price | Implemented | DE selling_price, INR constraint, branch listing edits; K/F/H | Kept separate from company list price |
| R069 | 11; 10 | Dealer sees selected categories/brands | Partial | Dealer Authorization lists company grants, not own declared selections/categories; K/F | Complete R043–045 then show declarations separately |
| R070 | 13; 10–11 | Category → company/brand → product → model/variant → details hierarchy | Implemented | CAT Category, Brand, BrandCategory, Product, ProductVariant relationships; K/F/H | Image/PDF tail assessed separately |
| R071 | 14; 11 | Product name and product code | Implemented | CAT required name/code, serializers/company forms; K/F/H | Uniqueness limitations R081 |
| R072 | 14,18; 11,14 | Product model number | Partial | Variant SKU/name/attributes can represent models; no distinct structured model-number field; K/F | Clarify whether SKU/model mapping satisfies specification |
| R073 | 14,18; 11,14 | Product description and specifications | Implemented | CAT text/JSON fields, company edit, public detail; K/F/H | Schema for industry-specific attributes remains configurable |
| R074 | 14; 11 | Product unit | Implemented | CAT Product.unit and mobile forms/detail; K/F/H | No unit conversion implied |
| R075 | 14; 11 | Catalogue/list price storage | Implemented | CAT nullable price + INR/empty currency pairing; K/F/H | No price fabricated when absent |
| R076 | 14,18; 11,14 | Structured HSN code in canonical product | Missing | Product/Variant have no HSN field; invoice-only HSN entry is not catalogue support; K | Add explicit approved metadata contract later |
| R077 | 14,18; 11,14 | GST information/rate in canonical product | Missing | No canonical GST/tax metadata fields; invoice inputs independent; K | Never infer applicability or rates |
| R078 | 13–14; 11 | Catalogue PDF/reference associated with product/company catalogue | Missing | No catalogue-PDF entity/reference API or dedicated local catalogue-PDF UI; K | Define local-only reference use; no shared upload without approval |
| R079 | 14; 11 | Product lifecycle/status | Implemented | CAT DRAFT/PUBLISHED/ARCHIVED plus moderation state; K/F/H | Distinguish owner lifecycle from admin restriction |
| R080 | 14,21; 11,16 | Availability carried with product information | Changed | DEC separates canonical product from location-specific dealer availability; DE K/F/H | Correct approved ownership model; no company stock duplication |
| R081 | 14,20; 11,16 | Unique product code/model to reduce duplicates | Partial | Product unique per brand_category+code; variant SKU unique per product; K/H | Same brand/code across categories is possible; no fuzzy/global dedupe policy |
| R082 | 15,31; 12,23 | Admin adds/maintains categories | Implemented | /staff/catalogue/categories GET/POST and /{id} PATCH; Catalogue/CatalogueTools; K/F/H | Requires taxonomy permission, records audit |
| R083 | 16–17; 13–14 | Dedicated company registration/profile | Implemented | COMPANY account subtype plus /companies/register, /companies/me; K/F/H | No duplicate authentication system |
| R084 | 17; 13 | Company name | Implemented | CompanyProfile.legal_name/trading_name; company form; K/F/H | Legal name required |
| R085 | 17; 13 | Brand name supplied during company registration | Partial | Brands created in verified company catalogue, not initial registration; K/F/H | Approve onboarding sequence or add unverified declaration without canonical brand |
| R086 | 17; 13 | Company authorized-person name | Implemented | CompanyProfile.authorized_person_name and mobile field; K/F | Mandatory completeness assessed at R100 |
| R087 | 17; 13 | Company email | Implemented | company_email validated and email change resets verification; CO K/F/H | Simulated verification is separate R095 |
| R088 | 17; 13 | Company GST number mandatory | Changed | Optional GSTIN/PAN shape validation, India policy; CO K/F/H | Define applicable requirements rather than force GST for every company |
| R089 | 17; 13 | Company registration details | Partial | registration_number and tax_registration_number fields, legacy documents; CO K/F/H | Structured evidence/applicability and local-only submission limit remain |
| R090 | 17; 14 | Company address, PIN, area, district, state | Implemented | CO fields, Indian PIN/state validators, mobile edit; K/F/H | Supported fields; mandatory completeness R100 |
| R091 | 17; 14 | Optional company website | Implemented | CO URLField and mobile validation; K/F | None for stated field |
| R092 | 17; 14 | Company logo | Missing | No company-logo field, storage binding, local logo selector or display; K | Decide local-only meaning/public distribution before building |
| R093 | 17; 14 | Submit company documents to platform | Changed | Phase 8 LF device-only working copies; legacy CO private upload API remains; K/F/H | New phone-only files cannot satisfy staff evidence or submission requirements |
| R094 | 17; 14 | Company contact information | Partial | Owner mobile, company email and authorized-person field; no separate public/contact-role profile; K | Define required and disclosable contact details |
| R095 | 17; 14 | Verify company email ownership | Changed | CO DEBUG/loopback local simulation, real ownership flag not falsely set; K/F/H | Real email provider intentionally parked |
| R096 | 17; 14 | Verify GST where applicable | Partial | Shape validation and general manual company decision, no specific GST evidence outcome; K | Manual review contract; external GST verification deferred |
| R097 | 17; 14 | Admin verifies uploaded company/document evidence | Changed | Legacy CO staff claim/download/review works; device-only files never reach it; K/F/H | Resolve local evidence path explicitly; do not claim fresh local-only onboarding is complete |
| R098 | 17; 14 | Duplicate company/brand check | Partial | One company per owner; brand unique within company; no cross-account company/brand identity matching; K/H | Define canonical identity and dispute/review rules |
| R099 | 17; 14 | Pending, verified, rejected and suspended company status | Implemented | CO verification_state + separate activity_state; account block independent; K/F/H | Rejected resubmission remains staff-controlled |
| R100 | 17; 13–14 | Enforce required registration information | Partial | Legal name/email required; many PDF-required details optional; CO K/F | Reconcile applicability/required fields with approved optional tax identifiers |
| R101 | 18; 14–15 | Verified company adds/updates owned catalogue products | Implemented | CAT /companies/me/catalogue/products POST/PATCH, backend eligibility checks; K/F/H | No pending/suspended publication |
| R102 | 18; 14 | Add product images for catalogue distribution | Changed | LF private product attachments only; no public/shared image pipeline; K/F, DEC | Device images do not appear for buyers/admin |
| R103 | 18; 14 | Upload catalogue PDFs | Changed | Automatic/remote file flow disabled by Phase 8; no local catalogue PDF module either (R078); K | Storage policy supersedes upload; local reference feature still absent |
| R104 | 18; 14 | Update company catalogue/list prices | Implemented | CAT Product PATCH and audit snapshots; K/F/H | No dealer-price overwrite |
| R105 | 18; 15 | Deactivate discontinued products | Implemented | CAT ARCHIVED, inactive variants, retained records; tests K/F/H | Public eligibility excludes archived content |
| R106 | 18; 15 | Add/edit product variants/SKUs | Implemented | CAT product variants owner routes; duplicate SKU tests; K/F/H | SKU immutable scope product-specific |
| R107 | 18; 15 | Maintain catalogue version/update information | Implemented | updated_at + append-only CatalogueAudit snapshots; migrations and tests K/F/H | No full restore/version rollback UI promised |
| R108 | 19; 15 | Company manages authorized dealer mapping | Implemented | DE /companies/me/dealer-authorizations grant/revoke; company mobile; K/F/H | Company only, never dealer self-grant |
| R109 | 19; 15 | Product-level authorization hierarchy | Changed | DEC scope is company+brand+business; products/branches linked via listings; DE K/F/H | No new per-product grant layer required |
| R110 | 19; 15 | Link authorized dealers to locations and PIN/area/district | Implemented | DE business→locations→canonical product listings + scoped grant; K/F/H | Authorization is business/brand-wide, not separate branch grant |
| R111 | 19,35; 15,26–27 | Business verification, company verification and authorized dealer are distinct | Implemented | Separate BusinessProfile, CompanyProfile and AuthorizedDealerGrant; K/F/H | Buyer labels incomplete at R032–033 |
| R112 | 20; 16 | Dealers reference existing official products rather than clone them | Implemented | DE listing product/variant FKs; dealer cannot create catalogue; K/F/H | Company-side duplicate scope remains R081 |
| R113 | 20,31; 16,23 | Admin reviews potential duplicate products | Missing | Staff products searchable, but no duplicate-candidate/match/merge review workflow; K | Define matching/evidence; never destructive auto-merge |
| R114 | 22,37; 17,28 | Dealer discovery access | Changed | DEC D-013/D-022 explicitly requires login; DE IsActiveAccount; K/F/H | Public catalogue remains separate |
| R115 | 22,35; 17,26–27 | Discovery reflects genuine verified/company-confirmed dealer eligibility | Implemented | DE eligible_listings rechecks grant/company/business/branch/product/variant/account states; K/F/H | Explicit buyer status labels still R032–033 |
| R116 | 23; 17–18 | Dealer cart lines: image/name/code/description/brand/quantity/list price/discount/HSN/GST/final price/total | Missing | No dealer cart contract; buyer enquiry draft has different fields/purpose; K/F | Implement only after commercial field rules agreed |
| R117 | 24; 18–19 | Dealer reviews cart, generates quotation, shares with chosen customer | Partial | EQ handles dealer response to buyer enquiry, no proactive dealer cart/customer flow; K/F/H | R058/R060/R064 dependencies |
| R118 | 26,38; 20,31 | Customer accepts/rejects received quotation | Implemented | EQ /enquiries/{id}/response, latest revision/expiry checks; K/F/H | Registered PERSONAL buyer only; guest links separately deferred |
| R119 | 25; 19 | Quotation business/dealer identity | Partial | EnquirySerializer resolves current dealer name/branch; no immutable commercial identity snapshot; K/F | Preserve issued revision identity independently of catalogue/profile edits |
| R120 | 25; 19 | Quotation business address and GST number | Missing | Quotation/enquiry response does not supply document-ready supplier address/GST snapshot; K | Do not treat branch ID as printed business identity |
| R121 | 25; 19 | Quotation customer name and contact | Missing | Buyer FK only; PersonalProfile lacks name/contact profile and no recipient document snapshot; K | Define customer data/privacy and snapshot contract |
| R122 | 25; 19 | Quotation number | Partial | Integer revision ID + revision index, no dedicated displayed/document number; EQ K/F | Approve human-facing numbering policy |
| R123 | 25; 19 | Quotation date | Implemented | EQ created_at; mobile/admin IST helpers; K/F/H | Provider-free timestamps retained |
| R124 | 25; 19 | Product images on quotation | Changed | LF images private/device-only, no quotation renderer or shared images; K/F | Cannot promise cross-device quotation images |
| R125 | 25; 19 | Brand, product name/code/description on quotation | Partial | EQ item product_name/variant_sku; enquiry includes code; brand/description absent and identity resolves live FKs; K/F | Snapshot and render full accepted commercial description |
| R126 | 25; 19 | HSN on quotation | Missing | No QuotationItem HSN field; invoice-only entry exists; K | Explicit metadata, not inferred tax classification |
| R127 | 25; 19 | Item quantities on quotation | Implemented | EQ decimal positive quantities, every enquiry item once; K/F/H | None at this narrow requirement |
| R128 | 25; 19 | Catalogue/list price on quotation | Missing | EQ stores dealer unit_price, not source catalogue/list-price snapshot; K | Keep dealer price and list price distinct |
| R129 | 25; 19 | Discount percentage and amount on quotation | Missing | EQ no discount fields/calculation; K | Define rounding/discount base before implementation |
| R130 | 25; 19 | Taxable amount and GST on quotation | Missing | EQ total is quantity×unit_price only; no explicit tax config; K | No automatic assumed GST |
| R131 | 25; 19 | Final item price/line amount | Implemented | EQ explicit unit_price/currency and calculated line_total; K/F/H | Does not include absent discount/tax features |
| R132 | 25; 19 | Quotation total amount | Implemented | EQ Decimal line sum exposed as total; K/F/H | No tax-inclusive-total claim |
| R133 | 25; 19 | Quotation terms and conditions | Partial | dealer_notes free text exists; no dedicated terms snapshot/document template; K/F | Clarify notes-as-terms policy and rendering |
| R134 | 26; 20 | Dealer directly converts approved quotation to invoice | Changed | OR buyer order creation → dealer confirmation → invoice; later Phase 7 decision; K/F/H | Do not revert approved order ownership/transitions |
| R135 | 26; 20 | Customer receives/downloads/shares invoice PDF | Partial | OR correct private backend endpoint exists; mobile concatenates duplicate /api/v1; K/P/H | Fix URL composition and test real owner download/share; server response alone is insufficient |
| R136 | 27; 20 | Unique invoice number | Implemented | OR InvoiceSequence by business/FY and unique invoice_number; K/H | FY boundary defect remains R137 and gap summary G02 |
| R137 | 27; 20 | Correct invoice date/business date | Partial | pdf.py uses issued_at.strftime without IST conversion; fy uses default UTC; K/P | India midnight/FY boundaries need explicit Asia/Kolkata handling/tests |
| R138 | 27; 20 | Invoice supplier/business name | Implemented | OR immutable supplier_name snapshot and PDF; K/H | None for this field |
| R139 | 27; 20 | Invoice supplier GST number | Implemented | OR supplier_gstin snapshot, tax-invoice input checks and PDF; K/H | Format/config validation does not establish tax/legal eligibility |
| R140 | 27; 20 | Invoice business address | Missing | No supplier-address snapshot or PDF line; OR K | Add immutable address data with approved requirements |
| R141 | 27; 20 | Invoice customer details | Partial | buyer FK and buyer_gstin, no buyer name/address/contact snapshot or PDF details; K | Complete from approved profile/recipient contract |
| R142 | 27; 20 | Invoice product image | Changed | LF device-only image boundary; OR PDF has no image embedding; K | Requires explicit local-document image policy |
| R143 | 27; 20 | Invoice brand | Missing | OrderItem/tax snapshot/PDF have no brand field; K | Snapshot rather than resolve mutable catalogue |
| R144 | 27; 20 | Invoice product name | Implemented | OR OrderItem/product_name snapshot and PDF item line; K/H | Long-name wrapping still R065 |
| R145 | 27; 20 | Invoice product code | Partial | OrderItem and tax_snapshot retain code; invoice_pdf does not print it; K | Render immutable product_code in document |
| R146 | 27; 20 | Invoice product description | Missing | No immutable description field/printed line; K | Approve commercial description snapshot |
| R147 | 27; 21 | Invoice HSN | Implemented | Explicit InvoiceLine input, snapshot, PDF, tax-invoice checks; K/H | Supplier selects classification; no inferred HSN |
| R148 | 27; 21 | Invoice quantity and price | Implemented | OR order item snapshots and PDF INR unit price/quantity; K/H | None for these fields |
| R149 | 27; 21 | Invoice discount | Implemented | OR explicit nonnegative amount capped at gross; totals/snapshot/PDF; K/H | Quotation discount remains absent |
| R150 | 27; 21 | Invoice taxable value, GST breakup and total | Implemented | OR explicit tax mode/rate, CGST/SGST/IGST and Decimal totals; tests K/H | Not a certification of tax applicability/statutory compliance |
| R151 | 27; 21 | Invoice payment status | Missing | No manual payment-status field/model/PDF value; OR K | A manual status is not a payment gateway. Confirm its scope separately; real payments/collection remain deferred |
| R152 | 27; 21 | Invoice terms and conditions | Missing | No terms snapshot or PDF content; OR K | Define/version issued terms, preserve invoice immutability |
| R153 | 27; 20–21 | Complete readable invoice document layout | Partial | pdf.py decrements a single y coordinate with no wrapping/page-break logic; K | Many/long lines may clip; add visual multi-page acceptance tests |
| R154 | 28; 21 | Service-provider profiles: name/mobile/OTP/trade/PIN/area/district/state/location, uniqueness and duplicate prevention | Deferred | DEC D-009; no service-provider module; K | Keep private trade-worker contacts separate (R048) |
| R155 | 28; 21–22 | Search service providers by trade/PIN/area/district/location | Deferred | No module/routes; explicit deferred ecosystem; K | Do not start marketplace implicitly |
| R156 | 29; 22 | Job-seeker profile, skills, experience, preferred location | Deferred | DEC D-009; no job domain; K | Explicit future approval required |
| R157 | 29; 22 | Search/apply for local jobs | Deferred | No jobs/applications models/routes; K | Future jobs phase only |
| R158 | 29; 22 | Job notifications | Deferred | Jobs and external notification integration parked; K | No service credentials needed now |
| R159 | 30; 22 | Employer openings, skills, salary/range and location | Deferred | No employer/job-opening module; DEC/K | Future scope |
| R160 | 30; 22 | Review/contact applicants and recruitment states | Deferred | No recruitment module; DEC/K | Future scope |
| R161 | 31; 23 | Admin manages Personal users/accounts | Missing | No staff user directory/profile/account-block/restore API or page; AC state model alone is insufficient; K | Least-privilege user administration/audit contract |
| R162 | 31; 23 | Admin manages Business users | Implemented | DE staff businesses list, decisions and dealer-network UI; K/F/H | Rich verification evidence remains incomplete |
| R163 | 31; 23 | Admin manages Company users across lifecycle | Partial | CO pending verification/review queues and suspend/restore APIs; no complete company/account directory UI; K/F/H | Inspect approved/suspended companies without relying on pending queue/history |
| R164 | 31; 23 | Admin manages service providers, job seekers and employers | Deferred | Corresponding roles deferred; DEC/K | Not a current admin defect |
| R165 | 31; 23 | Separate brand verification/approval | Changed | Verified-company ownership qualifies brand; no independent Brand.status approval state; CAT/DEC K/F | Company verification plus product moderation is the current rule |
| R166 | 31; 23 | Admin preapproves catalogue/products | Changed | DEC D-004 verified company can publish immediately; staff hides/suspends/restores; K/F/H | Post-publication oversight, not mandatory preapproval |
| R167 | 31; 23 | Admin inspects products/models/codes and moderates publication | Implemented | CAT staff products/moderation API, Catalogue UI; K/F/H | Company owns content; staff not arbitrary product editor |
| R168 | 31; 23 | Admin manages/inspects product images | Changed | Device-only attachments are not visible to admin; LF/DEC K | No false remote-image review claim |
| R169 | 31; 23 | Admin manages catalogue PDFs | Changed | Local-only/no shared catalogue PDF contract; CAT/LF K | Cannot inspect files on another phone |
| R170 | 31; 23 | Admin manages catalogue HSN codes | Missing | No canonical HSN fields or catalogue admin controls; K | Depends on R076 taxonomy/commercial metadata design |
| R171 | 31; 23 | Admin inspects dealer locations and availability | Implemented | DE staff locations/listings, moderation/search, branch/price/stock UI; K/F/H | Dealer owns price/stock; no unsupported staff commercial edits |
| R172 | 31; 23 | Admin inspects authorized-dealer mapping | Implemented | DE /staff/dealers/authorizations and authorization-audit; ADM K/F/H | Company remains the only grant/revoke actor |
| R173 | 31; 24 | Admin inspects quotations and invoices | Implemented | EQ /staff/enquiries, OR /staff/orders/detail and audit; ADM K/F/H | Does not mean all PDF fields are complete |
| R174 | 31; 24 | Reports: totals for Personal, Business, Company and dealer accounts | Missing | Overview displays health/workflow links, no aggregate report endpoint; K/F | Define metrics and filters; do not fabricate counts |
| R175 | 31; 24 | Product/catalogue/category/brand/dealer reports | Partial | Filterable paginated inspection lists exist; no summary/export/reporting module; CAT/DE/ADM K/F/H | Define report semantics before adding analytics |
| R176 | 31; 24 | Quotation and invoice reports | Partial | Staff inspection lists/history/search, no aggregate/export reporting; EQ/OR K/F/H | Report totals/date ranges/exports missing |
| R177 | 31; 24 | Total service-provider reports | Deferred | Service-provider module deferred; DEC/K | Not a current counting defect |
| R178 | 32–33; 24–25 | Notification module/in-app inbox | Missing | No Notification model/service/inbox/read-state API; status refresh is not notification delivery; K | Local-only in-app events could be designed without external services |
| R179 | 33; 25 | OTP/external notification delivery | Deferred | No real SMS/email/notification providers during development; DEC; local OTP simulation works AC K/F/H | Provider integration intentionally parked |
| R180 | 33; 25 | Registration/business/company approval and catalogue/availability alerts | Missing | State visible after refresh only; no local in-app notification event workflow; K | External delivery deferred, local event/inbox still absent |
| R181 | 33; 25 | Quotation received/approved and invoice-generated alerts | Missing | EQ/OR state polling/read pages, no notification records/delivery/read state; K | Separate local alerts from SMS/push provider plans |
| R182 | 33; 25 | Service-request notifications | Deferred | Service-provider marketplace deferred; DEC/K | No service-request flow authorized |
| R183 | 34; 26 | Optional commercial hosting/brand/dealer-management service plans | Deferred | Core capabilities exist separately; no monetized plans/entitlements; PDF labels future commercial options; K | Do not gate existing local features with fees |
| R184 | 34; 26 | Product promotion and premium company features | Deferred | Explicit potential future options, no promotion/plan module; K | Scope/abuse policy before implementation |
| R185 | 34; 26 | Company commercial analytics offering | Deferred | Future commercial option, no analytics plan/service; K | Core reporting gap R174–176 remains distinct |
| R186 | 36; 27 | Android mobile application | Implemented | Existing Expo app, generated Android release project, signed APK/phone launch; H APK README and UI report; K/F | Not full device reliability sign-off |
| R187 | 36; 27 | iOS mobile application | Unverified | Expo/RN source and iOS script exist; no native iOS build/signing/device evidence; K | Needs appropriate Mac/Xcode/toolchain and device checks |
| R188 | 36; 27 | REST API, authentication and catalogue/quotation/invoice services | Implemented | DRF installed apps/routes/models/tests AC/CAT/EQ/OR; K/F/H, P health 200 | Narrow service existence/behavior, not complete source feature equivalence |
| R189 | 36; 27 | PostgreSQL or MySQL database | Implemented | PostgreSQL is one of the PDF's allowed alternatives; psycopg/settings/PostgreSQL migrations; K/H | No MySQL port required; SQLite only explicit fallback |
| R190 | 36; 27 | AWS/Azure cloud hosting | Deferred | Local laptop API/PostgreSQL; no production/cloud deployment approved; DEC/K | No provider/server setup in this roadmap without approval |
| R191 | 36; 27–28 | Shared storage for catalogues/images/company/business docs and quotation/invoice PDFs | Changed | LF selected files private on phone; legacy company files remain backend and issued invoice PDF bytes in DB; K/F | No cloud; local-only selected files do not imply all historical/generated bytes are phone-exclusive |
| R192 | 36; 27 | Backend notification service | Missing | No installed notification app/routes/task service; K | Local event design first; external provider work deferred |
| R193 | 37; 28 | Complete Personal registration→product→dealer→contact journey | Partial | Browse/search/discovery works AC/CAT/DE; Personal profile and public-contact steps missing; K/F/H | R011/R014–016/R031; purchase/payment not implied |
| R194 | 37; 29–30 | Complete dealer registration→categories/brands/contacts→cart→quote→invoice journey | Partial | DE/EQ/OR implement a different enquiry/order core; many original onboarding/cart/PDF steps absent; K/F/H | Cannot call original complete journey finished |
| R195 | 37; 30 | Company registration→verification→catalogue/images→dealer mapping→distribution | Changed | Text catalogue and grants work; Phase 8 removes mobile remote evidence/images; K/F/H | Local-only evidence must not be represented as staff-reviewed |
| R196 | 38; 30–31 | Quotation→approval→invoice→completed purchase ecosystem | Partial | Accepted quote/order state/invoice exists; no payment/fulfilment proof and document gaps; K/F/H | Completed order status does not prove money/delivery changed hands |
| R197 | 39; 32 | Online payments | Deferred | PDF future enhancement; explicit no payment integration/collection; DEC/K | Not authorized now |
| R198 | 39; 32 | WhatsApp quotation sharing | Deferred | PDF future enhancement; no provider/link/share-PDF integration; K | Native invoice share is not WhatsApp quotation workflow |
| R199 | 39; 32 | Vendor/company/dealer ratings | Deferred | Future scope; no ratings model/API; K | Requires moderation/abuse rules later |
| R200 | 39; 32 | Order tracking | Implemented | OR status transitions/history in buyer/dealer mobile and staff inspector; K/F/H | Status tracking only; delivery tracking separately deferred |
| R201 | 39–40; 32 | Advanced stock/inventory management | Deferred | Only branch quantity/stock state implemented; PDF future enhancements; K | No stock ledger, reservation, warehouse or automatic depletion promised |
| R202 | 39; 32 | Purchase orders | Deferred | Existing accepted-quotation buyer Order is not a procurement purchase-order module; K | Future scope, do not duplicate orders blindly |
| R203 | 39; 32 | Delivery tracking | Deferred | No shipment/logistics module; explicit future PDF scope; K | No external logistics integration now |
| R204 | 39; 32 | English, Telugu and Hindi localization | Deferred | English UI exists, no i18n/locale switching/catalogues; PDF future scope; K | India formatting does not equal translation support |
| R205 | 39; 32 | AI recommendations | Deferred | No recommendation engine; PDF future enhancement; K | No external AI service authorized |
| R206 | 39; 32 | Customer order history | Partial | OR mobile orders loads page 1 only; no next/previous controls; backend paginates; K/F/H | Add real history navigation; existing first page is not all orders |
| R207 | 39; 32 | Dealer order history | Partial | Same mobile page-1 limitation; admin has separate pagination; K/F/H | Verify >page-size histories |
| R208 | 40; 32 | ERP integration | Deferred | PDF future scope; no ERP connector; K | No external integrations now |
| R209 | 40; 32 | GST portal integration | Deferred | Manual/configured tax inputs only; PDF future scope + development policy; K | No unverified government API assumptions |
| R210 | 40; 32 | Advanced inventory module | Deferred | Cross-reference R201; no advanced ledger/warehouse features; K | This row captures the separately named module scope, not a basic stock defect |
| R211 | 40; 32 | Analytics dashboard | Deferred | Advanced analytics explicitly future; Overview is not analytics; K | Basic required reports remain R174–176 |
| R212 | 40; 32 | Company sales analytics | Deferred | No sales aggregation/dashboard; PDF future scope; K | Requires approved metrics and source data |
| R213 | 40; 32 | Dealer performance analytics | Deferred | No performance model/dashboard; PDF future scope; K | Not inferred from listing counts |
| R214 | 40; 32 | Product-demand analytics | Deferred | No demand aggregation/analytics; PDF future scope; K | Need privacy/metric definitions |
| R215 | 40; 32 | Automated dealer management | Deferred | Current grants are manual explicit company actions; PDF future enhancement; K | Never automate approval implicitly |
| R216 | 40; 32 | Company-system API integrations | Deferred | No integration connector; PDF future scope; K | Existing REST APIs are not company-system integration |
| R217 | 1,16,41–42; 1,13,32–34 | Reduce printing/distribution costs, manual work and duplicate/incorrect data; deliver business value | Unverified | Functional mechanisms partly present, but no measured cost/effort/accuracy acceptance baseline; K/H | Validate with user/business trials; do not claim measured outcomes from tests |

## Complete source-section crosswalk

| PDF section | Coverage |
| --- | --- |
| 1 Project objective | R001, R008–009, R193–196, R217 |
| 2 Registration types | R001–008 |
| 3 Personal purpose/example | R010, R019–033 |
| 4 Personal registration | R002, R011–018 |
| 5 Personal features | R019–035, R114–115 |
| 6 Business purpose | R036, R057–065, R117–153 |
| 7 Business registration | R003, R012–013, R037–043 |
| 8 Category/brand selection | R043–047, R069 |
| 9 Worker information | R048–049; service-provider future use R154–155 |
| 10 Business validation | R012–013, R050–056 |
| 11 Business main features | R057–069 |
| 12 Product catalogue | R008, R010, R070 |
| 13 Catalogue structure | R070, R072–078, R093/R102–103 |
| 14 Product information | R071–081, R023–026 |
| 15 Product categories | R009, R082; all named manufacturer examples are illustrative |
| 16 Company purpose | R008, R010, R217 |
| 17 Company registration/validation | R004, R012–013, R083–100 |
| 18 Company management | R071–077, R101–107 |
| 19 Dealer mapping | R033, R108–111 |
| 20 Duplicate prevention | R081, R098, R112–113 |
| 21 Availability mapping | R030, R066–068, R080, R110 |
| 22 Dealer search | R027–035, R114–115 |
| 23 Cart | R058, R116 |
| 24 Quotation flow | R060–062, R117 |
| 25 Quotation fields/PDF | R064, R119–133 (every listed identity/item/price/discount/tax/terms field named) |
| 26 Invoice flow | R063, R118, R134–135 |
| 27 Invoice fields | R065, R136–153 (every listed field named) |
| 28 Service providers | R005, R154–155 |
| 29 Job seekers | R006, R156–158 |
| 30 Employers | R007, R159–160 |
| 31 Admin | R050–055, R082, R097, R113, R161–177 |
| 32 Recommended modules | Accounts R011–018/R161; business R037–056; company R083–111; provider/jobs R154–160; catalogue/brand/product R070–113; dealer/search/availability R027–035/R066–069; cart R058/R116; quote/invoice R117–153; notifications R178–182/R192; admin/reports R161–177 |
| 33 Notifications | R158, R178–182 |
| 34 Business model | R002–004, R057–069, R183–185 |
| 35 Separate verification | R033, R099, R108–111, R115 |
| 36 Technical | R186–192; catalogue/PDF service gaps in R064–065/R078/R191 |
| 37 High-level flows | R193–195, underlying individual rows |
| 38 Ecosystem | R118, R134–135, R193–196 |
| 39 Future Phase 2 | R197–207 (future labels are from PDF, not permission to start a new development phase) |
| 40 Future Phase 3 | R201, R208–216 |
| 41 Business value | R019–035/R057–069/R101–113/R119–153/R217 |
| 42 Core objective | R001, R008, R193–196/R217; final continuation on p34 included |

## Audit boundaries and decisions not counted as original PDF requirements

- India-only, INR-only, Indian phone/PIN/state validation and IST display are later approved refinements, implemented in `config/india.py`, mobile/admin `india.ts` and migration constraints. No foreign-currency/GPS/provider work is proposed to match old prose.
- Company representatives, restricted review for independently blocked accounts, retention/backup and detailed operational security are later architecture obligations. Existing one-owner company implementation and company-only review routes do not fulfill every planned representative/account-recovery route. These are listed in the gap summary without pretending they were explicit source-PDF requirements.
- Audit/log models and PostgreSQL triggers exist, but historical reports and raw migration text do not establish that every current trigger is applied or that full operational recovery is verified today.
- Fresh anonymous invoice GET/PIN-independent probes did not read private data. Invoice URL mismatch is verified at routing/composition level, not by a new owner-session download. The FY probe executed the exact `fy` function body in isolation with Django's configured UTC default; no database or invoice was created.
- Source requirements that conflict with current policy are not silently turned into implementation tasks. See `implementation-gap-summary.md` and `recommended-development-roadmap.md` for policy gates and scoped priorities.
