# Package A implementation and validation

Date: 04-11-2026 IST. Authorized scope: G01 mobile invoice URL, G02 India invoice calendar, G04 Buyer/Dealer enquiry/order pagination only.

**Status: implemented and automated-verified; physical acceptance remains pending/limited. Do not mark the whole package complete yet.** The existing phone-use question is pending; the current development dataset also cannot demonstrate page 2. No Package B or later feature was started.

## Inspection and preservation

Read the original requirement matrix, gap summary, roadmap, attached Package A request and relevant API/mobile/storage/test documentation. Inspected existing uncommitted status/diff, actual URL serializers/routes, mobile API base, vault implementation, UTC settings, invoice FY/PDF code, pagination contract and test launcher before changes. Brief findings were reported before implementation.

There were 128 existing modified/untracked/deleted status entries at the initial inspection, including substantial prior phase work. No reset, clean, stash, stage, commit, push or discard was used. Most affected commercial files were already untracked; a Git diff against HEAD therefore is not a complete view of them. Changes were targeted to existing function/call-site anchors; relevant untracked sources and tests were reviewed directly. Historical invoices, business records, signing credentials and previous APKs were preserved.

## G01 — invoice URL and private vault

Root cause: backend `InvoiceSerializer.get_download_url` returns `/api/v1/orders/{id}/invoice/download`, while `ApiClient.base` already includes `/api/v1`. Direct concatenation generated `/api/v1/api/v1/...`.

Implementation:

- `api-file-url.ts` resolves the actual root-relative reference against the configured API origin. It validates HTTP(S), denies embedded URL credentials, different hosts/schemes/ports, fragments, non-API paths and encoded slash/backslash escape cases. Same-origin absolute references also remain constrained to the configured API root. No token is placed in a URL.
- `local-files.ts` exposes `downloadApiFile`, the single API-file boundary, then reuses the existing durable private vault/download policy. `OrderWorkspace` uses that boundary. Backend path/response and private invoice permissions are unchanged.
- Failed HTTP responses, zero-byte downloads, thrown transport errors and metadata-write failures remove only the newly generated partial destination and do not create successful metadata. Existing cached matching copies are reused without a second network transfer. UI success still occurs only after a saved file record is returned.
- The actual invoice API does not redirect; this validation does not claim a newly implemented general-purpose redirect/proxy security service. No auth/storage permission has been relaxed.

Regression evidence: tests execute the real resolver and real vault module against an isolated in-memory Expo filesystem adapter, not just string-source assertions. They prove one prefix, safe header destination, successful metadata persistence/repeat reuse, cleanup and no foreign-origin transport. Existing and added Django owner/foreign/anonymous tests exercise the unchanged download route on PostgreSQL fixtures.

## G02 — explicit Indian business calendar

Root cause: `fy()` used `timezone.localtime(now)` with global TIME_ZONE=UTC, and PDF rendering called `issued_at.strftime` without conversion.

Implementation: new `orders/business_calendar.py` uses `ZoneInfo('Asia/Kolkata')` explicitly for business_datetime and financial_year. Existing `fy` delegates to it, preserving supplier/year sequence ownership. PDF issue dates use the same helper and an IST label. Global timezone, UTC timestamp persistence, tax calculations, issuance/ownership rules and schema remain unchanged. Historical immutable invoice PDFs/rows are neither regenerated nor updated.

Boundary tests cover:

| UTC instant | India business date/time | Financial year |
| --- | --- | --- |
| 30-03-2026 18:30 | 31-03-2026 00:00 IST | 2025-26 |
| 31-03-2026 18:29:59 | 31-03-2026 23:59:59 IST | 2025-26 |
| 31-03-2026 18:30 | 01-04-2026 00:00 IST | 2026-27 |
| 31-03-2026 20:00 | 01-04-2026 01:30 IST | 2026-27 |
| 01-04-2026 00:00 | 01-04-2026 05:30 IST | 2026-27 |

Tests also activate a different current timezone to prove the explicit India rule is independent, reject naive timestamps, check PDF date rendering, assert stored issued timestamps remain UTC and verify FY sequence rollover/supplier separation/duplicate scope rejection in disposable fixtures. No real invoice was created for a historical-date test.

## G04 — mobile history pagination

Root cause: OrderWorkspace hard-coded page 1; EnquiryWorkspace declared a page setter but never exposed pagination. Backend PageNumberPagination already returns count/next/previous/results with page size 20.

Implementation:

