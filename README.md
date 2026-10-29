# SmartTrade

SmartTrade is a marketplace for official company product catalogues and local dealer discovery. Release 1 covers account foundations, company and dealer-business registration/verification, company-owned catalogues, dealer locations and their product listings, authenticated dealer discovery, and a staff/admin panel.

## Release 1 scope

- Mobile clients for personal, business, and company accounts; users must authenticate to browse dealers.
- Staff/admin users have a separate account type and permissions.
- Manual business and company verification, private document handling, and audit history.
- Company registration email verification and the business registration contacts required by the source requirements.
- Verified company-owned brands and catalogues; verified companies may publish immediately, subject to admin moderation.
- Multiple dealer locations, each with its own availability, stock, and selling price.
- Dealer search by PIN code, area, and district; GPS distance is optional.

Quotations and invoices are later phase work. Service providers, job seekers, employers, payments, WhatsApp integration, ratings, order tracking, multilingual features, AI recommendations, ERP/GST integrations, and analytics are deferred.

## Proposed stack

- Mobile: React Native, Expo, TypeScript
- Admin: React, TypeScript
- Backend: Python, Django REST Framework
- Database: PostgreSQL
- Version control: Git and a private GitHub repository
- OTP, email, and cloud/object-storage providers are configurable; credentials are never hardcoded.

## Proposed monorepo

```text
smarttrade/
├── apps/
│   ├── mobile/                 # Expo React Native app
│   └── admin/                  # React staff/admin panel
├── services/
│   └── api/                    # Django REST Framework API
├── docs/
│   ├── architecture.md
│   ├── database-design.md
│   ├── api-specification.md
│   ├── implementation-plan.md
│   ├── decisions.md
│   └── SmartTrade document.pdf
├── .github/                    # Repository automation (future)
└── README.md
```

This tree is a proposal, not an implementation. No application code or dependency manifests are included.

## Documentation

- [Architecture](docs/architecture.md)
- [Database design](docs/database-design.md)
- [API specification](docs/api-specification.md)
- [Implementation plan](docs/implementation-plan.md)
- [Decisions](docs/decisions.md)
- Requirements source: `docs/SmartTrade document.pdf`

## Status

Documentation proposal only. Begin implementation after the owner approves the architecture and resolves the decisions marked as implementation blockers in [decisions.md](docs/decisions.md).
