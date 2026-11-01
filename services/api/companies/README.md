# Company registration and verification API

This app extends the existing `accounts.Account` authentication system. It does not create a second account or authentication model. A `CompanyProfile` has one immutable owner `COMPANY` account; verification and company activity are separate states.

## States and permissions

- Company verification: `PENDING` → `VERIFIED` or `REJECTED` after staff review.
- Company activity: `ACTIVE` or `SUSPENDED`. Suspension hides catalogue eligibility and denies company-scoped writes without changing account access or token version. Restore only changes activity and is separately audited.
- Account access (`ACTIVE/BLOCKED`) remains independent. A company rejection or activity suspension does not automatically block the owner account. An independently blocked account cannot use these authenticated endpoints.
- Catalogue eligibility is `VERIFIED` + activity `ACTIVE` + active owner account. Catalogue APIs are not implemented in this milestone.
- Staff actions check the assigned `REVIEW_COMPANY`, `SUSPEND_COMPANY`, `RESTORE_COMPANY`, `VIEW_PRIVATE_DOCUMENTS`, or `HANDLE_REVIEW_REQUESTS` permission on the backend. Ordinary accounts have no staff role-grant endpoint.

## Endpoints

All paths are under `/api/v1`:

- `POST /companies/register`
- `GET|PATCH /companies/me`
- `POST /companies/me/email-verification/request`
- `POST /companies/me/email-verification/confirm`
- `POST /companies/me/documents` (multipart)
- `GET /companies/me/documents/{document_id}`
- `POST /companies/me/verification-submissions`
- `POST /companies/me/review-requests` (rejected or activity-suspended company only)
- `GET /staff/companies/verification-queue`
- `POST /staff/companies/{company_id}/claim`
- `POST /staff/companies/{company_id}/verification-decision`
- `POST /staff/companies/{company_id}/suspend`
- `POST /staff/companies/{company_id}/restore`
- `GET /staff/companies/{company_id}/documents/{document_id}`
- `GET /staff/companies/review-requests`
- `POST /staff/companies/review-requests/{request_id}/resolve`

Verification cases must be claimed by an active `REVIEW_COMPANY` staff account before a decision. Private case files additionally require `VIEW_PRIVATE_DOCUMENTS` and the assigned reviewer identity. Verification decisions and activity changes require a non-empty reason, use the authenticated staff actor, and write a `CompanyAuditEvent`. Handling a review request does not restore company activity or account access. The same account ID cannot review or resolve its own company; cross-account human identity matching requires an approved staff identity policy and is not represented in the current account schema.

The staff verification queue returns pending case fields, the read-only registered `company` profile, and document metadata (`id`, type, original filename, content type, size, and upload time). These fields support the admin review screen; they do not expose a storage path or file URL. File contents remain available only through the assigned-reviewer download endpoint after its independent `VIEW_PRIVATE_DOCUMENTS` permission check.

## Email and file configuration

`SMARTTRADE_COMPANY_EMAIL_PROVIDER` is a dotted Python class path implementing `send_code(email)` and `verify_code(email, code)`. No adapter is configured by default; email verification fails closed. Codes are not generated, stored, logged, or returned by this app. Providers must bind single-use, expiring codes to the exact email and apply delivery/attempt protections.

All of the following are unset in `.env.example`; uploads and verification submission fail closed until values are deliberately configured:

- `SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES`: positive integer byte limit.
- `SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES`: comma-separated MIME types; the current signature validator supports PDF, JPEG, and PNG.
- `SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES`: comma-separated required document type codes. No legal-document list or file limit is assumed by the application.
- `PRIVATE_FILE_STORAGE_ROOT`: private local development directory. Default is `services/api/private_uploads/`, ignored by Git and not mounted as a URL. Production object storage is not configured.

Documents are written under random storage names and expose no URL/storage key. Downloads are streamed only after owner or `VIEW_PRIVATE_DOCUMENTS` authorization and are audited. Local file permission settings are restrictive where the operating system supports them. Malware scanning, production private-object storage, retention periods, and file-policy values remain deployment blockers.

## Verification and tests

Use the confirmed local PostgreSQL launcher from the repository root:

```powershell
.\.venv\Scripts\python.exe scripts/manage-local.py check
.\.venv\Scripts\python.exe scripts/manage-local.py test --noinput -v 1
.\.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run
```

Tests use the dedicated test role and disposable test database, including PostgreSQL triggers. The launcher disables development authentication/email flags for regression tests; individual boundary tests explicitly opt in. No migration is needed for the local email simulation.

### Local email simulation

`SMARTTRADE_ENABLE_DEV_EMAIL=false` is the default. Local development may enable it only with `DJANGO_DEBUG=true`; each request must have a loopback socket peer, loopback Host and, when supplied, loopback browser Origin. It does not trust forwarded addresses. No email or code is stored or delivered. A non-empty code records `COMPANY_EMAIL_DEV_VERIFIED` audit evidence bound to an email fingerprint, never `email_verified_at`. Changing email appends a reset event, including when changing back to an earlier address. Disabling the flag or DEBUG removes submission eligibility based on simulation. Staff queues explicitly label simulated evidence. Existing real-provider behavior remains unchanged, but external providers are deferred during development.

The owner context adds `email_verification_mode`, `email_ready` and `can_verify_email`. Submission uses real provider verification or currently enabled local evidence. Pending submissions lock profile/documents/email simulation; rejected and suspended companies retain only permitted status/review functions. Upload, profile-edit, email-confirm and submission transactions serialize on the company row. Private downloads use `Cache-Control: private, no-store` and `nosniff`.

See [Phase 1 validation](../../../docs/company-phase1-validation.md) for the authorized local synthetic-document policy and actual UI/API coverage. These test values are not production requirements.

Rejected verification cases cannot currently be resubmitted; a staff reopen/resubmission policy remains unresolved. Staff and company-owner accounts use separate immutable account types, but this schema cannot identify one human using separate mobile numbers; a verified identity conflict-of-interest policy remains unresolved.
