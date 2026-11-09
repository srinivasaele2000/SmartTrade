# SmartTrade exploratory user testing — Stage A

Date: 03-11-2026 (IST). Status: **partial coverage; mobile access recovered, destructive/state-changing scenarios outstanding**. This is an exploratory report, not release sign-off. Existing automated test totals are not evidence of completion of these journeys.

## Environment and preservation

Existing uncommitted working tree preserved. Local API at `127.0.0.1:8000`; admin at `127.0.0.1:5173`. Controlled development inventory was read from `smarttrade_dev`. No application code, configuration, migrations, roles, or marketplace records changed. Supported development login was used; it may produce normal authentication bookkeeping. Only this report and the ignored supporting probe were written. No commits, pushes, external integrations, or deployments.

## Executed coverage

| Module / role | Actual evidence | Outcome |
|---|---|---|
| Platform Admin authentication | Browser Development Login displayed STAFF account 1 and PLATFORM_ADMIN permissions | Passed |
| Verification queue | Authenticated browser displayed “No pending company reviews” and API-empty-state explanation | Passed read/empty state; no approval submitted |
| Review requests | Navigation opened restricted review-request page | Render verified; handling not tested |
| Catalogue | Browser loaded controlled product, SKU, brand, categories, INR price, publication/moderation status and dated audit snapshots | Passed read journey |
| Dealer network | Browser loaded verified controlled dealer, active grant and grant/revocation audit history | Passed read journey |
| Enquiries and quotations | Inspect enquiry opened accepted enquiry 1, quantity 2, accepted revision 1, INR 2,500 total and validity | Passed read journey |
| Orders and invoices | Inspect order opened confirmed order, immutable item snapshot, order history and bill of supply 1/2026-27/00001 | Passed read journey; PDF download not tested |
| Combined audit history | Browser explicitly displayed viewer not implemented, with directions to module-specific histories | Missing feature confirmed |
| Buyer login and boundary | Actual HTTP login 200; discovery 200; business/company/staff-order endpoints 403 | Passed tested boundaries |
| Dealer login and boundary | Actual HTTP login 200; own business 200; company/buyer-enquiry/staff-order endpoints 403 | Passed tested boundaries |
| Company login and boundary | Actual HTTP login 200; own company 200; business/buyer-enquiry/staff-order endpoints 403 | Passed tested boundaries |
| Anonymous browsing | Public products 200; dealer discovery 401 | Passed |
| Android emulator | Pixel_10_Pro window enumerated, but capture returned unrelated desktop content; coordinate action rejected outside bounds | Tooling blocker; no mobile pass claimed |

## Reproducible findings

### STA-001 — Combined admin audit viewer unavailable

- Role: Platform Admin. Module: Audit history. Severity: **Medium**. Classification: confirmed feature gap, explicitly acknowledged by UI.
- Steps: authenticate via supported Development Login; select Audit history in sidebar.
- Expected: inspect combined administrative audit records, or a documented supported equivalent.
- Actual: heading “Audit history viewer is not implemented”; text says combined viewer is not implemented and directs to Catalogue and Dealer network histories.
- Evidence: actual browser accessibility snapshot at `http://127.0.0.1:5173/#audit`, heading and explanatory text above. No screenshot file saved; snapshot evidence only.
- Reproducible: yes, navigation produced the explicit state. Module-specific catalogue and authorization histories did return actual records.

### STA-002 — Outdated enquiry-page scope explanation

- Role: Platform Admin. Module: Enquiries. Severity: **Low**. Classification: confirmed wording inconsistency.
- Steps: authenticate; open Enquiries; inspect the explanation; then open Orders and inspect the existing order.
- Expected: explanation reflects the current enquiry-to-order journey.
- Actual: Enquiries says “This workflow does not create orders, invoices or payments.” Orders shows an order and issued invoice originating from the accepted quotation. The wording can describe only the read-only admin page, but does not make that scope clear.
- Evidence: browser snapshots at `#enquiries` and `#orders`; existing accepted enquiry 1 and confirmed order with invoice.
- Reproducible: yes. No functional commercial-record failure inferred from this wording.

