# SmartTrade screenshot presentation sequence

This sequence contains only actual captures. Begin with the mobile journey below, then use the existing admin sequence for staff oversight. Controlled records are validation data.

## Mobile journey

1. Buyer discovery — `buyer-mobile/01_catalogue.png`, `02_products.png`.
2. Product and SKU — `buyer-mobile/03_product_details.png`, `04_product_variants.png`.
3. Branch price and availability — `buyer-mobile/05_dealer_discovery.png`. Omit `06_branch_comparison.png` because it duplicates the same frame.
4. Dealer operations — `dealer-mobile/01_dashboard.png`, `02_branches.png`, `03_listings_stock.png`.
5. Enquiry and accepted quotation — `dealer-mobile/04_enquiries.png`, `05_quotation.png`.
6. Orders — `dealer-mobile/06_orders.png`, `buyer-mobile/07_orders.png`.
7. Issued invoice record — `buyer-mobile/08_order_details.png`; this does not show the PDF viewer.
8. Company management — `company-mobile/01_dashboard_verification.png`, `02_brands.png`, `03_products.png`, `04_dealer_authorization.png`.

## Existing admin sequence (unchanged images)

1. **Company catalogue** — [Published product](admin-web/01_catalogue.png): explain canonical company ownership and INR list price.
2. **Company-to-dealer authorization** — [Eligible authorization](admin-web/04_dealer_authorization.png): explain explicit company confirmation and verified dealer status.
3. **Enquiry and quotation** — [Accepted quotation revision](admin-web/02_accepted_quotation.png): show SKU, quantity, validity and INR total.
4. **Order and invoice** — [Confirmed order and bill of supply](admin-web/03_order_and_invoice.png): show preserved commercial snapshot and recorded history. No payment functionality is implied.

Pending additions: local file storage operations, invoice PDF viewer, and onboarding submission. The included records are controlled local validation data, not actual merchandise or client transactions.
