# India-only compliance baseline

SmartTrade Release 1 is restricted to India. Backend timestamps remain timezone-aware UTC; mobile and admin display them in `Asia/Kolkata` as `DD-MM-YYYY HH:mm IST`.

- Accounts store one unique canonical Indian mobile number in `+91XXXXXXXXXX` format.
- Company and dealer addresses accept six-digit Indian PIN codes and recognized Indian states/union territories. Dealer branch country is fixed to `IN`.
- Catalogue and dealer prices are separate, but both accept INR only. No currency conversion, tax, discount, shipping, or rounding business rule is inferred.
- Company and dealer profiles support optional GSTIN and PAN. Their format is validated; SmartTrade does not claim government verification and does not calculate tax.
- Mobile and admin render INR with the rupee symbol and Indian digit grouping. API decimal values retain their configured four-decimal storage precision.

Migration reconciliation on 02-11-2026 was limited to controlled records in `smarttrade_dev`: legacy synthetic mobiles were replaced by local-only Indian-format identities, synthetic USD labels were changed to INR without a rate conversion, and synthetic branch locations were made valid Indian test locations. No record was deleted and no production database was accessed.

Remaining policy work: government-backed GSTIN/PAN verification, legal address evidence, accounting rounding, tax calculation, state-specific compliance, and production localization review are explicitly outside this audit.
