# Stage E — final reliability verification

03-11-2026 IST. Read Stage C, Stage D and Phase 8 reports. This report includes the original Stage E work and its resumed continuation; no completed test was repeated. **Partial verification, not a reliability sign-off.** No application code changed, emulator reset/reinstall, existing file deletion, production connection, business-record mutation, commits, pushes or deployments.

## Company outage/recovery — completed before interruption

Used existing controlled Company account 4 through supported development OTP. Confirmed COMPANY/ACTIVE account and actual verified company dashboard. Identified API PID 1644 by its SmartTrade runserver command, stopped only that process and confirmed health unavailable. Refresh company status showed connection error and **'Server unavailable: local session retained for device files. Server revalidation will retry.'** Account remained signed in.

Restarted API with existing .venv, 127.0.0.1:8000 only. Health returned 200. The offline session message cleared automatically, actual company name returned, and Documents showed the company document policy without another login or manual company retry. This was observed before resumption; not repeated.

Evidence: [Company offline session retained](evidence/stage-e/company-offline-retained.png). Recovery was observed on actual Documents screen but a separate recovery screenshot was not saved. No claim based solely on automated tests.

## Scenario statuses

| Test | Status | Actual evidence / limitation |
|---|---|---|
| Company sign-in and valid protected access | Passed | Actual COMPANY/ACTIVE, verified dashboard through existing account. |
| Company temporary API outage retains identity | Passed | Actual offline-session banner and Company workspace; screenshot above. |
| Company automatic session recovery | Passed | After API restart, banner cleared and actual company data returned without login. |
| Valid API access/refresh | Passed | Controlled Company login; /auth/me 200; /auth/refresh 200. |
| Invalid refresh rejection | Passed (API) | /auth/refresh with explicit invalid test string returned 401. |
| Definitively revoked refresh rejection | Passed (API) | Supported /auth/logout returned 204; same previously valid access and refresh then each returned 401. |
| Device credentials cleared after definitive revocation | Blocked | Company session was deliberately revoked through supported API, but Android black screen prevented observing its subsequent session-rejection UI. No raw SecureStore token inspection/injection used. Do not substitute API denial for proof of device clearing. |
| Network failure does not clear credentials | Passed (observable session behavior) | Company stayed signed in and recovered automatically. Encrypted-storage contents not extracted; no secrets printed. |
| Save disposable Company document | Blocked | Opened Select file for this device after recovery; Android picker transition went black. No file was selected or import confirmed. |
| Document and metadata after force-close/reopen | Blocked | OS/picker remained unresponsive; no fresh force-close/reopen completed. Existing Stage C Dealer synthetic copy preserved; Stage D listing is historical evidence only. |
| Missing local file handling | Blocked | No isolated private-file fault fixture; deleting/renaming existing documents prohibited. No safe app-supported method to remove only test contents while retaining metadata. |
| Invalid file handling | Blocked | Native picker unavailable; no invalid fixture selection executed. |
| Size-limit rejection | Blocked | Picker unavailable; no limit settings changed or oversized file selected. |
| Insufficient storage | Blocked | No isolated quota/fault environment. Filling shared emulator storage could affect existing documents; not attempted. |
| File-access failure and recovery | Blocked | No isolated revoked-URI fixture; native picker/Android interruption cannot establish an application file-error response. |

## Revocation evidence — resumed work

Temporary ignored `tmp/stage_e_revocation.py` uses existing local HTTP helper, which asserts smarttrade_dev / smarttrade_app before access. Existing Company account 4 is the only target. Login and supported logout alter authentication bookkeeping/token version only; company/catalogue/dealer/commercial records untouched. Tokens remained in process memory and were never printed or saved. Actual output:

```text
valid_access: 200
valid_refresh: 200
invalid_refresh: 401
logout: 204
revoked_access: 401
revoked_refresh: 401
```

The logout intentionally invalidates the controlled Company's other existing sessions, including its emulator session. A subsequent test login is permitted through the normal local development flow, but was not attempted while Android was unresponsive. No account role, password or database privilege changed.

## Android interruption and safe recovery attempts

At original Stage E start, Android displayed **'Process system isn't responding'**. Chose Wait; Android recovered and Company tests completed. Later, selecting a local document caused a black Android window. On resume, refreshed the current window binding and observed the same black screen. Attempted Home once: status icons returned, but launcher/app surface stayed black. Attempted Back once: no usable app/picker recovered. Stopped further UI attempts; no reset, reinstall, data clear, file deletion or repeated force-kill.

[Actual unresponsive Android screen](evidence/stage-e/android-unresponsive.png). This is an environment interruption, not a confirmed SmartTrade application defect. No stack trace or reproducible app-specific cause was obtained. The initial ANR text was observed but no separate ANR screenshot file was saved.

API remained healthy at final read-only check: GET /api/v1/health returned **200**. API, Metro and emulator left running. No bug fixes or unrelated tests performed. `git diff --check` on this report passed.

## Consolidated reliability summary

- Stage C identified restart-refresh, outage-session-loss and Dealer-vault API-dependency defects; Stage D implemented and regression-tested fixes.
- Stage D actual Dealer outage/recovery and Stage E actual Company outage/recovery now pass. Stage E confirms real backend rejection of invalid and revoked refresh credentials.
- On-device definitive-revocation clearing, force-close document persistence and storage-failure validation remain blocked, explicitly not passed. No full reliability approval is supported until those device checks are completed on a responsive Android runtime.
- Stage E introduced no new confirmed SmartTrade bug. Preserve the OS interruption evidence for emulator diagnosis; no application fix inferred from a black screen. Stop after verification.
