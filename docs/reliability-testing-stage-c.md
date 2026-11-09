# Stage C — reliability testing

03-11-2026 IST. Actual Pixel_10_Pro, Expo Go/SmartTrade, local Django API, smarttrade_dev. Read Stage A, Stage B and Phase 8 reports before testing. **Partial reliability coverage; not a release sign-off.** No bugs fixed, application code changed, business records submitted/deleted, database migrations, cloud integration, commits, pushes or deployment.

## Results

| Scenario | Status | Actual steps and results |
|---|---|---|
| Force-close/reopen | Passed | Android Settings → Apps → Expo Go → Force stop → OK. Force-stop became disabled. Used Open icon → recent SmartTrade project. No cache/data clearing or reinstall. |
| Server revalidation of saved session | Passed for rejection of expired access | After reopen the app displayed 'Saved session is no longer valid. Sign in again.' It did not silently grant access. |
| Seamless session restoration with refresh | Failed / STC-001 | Saved session was discarded rather than using its stored refresh token after access expiry; see finding below. |
| Still-valid access restoration | Not Tested | Force-close run reached the expired-access case; a separate immediate fresh-login restart was not performed. |
| Logout and subsequent login | Not Tested | Stage B has prior actual controlled sign-out/login coverage; not repeated as Stage C evidence. |
| Documents and metadata after restart | Not Tested | Current Buyer session has no document workspace. No Company/Dealer login or private file manipulation performed in this pass. |
| Buyer API outage | Passed | On loaded controlled Buyer enquiry workspace, stopped confirmed SmartTrade API process 25416 (tmp/manage_local.py runserver 127.0.0.1:8000 --noreload). Health request confirmed unavailable. Tapped Refresh enquiries; screen displayed 'Cannot reach SmartTrade. Check the API URL, device network and local server.' and Retry enquiries. |
| Buyer reconnect/retry | Passed | Restarted only SmartTrade API using existing .venv on 127.0.0.1:8000; health HTTP 200. Tapped Retry enquiries; same enquiry IDs 4,3,2,1 reappeared without sign-in or reinstall. |
| Dealer offline/reconnect | Not Tested | No live Dealer session exercised during outage. Buyer coverage cannot establish Dealer behavior. |
| Company offline/reconnect | Not Tested | No live Company session exercised during outage. Phase 8 historical results not substituted. |
| Duplicate submissions | Not Tested | No mutation submitted during outage; retry was GET-only. Same four enquiry IDs returned. This does not prove write idempotency. |
| Lost existing records | Passed for enquiry-list observation only | Four existing enquiry rows reappeared after retry. No broad persistence claim from this read. |
| Missing local file | Not Tested | No disposable file fixture was prepared. Existing private documents were not removed, renamed or edited. |
| Invalid file selection/MIME/size | Not Tested | No file picker input submitted during this pass. Code validation is not treated as actual runtime evidence. |
| Insufficient storage | Blocked | Safely forcing storage exhaustion requires an isolated quota/test environment. Filling shared emulator storage could affect preserved documents; no such operation attempted. |
| File access failure | Blocked | No isolated revoked-URI/read-failure fixture available. Existing file permissions and documents preserved. |
| Storage recovery/metadata consistency | Not Tested | No file failure induced; no verified recovery claim. |

## STC-001 — expired access prevents persisted-session refresh on restart

- Role/module: controlled Buyer / persisted authentication. Severity: **Medium**.
- Steps: sign in using existing controlled account, keep session until access token expires, force-stop Expo Go via Android App info, reopen Expo Go → SmartTrade while local API is available.
- Expected: if stored refresh remains valid, refresh the session, fetch current account from server, and restore permitted access; expired/revoked refresh must still require login.
- Actual: app immediately shows 'Saved session is no longer valid. Sign in again.' and clears the stored session.
- Evidence: [actual restarted screen](evidence/stage-c/restart-session-expired.png). Read-only source inspection confirms restore calls loadAccount with saved access and deletes SecureStore on any non-network error, with no refresh attempt. A running-session refresh timer exists separately and cannot execute before restoration.
- Reproducibility: observed in this force-stop run; same expiry behavior was observed during Stage B reload/reopen. Effective JWT lifetime read separately; no stored tokens exposed or extracted. The stored refresh itself was not directly replayed, so its individual validity is not independently proven. The missing restore-refresh path is confirmed; no claim of authorization bypass.
- No fix applied.

## Evidence and safety

- [Buyer API-offline screen](evidence/stage-c/buyer-api-offline.png): actual loaded error and retry state; contains no credentials/private document contents.
- [Restart session-expired screen](evidence/stage-c/restart-session-expired.png): actual post-force-stop state.
- Local health probe after stopping process returned connection failure; after restart returned HTTP 200.
- Screenshots are unedited emulator window-region captures, 404 × 848. No automated suite was rerun or substituted for exploratory testing.
- API was restored and left running; emulator/Metro retained. Android force-stop affected the Expo runtime only; no emulator reset or data clear.

## Summary

Buyer outage/error/retry recovery and genuine OS force-stop/reopen were exercised. One reproducible session-restoration issue recorded with the refresh-validity qualification above. Dealer/Company outage, fresh-session restart, document persistence and most storage fault cases remain untested or blocked as explicitly itemized. Existing business records and real documents were preserved. Stop after Stage C testing; do not treat incomplete coverage as a pass.

## Continuation — Dealer, Company and token investigation

