# Buyer catalogue and dealer journey



The app now has catalogue, product-detail and dealer-discovery screens. It uses the existing Expo entry point and simple typed screen state, with Back controls and Android hardware-back handling; no navigation package was added. Returning from details preserves catalogue search/filter/page state.



## Local launch



Dependencies keep the existing manifest versions; `package-lock.json` records the resolved versions. Node 24 is used for the dependency-free test runner.



```powershell

cd C:\Projects\SmartTrade\apps\mobile

npm ci

Copy-Item .env.example .env.local

```



Set `EXPO_PUBLIC_API_URL` in the ignored `.env.local` to an API base reachable **from the device**, including `/api/v1`. The app has no localhost fallback and shows a configuration error when unset. These variables are public build configuration, never a place for tokens/passwords. Restart Expo after changing configuration.



For an Android emulator, use `http://10.0.2.2:8000/api/v1`. `10.0.2.2` routes to the Windows host's loopback; Django can remain on `127.0.0.1:8000`.



For an authorized physical Android phone connected by USB, use `http://127.0.0.1:8000/api/v1`, then run:



```powershell

adb reverse tcp:8000 tcp:8000

adb reverse tcp:8081 tcp:8081

npm start -- --localhost --offline --port 8081

```



Open the project in an Expo-compatible development client/Expo Go on the connected device. Only use a client compatible with the declared Expo SDK 58; do not change SDK versions just to match an older installed client. Expo's `a` shortcut can open a connected compatible Android runtime. Stop Metro with Ctrl+C. Remove forwarding with `adb reverse --remove tcp:8000` and `adb reverse --remove tcp:8081` when finished. The same USB forwarding option works with a running Android emulator if its Metro client cannot reach the host.



For an emulator using the host-loopback API address, start Metro locally with `npm start -- --localhost --offline`; use the compatible device/client's normal connection flow. `localhost` on a phone means that phone, not this Windows laptop. No instructions here require changing Django to `0.0.0.0`, changing allowed hosts broadly, or publishing a tunnel. Physical iOS requires a separately approved secure development transport; Windows cannot run Apple's iOS simulator. An iOS simulator can use `127.0.0.1` only when the API is running on the same Mac. Production mobile API configuration must use HTTPS.



## API and screen behavior



- `GET /catalogue/categories?page=N`: paginated category choices and All categories.

- `GET /catalogue/products?search=...&category=...&brand=...&page=N`: public product browsing with search, retry/empty/error/loading states and pagination. The API has no public brand index, so the optional buyer brand filter accepts an explicit numeric ID; it does not infer IDs from brand names or fabricate brand choices.

- `GET /catalogue/products/{id}`: fresh product details, specifications, explicit catalogue price/currency, and active variants/SKUs. A 404 is shown as product unavailability.

- `GET /dealers/listings?product=...&pin_code=...&locality=...&district=...&stock_status=...&page=N`: authenticated branch comparison. PIN is tried first by the backend, with labelled locality/district fallback. Backend match_level is displayed. Prices remain branch/currency-specific, quantities are shown only for confirmed in-stock listings when supplied, and out-of-stock/unknown availability are distinct from no matching results.

- `GET /auth/me`: used by the session admission function to validate an access token issued by a future real authentication flow.



Dealer responses are projected into types containing only public branch address/identity fields; contacts are not passed to the UI. Backend eligibility is authoritative. There is no local inventory cache or fixture fallback; refresh retrieves current eligible listings. Navigation retains the selected product and variant. The API does not support a variant query parameter: variant selection filters each fetched product-listing page, explicitly labelled in the UI. Server totals remain totals across all variants; a page without the selected variant is not reported as global unavailability. Pagination still allows inspection of other pages. No currency conversion, tax, delivery, reservation, cart, quote or payment behavior is added.



## Authentication and session

Mobile now has login, explicit Personal/Business/Company registration, OTP entry, account/status and sign-out screens. Normal and opt-in development OTP use the existing `/auth/register`, `/auth/otp/request`, `/auth/login`, `/auth/me`, `/auth/refresh`, `/auth/logout` contracts. Development acknowledgements clearly say no SMS was sent and phone ownership remains unverified. Unknown accounts must explicitly register; mobile registration cannot create STAFF or grant roles. Backend blocking/permissions remain authoritative.

Access and refresh tokens stay in React memory, never public environment values or local files. Session admission and each refresh load `/auth/me`; scheduled refresh replaces access tokens. Refresh failures clear the session. Logout clears local state and invokes server token-version revocation; failed server logout is clearly reported. Relaunch/reload requires sign-in. Sign-in from product-to-dealer discovery returns to that selected product/variant. Account type and verification status are separate from company/business approval.

