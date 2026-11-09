# Mobile button redesign

Date: 04-11-2026. Scope: mobile presentation and interaction feedback only.

## Shared component and variants

`apps/mobile/src/Button.tsx` replaces eight duplicated button implementations and the authentication screen's bespoke controls. All 133 mobile action/selection call sites now specify their intent explicitly; button text never determines behavior, permission or style at runtime.

| Variant | Appearance | Uses |
| --- | --- | --- |
| Primary | Dark green `#14553E`, white text | Create, save, submit, accept, confirm, principal search |
| Secondary | White, green border/text | Edit, cancel editing, supporting actions |
| Tertiary | Transparent, green text | Refresh/retry, back, pagination, account/workspace links, open/download |
| Destructive | Red `#B42318`, white text | Reject, revoke, withdraw, cancel order, remove/delete, sign out |
| Navigation | Subtle neutral background; selected green tint, green border and check | Workspace tabs, category/brand/SKU choices, stock/state filters, invoice selections |
| Disabled/busy | Muted grey-green background, border and text | Existing forbidden/unavailable actions, and actions processing a request |

Dynamic grant/revoke and order-transition buttons select variants from their existing action state. Dealers cannot grant authorization. Existing disabled expressions and existing irreversible-operation confirmation dialogs remain intact.

## Design and interaction rules

- Minimum 48 dp touch target; action radius 10 dp, navigation radius 8 dp; 15 sp semibold text, 21 dp line height, consistent internal spacing. Labels can wrap and shrink within the available row width instead of overflowing. Existing screen scroll/wrap layouts are preserved.
- Lucide icons clarify search, save, create, send, confirm, edit, back/next, refresh, download/open and destructive actions. Decorative icons are hidden from accessibility; text labels remain present. Selected navigation also uses a check rather than relying only on color.
- Accessible action labels, selected tab state, disabled state and busy state. Press feedback is shared. Busy controls show an inline spinner and retain their label to avoid layout jumps.
- A synchronous ref gate prevents repeated presses before a render; promise-returning handlers remain locked until settlement. Existing screens also continue using their own busy flags. This is a UI duplicate-tap guard, not a replacement for backend concurrency/idempotency rules.
- No successful API response is fabricated, no validation removed, and no previously forbidden action enabled. Confirmation, exception display, API endpoints and session/role logic remain the responsibility of the existing screens.

## Screens updated

| Area | Updated controls |
| --- | --- |
| Buyer / App.tsx | Catalogue search/filter selections, pagination, product/SKU choices, dealer discovery, enquiry entry, account navigation and sign-out |
| AuthScreen | Send/verify OTP, registration choices, sign-in/registration mode switching |
| CompanyScreen | Workspace tabs, profile save, local email simulation, verification/review submission, retry/refresh/navigation |
| CompanyCatalogue | Brands, category association, product forms, variant/SKU forms and publication selections |
| CompanyAuthorizations | Dealer search, grant/revoke confirmation, records, filters and pagination |
| DealerWorkspace | Dashboard tabs, profile, branches, authorizations, product/variant selection, inventory, listing publication/withdrawal/reactivation |
| EnquiryWorkspace | Buyer enquiries, quotation acceptance/rejection, dealer quotation revisions, order conversion and draft line removal |
| OrderWorkspace | Order selection, dealer transitions, buyer cancellation, invoice issue/download and explicit selected tax/supply controls |
| LocalFileVault | Local selection, retry, open and confirmed deletion |

There is no dedicated staff-management workspace in the mobile app. Staff-facing account/sign-in controls use the same shared system; company/dealer guards remain in place. The web Admin Console is outside this mobile-only change and was not restyled.

## Files changed by this task

- Added `apps/mobile/src/Button.tsx`.
- Updated `apps/mobile/App.tsx` and the eight screen/workspace files listed above in `apps/mobile/src`.
- Added `apps/mobile/tests/button.test.mjs` and `button-adapter.mjs`; updated the five existing Buyer, Company, Company catalogue, Company authorization and Dealer component harnesses to render the real shared component.
- Updated mobile package manifest/lockfile with exactly `lucide-react-native@1.68.0` and Expo-supported `react-native-svg@15.16.0`. Existing Expo, React Native, React and TypeScript versions were preserved. npm reported 10 advisory findings during installation; no unrelated automated dependency upgrades were attempted.
- Updated Android app Gradle CMake arguments to use `CMAKE_OBJECT_PATH_MAX=240` for SVG codegen on Windows.
- Updated `apps/mobile/scripts/build-usb-apk.ps1` with a validated optional output filename, preserving existing APKs instead of overwriting them.
- Added this report and real-device evidence under `docs/evidence/button-redesign`.

