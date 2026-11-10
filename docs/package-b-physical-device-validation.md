# Package B physical Android validation

07-11-2026 IST. Physical acceptance remains blocked at sign-in. The signed update installed and loaded the catalogue over USB. Two bounded ADB tap attempts left the app on the catalogue, with no phone OTP or login request observed. The accessibility hierarchy continued to expose the catalogue search field and Sign in control. A manual Sign in tap was requested to distinguish input delivery from a navigation defect.

| Test | Physical-device result | API/Admin result | Evidence | Blocker or notes |
| --- | --- | --- | --- | --- |
| Personal profile | BLOCKED | PASS for read and role boundary. Personal GET 200 with linked mobile, Dealer GET 403. | Sanitized API log | Save, reopen, read-only mobile UI and PIN/state validation on phone remain untested. |
| Dealer business profile | BLOCKED | PASS for read. Controlled Dealer GET 200, active account and verified business, two operating branches. | Sanitized API log and admin onboarding view | Profile edits, validation and registered-address separation on phone remain untested. |
| Category and brand declarations | BLOCKED | PASS for reads. Declarations and options returned 200 with two canonical brands available. | Sanitized API log | Multi-selection, save, reopening and Other behavior remain untested on phone. |
| Other-brand suggestion and review | BLOCKED | PASS for empty state in API and admin browser. Live review actions NOT TESTED. | Suggestion list 200 with zero suggestions. Admin showed No suggestions. | No suitable existing suggestion. Creation was deferred until the physical workflow could be reached. |
| Trade-worker contacts and consent | BLOCKED | PASS for empty data and permission boundary. Dealer GET 200 with zero contacts and minimum ten. Buyer 403 and anonymous 401. | Sanitized API log | No controlled contacts with consent. No third-party record was created. Phone empty state, progress and validation remain untested. |
| Admin and duplicate review | NOT TESTED on phone. Admin is a browser workflow. | PASS for dealer detail and empty duplicate state. Dedicated contact access denied. Authorized contact inspection BLOCKED. | Staff onboarding GET 200, browser displayed No potential matches found, private contact control absent, staff contact GET 403 | There were no active staff assignments for the dedicated contact-review permission. |
| Company authorization integrity | BLOCKED for declaration mutation check | Read-only baseline recorded one existing grant. | Database aggregate preflight | No declaration or review write was submitted, so there is no live before-and-after mutation test. |
| Existing Buyer and Dealer regression | PASS for physical public catalogue. Authenticated phone journeys BLOCKED. | PASS for read-only API smoke checks. Buyer discovery, Dealer locations and Dealer listings returned 200. | Sanitized API log and physical catalogue HTTP records | Phone authenticated discovery and listing workflows remain untested. |

## APK and environment

- Physical serial `5e106900`, model `23049PCD8I`. USB reverse `tcp:8000 tcp:8000` succeeded.
- APK `client-presentation/apk/SmartTrade-0.1.0-package-b-arm64-release.apk`. Package `in.smarttrade.localtest`, version `0.1.0` (code `1`), native ABI `arm64-v8a`. Gradle build passed. APK Signature Scheme v2 verified with one signer.
- SHA-256 `fd07f385428ec7bd3dd7759169468ea6173be19b3c837444e47b25705a5ee71f`. The installed base APK matched the release artifact by SHA-256.
- `adb install -r` returned Success. Activity cold launch returned Status ok in 1,195 ms. Physical catalogue categories, products and brands returned HTTP 200.
- Confirmed PostgreSQL database `smarttrade_dev` and application role `smarttrade_app`. Reviewed the targeted migration plan and applied only `accounts.0004_package_b_profiles` and `dealers.0004_package_b_profiles`. Both are marked applied.
- Django and Vite run on loopback. API health returned 200 directly and through the Vite proxy. Django checks, both TypeScript checks and `git diff --check` passed.

## Evidence and scope

Sanitized API and physical request evidence is in `docs/evidence/package-b/physical-validation.log`. The browser check used the existing designated development reviewer. It reached the Dealer network onboarding panel and observed identity, declarations, suggestion and duplicate sections. No screenshot is attached. Evidence records endpoint statuses and UI state without private fields, tokens or credentials.