- Shared `HistoryPage` request controller, `useHistoryPage` glue and `HistoryPager` controls are used only by these two commercial workspaces. No global resource refactor or pagination-size/API-filter change.
- Immediate loading state gates repeated Next/Previous taps before a React render. AbortController plus a request-generation check excludes late/out-of-order completions even if a transport ignores abort.
- Display current page and API count; enable navigation only when the current ready response has the respective next/previous link. Retry stays on the failed page; explicit Refresh starts at page 1. A completed business operation reloads its current page, preserving existing operation semantics.
- Selected records, quotation edits, cancellation/rejection reasons, buyer requirements/notes and external draft lines remain outside history controller state and are not cleared on page/retry/refresh changes.
- Existing API clients, filters, session/permission checks, detail navigation and commercial action handlers remain. Only the list-loading/page controls changed.

Tests cover actual Buyer/Dealer OrderWorkspace and EnquiryWorkspace TSX with existing clients, the real page controller and native/hook host adapters. They load different records, return to previous page, disable final Next, preserve selected detail and unsaved inputs, refresh predictably, render failure/retry and empty states. Controller tests cover immediate rapid-tap gating, request abort, late completion, loader replacement and disposal. PostgreSQL fixtures containing 21 valid records test all four actual history list endpoints and retained dealer state filtering.

## Files changed in this package

| File | Change |
| --- | --- |
| `apps/mobile/src/api-file-url.ts` | New constrained API file URL resolver |
| `apps/mobile/src/local-files.ts` | API-file adapter and failed-download cleanup |
| `apps/mobile/src/OrderWorkspace.tsx` | Resolver-backed vault use and history controller/pager |
| `apps/mobile/src/EnquiryWorkspace.tsx` | History controller/pager; preserve commercial drafts/actions |
| `apps/mobile/src/history-page.ts` | New request-generation/loading/navigation controller |
| `apps/mobile/src/useHistoryPage.ts` | New React subscription/lifecycle adapter |
| `apps/mobile/src/HistoryPager.tsx` | Shared controls using existing button system |
| `apps/mobile/tests/invoice-download.test.mjs` | Five resolver/vault regressions |
| `apps/mobile/tests/history-page.test.mjs` | Five controller regressions |
| `apps/mobile/tests/commercial-history-component.test.mjs` | Six actual-workspace render/navigation regressions |
| `apps/mobile/tests/local-files.test.mjs` | Update existing source-boundary assertion to new adapter name |
| `services/api/orders/business_calendar.py` | Named India timezone/calendar helper |
| `services/api/orders/views.py` | Delegate FY calculation; no API/permission change |
| `services/api/orders/pdf.py` | Convert issue-date display explicitly to IST |
| `services/api/orders/test_business_calendar.py` | Three calendar/PDF regressions |
| `services/api/orders/tests.py` | Three PostgreSQL scope/download/history regressions |
| `docs/implementation-gap-summary.md` | Current Package A follow-up; preserve original audit baseline |
| `docs/recommended-development-roadmap.md` | Accurate Package A progress, not blanket completion |
| `docs/package-a-implementation-report.md` | This report/manual procedure |

No dependency, settings, database model, migration, admin code or authentication change was needed. Generated temporary logs/export and the separately named APK are artifacts, not new application domains.

## Actual commands and results

Commands below were executed from the repository root unless another directory is named.

| Command/check | Actual result |
| --- | --- |
| `npm --prefix apps/mobile run typecheck` | PASS |
| `npm --prefix apps/mobile test` | **113 passed, zero failed/skipped** in the final run; includes 16 new regressions |
| `.venv\Scripts\python.exe scripts/manage-local.py check` | PASS, no issues |
| `.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run` | PASS, No changes detected; no migration generated/applied to development |
| `.venv\Scripts\python.exe scripts/manage-local.py test orders enquiries --noinput -v 1` | **22 passed, zero skipped**, final 8.856 s; disposable database created and destroyed normally |
| Expo `export --platform android --output-dir ../../tmp/package-a-android-export`, cwd apps/mobile | PASS; 2,818 modules, Android Hermes .hbc approximately 4.4 MB |
| `apps/mobile/scripts/build-usb-apk.ps1 -OutputName SmartTrade-0.1.0-package-a-arm64-release.apk` | PASS; release build 3m 21s, 310 tasks (11 executed, 299 up-to-date) |
| Android `apksigner verify --verbose` and `aapt dump badging` | PASS; one signer, APK v2 verified, package in.smarttrade.localtest, version 0.1.0 (1), arm64-v8a, release/non-debuggable |
| Admin tests/typecheck | Not run: no admin code or shared response contract changed; previous audit results are not represented as a fresh run |
| Full unrelated backend suites | Not rerun; affected orders/enquiries/calendar suite passed |