These files already contained uncommitted work where applicable; that work was retained. No backend code, permissions, API contracts, database models, migrations or business records were changed.

## Validation

| Check | Actual result |
| --- | --- |
| `npm run typecheck` in apps/mobile | PASS |
| `npm test` in apps/mobile | PASS: 97 tests, zero failed/skipped |
| New button regression tests | Seven tests: variant distinction, selected navigation, disabled/loading safety, rapid taps, async success/failure unlock, long-label touch targets, and explicit shared intent across all screens |
| Existing role/workspace/component tests | PASS as part of the complete mobile suite; these are headless tests, not device mutation tests |
| Initial signed build with SVG | FAILED at Ninja mkdir for an excessively long generated object path |
| CMake path correction | Reduced object path maximum from cached 1024 to 240 so CMake hashes long object names; no library/SDK downgrade or security bypass |
| Signed ARM64 release retry | PASS: 3m 43s, 310 tasks (34 executed, 276 up-to-date) |
| Final signed build after loading cleanup | PASS: 1m 33s, 310 tasks (11 executed, 299 up-to-date); 2,814 JavaScript modules bundled with Hermes enabled |
| APK signature/package | PASS: APK Signature Scheme v2, one signer; `in.smarttrade.localtest`, arm64-v8a, non-debuggable release |
| Physical phone update | PASS: `adb -s 5e106900 install -r` returned Success; original signing identity and app data retained |
| Local API health | HTTP 200 during verification; USB reverse remains local-only |
| `git diff --check` | PASS for tracked mobile changes; existing line-ending conversion warnings only |
| Backend/admin suites | Not run: no backend/admin code changed |

Final APK: `client-presentation/apk/SmartTrade-0.1.0-buttons-final-arm64-release.apk`. Previous APKs and private signing credentials are preserved. Generated APKs and signing material remain Git-ignored.

## Screenshot evidence and live limits

- `docs/evidence/button-redesign/before-current.png`: genuine physical-phone Company dashboard before redesign, showing the previous action/tab hierarchy. No personal phone number, token or private document is visible.
- All screenshots below are genuine, unedited 1080 × 2400 captures from the connected physical phone; each was visually inspected. The phone's small ongoing-media status indicator is a system overlay, not SmartTrade content. No personal phone number, OTP, token or private document is shown.

| Screenshot | Actual evidence |
| --- | --- |
| `before-current.png` | Company dashboard before redesign: earlier similarly styled tabs and refresh/navigation actions |
| `after-company-dashboard.png` | Same Company dashboard after redesign: selected-tab tint/check, neutral unselected tabs, tertiary refresh/back |
| `after-company-catalogue.png` | Actual brand workspace: shared navigation, disabled Create brand for a blank name, tertiary refresh; form was not submitted |
| `after-company-account.png` | Existing Company session/account screen: tertiary workspace navigation versus destructive Sign out; sign-out was not pressed |
| `after-buyer-search.png` | Public catalogue: enabled dark-green Search catalogue, outlined Clear filters, selected/unselected category controls |
| `after-buyer-catalogue.png` | Actual product cards and muted unavailable pagination; catalogue content comes from the existing local API |

Evidence directory: `docs/evidence/button-redesign/`. The directly comparable before/after pair is the Company dashboard. Catalogue screens were browsed within the existing Company session; they are not proof of a separate Buyer-account login. Actual phone checks verified Company account → dashboard → catalogue navigation, loaded existing data, preserved session after update and button appearance. No profile, catalogue, authorization, stock, quotation or order mutations were made. Device busy/destructive submission behavior is covered by automated tests; real destructive actions were deliberately not executed for screenshots.

The existing Pixel emulator had a corrupted display/stale picker. A normal Android reboot preserved installed apps/storage, but Android subsequently displayed repeated system/process ANRs. Wait was selected; no factory reset, reinstall or file deletion was performed. Emulator visual verification is not counted as passed.

Initial phone use/picture-in-picture interrupted collection; after the user authorized pausing other apps, clean SmartTrade screenshots were captured. Unrelated captures were excluded. The phone is left on the working catalogue screen with its existing Company session. This report does not claim full live testing of all four roles. Backend business workflows were intentionally left unchanged.

## Remaining limits

- Pixel emulator visual validation is blocked by OS-level ANRs; physical-phone validation succeeded instead. No emulator data was reset.
- Dealer, quotation, order and local-file control migrations passed the applicable headless/component/API-client tests, but this task did not log into every role or execute every commercial/destructive workflow on-device.
- npm advisory warnings and dependency Gradle/AGP deprecations remain outside this UI-only task. Signing and backend authentication settings were preserved; no public exposure was introduced.
- No commits, pushes or deployments were performed.