No source fix was made. The previously recorded automated results of 178 PostgreSQL, 116 mobile and 26 admin tests remain the automated baseline. This pass applied local schema changes and installed the APK while preserving app data. No profile edits, contact or suggestion creation, grant changes or staff permission grants were made.

## Sign-in diagnostic follow-up — 07-11-2026 IST

Phone `5e106900` was connected. SmartTrade's `.MainActivity` was the focused and obscuring window and PID `14641` was running. Installed package `in.smarttrade.localtest` version `0.1.0` (code `1`) matched the previously signature-verified APK by SHA-256. Django health returned 200. The USB reverse mapping was absent after reconnect and was restored as `UsbFfs tcp:8000 tcp:8000`.

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Open sign-in form | PASS for observed screen | The form was already open at inspection. Android hierarchy contained Welcome back, the Indian mobile number field and Send OTP. The catalogue search field was absent. The transition that opened the form was not observed. |
| Physical screen and controls | PASS for capture and hierarchy | ADB capture was 1080 × 2400. Sign in header button bounds were `[469,111][699,243]`. The mobile field was enabled, focusable and clickable at `[118,903][962,1041]`. Android reported a shown IME during diagnostics. A populated field was detected, so the unredacted capture was withheld and discarded. |
| Controlled text entry | BLOCKED | Select-all/delete plus text entry did not produce the controlled mobile. An additional attempt using explicit Android end and delete keys left the field value unchanged. Filtered Android logs did not establish whether the input events were delivered, rejected, or intercepted. |
| Phone OTP and authentication | NOT TESTED | Stopped before Send OTP because the field did not match the controlled account. No phone OTP submission or login was observed during this diagnostic. |
| Personal and Dealer workflows | BLOCKED | Awaiting authenticated phone access. Prior read-only API and Admin results in the main table still apply. |

The confirmed blocker is reliable entry into the populated phone form. There is insufficient evidence to attribute it to SmartTrade, the keyboard, or Android's handling of injected input. The next diagnostic is a physical keyboard entry and ordinary development login with the controlled Personal account, then confirmation of the authenticated My account screen. No application source, account data, business records or permissions changed during this follow-up.

## Authenticated session follow-up — 07-11-2026 IST

Device `5e106900` remained connected with USB reverse forwarding. Django logs showed the manual OTP request returning 202, login returning 200 and the authenticated profile and token refresh returning 200. The physical catalogue displayed My account. A standard ADB tap did not visibly navigate. After one mouse-source ADB tap, the account screen was visible and displayed **COMPANY**, **Account status: ACTIVE**, and Company dashboard. The phone session was preserved.

| Check | Result | Evidence |
| --- | --- | --- |
| Existing physical authentication and account navigation | PASS | My account showed an active Company session. See `docs/evidence/package-b/active-account-role.png`. |
| Personal profile navigation and editing | BLOCKED | The actual role is COMPANY. `apps/mobile/App.tsx` renders Personal profile only for `account_type === 'PERSONAL'`. Load, edit, save/reopen, mobile read-only presentation, and invalid PIN/state checks were not exercised on the phone. |
| Dealer profile, declarations, suggestions and contacts | BLOCKED | Dealer verification awaits the Personal test and the controlled Dealer session. No profile, declaration, suggestion or contact mutation occurred. |
| Admin permissions and Buyer/Dealer regression | NOT TESTED again in this follow-up | Prior live API and Admin browser results in the main table still apply. No grants were touched. |

To resume, the user needs to switch to the existing controlled Personal account and confirm that My account reads PERSONAL. The prior ADB login-entry limitation was not retested.

## Controlled Personal session switch — 07-11-2026 IST

**PASS.** The physical phone `5e106900` was left on My account with **PERSONAL** and **Account status: ACTIVE** visible. Read-only inspection of `smarttrade_dev` confirmed controlled account ID `7`, an active PERSONAL subtype, and an exact match between its registered mobile and the existing controlled identity fixture. The mobile number and OTP are omitted.