## Supporting API evidence

`tmp/stage_a_role_probe.py` uses the actual contract (`mobile_e164`, `code`, response `access`) and existing controlled account IDs 7 (buyer), 3 (dealer), and 4 (company). It never prints mobiles, codes, or tokens. Earlier 400/401 results were caused by incorrect probe fields and are **not application bugs**. The corrected run returned:

```text
public_catalogue=200; anonymous_discovery=401
PERSONAL login=200; discovery=200; businesses/me=403; companies/me=403; staff/orders=403
BUSINESS login=200; businesses/me=200; companies/me=403; enquiries=403; staff/orders=403
COMPANY login=200; companies/me=200; businesses/me=403; enquiries=403; staff/orders=403
```

## Blocked and untested scenarios

- Actual mobile login, registration, keyboard/forms, interrupted navigation, validation, loading/retry states, restart, logout and offline files could not be inspected reliably in this Stage A pass because the native capture surface is incorrect. Earlier phase validation is historical evidence only.
- Full Company → Brand → Product → Authorization → Listing → Buyer → Enquiry → Quotation → Order → Invoice creation journey was not repeated. Existing chain was inspected through admin, not newly completed end to end.
- Revocation, suspension, rejection, cancellation, blocking, approval, new submissions and record-edit validation were not executed in this pass. No preserved record was changed to simulate these states.
- Cross-account read checks passed for controlled buyer account 8: login 200; another buyer's enquiry 1 returned 404, order 1 returned 404 and invoice download returned 403. Buyer access to a private company document endpoint returned 403. These checks establish only these tested read boundaries; unauthorized mutation cases remain untested.
- Invoice PDF rendering/download, tax-field validation, local storage deletion/low-space/missing-file cases, refresh expiry and logout invalidation remain untested here.
- India formatting observed in admin: INR symbol, DD-MM-YYYY dates and IST labels. Invalid mobile/PIN, rounding and full India validation not exercised.
- No browser Network trace or saved screenshots were captured. Evidence consists of observed browser accessibility snapshots and actual HTTP status outputs. No claim of console-error inspection.

## Overall result

Admin read journeys and the tested role boundaries work. Two reproducible UI/feature findings are recorded; no verified security vulnerability was discovered in the executed checks. Coverage is insufficient to certify the entire application. Stage A remains incomplete for mobile and write/scenario exploration. No bugs were fixed.

## Continuation — 03-11-2026

This section supersedes the earlier mobile-tool blocker and adds coverage without repeating completed admin tests. The subsequent screenshot task recovered foreground emulator capture and direct keyboard entry. Actual Buyer, Dealer and Company sign-in, account navigation and sign-out were exercised through supported development OTP; no session injection was used. Screenshots from that actual interaction are retained under `../client-presentation/screenshots/` and are evidence of read journeys only.

| Additional check | Actual result |
|---|---|
| Invalid-format registration mobile | HTTP 400; no account created |
| Public STAFF registration attempt | HTTP 400; no staff created |
| Empty login code | HTTP 400 |
| Foreign buyer quotation response | HTTP 404; existing quotation unchanged |
| Foreign buyer order cancellation | HTTP 404; existing order unchanged |
| Buyer invoking dealer order action | HTTP 403 |
| Company invoking staff suspension | HTTP 403 |
| Owner invoice download | HTTP 200; 2,013 bytes, `%PDF` signature; visual PDF rendering not tested |
| Token refresh before logout | HTTP 200 |
| Controlled secondary-buyer logout | HTTP 204; subsequent access `/auth/me` and refresh each HTTP 401 |
| Invalid discovery PIN `123` | HTTP 200; issue STA-003 |
| Mobile Buyer | Catalogue → product → variants → dealer listing; account → orders → confirmed order/invoice record loaded |
| Mobile Dealer | Dashboard → branches → listings; account → accepted enquiry → quotation revision; incoming orders loaded |
| Mobile Company | Dashboard verification status → brands/products → authorization record loaded |
| Current emulator continuation | Company dashboard, Dealers restriction and Documents navigation worked. Current pending company showed publishing not permitted and dealer search disabled. No profile edits, submissions or file operations performed on this current session. |
| Local-file explanation | Documents explicitly states local copies do not satisfy submission requirements and are not uploaded/synchronized/visible to staff. Existing local file entry was visible; no private document opened. |