## Current implementation inventory

| Area | Current state |
| --- | --- |
| Catalogue/home | Existing public categories, search, pagination and empty/error/retry states; catalogue currently serves as home, no separate role home/dashboard |
| Product details and variants | Existing implementation; populated live data cannot be tested when the local catalogue is empty |
| Authentication | Login, development OTP, explicit account-type registration, active session admission, refresh and logout implemented |
| Dealer discovery | Existing PIN-first location/stock filters and branch price comparison now reachable after sign-in |
| Account screen | Actual account type, access state and mobile verification; no invented business verification |
| Company management | Company-only dashboard, registration/profile, private document picker/upload, email confirmation, application and restricted review-request screens implemented |
| Dealer management | BUSINESS-only dashboard/profile, paginated branches, read-only authorization status, authorized catalogue selection and listing/stock forms implemented |

Existing company and dealer write APIs support most remaining forms. Dealer authorization status is now available through the owner business workspace context. Remaining API gaps are a public brand directory and server-side discovery variant filtering. Local company verification now uses the guarded development email simulation and explicitly configured local document policies; a real email provider is not required. Do not invent consent, upload limits, or verification shortcuts. No backend changes were necessary for this authentication milestone.

## Verified Windows emulator setup

The existing Pixel_10_Pro AVD boots on the installed Android SDK. Expo Go matching SDK 58 was installed into that emulator with user approval; project dependency versions were not upgraded. SDK platforms 34/36/36.1, build tools 34/35/36 and JDK 17 plus Android Studio JBR 21 are installed. Expo Go does not require a local native Gradle build; native APK compilation has not been validated.

The ignored mobile `.env.local` is configured to `http://127.0.0.1:8000/api/v1` with ADB reverse forwarding for ports 8000 and 8081. This preserves backend loopback-only development authentication and does not expose the API to the network. The generic `10.0.2.2` address above works for public data but must not be used to bypass the development-auth Host/loopback restrictions. Keep the reversed localhost transport for development OTP.

The app and Metro are running. Select the **Android Emulator - Pixel_10_Pro:5554** window on the Windows taskbar. For later sessions, the root helper `scripts/start-mobile-local.ps1` reuses the AVD/Metro when possible and starts the installed Expo project otherwise. It expects the existing API to be running on 127.0.0.1:8000. It installs no packages or system services. Stop Metro with Ctrl+C in its terminal; closing the emulator stops the virtual device.

Visual checks used an actual Android screenshot and device UI: catalogue/category empty responses rendered and the OTP sign-in reached the authenticated My account state. No sample marketplace data was inserted. Full product/dealer comparison with populated inventory and company/dealer management have not been tested end to end. The AVD emits a recommended-host-RAM advisory (16 GiB suggested, about 15.7 GiB reported available); it still boots. A Windows capture limitation prevented desktop-level window placement/advisory dismissal; Android screen capture and app interaction worked.

## Checks



```powershell

npm run typecheck

npm test

$env:EXPO_OFFLINE = '1'

.\node_modules\.bin\expo.cmd export --platform android --output-dir dist

```



The existing project defines no lint script. Tests use Node's built-in runner and TypeScript stripping, with isolated contract fixtures only. They cover mapping, private-field projection, query filters, page metadata, authentication gating, invalid/expired sessions, transport/HTTP/malformed-response failures, abort propagation, variant-page semantics, stock labels and the actual resource reducer's loading/error/retry/empty states. These are headless client/state tests, not rendered device interaction tests. Android export creates a JavaScript/Hermes bundle, not an APK/AAB or an installed app. The Pixel_10_Pro emulator is connected; catalogue and sign-in were exercised on it. Full screen-reader, background/resume and populated marketplace journeys remain unverified.


## Company mobile workspace

Sign in with an existing COMPANY account, open **My account**, then **Company dashboard**. Personal, Business and STAFF accounts do not receive that entry; backend permissions independently protect all company routes. Buyer catalogue navigation remains available through Back. No profile, documents or application are fabricated when an account has not registered its company.

The workspace includes Dashboard, Profile, Documents, Email and Application tabs. Company registration requires the same legal name and company email as the backend serializer; additional fields remain optional unless the backend rejects them. Existing profiles are editable only when the server's `can_edit` permits it. Submission locks profile/documents, duplicate pending submissions are disabled, suspended activity stays separate from account access, and rejected/suspended companies can send a reason-required restricted review request only when `can_request_review` is true.

Existing paths used (relative to `/api/v1`):