The first mouse-source sign-out tap left the Company screen visible. A short held touchscreen press successfully activated Sign out. The same input method reached the sign-in form and the existing development OTP flow. Django recorded logout 204, OTP request 202, login 200 and authenticated profile 200. The live Android hierarchy was checked again after capture and still showed PERSONAL, ACTIVE, Personal profile and Sign out.

Screenshot evidence is in `docs/evidence/package-b/personal-account.png`. The Personal profile entry was visible and left unopened. Profile editing and Dealer workflows remain NOT TESTED on the phone.

## Non-destructive physical validation — 09-11-2026 IST

Phone `5e106900` ran the signed role-identity update with the local API over USB. The controlled Buyer (account 7) and verified Dealer (account 3) each signed in through the existing development OTP flow. The API recorded OTP 202, login 200 and profile reads 200. No mobile numbers or OTPs are included in the evidence.

| Result | Physical check | Evidence |
| --- | --- | --- |
| PASS | Personal profile loaded all six fields and displayed the account mobile as read-only text matching account 7. | Device hierarchy and `GET /auth/personal-profile` 200. |
| PASS | The unsaved PIN value `123` triggered “Use a six-digit Indian PIN code.” Leaving the screen discarded the draft. | Device hierarchy and identical before/after Personal profile. A screenshot was withheld because the account mobile remained visible in the captured validation viewport. |
| PASS | Dealer Profile displayed the owner/authorized-person, business email and registered address controls. Branches displayed an operating address separately. | [Dealer profile](evidence/package-b/dealer-profile.png) and live profile/location reads. |
| PASS | Eight dealer categories were visible. Electrical and Other were selected simultaneously. Two existing canonical brands were also selected simultaneously on a subsequent draft. | [Category draft](evidence/package-b/dealer-category-draft.png) and [brand draft](evidence/package-b/dealer-brand-draft.png). |
| PASS | Other-brand name entry enabled the suggestion submit button. The draft was left by switching tabs. | Phone hierarchy. No suggestion submitted. |
| PASS | Contacts displayed an empty list and progress of 0 of 10. Checking consent enabled Save contact and clearing it disabled Save contact again. | [Contact progress](evidence/package-b/dealer-contact-progress.png) and [consent cleared](evidence/package-b/dealer-contact-consent.png). No worker data was entered. |
| FAIL | Unsaved category selections disappeared while remaining on Declarations. | Both selected flags were first observed on the phone, then both were clear. At 19:21:04 IST the authenticated refresh was followed by a workspace/declaration reload and a brand request without the selected category filters. The profile reload can temporarily unmount the declaration form. |
| PENDING | Valid profile/declaration persistence, submitted suggestion review, contact persistence and timestamp, and staff duplicate review. | This pass was limited to unsaved drafts and existing data. |

Read-only comparisons found the Personal and Dealer profiles, existing grants, branches, listings, declarations, suggestions, contacts and product taxonomy unchanged. No declaration or suggestion was submitted, so grant integrity was confirmed for the exercised draft flows only.

The phone was left authenticated as the controlled Dealer in Dealer workspace → Contacts with consent unchecked. No Git commands were run.

### Dealer draft refresh fix

The mobile fix retains the last loaded Dealer profile during a refetch so that the active tab and its forms remain mounted. Declaration and profile forms accept new server values while clean and preserve edited values until a successful save or until the user leaves the form. The account-scoped workspace key still separates sessions. The tests exercised the real workspace and resource hook with a rotated token, an in-flight fetch, a failed profile fetch and recovery. All 119 mobile tests passed, and `tsc --noEmit` passed. The physical declaration test is recorded below.

Manual check for `5e106900` with a build containing the fix:

1. Sign in as the controlled Dealer and open **Dealer workspace → Declarations**.
2. Select two categories, select available brands, and enter a non-sensitive draft in **Suggested brand name** and **Context**. Leave the save and submit buttons untouched.
3. Stay on Declarations through an automatic token refresh. In the local Django log, confirm `POST /auth/refresh` and the subsequent `GET /businesses/me` and declarations reads completed. Allow about one minute for the background refresh, or briefly background and reopen the app without force-closing it.
4. Verify the same categories and brands remain selected and both text fields retain their exact values. Repeat on **Profile** with an unsaved identity field if needed.
5. Leave the tab to discard the drafts. Keep the check local and avoid saving test values.

