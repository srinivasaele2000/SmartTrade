# SmartTrade

The mobile buyer journey now includes API-backed public catalogue/categories, product detail/variants, and authentication-gated dealer comparison screens. See [mobile setup and validation](apps/mobile/README.md) for exact launch commands, emulator/USB networking, tested behavior and the current real-sign-in boundary.

Dealer business profiles now support multiple branches, branch-specific canonical-product listings, selling prices/stock, company-issued brand authorization, authenticated discovery and audited staff review. See the [dealer API contract](services/api/dealers/README.md). Company catalogue prices remain separate from dealer selling prices, and dealer discovery requires login.

The company-owned catalogue now includes brands, brand/category associations, products, variants, public eligible-product browsing and audited staff moderation. The admin Catalogue section connects to the real staff APIs. See [the implemented catalogue contract](services/api/catalogue/README.md) for endpoints, permissions, technical choices and remaining scope. Dealers will reference these canonical product IDs; dealer inventory and selling-price APIs remain separate future work.

## Configured local PostgreSQL development

The ignored root `.env` contains the local `smarttrade_dev` connection and separate application/test credentials. From the repository root, use the existing virtual environment:

```powershell
.\.venv\Scripts\python.exe scripts/manage-local.py check
.\.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe scripts/manage-local.py test
.\.venv\Scripts\python.exe scripts/manage-local.py runserver 127.0.0.1:8000
```

The launcher loads the local environment explicitly. Tests use `DB_TEST_USER` and `DB_TEST_PASSWORD` to create and remove `test_smarttrade_dev`; the runtime application role cannot create databases. The Phase 1 regression run passed all 121 backend tests, including PostgreSQL trigger tests, against PostgreSQL 18. Never point this launcher at an unrelated database. Local staff testing uses the existing designated development administrator and guarded development login; no external provider is needed.

SmartTrade is a marketplace for official company product catalogues and local dealer discovery. Release 1 is being developed as a React Native + Expo mobile app, a React + TypeScript staff admin app, and a Django REST Framework API backed by PostgreSQL.

## Release 1 scope

- Public browsing of eligible company catalogue products; dealer discovery requires login.
- Company and dealer-business registration and manual verification.
- Company-owned product catalogues and separate dealer-location listings, inventory, availability, and selling prices.
- Multiple dealer locations and authenticated discovery by PIN code, locality, and district; optional GPS nearby fallback must be labelled.
- Separate staff/admin identities with least-privilege roles, private file access, and audit history.
- Company activity suspension hides its catalogue and disables company-scoped activity while preserving all records. It does not block associated accounts; otherwise permitted sign-in/account-level functions, suspension status, and restricted review requests remain available unless an account is independently blocked.
- Registration fee collection is disabled. Quotations, invoices, service-provider profiles, jobs, and employment features remain deferred.

Business permission confirmation is required to submit trade-worker contacts, and each contact must separately opt in before a later public service-provider profile is created. Release 1 does not create those profiles automatically. File limits are configurable; retention periods, consent wording, search radius, and other open operational values remain unspecified in [decisions](docs/decisions.md).

## Core account and catalogue rules

- Each normalized mobile number belongs to one account with exactly one immutable account type. A company account links to at most one company; companies may have separately authenticated representatives. Staff identities are separate and least-privileged.
- Business verification, company verification, and company-authorized-dealer status are distinct. Business and company verification is manual.
- One verified company owns each brand and may own multiple brands. Company catalogue/list prices are separate from dealer-location selling prices, stock, and availability.
- Dealer businesses may have multiple locations. A listing is unique per location + product + variant, with a separate uniqueness rule for products without variants.
- Only authorized representatives of the owning company may grant/revoke company + brand + dealer-business authorization.

The backend now supports company-owner registration, configurable email verification, policy-configured private verification-document upload, submission/queue/manual approval or rejection, restricted review requests, and staff-authorized company activity suspension/restoration. Company verification and activity status remain separate from account blocking and authorized-dealer status. The implemented API and local configuration boundary are documented in [the companies API README](services/api/companies/README.md). Company-owned catalogue capabilities are described in the Phase 2 validation report below.