API checks used `tmp/stage_a_remaining.py`, after asserting the connection is exactly `smarttrade_dev` / `smarttrade_app`. Only controlled login/session operations and denied actions were submitted. No business-state transitions or record creation occurred.

### STA-003 — Discovery accepts malformed Indian PIN filters

- Role/module: Buyer / dealer discovery. Severity: **Medium**. Verified API validation defect.
- Steps: sign in as controlled Buyer; GET `/api/v1/dealers/listings?product=1&pin_code=123` with the issued session.
- Expected: HTTP 400 with six-digit Indian PIN validation; malformed search distinguished from a legitimate search with no eligible results.
- Actual: HTTP 200; malformed PIN is processed as a location search.
- Evidence: actual local HTTP probe output `invalid_pin: 200`; inspected `Discovery.get` normalizes the PIN but does not apply the Indian PIN validator, although location creation does.
- Reproducibility: confirmed by the live request and matching request-processing code. No inference of data exposure or malformed stored branch data.

### STA-004 — Company authorization timestamp uses raw UTC text

- Role/module: Company / dealer authorization records. Severity: **Low**. Verified formatting defect.
- Steps: company workspace → Dealers → Authorization records → inspect existing active grant.
- Expected: DD-MM-YYYY display in IST, consistent with India-only UI rules.
- Actual: Updated value is raw ISO UTC with `Z`, e.g. `2026-11-01T19:25:27.485712Z`.
- Screenshot evidence: `../client-presentation/screenshots/company-mobile/04_dealer_authorization.png` from the actual emulator, readable and unedited.
- Reproducible: yes, captured actual record. No business record was edited.

## Current coverage limits and outcome

Four findings total (STA-001–004); no fixes applied. Buyer/dealer/company read journeys and selected authorization boundaries are verified. The invoice bytes and logout invalidation now pass actual API checks. Existing screenshot images evidence actual mobile navigation; they do not establish successful form submissions.

Still untested in this Stage A continuation: new-account registration success, company submission/approval/rejection, brand/product edits, dealer grant/revoke and stock transitions, new enquiry/revised quotation/expiry/acceptance/cancellation, invoice issue/tax validation, sustained token refresh on device, application restart, offline file access, deletion, missing-file and low-space behavior. The full chain was inspected using existing linked records, not newly executed from registration to invoice. These scenarios would require dedicated new controlled records or changing existing states; they were left unchanged during this non-destructive continuation.

The current emulator session had switched to a pending company containing user-entered contact details since screenshot capture. Only read navigation was performed; screenshots containing these details were not added to the report. No admin tests were restarted, and no browser Network or console inspection is claimed. The application is not certified as fully tested; Stage A stops with the remaining coverage explicitly listed.

## Final outstanding-scenario pass — 03-11-2026

The following results supersede corresponding untested entries above. New commercial records are explicitly labelled `STAGE-A disposable` in requirements/notes/reasons. Existing enquiries/orders/invoices were not changed or deleted. No application code changed. Supporting driver: ignored `tmp/stage_a_transitions.py`, using actual HTTP requests and asserting `current_database()=smarttrade_dev`, `current_user=smarttrade_app` before any writes.

