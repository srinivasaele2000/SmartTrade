# SmartTrade - Actual Application Screenshot Pack

Captured from the running local application on 2026-11-01 (client timezone: Asia/Calcutta).

**13 mobile screenshots + 8 web screenshots = 21 original captures.**

These images document the currently developed application, including empty, pending and configuration-required states. They are not mockups, populated demonstrations, or certification that every workflow is complete.

## Capture and quality

- Mobile: connected Pixel_10_Pro emulator, native Android screencap PNG, **1280 x 2856** pixels. Every file contains the complete phone framebuffer, including native status/navigation bars. Long forms are shown at explicit natural scroll positions; nothing is stitched.
- Web: actual admin at http://127.0.0.1:5173/, authenticated through the existing supported Development Login. Browser viewport held at **1440 x 1000**. Native browser screenshots are **JPEG**, so their extensions are .jpg; no image conversion or recompression was applied.
- Original capture bytes are retained. No mock data, generated UI, redaction, overlays, screenshot resizing or application styling changes were used. Minor clipped/off-screen scroll content is part of the actual viewport; the phone frame itself is not cropped.
- All 21 images were visually reviewed. Format/dimension checks and SHA-256 uniqueness checks passed. manifest.json records dimensions, byte counts and hashes.
- Credential/OTP entry was never captured. Private contact fields were checked before capture. Private company documents were neither opened nor downloaded. Some company screens were withheld instead of exposing private values.

## Screenshot inventory

Every linked file below was actually captured. Data/state labels distinguish blank forms, real records, empty API responses and unavailable workflows.

| Screenshot file | Application/module | Captured | Screen description | Data/state | Known limitation |
| --- | --- | --- | --- | --- | --- |
| [mobile/authentication/mobile_login.png](mobile/authentication/mobile_login.png) | Mobile / Authentication | Yes | Blank login form. | Actual UI; no credentials entered. | OTP delivery and verification are not demonstrated in this image. |
| [mobile/authentication/mobile_registration_account_type.png](mobile/authentication/mobile_registration_account_type.png) | Mobile / Authentication | Yes | Personal, Dealer/Business and Company account selection. | Actual blank registration UI. | No registration submitted; no account created. |
| [mobile/buyer/mobile_buyer_category_filter_empty.png](mobile/buyer/mobile_buyer_category_filter_empty.png) | Mobile / Buyer | Yes | Existing category selected in the catalogue. | Real category filter; empty product result. | No product-detail or comparison journey can begin from an empty catalogue. |
| [mobile/buyer/mobile_buyer_home_catalogue.png](mobile/buyer/mobile_buyer_home_catalogue.png) | Mobile / Buyer | Yes | Catalogue serving as the current buyer home; search and category choices. | Real category API data; zero matching products. | There is no separate buyer home page. Long content is an actual screen viewport, not a stitched image. |
| [mobile/company/mobile_company_document_management.png](mobile/company/mobile_company_document_management.png) | Mobile / Company | Yes | Private document-management view. | Real company context; no documents; policy unconfigured. | Upload disabled until approved document policy is configured. No private file opened. |
| [mobile/company/mobile_company_verification_status.png](mobile/company/mobile_company_verification_status.png) | Mobile / Company | Yes | Verification application and pending company status. | Real pending company context; no submitted application. | Not evidence of completed verification; submission prerequisites are unmet. |
| [mobile/dealer/mobile_dealer_authorization_empty.png](mobile/dealer/mobile_dealer_authorization_empty.png) | Mobile / Dealer | Yes | Company-issued brand-authorization view. | Real empty authorization API context. | No active/revoked grant examples exist for this business; no self-grant controls. |
| [mobile/dealer/mobile_dealer_branch_form_controls.png](mobile/dealer/mobile_dealer_branch_form_controls.png) | Mobile / Dealer | Yes | Scrolled lower branch form: blank private contacts and visibility controls. | Actual unsaved form; pending-business publication restriction. | No contact values entered; no branch saved. |
| [mobile/dealer/mobile_dealer_branches_empty.png](mobile/dealer/mobile_dealer_branches_empty.png) | Mobile / Dealer | Yes | Owner branch-management list. | Real empty branch API result. | No existing branch editing/deactivation workflow can be shown. |
| [mobile/dealer/mobile_dealer_business_profile.png](mobile/dealer/mobile_dealer_business_profile.png) | Mobile / Dealer | Yes | Permitted business profile form. | Real existing incomplete business profile. | No field changed or saved. |
| [mobile/dealer/mobile_dealer_dashboard_pending.png](mobile/dealer/mobile_dealer_dashboard_pending.png) | Mobile / Dealer | Yes | Pending business status and network totals. | Real API data: active account, pending verification, zero branches/listings. | Business has not been approved. |
| [mobile/dealer/mobile_dealer_listings_inventory_restricted.png](mobile/dealer/mobile_dealer_listings_inventory_restricted.png) | Mobile / Dealer | Yes | Product-listing and inventory entry screen. | Real empty listing API result; creation disabled for pending business. | Listing and inventory share this screen. Price/stock editors are not reachable with current eligibility. |
| [mobile/dealer/mobile_dealer_new_branch_unsaved.png](mobile/dealer/mobile_dealer_new_branch_unsaved.png) | Mobile / Dealer | Yes | New branch form, upper fields. | Actual blank form; not a saved branch. | Form opened only and later cancelled. |
| [web/catalogue/web_catalogue_management_empty.jpg](web/catalogue/web_catalogue_management_empty.jpg) | Web / Catalogue | Yes | Product moderation/search and blank category-creation form. | Authenticated real empty product result. | No category created; no product moderated. |
| [web/dealers/web_dealer_branches_empty.jpg](web/dealers/web_dealer_branches_empty.jpg) | Web / Dealers | Yes | Dealer branch-management tab. | Authenticated real empty branch result. | No branch moderation performed. |
| [web/dealers/web_dealer_inventory_empty.jpg](web/dealers/web_dealer_inventory_empty.jpg) | Web / Dealers | Yes | Price-and-stock inspection tab. | Authenticated real empty listing result. | No inventory record edited or fabricated. |
| [web/dealers/web_dealer_network_pending_business.jpg](web/dealers/web_dealer_network_pending_business.jpg) | Web / Dealers | Yes | Business-review tab with existing incomplete pending profile. | Authenticated real existing development business record. | Approval/rejection controls displayed only; no action taken. |
| [web/other/web_audit_history_not_implemented.jpg](web/other/web_audit_history_not_implemented.jpg) | Web / Audit history | Yes | Explicit not-implemented viewer state. | Actual application limitation; no audit read API invoked. | This is not a functioning audit-history viewer. |
| [web/overview/web_admin_overview.jpg](web/overview/web_admin_overview.jpg) | Web / Overview | Yes | Administration workflow overview and connected health badge. | Authenticated actual UI; real process-health request. | Health is liveness only, not a completed business workflow. |
| [web/verification/web_company_verification_empty.jpg](web/verification/web_company_verification_empty.jpg) | Web / Verification | Yes | Company verification queue and case-selection panel. | Authenticated real empty queue. | No company case was claimed, reviewed or approved. |
| [web/verification/web_review_requests_empty.jpg](web/verification/web_review_requests_empty.jpg) | Web / Review requests | Yes | Restricted company review-request queue. | Authenticated real empty queue. | No review request resolved. |