- `GET /companies/me`: company plus an additive owner-only `verification` context containing configured document policy, document metadata, latest application/decision, missing document types, review requests and allowed-action booleans. No storage paths/public URLs are returned. A specific COMPANY_NOT_REGISTERED 404 opens registration; other errors remain errors.
- `POST /companies/register`, `PATCH /companies/me`: explicit company registration and permitted profile changes; status/ownership fields are not posted.
- `POST /companies/me/documents`: native multipart upload with Bearer authorization using `expo-document-picker ~58.0.4`, the installed Expo SDK's declared version. The picker copies selection to app cache for upload. XHR reports actual transfer progress; 100% means waiting for server confirmation, not approval. Policy, size and MIME checks run before upload; signatures and authoritative validation remain on the backend. No public file links/sharing are introduced. Document rows show uploaded versus attached-to-application metadata.
- `POST /companies/me/email-verification/request` and `/confirm`: guarded company email simulation when DEBUG, SMARTTRADE_ENABLE_DEV_EMAIL and loopback checks pass. Any non-empty test code records separate development audit evidence; no email is sent and email_verified_at remains unset. With simulation disabled, existing provider behavior remains unchanged and missing configuration fails closed.
- `POST /companies/me/verification-submissions`: requires the actual server `can_submit` and displays returned case ID/status.
- `POST /companies/me/review-requests`: displays the actual returned request state and does not restore access.

No new route or migration was introduced. The previously missing policy/document/application read contract was reported before extending the existing GET response. Existing response.company and all write permissions remain intact. No retention period, upload limit, document taxonomy, consent text or email provider was invented/configured.

Local company onboarding has now been tested using controlled PostgreSQL company records, native Android PDF selection/upload, local email simulation, submission and real staff browser review. See [Phase 1 validation](../../docs/company-phase1-validation.md) for exact coverage, development-only policy values and remaining limitations. No external provider is required for this local workflow.

Company milestone validation: mobile TypeScript passed; 31 Node tests passed; Android Hermes export passed; full PostgreSQL suite passed with 105 tests and zero skips; Django checks and migration consistency passed (no migrations needed). On the actual emulator, the existing COMPANY account completed development OTP sign-in, received the role-specific company entry, loaded the unregistered-company state from the API and opened the registration form. No company profile or marketplace sample records were created. API/Metro remain loopback-only and running. The native picker module loaded without a captured Android runtime error, but picker selection/upload was not exercised live because company/profile policy prerequisites are absent.

The document-picker installation reported 12 npm audit findings in the current Expo dependency tree (two high, nine moderate, one low). No blind audit fixes or unrelated dependency upgrades were applied; assess compatible remediation separately.

## Dealer mobile workspace

Sign in with a BUSINESS account, then use **My account → Dealer dashboard**. Other account types do not receive the entry; the backend independently checks active business ownership. Catalogue browsing and the existing Company workspace remain unchanged.

Tabs: Dashboard, Profile, Branches, Authorization and Listings. Dashboard displays actual business/account status and backend aggregate branch/published/discoverable-listing counts. Published does not mean currently discoverable: company suspension, revoked grants, hidden/inactive branches and moderated products can hide preserved records. Profile edits post only legal name and registration number; verification cannot be self-assigned.

Branches are paginated, owner-scoped and preserve history on deactivation. Create/edit forms include required location fields, explicit two-letter country code, private contacts, active status and PRIVATE_DRAFT/VISIBLE selection. Pending businesses can create private drafts; only verified businesses can make branches visible. Staff's admin_hidden field is read-only and never submitted by the mobile client. Private owner contacts remain absent from public discovery models.

Authorization shows only this business's company-issued grants, brand/company names, active/revoked state and current eligibility. No grant/revoke controls exist. Only a verified business with an eligible grant may select products for listing. The backend remains authoritative on each write. Revoked grants/hidden branches/company suspension cannot be bypassed by stale mobile state.

Listing creation selects an owned eligible branch, an eligible authorized brand, a real public company product, and an optional active variant. Products are searched/paginated through the existing public catalogue with brand filtering. Canonical brand/company identifiers are matched, never brand names. Dealer selling price/currency are distinct from company catalogue prices. Currency has no default; optional quantity must agree with IN_STOCK/OUT_OF_STOCK/UNKNOWN and decimal limits. Existing listings preserve branch/product/variant identity. Updates send only price/currency/stock/quantity/state; withdrawal sends only state=WITHDRAWN, which preserves the backend's withdrawal exception after company/grant ineligibility for verified businesses. There is no deletion, tax, shipping, reservation or payment behavior.

Contracts used:

