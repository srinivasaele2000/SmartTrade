# Package B implementation report

06-11-2026 IST. Scope covers Personal and Dealer onboarding, canonical brand declarations, private worker contacts, and staff review. The source audit and Package A work remain in the working tree.

| Feature | Original reference | Implemented behavior |
| --- | --- | --- |
| Personal profile | PDF §4.2, page 3. R011, R014–R017 | The existing Personal subtype stores name, occupation, PIN, locality, district and state. Its authenticated account supplies the read-only mobile number. My account → Personal profile loads and saves these fields. The model has no independent mobile or device location history. |
| Business identity | PDF §7.1, page 6. R037–R042, R052 | The existing business profile gains owner or authorized-person name, organization email and registered address fields. Existing legal name, registration reference, GSTIN and PAN remain editable under existing policy. The dealer Profile tab separates registered address from operating branches. Staff inspect registered details in an explicit onboarding review. |
| Categories | PDF §§7–8, pages 6–7. R043, R045, R069 | Dealers choose multiple categories from the eight source categories. These choices are stored separately from product taxonomy. Brand choices use active catalogue category links where names match the supported categories, including Iron/Steel aliases. Other is a fixed declaration option with access to canonical brand search. |
| Brand declarations and suggestions | PDF §8, pages 7–8. R044–R047, R069 | The dealer can select multiple existing brands and submit a normalized, deduplicated suggestion with context. Staff can approve for follow-up, reject, or link the suggestion to an existing brand. Every decision requires a reason and records actor, time and subject. Mapping records a reference on the suggestion. Company grants and catalogue ownership remain governed by their original APIs. |
| Trade-worker contacts | PDF §9, pages 8–9. R048–R049 and D-027 | The dealer can add, edit and remove private contacts. Canonical Indian mobile numbers are unique within each network. Save and edit require explicit permission confirmation with a UTC timestamp, displayed in IST. The screen displays progress toward ten contacts. Contact review is separately permissioned and audited. |
| Duplicate business identity | PDF §10, page 9. R053 | Staff see potential matches on normalized GSTIN, registration reference, or business name together with registered address and PIN. A shared address alone produces no match. Staff record distinct businesses or follow-up with a reason. A changed identity invalidates the previously reviewed match fingerprint. Existing mobile uniqueness remains in the account model. |

## Models, routes and screens

- `accounts/models.py` extends `PersonalProfile` and `BusinessProfile`. `accounts/profiles.py` implements owner-scoped Personal GET/PATCH and shared Indian location validation. Its route is `/api/v1/auth/personal-profile`.
- Existing `GET/PATCH /api/v1/businesses/me` supports the registered business fields. Existing staff list and decision responses retain the previous summary projection. Business update audit records preserve their previous fields and add edited field names without copying the new registered contact details.
- `dealers/models.py` adds `DealerDeclarations`, `BrandSuggestion` and `TradeWorkerContact`. `dealers/onboarding.py` handles the following routes under `/api/v1`.

| Scope | Route | Methods |
| --- | --- | --- |
| Dealer owner | `/businesses/me/declarations` | GET, PUT |
| Dealer owner | `/businesses/me/declaration-brands` | GET, with category and search filters |
| Dealer owner | `/businesses/me/brand-suggestions` | GET, POST |
| Dealer owner | `/businesses/me/trade-contacts` and `/businesses/me/trade-contacts/{id}` | List GET, create POST, owner-scoped PATCH and DELETE |
| Business reviewer | `/staff/dealers/businesses/{id}/onboarding` | GET |
| Business reviewer | `/staff/dealers/businesses/{id}/brand-suggestions/{suggestion_id}/review` | POST |
| Business reviewer | `/staff/dealers/businesses/{id}/duplicate-review` | POST |
| Trade contact reviewer | `/staff/dealers/businesses/{id}/trade-contacts` | GET |

- Mobile changes are in `App.tsx`, `DealerWorkspace.tsx` and `Onboarding.tsx`. Use My account → Personal profile, or Dealer dashboard → Profile, Declarations or Contacts.
- Admin changes are in `Dealers.tsx` and `DealerOnboarding.tsx`. Open Dealer network → Business review → Review onboarding. The view shows registered identity, declarations, suggestions, duplicate matches and recent reasoned decisions. Private contacts are loaded on request by authorized staff.

## Security and data boundaries

Personal and dealer owner APIs resolve the profile from the authenticated account. Trade contact edits/removals also scope the record ID to that business. Existing verification restrictions govern dealer writes. Business reviewers need `REVIEW_BUSINESS`. Private contact review requires `REVIEW_TRADE_CONTACTS`, which is part of future controlled super-admin bootstrap. Existing roles receive no automatic grant. Contact access and changes are audited using record identifiers, with phone numbers, names and locations kept out of the audit snapshot. New private responses use `Cache-Control: no-store`.

Brand declarations and suggestion review never create an authorization grant or change listing eligibility. Private profile fields and contacts are confined to authenticated profile and staff review routes. Existing public catalogue and discovery projections retain their established contracts. The dealer confirms permission from each contact. That confirmation is self-reported, with no independent verification or claim about legal sufficiency. Worker details do not create public profiles or trigger messages.

