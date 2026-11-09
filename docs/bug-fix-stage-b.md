# Stage B — four Stage A findings

03-11-2026 IST. Existing dirty working tree preserved; no business records changed, migrations applied, dependencies added, commits, pushes or deployments.

## STA-001 — audit route

Reproduction: staff sign-in → Audit history; Stage A observed an explicit not-implemented placeholder. Root cause: App.tsx special-cased audit before the ordinary sign-in/render path; no component called existing audit APIs.

Fix: route now uses normal authentication gating and a read-only AuditHistory hub, with independent READ_AUDIT permission, existing catalogue/authorization/listing audit endpoints, source selection, pagination, loading/error/retry/empty states. It explicitly states coverage is not exhaustive. No new backend endpoint or permission introduced. Company verification and commercial histories remain in their existing workflows; no fabricated unified timeline.

Files: apps/admin/src/AuditHistory.tsx (new), App.tsx, navigation.ts; tests/stage-b.test.mjs (new). Regression render tests cover missing permission, allowed sources, loading and explicit coverage limitations. Actual browser: signed-out #audit showed sign-in; supported Development Login loaded 15 real catalogue events; switching to authorization loaded 7 real events with actor/action/reason and IST timestamps. No business actions submitted.

## STA-002 — enquiry wording

Reproduction: Enquiries claimed the workflow did not create orders/invoices while Orders showed its downstream commercial record. Root cause: Phase 6 explanation outlived the later order implementation.

Fix: Enquiries.tsx now explicitly describes this admin page as read-only, explains accepted quotations can become orders/invoices in buyer/dealer workflows, and states payment collection is unsupported. Regression test renders the actual component and checks this explanation and removal of old claim.

## STA-003 — malformed discovery PIN

Reproduction: authenticated GET /api/v1/dealers/listings?product=1&pin_code=123 returned 200 in Stage A. Root cause: Discovery.get normalized search PIN but never validated it; creation used the existing India validator.

Fix: dealers/views.py applies existing INDIAN_PIN_PATTERN whenever pin_code is supplied, before location fallback. Invalid/empty/blank PIN yields the existing 400 validation envelope with field_errors.pin_code. Normalized spaced valid PINs remain supported, as does locality fallback from a valid unmatched PIN. No DB/schema changes.

Regression: dealers/tests.py covers three-digit, leading-zero, alphabetic, empty, whitespace and overlong values with locality supplied; valid spaced PIN succeeds. Existing fallback fixtures changed from the invalid word 'missing' to valid unmatched '999999'. First run exposed these fixture assumptions and the existing error-envelope nesting; corrected tests then passed in full suite. Tests exercise actual DRF request handling on disposable PostgreSQL fixtures. The long-running no-reload server was not restarted just for this check, so its loaded PIN handler is not claimed reverified live.

## STA-004 — company authorization timestamp

Reproduction: Company → Dealers → Authorization records displayed raw ISO UTC; evidence in client-presentation/screenshots/company-mobile/04_dealer_authorization.png. Root cause: CompanyAuthorizations.tsx interpolated updated_at directly.

Fix: use existing istDateTime helper, preserving backend UTC values. Component regression renders 2026-11-01T19:25:27.485712Z as 02-11-2026 00:55 IST and asserts raw time is absent. Files: apps/mobile/src/CompanyAuthorizations.tsx and tests/company-authorizations-component.test.mjs (adapter imports real formatter). No API contract changed. Fresh emulator navigation for this specific fix was not repeated; verification is actual component render plus TypeScript.

## Commands and results

| Command | Actual final result |
|---|---|
| .venv Python tmp/manage_local.py test -v 1, cwd services/api | 164 PostgreSQL tests passed, no skips, 19.091 s; disposable test database destroyed normally |
| tmp/manage_local.py check | No issues |
| tmp/manage_local.py makemigrations --check --dry-run | No changes detected |
| npm test, apps/admin | 25 passed, 0 failed/skipped |
| npm run typecheck, apps/admin | Passed |
| npm run build, apps/admin | Passed; 30 modules |
| npm test, apps/mobile | 84 passed, 0 failed/skipped |
| npm run typecheck, apps/mobile | Passed |
| git diff --check | Passed; existing LF/CRLF notices only |

Initial mobile component tests needed the new india import added to their existing isolated renderer; final test uses the real formatter. No production providers or existing business data touched. Existing Node module-type notices remain unrelated to these fixes. Hermes export was not run for these narrowly scoped fixes.