- `GET/PATCH /businesses/me`: unchanged profile write fields; GET adds owner-only workspace totals, permission flags and read-only authorizations. No new URL is introduced.
- `GET/POST /businesses/me/locations`, `GET/PATCH /businesses/me/locations/{id}`: owned branch management.
- `GET/POST /businesses/me/listings`, `GET/PATCH /businesses/me/listings/{id}`: owned inventory and publication/withdrawal.
- `GET /catalogue/products?brand=...&search=...&page=...`: company-owned published catalogue/variants; additive read-only brand_id/company_id fields support exact matching.
- The existing company-owned `/companies/me/dealer-authorizations` grant/revoke route is deliberately not called by dealer mobile users.

The missing dealer grant read contract and catalogue identifiers were reported before extending existing responses. No new endpoint, model, migration or authorization rule was introduced. Business verification is staff-controlled; there is no dealer self-approval flow or configurable activation invented here.

Tests include API/body validation, owner pagination, stock/price rules, authorization matching, branch create/edit/deactivation requests, immutable listing identity, state-only withdrawal, failed saves and malformed-success handling. Headless component tests render the actual DealerWorkspace TSX with native-host adapters and isolated resource/session fixtures. They reuse matching React/ReactDOM and TypeScript already installed in the monorepo; no new dependency was installed. These are component renders, not device interaction tests.

Dealer milestone validation: 42 mobile tests passed (including three actual TSX headless component-render tests); mobile TypeScript and Android Hermes export passed. The complete PostgreSQL suite passed with 111 tests and zero skips; Django checks and migration consistency passed. The connected emulator retained the existing COMPANY account entry and correctly hid the BUSINESS-only Dealer dashboard from that identity. A user-authorized development BUSINESS identity now exists with a pending profile. Role-specific emulator screen checks passed; positive branch/listing mutation tests remain limited to the isolated automated suite because no live branches, grants or listings were authorized for creation. No live branches, products, grants or listings were created, and no database migrations were required. API and Metro remain loopback-only and running.

Approved Dealer emulator follow-up: created one dedicated local BUSINESS login through the existing registration API after confirming smarttrade_dev/smarttrade_app. It uses a reserved fictitious number; its phone remains unverified, profile PENDING, and staff assignments zero. Actual Android development OTP login, My account role entry, Dashboard, Profile, Branches, Authorization and Listings screens passed. The new-branch form opened, the visible-branch control was disabled for the pending business, and the form was cancelled without saving. Real owner API reads returned empty data; listing creation, self-verification, self-authorization and staff access were correctly rejected. Final scoped database counts were zero branches, listings and grants. No approvals or marketplace sample records were created. The emulator is left authenticated on Dealer dashboard, with the API and Metro running on loopback. Automated code suites were not rerun for this account/data-only verification follow-up; the preceding code milestone's results remain 42 mobile tests and 111 PostgreSQL tests passed.


## Phase 2 company catalogue

Open My account → Company dashboard → Catalogue. Brands, Categories and Products tabs support owned brand create/edit, permitted category associations, product drafts/publication/editing, specifications, optional catalogue price/currency and variant/SKU editing. Only eligible companies can save; backend permissions remain authoritative. Refresh also reloads company eligibility. Active sessions retain unsaved catalogue forms during token-refresh loading.

[Phase 2 validation](../../docs/company-catalogue-phase2-validation.md) lists actual API contracts, emulator/browser tests, changed files and limitations. Independent brand activation/moderation and product images are not supported by the current backend; no artificial controls or endpoints were added.


## Phase 3 company-to-dealer authorization

Company accounts: My account → Company dashboard → Dealers. Select an owned brand, search verified active businesses, grant with a reason, and inspect/filter/revoke/reactivate retained authorization records. Only the eligible owning company can write; company and account restrictions remain backend-enforced.

BUSINESS accounts reuse Dealer dashboard → Authorization for read-only brand/company/status/eligibility and refresh. No dealer self-grant action exists. See [Phase 3 validation](../../docs/company-dealer-phase3-validation.md) for actual emulator/browser coverage and tests. No Phase 4 inventory development was performed in this milestone.


## Phase 4 dealer listings and stock

Dealer dashboard → Listings reuses existing authorized brand/product/SKU and branch selection, with search/state filters, actual company/SKU/eligibility details, visible validation feedback and explicit retained-row reactivation. Only the dealer edits its price/stock; backend checks remain authoritative. Buyer discovery sends the selected variant before pagination and never exposes private branch contacts.

[Phase 4 validation](../../docs/dealer-listings-phase4-validation.md) distinguishes actual Android listing lifecycle, admin moderation/search, live API adverse cases and automated PostgreSQL fixtures. No Phase 5 order/reservation/payment features are included.