Backend safety: inspected root configuration without printing secrets; development target is smarttrade_dev/smarttrade_app on loopback. Dedicated **smarttrade_test** has CREATEDB but no superuser/CREATEROLE, and cannot CONNECT to smarttrade_dev (confirmed). A read-only postgres maintenance connection confirmed **test_smarttrade_dev did not exist** before the first run. Django used its separate disposable test database, applying test-only migrations there; it did not migrate or mutate live business data. The first inspection's attempt to CONNECT to the development DB as the test role was denied, correctly; no privileges were broadened.

Initial test-only issues were corrected: Node strip-types cannot load TypeScript parameter properties, so the controller uses an explicit field/constructor assignment; a headless text assertion needed whitespace tolerance. These did not require changing permissions or business behavior. All final checks above actually ran.

APK: `C:\Projects\SmartTrade\client-presentation\apk\SmartTrade-0.1.0-package-a-arm64-release.apk`.

SHA-256: `b9e61dea6fefe9c0e9c71fa96faa610fc54f01083078567f3d75821caea1aebe`.

The API was restarted only after confirming PID 25080 was the SmartTrade loopback runserver, to load the calendar code. New local launcher PID 19088; no PostgreSQL/admin service was stopped or reconfigured. Reloaded health returned **HTTP 200**. A final read-only maintenance query confirmed the disposable test database was absent after teardown.

Final default `git diff --check` returned **0**; targeted whitespace scanning also passed for the relevant untracked files. A diagnostic invocation with forced `core.autocrlf=false` treated pre-existing Windows CRLF endings as trailing whitespace; the repository's normal Git normalization passed, and no mass line-ending edits were made. Branch remains **main**; final status contains 136 existing/new dirty entries. No files were staged. Pre-existing settings/dependency/other-module diffs were not changed by Package A.

## Physical Android acceptance status

The Package A APK is built, signature-verified, installed and launch-tested on the physical phone. Authenticated phone acceptance remains incomplete; see the dated follow-ups below. Older button-redesign screenshots are not Package A evidence.

Read-only development metadata confirms an existing invoice on order 1 owned by controlled Buyer account 7, business 1, and only four orders/four enquiries in total. No mobile numbers/tokens were printed and no business records were changed. Page size remains 20. More-than-one-page device acceptance is **Blocked by dataset size**, even though disposable PostgreSQL and mobile component tests passed with multiple pages. Do not create 21 live commercial records or change server page size merely to manufacture a pass.

| Phone scenario | Current status |
| --- | --- |
| Install/launch Package A APK | Passed on physical phone 5e106900 on 05-11-2026; update install Success, launch Status ok |
| Existing owner downloads invoice into private vault | Blocked at supported Buyer sign-in: unreliable Android UI inspection; no download attempted |
| Open PDF and repeat download without duplicate local record | Not Tested |
| Foreign user denial on actual phone | Not Tested; backend PostgreSQL regression Passed |
| Buyer/Dealer history beyond page 1 | Blocked: current dataset fits one page; isolated automated tests Passed |
| New IST invoice/FY boundary on actual phone | Not Tested; isolated calendar/API/PDF tests Passed; no historical invoice rewritten |

## Concise physical-phone procedure

Use only the existing phone `5e106900`, API `127.0.0.1:8000`, intended development environment and controlled accounts. Do not touch the emulator or expose services.

1. Install the new Package A APK as an update using `adb -s 5e106900 install -r client-presentation/apk/SmartTrade-0.1.0-package-a-arm64-release.apk`; stop on any signature/security prompt rather than uninstalling or bypassing it. Reapply `adb -s 5e106900 reverse tcp:8000 tcp:8000` after USB reconnection.
2. Open SmartTrade and use the existing supported development OTP flow for the controlled Buyer that owns order 1. No new account, provider or fake production verification is required. Do not capture login fields/tokens in screenshots.
3. My account → Orders and invoices → existing invoiced order → Download/open invoice PDF. Expect a real PDF and private-vault entry after successful download. Cancel the share chooser without sending data externally if only verifying open. Repeat and check that the same local copy/one metadata record is used. A network/403 failure must show an error, not a saved-success message; do not delete an existing user's document to force a re-download.
4. Verify foreign-account denial using only existing controlled identities and the actual authorized path; never change invoice ownership. Backend fixture tests already establish 401/403 boundaries. Restore the original Company session afterwards if it was temporarily changed.
5. Inspect Buyer and Dealer enquiry/order history Page 1 and disabled Next for this small dataset. Beyond-page-1 acceptance requires separately approved suitable disposable data or an isolated device test environment. Do not silently shrink page size or insert live records here.
6. Calendar boundary evidence comes from the disposable tests. Historical PDFs are immutable and retain their original bytes; do not expect an old PDF to change its issue-date label or regenerate it. Test a new boundary-dated invoice only in an approved isolated environment, not by changing the laptop clock or backdating live records.