Existing controlled Company 4 and Dealer 3 signed in through supported development OTP. No business objects changed. The only new device content is a private Dealer-vault copy of the pre-existing synthetic `phase1-test-…` PDF fixture (684 bytes) from Android Downloads. Its source and every existing document were preserved. The local copy remains for future restart testing.

| Outstanding scenario | Status | Actual steps / results |
|---|---|---|
| Company outage message | Passed | Loaded verified Company dashboard; stopped confirmed SmartTrade API PID 12064; Refresh company status showed connection error and Retry company request. [Screenshot](evidence/stage-c/company-offline.png). |
| Company vault initially offline | Passed for rendering only | Opened Documents while API down; account-scoped local vault and explicit offline explanation still rendered. File-entry opening was not completed. |
| Company prolonged outage/recovery | Failed — STC-002 | Refresh timer ran while API unavailable, clearing session and preventing Company/vault access. API restored (health 200) but sign-in remained required. [Screenshot](evidence/stage-c/company-offline-refresh-cleared.png). |
| Dealer outage message | Passed | Loaded verified Dealer workspace, stopped confirmed SmartTrade API PID 27896; Refresh dealer records showed connection error and Retry dealer workspace. |
| Dealer Documents offline | Failed — STC-003 | With active session, Documents tab displayed only API error/retry, no LocalFileVault. [Screenshot](evidence/stage-c/dealer-documents-offline.png). |
| Dealer API recovery | Passed | Restarted API with .venv on 127.0.0.1:8000; health 200. Retry dealer workspace restored actual dealer and Documents vault without reinstall/login. |
| Valid file selection and metadata | Passed | Dealer vault initially empty; native picker → Download → synthetic phase1 PDF. UI listed `selected-file.pdf`, application/pdf, 1 KB (rounded), Available offline on this device. No upload or business verification submission. |
| Local document persistence after new force-close | Blocked | Prepared synthetic local fixture, went Android Home → launcher → Settings to repeat force-stop. Settings opened a black screen on repeated observations. No second force-stop/reopen completed. No emulator reset/data clear performed. Fixture remains intact; persistence not claimed. |
| Missing files | Blocked | App-private content cannot be removed via supported app controls while retaining metadata. No private sandbox mutation/rooting or existing-document deletion attempted. Needs a safe isolated fixture/fault mechanism. |
| Invalid files | Not Tested | Native picker exposed the existing valid PDF fixture only. No invalid fixture imported or validation-failure outcome observed. |
| Oversize validation | Not Tested | No disposable oversized file prepared; no production/device policy values changed. Valid 684-byte acceptance does not prove size-limit rejection. |
| Insufficient space | Blocked | No isolated storage quota/fault facility; shared device filling would risk existing files. |
| File access failure | Blocked | No isolated revoked permission/URI fixture; broad permissions and user files preserved. |
| Metadata after failed storage operations | Not Tested | No storage failure induced, so no atomicity/recovery claim. |

### STC-001 root cause clarification — stored refresh exists, then is discarded

The observed restart message is reached only after `validPersisted(saved)` passes. That function requires **both access and refresh to be strings**. Thus the saved SecureStore payload contained a refresh string when restoration started; this is control-flow evidence, not raw-token extraction. `loadAccount(api, saved.tokens.access)` then fails with a non-network response, and restore directly calls `SecureStore.deleteItemAsync(SESSION_KEY)`, deleting the entire payload including refresh. It never calls `/auth/refresh` in that branch. The timer is scheduled only after `setSession`; failed restoration never sets session. This explains why refresh cannot rescue an expired-access restart.

Effective configured token lifetimes previously read from SimpleJWT: access 300 seconds, refresh 86,400 seconds. The individual persisted refresh validity/revocation state was not inspected or replayed. No token values were printed. After deletion, the UI provides no safe token-presence inspector; absence is inferred from the executed delete branch, not an independent secure-storage dump.

### STC-002 — network failure during refresh destroys offline session

- Role/module: Company observed; shared session provider. Severity: **High** (device-local documents become unavailable during an ordinary API outage; no file deletion observed).
- Reproduce: sign into controlled Company; stop API; refresh dashboard and open Documents; keep app active until scheduled token refresh.
- Expected: transient network failure preserves encrypted local identity for local-only document access; protected API operations remain unavailable until server revalidation.
- Actual: 'Session refresh failed. Sign in again.'; Company screen says active COMPANY required; local vault no longer reachable. Restart API; UI remains signed out.
- Evidence: company-offline-refresh-cleared.png above. Read-only source corroboration: refresh timer catch unconditionally calls clearSession, which removes SecureStore, without differentiating network error. One actual prolonged outage observed; deterministic matching code path. No fix applied.

### STC-003 — Dealer vault depends on live business API response

- Role/module: Dealer / local Documents. Severity: **Medium**.
- Reproduce: active controlled Dealer → dashboard; stop API → Refresh dealer records → Documents.
- Expected: account-scoped device files remain reachable offline as Phase 8 specifies.
- Actual: only API error/retry; vault absent. Restart API and Retry → vault appears.
- Evidence: dealer-documents-offline.png and actual successful retry. Read-only DealerWorkspace inspection: document vault is rendered within loaded business-data content and references `data.id` for legacy scope. No fix applied. This is a reachability defect; no evidence that files were lost.

API restored and left healthy on loopback. No unauthorized business writes, fixes, commits/pushes/deployments. Results above supersede matching earlier Not Tested rows only; storage fault and post-restart persistence gaps remain explicit. Three Stage C findings are now recorded; Stage C remains incomplete for the blocked storage scenarios.
