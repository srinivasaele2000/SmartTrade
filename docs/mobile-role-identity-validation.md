# SmartTrade mobile role identity

The authenticated mobile header pairs the SmartTrade wordmark with a role badge. The same identity appears as a larger heading on My account, and the shared header remains visible in the Company and Dealer dashboards and their existing navigation.

| Account shown to the user | Accent | Icon |
| --- | --- | --- |
| Buyer | Blue | Shopping bag |
| Dealer | Green | Store |
| Company | Purple | Building |
| Platform Admin | Orange | Shield with check |

The badge reads the authenticated session on every render. It has no independently persisted role, role selector or permission effect. Platform Admin requires an active backend staff profile with the corresponding role assignment. Staff without that assignment see Staff. Logout removes the badge when the session clears. Role text is available to screen readers, and color is paired with text and an icon. The light and dark badge palettes have measured text contrast ratios of at least 6.82:1. Existing action buttons and navigation permissions retain their established behavior.

| Automated check | Result |
| --- | --- |
| Mobile TypeScript | PASS |
| Mobile suite | 117 passed, zero skipped. The new render test exercises the real header and account heading for all four roles, Staff fallback, signed-out state and dark palette. |
| Android Hermes export | PASS. 2,820 modules and one 4.4 MB Hermes bundle. |
| Local controlled sessions | PASS. Buyer, Dealer and Company development OTP request/login/profile returned 202/200/200. Designated staff development login/profile returned 200/200 and the server supplied the active Platform Admin role. |
| Signed ARM64 release | PASS. APK v2 verified with one signer. Package `in.smarttrade.localtest`, version `0.1.0` (code `1`), ABI `arm64-v8a`. |

Release artifact `client-presentation/apk/SmartTrade-0.1.0-role-identity-arm64-release.apk`. SHA-256 `052b651a8d484f212ac6727a91b48632212249fa57726503df461c6de5f1a0d6`.

The initial physical attempt was interrupted by a USB disconnect. The 09-11-2026 IST follow-up reconnected physical phone `5e106900` (model `23049PCD8I`, device `marblein`). The installed package was `in.smarttrade.localtest` version `0.1.0` (code `1`), with the prior Package B APK hash. `adb install -r` returned Success and the installed base APK hash matched the role identity artifact above. ADB confirmed a cold launch with Status ok. The Django API was started on loopback, returned HTTP 200 and was forwarded over USB.

The pre-existing session was rejected on the first launch (profile and refresh both returned 401). The controlled Buyer signed in through the normal development OTP flow. A subsequent force-stop and cold launch restored this fresh authenticated session and displayed BUYER in the header and My account. That restart required no fresh login.

| Physical check | Result | Screenshot |
| --- | --- | --- |
| Buyer | PASS. Blue shopping bag badge in the header and My account. | [Buyer](evidence/mobile-role-identity/buyer.png) |
| Dealer | PASS. Green storefront badge in both locations after switching from Buyer. | [Dealer](evidence/mobile-role-identity/dealer.png) |
| Company | PASS. Purple building badge in both locations after switching from Dealer. | [Company](evidence/mobile-role-identity/company.png) |
| Platform Admin | PASS. Orange shield badge in both locations after switching from Company. | [Platform Admin](evidence/mobile-role-identity/platform-admin.png) |
| Logout | PASS. The Sign in control returned and the authenticated role label disappeared between accounts. | [Signed-out catalogue](evidence/mobile-role-identity/signed-out.png) |
| Force-close and reopen | PASS with Buyer. The backend revalidated the session and both role labels returned. | [Buyer after restart](evidence/mobile-role-identity/buyer-after-restart.png) |

Each controlled account used the existing mobile development OTP flow. The device evidence covers the header, My account, signed-out state, account switching, and restart restoration of the Buyer session.

The final Platform Admin → Buyer switch also passed. The phone was left authenticated as the controlled Buyer on My account. The update used Android's in-place install, and the validation changed only test sessions. No Git commands were run.