## Remaining scope and stopping point

G03 invoice identity/content/layout, Package B onboarding, tax policy, cloud/providers/payments, guest links and all later packages remain untouched. The original source matrix counts remain the pre-fix audit snapshot. Package A cannot be labelled fully physically accepted until the pending device and suitable-dataset checks are completed. No commits, pushes, deployments or publication occurred.

## Physical-phone follow-up — 05-11-2026 IST

User approved phone use. Installed the signed Package A APK as an update on **5e106900 only** (`adb install -r`: Success); restored USB reverse for port 8000 and launched `in.smarttrade.localtest/.MainActivity` (Status ok). Emulator was untouched. API health returned 200.

The saved session was already definitively rejected: actual server log shows `/auth/me` 401 and `/auth/refresh` 401, followed by public catalogue category/brand/product requests returning 200. The app correctly displayed the sign-in-required state. No live session was available to restore.

Opened supported login using the existing controlled Buyer identity; actual OTP request returned **202** without an external provider. Buyer login did **not** complete: `uiautomator dump` repeatedly returned `ERROR: could not get idle state`; no successful `/auth/login` request was observed. Stopped unreliable interaction rather than forcing controls. Company sign-in could therefore not be restored; phone remains without a verified authenticated session. This is a device-verification blocker, not evidence of an invoice regression. No accounts or commercial records were created/changed.

**Still unverified on phone:** authenticated invoice download/open/repeat, foreign-owner denial and Company session restoration. Beyond-page-1 histories remain blocked by dataset size. Automated results above are unchanged; no fresh automated suites were needed for this documentation-only follow-up. Notification-containing incidental captures were discarded, and no credential/login screenshot is included as presentation evidence.

## Resumed physical verification — 05-11-2026 IST

**Completion criterion NOT MET.** Buyer invoice save/open/repeat and Company authenticated restart/restoration have not been verified on the physical phone. No application code was changed to compensate for UI automation failures.

### Inspection and APK identity

Inspected Git status (136 existing dirty entries), the report, auth client, session provider/recovery, order API contracts, private-vault download implementation and Package A regression tests. Preserved all prior changes. The user-named `SmartTrade-0.1.0-usb-arm64-release.apk` is an older artifact (22,445,982 bytes); the newer Package A artifact is 25,862,055 bytes. Read the installed base APK through ADB and compared SHA-256: it **exactly matches the signed Package A artifact** named above. Did not replace it with the older APK. Only physical serial 5e106900 was targeted.

### Physical-device evidence

- USB reverse `tcp:8000 tcp:8000`: command succeeded. Django health: HTTP 200. Read-only PostgreSQL query confirmed **smarttrade_dev / smarttrade_app**.
- Installed app launched successfully. Observed supported OTP confirmation screen left from the prior attempt. No successful phone `/auth/login` was observed after bounded input attempts.
- One bounded app-only recovery: `am force-stop in.smarttrade.localtest`, then launch: **Status ok, COLD, TotalTime 750 ms**. Public catalogue categories/brands/products subsequently returned HTTP 200. This was a signed-out restart, **not** evidence of authenticated session restoration.
- Android `uiautomator dump --compressed` still returned **ERROR: could not get idle state**. Display dimensions and ADB targeting were correct; window dump reported SmartTrade focused during inspection. Subsequent inspection found Android notification UI and an active call, so further interaction stopped to avoid interference. Incidental non-app/private captures were discarded; no login values or private PDF contents are attached.
- Buyer phone login: **Blocked**; invoice private-vault save, document-viewer open and repeat download: **Not Tested**. Failed-download metadata behavior on phone: **Not Tested**.
- Company phone login/profile, force-close/reopen restoration, expired-access recovery and temporary API outage: **Not Tested**, blocked by inability to establish a reliable phone session. API was not stopped merely to test a signed-out app.

### Live API evidence — not physical UI evidence

Used the existing controlled Buyer and Company through ordinary development OTP endpoints; tokens stayed in memory, with no token injection into the phone or external provider. No registration or commercial write occurred.