## Outcome and limitations

All four findings addressed within existing architecture. STA-001 is resolved as a shared hub for available histories, not an exhaustive merged platform log; adding further audit sources is outside this change. No fresh device verification or restarted-server PIN check is claimed. Stage A reliability scenarios previously marked blocked remain outside these four fixes. Stop after Stage B.

## Live verification follow-up — 03-11-2026

- **Audit hub: live passed.** Fresh browser #audit required supported staff login, loaded 15 catalogue events, and switched to 10 dealer listing events with actual actor/reason/IST values. Prior live authorization-source verification remains valid. No records changed.
- **Discovery PIN: live passed after restart.** Confirmed PID 32032 command was SmartTrade tmp/manage_local.py runserver 127.0.0.1:8000 --noreload, stopped only that process and restarted via project .venv. Health 200; authenticated GET product=1&pin_code=123 returned 400 VALIDATION_ERROR, field_errors.pin_code='Use a six-digit Indian PIN code.'; valid 560001 returned 200. No migrations or business writes.
- **Mobile enquiry wording: additional correction.** Original STA-002 was an admin issue, so mobile wording was not changed previously. Inspection found mobile still said no order was inferred. EnquiryWorkspace.tsx now explains accepted quotations can become orders, invoices follow dealer confirmation, and payments are unsupported. Added regression in tests/enquiries.test.mjs. Fresh live enquiry screen verification remains pending.
- **Company authorization: live failed, targeted correction made, device recheck incomplete.** Signed into existing controlled company through supported OTP; Company dashboard → Dealers → Authorization records reproduced Render Error 'Invalid time value'. After timestamp normalization, reattempt exposed 'Cannot read property replace of undefined'. Root cause confirmed by component/useResource inspection: on tab switch the previous dealer-search rows can render transiently as grant rows before the new request starts; those rows have no updated_at. The formatter now handles missing/invalid input safely and normalizes Django microsecond precision to milliseconds. No date is fabricated: invalid dates show 'Date unavailable'. Regression covers microsecond input, invalid input and undefined, in addition to the existing actual component IST render test. Files added to this follow-up: src/india.ts, tests/india.test.mjs. Initial assumption that precision alone caused the crash was insufficient; missing transient input was confirmed on-device.
- Fast Refresh recovered the app, but the saved session subsequently expired and was cleared by normal server revalidation. Final actual timestamp display has **not** been reverified; this finding cannot yet be marked live passed. No auth bypass or account privilege changes were used.

Actual emulator error screenshots were observed through native capture (CompanyAuthorizations stack; india.ts replace line). No sensitive login screenshots were saved. Automated checks are separate from these live results. Original 164 backend/25 admin passes remain applicable: follow-up edits are mobile-only. No unrelated application changes or existing business record mutations.

## Final pending check — mobile enquiry wording

**Passed: actual Pixel_10_Pro screen, 03-11-2026.** On resumption the emulator was at Android home. Reopened existing Expo Go → recent SmartTrade project; the old session was expired, so signed in through supported development OTP using existing controlled Buyer account 7. Opened My account → Enquiries and quotations. The loaded Buyer workspace showed existing enquiry history and this exact text:

> Item quantities and prices are explicit. Quotations use INR. An accepted quotation can become an order; invoices are available after dealer confirmation. No tax or delivery amount is inferred. Payment collection is not supported.

Evidence: [Actual mobile enquiry screen](evidence/stage-b/mobile-enquiry-wording.png), captured from the emulator screen region, 404 × 848; readable and unedited, no phone/code/token/private document contents. Expo floating control remains visible in the corner. This is live device verification, not an automated render assertion. No enquiry or other business action was submitted. No code changes or repeated test suites in this final check.

Prior continuation also completed the timestamp recheck after the initial failure: controlled Company → Dealers → Authorization records displayed **Updated: 02-11-2026 00:55 IST**, without a render crash. That observed result supersedes the earlier interim 'device recheck incomplete' entry; it was not repeated in this final wording-only check. Mobile follow-up automated suite: 85 passed, zero failed/skipped; TypeScript passed. Earlier entries describing pending verification are retained as chronology, not current blockers.

All four Stage B fixes now have live application/API evidence. Existing Stage A reliability gaps remain outside this verification. No commits, pushes or deployments. Stop after verification.