## Proposed stack

- Mobile: React Native, Expo, TypeScript
- Admin: React, TypeScript
- Backend: Python, Django REST Framework
- Database: PostgreSQL
- OTP, email, and cloud/object-storage providers are configurable; credentials are never hardcoded.

## Repository layout

```text
apps/
  admin/       React + TypeScript staff dashboard shell
  mobile/      React Native + Expo welcome screen
services/
  api/         Django REST Framework API
docs/          Architecture, database, API, decisions, and implementation plan
compose.yaml   Local API + PostgreSQL services
```

## Prerequisites

- Python 3.12 or newer in the Django 5.2 supported range
- Node.js 22.13 or newer and npm
- PostgreSQL 16+ locally, or Docker Compose (Docker Desktop is not currently available in this workspace)

Use a separate terminal for each running development server. Never put real credentials in source files. Copy `.env.example` to `.env` and set a unique local-only `DJANGO_SECRET_KEY` and `POSTGRES_PASSWORD` before using Compose. Do not commit `.env`.

## Backend API

### Option A: Docker Compose with PostgreSQL

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set non-empty local-only values for `DJANGO_SECRET_KEY` and `POSTGRES_PASSWORD`, then run:

```powershell
docker compose up --build
```

The API listens at `http://localhost:8000`; PostgreSQL is bound to localhost on port `5432`. Apply the account schema from a second terminal after startup:

```powershell
docker compose exec api python manage.py migrate
docker compose exec api python manage.py bootstrap_superadmin
```

The bootstrap command prompts for a mobile number and creates the first staff role only from a controlled shell. The number remains unverified until a real OTP provider verifies it. The health endpoint is `GET http://localhost:8000/api/v1/health`; it returns `{"status":"ok"}` for process liveness and does not claim database readiness.

### Option B: local Python and local PostgreSQL

From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r services\api\requirements.txt
$env:DJANGO_SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(48))"
$env:DJANGO_DEBUG = "true"
$env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1"
$env:DB_ENGINE = "postgresql"
$env:DB_NAME = "smarttrade"
$env:DB_USER = "smarttrade"
$env:DB_PASSWORD = "YOUR_LOCAL_PASSWORD"
$env:DB_HOST = "localhost"
$env:DB_PORT = "5432"
python services\api\manage.py migrate
python services\api\manage.py bootstrap_superadmin
python services\api\manage.py runserver
```

Replace `YOUR_LOCAL_PASSWORD` with the local PostgreSQL password you configured. The account foundation supports registration, OTP-provider-backed login, JWT refresh/logout, and `/auth/me`. With development OTP disabled and no provider configured, registration creates an unverified account and OTP request/login fail closed with `503 AUTH_PROVIDER_UNAVAILABLE`. External provider integration is deferred during development. Explicit guarded development OTP is supported only in local DEBUG mode; it never establishes phone ownership. Do not expose the development API to a public network.

### PostgreSQL integration tests

The API defaults to PostgreSQL, matching the approved stack. SQLite is available only as an explicit local development/test fallback by setting `$env:DB_ENGINE = "sqlite"`; it does not exercise the PostgreSQL trigger guards.

With a local PostgreSQL instance running, use the PostgreSQL connection variables from Option B and run from the repository root:

```powershell
$env:DB_ENGINE = "postgresql"
$env:DB_NAME = "smarttrade"
$env:DB_USER = "smarttrade"
$env:DB_PASSWORD = "YOUR_LOCAL_PASSWORD"
$env:DB_HOST = "localhost"
$env:DB_PORT = "5432"
python services\api\manage.py check
python services\api\manage.py test accounts -v 2
python services\api\manage.py makemigrations --check --dry-run
Push-Location services\api
python manage.py test
Pop-Location
```

The Django test runner creates and removes a separate test database (normally `test_smarttrade`) and applies migrations there. The PostgreSQL test role therefore needs permission to create databases. Use only a disposable local database server and local credentials for integration tests; do not point test settings at production. The trigger-specific tests are reported as skipped when `DB_ENGINE=sqlite` and run when the configured database backend is PostgreSQL.

## Mobile app

```powershell
cd apps\mobile
Copy-Item .env.example .env
npm install
npm start
```

For a physical device, set `EXPO_PUBLIC_API_URL` in the Expo environment to an address reachable from that device before starting Expo. The welcome screen does not make API calls or implement authentication.

## Admin web app

```powershell
cd apps\admin
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The dashboard is a UI shell only; it does not authenticate staff or call protected APIs yet.

