# SmartTrade presentation screenshots

Captured 03-11-2026 from the actual authenticated local admin portal and Pixel_10_Pro emulator. Four existing admin screenshots were preserved unchanged. Added 18 mobile screenshots across Buyer (8), Dealer (6), and Company (4). No application code or marketplace data changed. Existing controlled validation records retain their original labels; they must not be described as real customer transactions.

Admin PNGs use the same browser viewport (1265 × 712). Mobile PNGs use the same complete emulator screen region (404 × 848, including device frame), without emulator toolbar or desktop. They are native window captures at the current emulator window size, not full native framebuffer-resolution captures. All were visually inspected. No image compositing, mock data, redaction or UI modification was used. No passwords, OTPs, phone numbers, GSTINs or private documents appear. Company dashboard includes only the existing synthetic `.test` email, not a real person's contact.

| File | Feature | Description |
|---|---|---|
| admin-web/01_catalogue.png | Company catalogue | Published product, company/brand/category and INR catalogue price; the product card continues below viewport. |
| admin-web/02_accepted_quotation.png | Enquiries and quotations | Existing accepted enquiry and revision with SKU, quantity, validity and INR total. |
| admin-web/03_order_and_invoice.png | Orders and invoices | Confirmed order, accepted item snapshot, status history and issued bill-of-supply record. This is the invoice record, not the PDF viewer. |
| admin-web/04_dealer_authorization.png | Company-to-dealer authorization | Verified dealer and currently eligible company/brand authorization. |

## Excluded and unavailable captures

- Mobile access recovered using foreground window capture and direct keyboard events instead of clipboard-based typing. Existing controlled accounts signed in through normal supported local development OTP. No session injection, account creation or privilege changes were used. Login screens were excluded.
- Verification queue was empty in the preceding inspection, combined audit viewer is explicitly unimplemented, and local-only documents are not remotely reviewable. These are excluded under the requirement to avoid empty/error/debug states and misleading functionality.
- Invoice PDF viewer, local file operations, Phase 8 persistence, and onboarding form submission are not captured. Invoice record visibility does not prove PDF viewing/download. No commercial or authorization actions were submitted for screenshots.
- Existing development labels and explanatory interface text remain visible. This pack is a truthful partial development demonstration, not a complete client-ready release walkthrough.

See screenshot-index.md for the available presentation order. Existing Django, Vite, Metro and emulator services were not stopped.

## Mobile inventory

| File | Actual screen |
|---|---|
| buyer-mobile/01_catalogue.png | Buyer catalogue search and categories |
| buyer-mobile/02_products.png | Brands, existing product and INR catalogue price |
| buyer-mobile/03_product_details.png | Product description, price and specifications |
| buyer-mobile/04_product_variants.png | Variant/SKU and dealer-discovery entry |
| buyer-mobile/05_dealer_discovery.png | Existing out-of-stock North branch, INR selling price and public test location |
| buyer-mobile/06_branch_comparison.png | Same North branch frame; duplicate capture, omit from presentation |
| buyer-mobile/07_orders.png | Confirmed buyer order list |
| buyer-mobile/08_order_details.png | Order snapshot and issued bill-of-supply record; PDF control partly below fold |
| dealer-mobile/01_dashboard.png | Verified business, active account and actual branch/listing totals |
| dealer-mobile/02_branches.png | Central branch and visibility; private contacts absent |
| dealer-mobile/03_listings_stock.png | Published North listing, INR price and stock quantity |
| dealer-mobile/04_enquiries.png | Incoming accepted enquiry |
| dealer-mobile/05_quotation.png | Accepted quotation revision, quantity, validity and INR total |
| dealer-mobile/06_orders.png | Incoming confirmed order |
| company-mobile/01_dashboard_verification.png | Approved/verified and active company status |
| company-mobile/02_brands.png | Company-owned brand and create form; no creation submitted |
| company-mobile/03_products.png | Published product and moderation state |
| company-mobile/04_dealer_authorization.png | Active eligible dealer authorization; no revoke action submitted |

All included mobile frames show loaded content without errors, authentication inputs or developer tools. Some long pages extend beyond a single screen; screenshots do not imply the entire page fits at once. Existing UI wording and date formatting are preserved verbatim.