## Requested views not captured as completed workflows

No placeholder images were created for these items.

| Requested view | Capture status | Reason / honest scope |
| --- | --- | --- |
| Separate buyer home | Shared implemented screen captured | The existing catalogue is the buyer home; no artificial separate page was made. |
| Category browsing / product catalogue | Captured | The real existing category can be selected; products are empty. These are distinct filter states of the same implemented screen. |
| Product details | Not captured | No eligible public product exists to open. No product was invented or inserted. |
| Product variants | Not captured | Requires a real product; no eligible product is available. |
| Dealer discovery | Not captured | Current mobile entry is product-linked; an empty public catalogue prevents reaching it normally. No deep-link/state injection was used. |
| Dealer branch comparison | Not captured | Requires a product and eligible branch listings; none are available. |
| Company dashboard | Withheld for privacy | Existing profile contact values are visible. The screen was reached but not saved. |
| Company profile, including a lower scrolled view | Withheld for privacy | Private profile values remain visible even at the natural bottom scroll position. No masking or UI alteration was used. |
| Company document upload success | Not captured | Document policy is unconfigured and the real document list is empty. The actual disabled management screen is included instead. |
| Completed company verification / approval | Not captured | Company remains pending and has no submitted application. The real application-status screen is included. |
| Populated dealer branches and branch editing | Not captured | Existing business has no branches. Blank unsaved create-form views are included; they do not prove a saved branch exists. |
| Active/revoked brand-grant examples | Not captured | No grants exist for the business. The genuine empty authorization screen is included. |
| Product listing creation or price/stock editor | Not captured | Business is pending, no eligible grants/branches exist, and no public products are available. Only the real restricted listing/inventory entry screen is included. |
| Web company review detail/actions | Not captured | Queue is empty; no case was fabricated or submitted. |
| Actual web audit records | Not implemented | The application has no staff audit read endpoint/viewer. The explicit not-implemented screen is included. |

## Read-only handling and limitations

Only navigation, supported development sign-in, read requests and unsaved forms were used. No account was registered, no form saved, no verification/grant/moderation action taken and no sample marketplace data created. Mobile sessions were switched by reloading in-memory state rather than invoking logout, which would update database token versions. Database counters and account access/token-version/phone-verification state were checked before and after capture.

The existing development BUSINESS identity remains pending. Company email delivery and document-policy configuration remain prerequisites for completed company verification. Empty/restricted screenshots must not be presented as successful end-to-end approval, upload, listing creation or stock management.

The emulator's prior 540 x 1200 / density 240 display overrides were restored after capture. The temporary browser viewport was reset and the capture-only tab closed. Django, Metro, the admin server and emulator were left running. No application business logic, database ownership, Git history, credentials or production settings were changed. Nothing was committed, pushed or deployed.