Check admin TypeScript and production build:

```powershell
npm run typecheck
npm run build
```

## Security and implementation boundaries

- Backend authorization will be the source of truth; client visibility is never an access control.
- Marketplace verification workflows, catalogues, dealer discovery, staff-management APIs, and audit-writing endpoints are not implemented in this milestone.
- Staff accounts cannot self-register; provision the first staff role with the local `bootstrap_superadmin` management command. There is no public super-admin bootstrap endpoint.
- No secrets, production URLs, OTP credentials, or real database passwords belong in tracked files.
- Do not deploy this development foundation to production.

## Documentation

- [Architecture](docs/architecture.md)
- [Database design](docs/database-design.md)
- [API specification](docs/api-specification.md)
- [Implementation plan](docs/implementation-plan.md)
- [Decisions](docs/decisions.md)
- [Account authentication boundary](services/api/accounts/README.md)
- Requirements source: [SmartTrade document](docs/SmartTrade%20document.pdf)

### Optional local staff authentication

For an explicitly designated existing STAFF account, local development can opt in to `/api/v1/auth/dev-login` without an OTP provider. It defaults to disabled, requires DEBUG plus loopback access, never creates identities or verifies phones, and preserves staff permissions and token revocation. See [admin setup](apps/admin/README.md#local-development-authentication) for configuration, in-memory session behavior and complete disable instructions. Never enable or expose this route in deployed environments.

### Optional local OTP simulation

`SMARTTRADE_ENABLE_DEV_OTP=false` by default. Local DEBUG mode can explicitly enable a no-SMS adapter accepting non-empty codes through the existing OTP endpoints. It leaves phone ownership unverified, requires explicit marketplace registration, and grants no staff privileges. See [local setup and testing](apps/admin/README.md#optional-local-development-otp-simulation). Keep both development authentication flags disabled in production.


## Company onboarding — Phase 1 local validation

The Company mobile workspace, private document upload, local email simulation and staff verification/review workflow are connected to PostgreSQL. See [the Phase 1 validation report](docs/company-phase1-validation.md) for endpoints, actual emulator/browser coverage, test commands and limitations. The ignored local environment enables `SMARTTRADE_ENABLE_DEV_EMAIL=true`; its example defaults to false. Local simulation never sets real email ownership verification and fails closed when DEBUG is false. No external SMS or email service is required.


## Company brands and catalogue — Phase 2

The mobile company workspace now manages owned brands, category associations, products and variants/SKUs. Admin Catalogue includes product moderation, brand inspection, category editing and actual catalogue audit history. See [Phase 2 implementation and validation](docs/company-catalogue-phase2-validation.md) for routes, permissions, test results and explicit limits. No dealer authorization/inventory development is included in this phase.


## Company-to-dealer authorization — Phase 3

Company mobile grant/revoke, privacy-limited dealer search, existing dealer authorization status and admin authorization/audit inspection are connected. See [Phase 3 validation](docs/company-dealer-phase3-validation.md) for API contracts, changed files, live workflow evidence and limitations. No Phase 4 inventory development is included.


## Dealer listings and stock management — Phase 4

The existing dealer listing lifecycle is now verified on Android, with explicit reactivation, searchable inspection, listing audit history and variant-aware buyer pagination. See [Phase 4 validation](docs/dealer-listings-phase4-validation.md) for actual API/UI coverage, changed files and current-model limitations. No Phase 5 development is included.