| Scenario | Steps and actual evidence | Result |
|---|---|---|
| New buyer enquiry | Existing controlled buyer 7 POST `/enquiries`, branch 1, listing 1, quantity 1, labelled requirements. Returned 201, enquiry 2 SUBMITTED. Separate labelled enquiries 3 and 4 also returned 201. | **Passed (API)** |
| Quotation revision | Dealer 3 quoted enquiry 2 at INR 10 then INR 11. Both POSTs returned 201; revision 1 SUPERSEDED and revision 2 SENT in actual response. | **Passed (API)** |
| Buyer rejects quotation | Buyer POST enquiry 2 response REJECT with test reason; 200, enquiry REJECTED. | **Passed (API)** |
| Revised quotation accepted | Dealer sent revision 3 at INR 12 (201); buyer ACCEPT returned 200 ACCEPTED. | **Passed (API)** |
| Accepted quote to order | POST `/orders` with accepted quotation; 201, order 2 PENDING. | **Passed (API)** |
| Confirmation and fulfilment | Dealer POST actions CONFIRM → PROCESSING → READY → COMPLETE on order 2; each 200, respective states CONFIRMED → PROCESSING → READY → COMPLETED. | **Passed (API)** |
| Invalid completed-order transition | Dealer attempted CONFIRM again on completed disposable order 2; 400, no successful state change. | **Passed (API)** |
| Buyer cancellation | Separate enquiry 3 → quote → accept → order 3 PENDING; buyer cancel with reason returned 200 CANCELLED. | **Passed (API)** |
| Dealer rejection | Separate enquiry 4 → quote → accept → order 4 PENDING; dealer REJECT with reason returned 200 REJECTED. | **Passed (API)** |
| Other submission workflows | New company verification/product/branch submissions require dedicated new fixture identities and further business data. Not submitted in this scoped pass. | **Blocked / unexecuted** |
| App restart / session restoration | Actual emulator was inspected. Current session belongs to a user-entered pending company rather than the controlled screenshot account. Attempted Expo development-menu shortcut did not produce a restart menu. No forced termination, storage injection or user-session replacement performed. Session restoration after a true restart is not verified. | **Blocked** |
| Local-file persistence after restart | Existing local entry visible on Documents screen before restart; no reliable restart performed, so persistence not proven in this pass. | **Blocked** |
| API unavailable → reconnect | No outage was induced while current user session was active. Shared local API and current session were left running. No observed outage/recovery result is claimed. | **Blocked / unexecuted** |
| Insufficient device space | No isolated disposable storage environment available; filling the shared emulator could disrupt existing private files. No disk-filling or application fault injection used. | **Blocked** |
| Missing files | Would require removing/renaming existing private file contents or preparing a dedicated disposable file fixture. Existing user local file was preserved. No missing-file result claimed. | **Blocked** |
| Invalid file / access failure | Current document workspace contains user-session files. No files selected, permission state altered or private contents opened. Selection validation and access failure are not verified. | **Blocked / unexecuted** |

### Retained evidence of transitions

Actual HTTP output from the controlled driver:

```text
enquiry 2: 201 SUBMITTED
quote v1: 201; quote v2: 201; [v1 SUPERSEDED, v2 SENT]
reject: 200 REJECTED; quote v3: 201 QUOTED; accept: 200 ACCEPTED
order 2: 201 PENDING
CONFIRM 200 CONFIRMED; PROCESSING 200 PROCESSING; READY 200 READY; COMPLETE 200 COMPLETED
CONFIRM after completion: 400
enquiry 3/order 3: created through APIs; buyer cancel 200 CANCELLED
enquiry 4/order 4: created through APIs; dealer reject 200 REJECTED
```

Three disposable enquiries (2–4), five quotation revisions in total, and three orders (2–4) were retained with their append-only audit records. No invoices were created in this pass. No failures occurred in the executed commercial scenarios; no additional bug ID is justified. These are real API workflows, not claims of performing each submission by tapping the mobile UI.

### Stage A final assessment

Four reproducible findings remain open: **STA-001 Medium** combined audit viewer unavailable; **STA-002 Low** enquiry-page scope wording; **STA-003 Medium** malformed PIN accepted by discovery; **STA-004 Low** raw UTC company authorization timestamp. No fixes applied. Commercial submission/revision/rejection/acceptance/confirmation/cancellation/completion now pass actual local API checks on disposable records. Restart, outage/recovery and storage-failure exploration remain blocked/unexecuted as itemized above, so Stage A is not a complete reliability sign-off. Prior phase or automated test success is not substituted for those missing observations.
