# Account authentication foundation

## OTP provider boundary

`SMARTTRADE_OTP_PROVIDER` is an optional dotted Python class path for a real deployment adapter. The adapter instance must implement:

- `send_code(mobile_e164)`: dispatch through the configured provider and return `True`/`None` when accepted or `False` when it was not sent.
- `verify_code(mobile_e164, code)`: return `True` only after the real provider confirms a code bound to that mobile; return `False` for an invalid, expired, or already-used code. The provider must enforce one-time use, expiry, and attempt/delivery limits without exposing codes to SmartTrade.

No provider is bundled or configured in development. Registration can create an account, but it leaves `mobile_verified_at` null. OTP request and login return `503 AUTH_PROVIDER_UNAVAILABLE`, and no token is issued until a real provider adapter is configured. With a provider configured, dispatch failures receive the same acknowledgement as unknown/blocked numbers to reduce account enumeration. The API does not create, store, log, or return OTP codes. Provider credentials must come from environment-based secret configuration; delivery policy/rate limiting is the provider adapter's responsibility.

Registration accepts a complete E.164 mobile number because country-specific local-number normalization remains an open project decision. It does not infer a country code.

## Tokens and account status

Simple JWT issues Bearer access and refresh tokens only after provider verification. JWTs are not stored in the database. The API checks `access_state`, staff-profile state, and `token_version` for every protected request. Blocking an account or logging out increments the version, invalidating existing access and refresh tokens. Restoration does not lower the version, so old tokens remain invalid.

The account model uses Django's standard unusable-password marker for OTP accounts; no password, OTP, or raw token is stored. Staff permissions live in separate `StaffRole`, `StaffPermission`, and assignment tables. Marketplace registration rejects `STAFF`.

## Initial staff bootstrap

Run `python manage.py bootstrap_superadmin` only from a controlled local shell after applying migrations. It prompts for the staff mobile, creates one `PLATFORM_ADMIN` role assignment, and refuses to create another while an active platform admin exists. The account is not marked phone-verified by bootstrap. No HTTP endpoint creates or promotes staff accounts.
