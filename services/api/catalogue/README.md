# Company-owned catalogue: implemented slice

All paths below are relative to `/api/v1`, with no trailing slash. Owner and staff requests use the existing Bearer JWT authentication. Authentication has no development bypass.

| Endpoint | Permission and behavior |
| --- | --- |
| `GET /catalogue/categories` | Public active category list. |
| `GET /catalogue/products` and `GET /catalogue/products/{id}` | Public; only published, visible products from verified/active companies with active owners and active categories. Inactive variants are omitted. |
| `GET/POST /companies/me/catalogue/brands` | COMPANY owner; lists own brands, creates brand with server-derived company. |
| `GET/POST /companies/me/catalogue/brand-categories` | Own brand + active category association. Body: `brand`, `category`. |
| `GET/POST /companies/me/catalogue/products` | Own products only. Creation uses `brand_category`, `name`, `code`, `unit`, optional `description`, JSON-object `specifications`, `catalogue_price`/`currency`, and `state`. Default publication state is DRAFT. |
| `PATCH /companies/me/catalogue/products/{id}` | Update own product content/publication state. Brand/category association and company ownership cannot be transferred. |
| `POST /companies/me/catalogue/products/{id}/variants` | Create own product variant: `sku`, `name`, optional JSON-object `attributes`, `active`. |
| `PATCH /companies/me/catalogue/products/{id}/variants/{variant_id}` | Update/deactivate own variant without deleting records. |
| `GET/POST /staff/catalogue/categories` | `MANAGE_TAXONOMY`; create body `name`, optional `active`. Creation is audited. |
| `GET /staff/catalogue/products` | `MODERATE_PRODUCTS`; includes drafts, archived and moderated products for review. |
| `POST /staff/catalogue/products/{id}/moderation` | `MODERATE_PRODUCTS`; body `action` HIDE/SUSPEND/RESTORE and nonblank `reason` (max 4000). Audited. Restore changes product moderation only; company suspension and account blocking remain in force. |

Lists return `count`, `next`, `previous`, `results`; default page size 20, configurable by `page_size` up to 100. Public products filter by numeric `brand`, `category`, `company`, and product-name `search`. Staff product lists support name `search`. Errors use HTTP 400 for validation, 401/403 for authentication/permission failures, 404 for inaccessible resources, and 409 for unchanged moderation actions. Cross-company duplicate identifier input can return validation errors before the ownership check; it never grants access.

All owner writes, including drafts and variants, require a verified active company with an active account. Suspended/pending/rejected companies can still read their own catalogue. Public queries check live company/account eligibility. PostgreSQL guards enforce eligible company writes and immutable ownership associations; moderation-only changes are permitted independently so staff can moderate a suspended company's retained records. No delete endpoints are exposed.

Each write stores a CatalogueAudit with explicit company/brand/product/variant/category subject FKs as applicable, authenticated actor, action, timestamp, reason for moderation, and a snapshot. PostgreSQL rejects audit UPDATE/DELETE. FK deletion protection retains referenced entities. Dealer listing/inventory models are not introduced here: future dealer listings must reference these canonical products and variants.

Technical choices for this slice: brand names are unique within a company; product codes within a brand/category association; SKUs within a product. Amount storage supports 18 total digits with four decimal places, has no default currency, and requires an explicit three-letter uppercase currency code when an amount is supplied. This format check does not validate against an ISO currency registry. These are storage/input choices, not tax, rounding, stock, or regional business rules. Catalogue price is never a dealer selling price. Monetary display/rounding and supported currencies still need business confirmation before commercial use.

Deferred: media/assets and upload policy, hierarchical taxonomy editing, brand rename/reclassification, product version numbers for future quotations, HSN/GST policy, dealer stock/prices/discovery, representative delegation, and company-side mobile catalogue screens. The existing admin UI supports category creation, product inspection, search/pagination and reason-required moderation. Live staff interaction still requires a real OTP provider and staff identity; backend tests use isolated test identities.


## Phase 2 company workspace

Mobile company catalogue management and expanded admin taxonomy/inspection/audit screens now use these models. Added owner brand PATCH, staff brand GET, category PATCH with mandatory reason, and READ_AUDIT-protected catalogue history. Brand responses include read-only company eligibility and associated-category metadata. Existing product/variant ownership, moderation, pagination and PostgreSQL guards are preserved. No schema migration was needed.

See [Phase 2 validation](../../../docs/company-catalogue-phase2-validation.md) for exact routes, permissions, actual Android/browser coverage and unsupported brand-state/image contracts.