## Migration status

| Migration | Contents | Application |
| --- | --- | --- |
| `accounts/0004_package_b_profiles.py` | Thirteen additive Personal and Business fields. Existing accounts remain usable with blank new fields. | Applied in disposable PostgreSQL suite and on `smarttrade_dev`. |
| `dealers/0004_package_b_profiles.py` | Declarations and brand links, suggestions and review-state constraints, private contacts and per-dealer mobile uniqueness. | Applied in disposable PostgreSQL suite and on `smarttrade_dev`. |

Both were generated with Django and reviewed. Migration consistency reported no changes. During the 07-11-2026 follow-up, `showmigrations accounts dealers` confirmed both 0004 migrations applied on the development database. Existing staff permission assignments and development business records were preserved.

## Verification levels

| Check | Result |
| --- | --- |
| `.venv\Scripts\python.exe scripts/manage-local.py test --noinput -v 1` | 178 passed, zero skipped. Disposable PostgreSQL database created, migrated and destroyed. |
| `.venv\Scripts\python.exe scripts/manage-local.py check` | Passed with no issues. |
| `.venv\Scripts\python.exe scripts/manage-local.py makemigrations --check --dry-run` | Passed. No changes detected. |
| `npm --prefix apps/mobile test` | 116 passed, zero skipped. |
| `npm --prefix apps/admin test` | 26 passed, zero skipped. |
| Mobile and admin `npm run typecheck` | Passed. |
| `npm --prefix apps/admin run build` | Passed. |
| Expo Android Hermes export | Passed from `apps/mobile`. 2,819 modules and one 4.4 MB Hermes bundle. |
| `git diff --check` | Passed. New files also checked for trailing whitespace. |

The first export command ran from the repository root, which has no Expo package manifest. A second run from `apps/mobile` reached Hermes but could not write in the sandbox temporary directory. The successful run used a temporary directory inside the workspace and supplied only the local public API URL to Expo.

Backend test coverage uses the actual API views and disposable PostgreSQL records. It includes Personal profile editing and private identity boundaries, registered address validation, multiple declarations, all three brand review outcomes, audit reasons, contact consent and deduplication, staff access restrictions, and duplicate decisions. The full suite also runs existing Buyer, Dealer and Company workflows. Mobile and admin component tests use isolated render fixtures. Physical-device checks were blocked because `adb devices -l` listed no connected device. No Package B phone interaction, screen capture or live development API write was performed.

## Remaining decisions and limitations

- Personal and registered business fields support incremental editing. A mandatory onboarding completion gate would require a separate policy for existing incomplete profiles. GPS capture remains optional and unimplemented.
- The minimum of ten is visible as progress. Enforcement awaits the dedicated business verification submission workflow. The existing staff verification decision is still a status action, with no new evidence or upload workflow.
- The category vocabulary is fixed. Other captures the declaration without creating a product category. A new taxonomy proposal workflow and category aliases outside the supported mapping require a separate taxonomy decision.
- Approving a suggestion records it for follow-up. Linking to a brand requires a canonical brand ID. Creation of a newly verified canonical brand needs the established company ownership workflow and is separate from approval.
- Duplicate detection uses exact normalized signals. It does not treat shared contact numbers as proof, and the existing globally unique login mobile cannot collide between profiles. Reviewer matching compares current business profiles on demand. Indexing, licence jurisdiction and richer fuzzy matching are future scale or policy work.
- Existing staff need a controlled grant of `REVIEW_TRADE_CONTACTS` before reviewing these records. Retention policy and independent contact consent verification remain unresolved. The dealer can remove a contact, with a minimal removal audit event retained.
- Testing the five requested phone journeys remains outstanding. Package C has not begun.

## Physical verification follow-up — 07-11-2026 IST

Applied the two reviewed additive Package B migrations to `smarttrade_dev`. Built and signature-verified the signed ARM64 release APK, installed it as an update on physical phone `5e106900` and matched the installed hash to the artifact. The phone loaded the catalogue over USB. Authenticated phone verification is blocked at Sign in after two bounded ADB input attempts. Live API read checks and the browser onboarding review passed. The existing reviewer was correctly denied private contact access. The detailed result and remaining device tests are recorded in `package-b-physical-device-validation.md`.

The subsequent 07-11-2026 diagnostic confirmed that the form was already visible and restored USB forwarding after reconnection. The installed artifact hash still matched. Two bounded attempts to replace the mobile field did not produce the controlled account value, so the OTP request was not submitted. Authenticated phone acceptance remains blocked at text entry. See the sign-in diagnostic table in `package-b-physical-device-validation.md`.

After manual sign-in, physical My account navigation succeeded. The active session was COMPANY, so the Personal profile option was correctly absent. The existing session was preserved. Physical Personal and Dealer verification still awaits the controlled role sessions. The physical validation report links the account screenshot and records the HTTP authentication results.