### Signed draft retention build — 09-11-2026 IST

Built `client-presentation/apk/SmartTrade-0.1.0-dealer-draft-retention-arm64-release.apk` with the existing local release configuration. APK v2 signature verification passed with one signer. Package `in.smarttrade.localtest`, version `0.1.0` (code `1`), contained only `arm64-v8a` native code. SHA-256 `d5a88ac9e1d2f78c0b4906575b00813455af3f6cbaf5e3c4358554b1849fddec`.

The in-place install on physical phone `5e106900` succeeded and the installed APK matched that hash. Launch and loopback API access over USB succeeded. The first test attempt briefly lost foreground focus before editing began.

**Physical declaration draft retention passed.** The controlled Dealer selected Electrical and Other, selected two canonical brands, and entered a draft suggestion name and context. Backgrounding and reopening SmartTrade kept the same process. At 19:35:32 IST the local API returned 200 for the token refresh, account revalidation, Dealer profile and declarations refetches. The subsequent brand request included both selected category filters. All six draft values were verified on the phone after the refresh.

| Physical evidence | Before refresh | After refresh |
| --- | --- | --- |
| Two categories selected | [Before](evidence/dealer-draft-retention/categories-before.png) | [After](evidence/dealer-draft-retention/categories-after.png) |
| Two canonical brands selected | [Before](evidence/dealer-draft-retention/brands-before.png) | [After](evidence/dealer-draft-retention/brands-after.png) |
| Draft suggestion name and context | [Before](evidence/dealer-draft-retention/suggestion-before.png) | [After](evidence/dealer-draft-retention/suggestion-after.png) |

[Sanitized API evidence](evidence/dealer-draft-retention/refresh-requests.log)

ADB interaction retries were needed to confirm the brand selection and to dismiss the keyboard that Android reopened on return. The values were inspected on the same draft before and after the recorded refresh. Leaving Declarations discarded the draft and left the controlled Dealer on Contacts. Read-only comparisons confirmed the protected profiles, grants, branches, listings, declarations, suggestions, contacts and taxonomy were unchanged. No Git commands were run.
## Trade-worker contacts follow-up

| Check | Result | Evidence |
| --- | --- | --- |
| Empty state and progress | Passed on phone | The controlled Dealer saw “No contacts saved” and “0 of 10 minimum contacts for verification submission.” |
| Explicit consent | Passed on phone | Save contact was disabled before confirmation, enabled after confirmation, and disabled again when the draft was edited. |
| Indian mobile validation | Passed on phone | The synthetic input `123` triggered “Use an Indian mobile number in +91 format.” The app rejected it before making a save request. [Phone screenshot](evidence/package-b/dealer-trade-contacts.png) |
| Private endpoint | Passed | An anonymous request to `/api/v1/businesses/me/trade-contacts` returned HTTP 401. The isolated backend test also verified owner isolation and separate staff permission. |
| Successful submission, UTC timestamp, and updated progress | Blocked on phone. Passed in disposable PostgreSQL. | The API test returned HTTP 201, confirmed a UTC offset of zero, and verified the count advanced to 1 of 10. A valid submission on the phone would write to `smarttrade_dev`, which this task prohibited. |

Phone `5e106900` was left signed in as **Phase 3 Controlled Dealer** on **Dealer workspace → Contacts**. The form was empty, consent was unchecked, Save contact was disabled, and progress remained at 0 of 10.

## Admin review verification

| Admin review workflow | Result | Evidence |
| --- | --- | --- |
| Other-brand suggestions | Passed in Admin component and API tests | The UI showed the submitting business ID, suggestion name and context. Approval, mapping and rejection succeeded with a reason. Blank reasons were rejected. Canonical ownership and authorization grant count stayed the same. |
| Duplicate business review | Passed in Admin component and PostgreSQL API tests | Exact normalized matches triggered alerts. Near or partial matches did not. Distinct and Follow-up produced separate history entries. PostgreSQL rejected audit updates and deletions. |

Admin actions used disposable fixtures. Live browser submissions and physical phone interaction were outside this verification. The Admin suite passed 30 tests and the PostgreSQL onboarding suite passed 9.

