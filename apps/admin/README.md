# Admin navigation and integration

Run from `apps/admin`: `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`. All routes are local hash routes, so deep links/reload/browser back do not require new backend routing. Root/unknown hashes resolve to Overview. The sidebar selects one page; protected modules are mounted only on their selected page after staff authentication.

| Hash | Component / behavior | Backend paths relative to /api/v1 | Permission |
| --- | --- | --- | --- |
| #overview | App overview, module links, process-health indicator; no fabricated totals | GET /health | Public health only |
| #verification | App company queue, claim, secure downloads, reason-required decisions | GET /staff/companies/verification-queue; POST /staff/companies/{id}/claim; POST /staff/companies/{id}/verification-decision; GET /staff/companies/{id}/documents/{id} | REVIEW_COMPANY; assigned reviewer and VIEW_PRIVATE_DOCUMENTS for file content |
| #review-requests | ReviewRequests queue and resolution | GET /staff/companies/review-requests; POST /staff/companies/review-requests/{id}/resolve | HANDLE_REVIEW_REQUESTS |
| #catalogue | Catalogue product inspection/moderation and category creation | GET /staff/catalogue/products; POST /staff/catalogue/products/{id}/moderation; POST /staff/catalogue/categories | MODERATE_PRODUCTS; MANAGE_TAXONOMY for category creation |
| #dealers | Dealers business review, branch moderation and price/stock inspection | GET /staff/dealers/businesses, /locations, /listings; POST /staff/dealers/businesses/{id}/decision; POST /staff/dealers/locations/{id}/moderation | REVIEW_BUSINESS |
| #audit | Explicit not-implemented state | No staff audit-read endpoint exists | No data requested |

## Confirmed investigation findings

Previously the sidebar consisted of scrolling anchors, Verification was always marked active, Overview pointed to the same company-verification container, and Audit had no target. ReviewRequests/Catalogue/Dealers were wired components appended below Verification only after login. While signed out, their target sections did not exist. This made an authentication gate look like broken navigation. There was no general frontend router or separate Overview/Audit viewer.

The request paths and successful-response field names used by the existing implemented workflows match the Django routes and serializers. Vite forwards `/api` to `VITE_API_PROXY_TARGET`, default `http://127.0.0.1:8000`; `VITE_API_BASE_URL` defaults to `/api/v1`. Same-origin proxying avoids a local CORS requirement. Changing these environment values requires restarting Vite. Health success establishes process reachability, not OTP availability, database readiness or staff permissions.

There is no configured real OTP provider in the inspected local configuration. Existing terminal logs show 400 for invalid mobile input and 503 for unavailable OTP configuration. Normal admin login calls `/auth/otp/request` and `/auth/login`. The separately opt-in local development path is described below. Both load the real active staff profile through `/auth/me` and retain access/refresh tokens in memory only; reload loses the session. No fake OTP, frontend token input, role grant or automatic identity creation is provided. The backend checks permissions on each request. A 401 now clears the matching current session from every module; a 403 reports missing access without logging out otherwise-valid users.

Shared request handling now displays field validation, distinguishes network/HTTP errors from empty results, rejects unreadable success bodies, and does not report failed logout as server revocation. Pages expose retry controls; paginated totals are displayed only after a successful list load. Request-generation guards prevent older list responses from replacing newer searches/pages. Verification feedback survives removal of a decided case. Secure downloads use the same authorization/error path and preserve filenames.

## Validation and evidence limits

```powershell
npm run typecheck
npm test
npm run build
```

Tests use Node's existing TypeScript stripping and built-in test runner; no testing dependencies were added. They cover hash routes, request paths/bodies, validation errors, OTP-unavailable errors, session expiration, permission denial, malformed/network responses, empty lists and binary/204 responses. Test credentials/responses are isolated fixtures, not data inserted into the running app or database.

Browser checks covered all six signed-out sidebar destinations, active links, back/forward history, direct-link reload, and the new tab's captured error-level console log (empty during that navigation). Live HTTP probes through Vite returned 200 for health and 401 for implemented staff list endpoints. These were terminal HTTP probes, not a DevTools Network recording. No real staff session was available, so authenticated module rendering/data/actions were not tested end to end in the browser. Backend files/authorization were unchanged; the backend test suite was not rerun for this frontend-only investigation.

## Local development authentication

The development Vite UI probes `GET /api/v1/auth/dev-login` only on a loopback hostname. A positive capability response shows **Development Login** beside the normal OTP form. Clicking it sends an empty JSON object to `POST /api/v1/auth/dev-login`; the browser cannot select an account. Disabled capability returns 404 and hides the option. Enabled but missing/ineligible designation returns a clear 403 error on login. Production builds remove the button and do not probe the capability.

Backend configuration belongs only in the ignored root `.env`:

```dotenv
DJANGO_DEBUG=true
SMARTTRADE_ENABLE_DEV_AUTH=true
SMARTTRADE_DEV_AUTH_STAFF_ID=<existing-active-staff-account-id>
```

Use an existing securely provisioned STAFF identity; this endpoint never creates accounts or assigns roles. If there is no staff account, use the controlled first-admin provisioning process with authorization before designating it. The real profile, active roles and permissions come from `/auth/me`; backend permission checks remain authoritative.

Restart the API after configuration changes. Run from the repository root:

```powershell
.venv\Scripts\python.exe scripts/manage-local.py runserver 127.0.0.1:8000 --noreload
```