| Live HTTP check | Actual result |
| --- | --- |
| Buyer OTP request / login / profile | 202 / 200 / 200; expected PERSONAL identity, ACTIVE |
| Buyer existing order detail | 200; buyer ownership confirmed |
| Existing invoice canonical path | `/api/v1/orders/1/invoice/download`; no doubled prefix |
| Authenticated invoice download | 200; 2,013 bytes, `%PDF` signature; bytes inspected in memory only |
| Anonymous invoice request | 401 |
| Buyer refresh | 200 |
| Company OTP request / login / profile | 202 / 200 / 200; expected COMPANY identity, ACTIVE |
| Company refresh | 200 |

Sanitized durable evidence: `docs/evidence/package-a/physical-followup-api-verification.log`. These successful logins isolate the earlier expired saved session from currently valid authentication; they do not prove phone session restoration.

### Fresh automated validation

| Command | Result |
| --- | --- |
| `npm --prefix apps/mobile test` | PASS: 113 passed, zero failed/skipped |
| `npm --prefix apps/mobile run typecheck` | PASS |
| `.venv\Scripts\python.exe scripts/manage-local.py check` | PASS: no issues |
| `.venv\Scripts\python.exe scripts/manage-local.py test orders enquiries accounts --noinput -v 1` | PASS: 70 PostgreSQL tests, zero skipped, 12.726 s; disposable test DB destroyed |
| `git diff --check` | PASS |

The initial sandboxed backend test attempt could not open PostgreSQL (`Permission denied 10013`); rerunning with authorized local socket access produced the actual 70-test pass. The sandboxed migration-history probe had the same socket warning and was rerun with local access; its final result is recorded below. No migrations were applied to smarttrade_dev.

Session-code review: on profile 401/403, stored refresh is attempted; definitive refresh/account rejection clears credentials, while network/server failures retain the encrypted local session and retry. Existing mobile regression tests exercise expiry, network failure, rotation and rejected refresh. Prior live me/refresh 401 explains clearing the old saved session, but the exact historical token-expiry/revocation cause was not inferred from status codes alone.

Only this report and sanitized evidence were intentionally updated in this follow-up. No business records, source code, authentication permissions, configuration, emulator state, commits, pushes or deployments changed. Remaining action: an uninterrupted physical-phone testing window with responsive app input is needed to complete Buyer invoice and Company restoration acceptance.

Final migration consistency rerun with local PostgreSQL access: `.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run` — **PASS, No changes detected**, no database-history warning. Final normal `git diff --check` — **PASS**. Reviewed final diff statistics: pre-existing application changes remain; this follow-up introduced no source/configuration edits.

## Physical acceptance follow-up — 09-11-2026

Tested on physical phone `5e106900` using the installed SmartTrade release and the local API over USB.

| Acceptance check | Result | Evidence |
| --- | --- | --- |
| Buyer invoice save and repeat | Passed | Controlled Buyer account 7 opened its existing invoice on order 1. `GET /api/v1/orders/1/invoice/download` returned HTTP 200 and 2,013 bytes. The device vault showed one PDF entry. A repeat tap with USB forwarding removed presented the same local PDF filename, and the backend logged one download during the check. |
| Native PDF viewing | Not passed | The invoice action launched Android's share chooser with the saved PDF. No PDF reader displaying the document was observed. No external sharing or printing was performed. |
| Company restart and outage recovery | Passed | The controlled Company session survived an online cold launch, a background and foreground cycle with USB forwarding interrupted, and a second cold launch while forwarding was removed. During that launch the app reported that the local session was retained and would retry revalidation. After restoring the reverse tunnel, `/api/v1/auth/me` and `/api/v1/companies/me` returned HTTP 200 without another login, and the Company workspace showed the verified profile. |

The phone was left in the authenticated Phase 1 Controlled Company workspace with USB forwarding restored. The issued invoice and other business records were not changed.

## Android invoice viewer follow-up

**Passed on phone `5e106900`.** Installed the signed ARM64 invoice viewer release as an update. The Buyer order action opened Android's PDF viewer directly, and the viewer exposed the existing invoice's first page. Reopening from the app-private vault also worked with USB forwarding disconnected. Android reported `ACTION_VIEW`, `application/pdf`, a content URI, and the read grant flag. The backend recorded no additional invoice download. USB forwarding was restored.

The invoice and catalogue actions now use the same PDF viewer helper. All 121 mobile tests and the TypeScript check passed. The earlier Company restart and recovery result still stands.
