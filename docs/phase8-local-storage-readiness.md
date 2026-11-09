# Phase 8 — Pre-server readiness and local storage

## Implemented boundary

Mobile file contents are stored under Expo's app-private document directory. Metadata is stored separately in an app-private JSON index. Product images, company working documents, dealer working documents, and downloaded invoice PDFs are never automatically uploaded or synchronized. File selection is an explicit user action; deletion requires an explicit confirmation. Missing files remain visible as missing metadata instead of being silently treated as available.

Downloaded invoices are durable app-private files rather than cache files and can be opened offline after restart. Repeated download requests reuse an existing local copy. Android's native file picker grants read access only to the selected file; its bytes are copied into the private vault and no broad Android storage permission is requested.

JWT session state is persisted through Expo SecureStore. Logout removes the secure local session before attempting server logout. Server-side token-version, account-state, role, ownership, and development-authentication checks remain authoritative.

## Existing workflow limitations

- Company verification documents selected in Phase 8 are local working copies only. They do not satisfy backend verification requirements and cannot be inspected by staff. The mobile application no longer invokes the company document upload API.
- Existing backend document records are retained and remain accessible only through their existing authorization checks. Admin copy explicitly distinguishes them from device-only files.
- Product images are private device attachments. The public catalogue remains text-only because there is no approved image API or server storage contract.
- Dealer documents are private working files and do not create or change dealer verification evidence.
- Device-local files do not move to another phone, appear in the web admin, or survive app uninstall/device loss unless the future migration design adds an explicit encrypted backup/export process.
- Company and dealer document vaults are account-scoped and remain available when their profile APIs are offline. Product-image attachments remain associated with an individual product and therefore require the cached/current catalogue workspace to locate; Phase 8 does not add a separate offline product catalogue.

## Reliability, security, and performance review

- Mobile API resources retain distinct loading, error, empty, retry, and authentication-expiry states. Abort controllers or resource versioning prevent stale requests from being presented as successful current data.
- Sensitive local files are stored in the application sandbox. Opening a file uses the operating-system viewer/share chooser only after a user action.
- Filename normalization, path-prefix checks, MIME/size policies, free-space checks, atomic metadata replacement, missing-file detection, and idempotent deletion guard local operations.
- Backend authentication continues to validate JWT token version and account state on every protected request. Development OTP/authentication remains DEBUG- and loopback-gated.
- Commercial and discovery list endpoints are paginated. High-use catalogue, dealer, enquiry, and order queries use `select_related`/`prefetch_related`; future production monitoring must still establish query-count and latency budgets.
- The reviewed application code does not log OTP values, JWTs, local file contents, or document contents. Provider failures use non-sensitive messages.
- The existing backend company-file upload/download domain remains a migration artifact, not a Phase 8 mobile storage path. It must not be exposed publicly.

## Requirements before server migration

1. Approve storage jurisdiction, encryption-at-rest, tenant/object key design, malware scanning, MIME/signature validation, quotas, retention, legal hold, deletion, and backup/restore policies.
2. Define explicit consent-driven upload and synchronization APIs with resumable transfer, checksums, idempotency, ownership metadata, audit events, and authorization scopes.
3. Decide which document types are authoritative verification evidence and how staff access, redaction, download expiry, and access logging work.
4. Define product-image transformation, moderation, ordering, accessibility text, cache/CDN invalidation, and public URL policies.
5. Define an encrypted device-to-server migration/import flow. Never silently scan or upload existing local files.
6. Establish database and object-storage backups, recovery-point/recovery-time objectives, restore drills, key rotation, monitoring, alerting, and incident response.
7. Complete privacy notices, retention periods, upload limits, consent wording, and India-specific legal/security review.
8. Add production load tests, query budgets, storage capacity forecasts, observability with secret/PII redaction, and disaster-recovery acceptance criteria.

No cloud provider, payment service, SMS/email provider, production deployment, or automatic upload is introduced in Phase 8.