Run Vite from `apps/admin` with `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`, then open `http://127.0.0.1:5173/#verification`. Do not publish either port, tunnel it, or proxy remote users to this route. Local development login trusts local users/processes; it is not production authentication. Socket peer, Host and browser Origin are checked; forwarded-IP headers are not trusted.

Access and refresh tokens stay in React memory, with scheduled refresh before access-token expiry. Refresh failures clear the session, and logout invokes the existing server token-version invalidation. A dev-token claim restricts both access and refresh to enabled DEBUG mode, the designated active STAFF account and loopback requests. Mobile verification remains unchanged. A 403 from a workflow means the actual staff account lacks the required permission.

To disable completely: set `SMARTTRADE_ENABLE_DEV_AUTH=false`, clear `SMARTTRADE_DEV_AUTH_STAFF_ID`, restart the API, and reload the admin. Existing development access/refresh tokens are then rejected. Production must use `DJANGO_DEBUG=false`, the flag false, no designation, and a production frontend build. Normal provider-backed OTP authentication is unchanged.

Validation for this change uses PostgreSQL security tests and frontend client/session tests. A live authenticated browser session remains blocked if no existing STAFF account is present; automated test identities exist only inside the disposable test database.

## Optional local development OTP simulation

This is a separate opt-in from direct Development Login. In the ignored root `.env`, set:

```dotenv
DJANGO_DEBUG=true
SMARTTRADE_ENABLE_DEV_OTP=true
```

Leave `SMARTTRADE_OTP_PROVIDER` empty for provider-free local testing; the development adapter takes precedence only when DEBUG and its flag are both true. It makes no SMS requests and stores no codes. The repository example and current local configuration default to `SMARTTRADE_ENABLE_DEV_OTP=false`.

For **admin** access, also enable `SMARTTRADE_ENABLE_DEV_AUTH=true` and designate an existing active STAFF account with `SMARTTRADE_DEV_AUTH_STAFF_ID`. No STAFF accounts or permissions are created by OTP request/login. Secure provisioning remains a separate authorized operation. Ordinary PERSONAL/BUSINESS/COMPANY accounts can authenticate through the API in development mode but cannot use the staff console.

Restart the API from the repository root:

```powershell
.venv\Scripts\python.exe scripts/manage-local.py runserver 127.0.0.1:8000 --noreload
```

Run Vite from `apps/admin`:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/#verification`. Enter the designated staff mobile in E.164 format, choose **Send OTP**, enter any non-empty value, then **Verify and sign in**. The response and UI explicitly say development only and no SMS sent. The existing direct **Development Login** option remains available when separately enabled. The frontend uses its existing in-memory access/refresh session and loads the real staff permissions.

API sequence for marketplace accounts (relative to `/api/v1`):

1. For a new number, `POST /auth/register` with `mobile_e164` and `account_type` equal to PERSONAL, BUSINESS or COMPANY. Registration remains explicit and returns 201 with an unverified account. STAFF is rejected. Existing mobile numbers return 409; never change their type to work around this.
2. `POST /auth/otp/request` with `mobile_e164` returns 202, `authentication_mode: development_otp`, and a no-SMS message. Unknown numbers may request, but this does not create accounts.
3. `POST /auth/login` with `mobile_e164` and any non-empty `code` returns the existing JWT response plus `authentication_mode: development_otp`. Existing E.164 and code-length validation still apply. Unknown accounts receive 401 ACCOUNT_NOT_REGISTERED and must register first; empty/whitespace codes receive 400. Blocked/inactive accounts remain blocked.
4. Use the returned access token only in memory for normal permitted endpoints; never paste it into logs. `/auth/refresh` and `/auth/logout` preserve token-version validation/revocation.

`GET /auth/otp/request` is a local development capability probe: 200 only when enabled and loopback, otherwise 404 DEV_OTP_DISABLED. Normal POST endpoints retain their real-provider behavior when development mode is off; without any provider they return 503 AUTH_PROVIDER_UNAVAILABLE. With DEBUG false, the simulation cannot be selected, even if its flag or the provider import path is accidentally configured.

Development OTP does **not** set `mobile_verified_at`, create verification evidence, assign staff roles, verify companies/businesses, or remove publishing restrictions. Its JWTs carry `dev_otp`; both access and refresh reject these tokens outside loopback or after DEBUG/the flag is disabled. STAFF tokens additionally require the enabled designated development identity on every request and refresh. Do not expose Vite/API ports, tunnels or forwarding to other users. Foreign browser Origins and non-loopback socket peers are rejected; forwarded-IP headers are ignored.

To disable the simulation, set `SMARTTRADE_ENABLE_DEV_OTP=false` and restart Django. Existing simulation tokens then fail. To disable **all** development authentication, also set `SMARTTRADE_ENABLE_DEV_AUTH=false`, clear the designated staff ID, restart Django and reload the browser. Production always uses DEBUG false and both flags false.

Verification commands, from the repository root and then admin folder respectively:

```powershell
.venv\Scripts\python.exe scripts/manage-local.py check
.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run
.venv\Scripts\python.exe scripts/manage-local.py test --noinput
Set-Location apps/admin
npm run typecheck
npm test
npm run build
```

Backend tests exercise simulation, registration, inactive/blocked users, staff designation, permissions, loopback checks, token refresh/logout and real-provider selection using isolated fixtures in the disposable PostgreSQL test database. They do not provision identities in `smarttrade_dev`.
