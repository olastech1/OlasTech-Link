# OlasTech portal and controller

The live Omada Controller on `144.91.68.190` was upgraded from `6.2.14.11` to the explicitly pinned stable image `mbentley/omada-controller:6.3.0.111`. Docker reports healthy, `/api/info` reports the expected version, admin login works, and the EAP225-Outdoor remains connected and compatible.

The live **OlasTech Hotspot** uses the redesigned imported voucher portal from `template-repo/`. Its authentication type, voucher method, enabled state, SSIDs, and network assignments were checked after updating. HTML, CSS, and JavaScript all return HTTP 200, and `/portal/getPortalPageSetting` still returns voucher authentication.

The root `index.html`, `style.css`, and `script.js` contain the matching plan purchase page. These local changes have not been deployed to Vercel: the saved project is inaccessible with the existing CLI credential (HTTP 403). The domain recorded in the old portal settings currently serves a different website; do not overwrite it without identifying the intended deployment.

## Build the portal archive

Run `python3 scripts/package-portal.py`. It creates `omada-portal.zip` using only `index.html`, `index.css`, and `index.js`; Git metadata, credentials, and unused images are excluded. Upload that ZIP in the existing hotspot's imported portal page setting. Preserve the voucher authentication and SSID assignments.

The design uses system fonts and inline SVG, so it does not require Google Fonts, analytics, jQuery, or external images before authentication.

## Verification

Browser regression checks are in `scripts/test-portal.cjs` and require the `playwright` Node package plus an existing Chrome installation. Set `CHROME_PATH` on other platforms. Run `node scripts/test-portal.cjs` with Playwright available in Node's module search path.

Checks cover plan selection and WhatsApp details, API failures and retry, blank vouchers, keyboard submission, the native Omada auth payload, invalid vouchers, network retry, successful redirect, modal keyboard handling, and overflow at 320, 390, and 1440 pixels. These checks use simulated authentication responses and do not consume paid vouchers.

A real paid voucher connection still needs checking from a device on the hotspot Wi-Fi.

## Recovery

The server backup directory is `/root/omada-backups/20261116T161522Z/`. It contains the stopped controller data snapshot (`data.tar.gz`), original Compose file, original container inspection, and the portal configuration before redesign (`portal-before-redesign.json`). The original portal resource was retained.

To undo only the design, reselect the old imported portal resource from the saved configuration. To undo the controller upgrade, stop the controller gracefully, restore the complete old data snapshot into an empty data directory, restore the original Compose file, and start with the retained original image. Do not run the old controller against the upgraded database.

`scripts/upgrade-controller.sh` records a backup and retains the old image before a version change. It checks both Docker health and the API version and restores the snapshot if startup verification fails. Consult release requirements before selecting another minor version.

## Portal redirect repair

After the upgrade, a phone continued showing the access point’s “connection to Omada Controller has been lost” page even while the AP had an established management connection. The AP also completed a separate firmware upgrade to 5.3.1 and reconnected at 5:28 PM Lagos time. Reconnecting the phone alone did not clear the error.

The controller’s portal URL was set to automatic detection on a host with multiple Docker interfaces. Its `webPort` configuration was changed to `autoPortalIpEnable: false` and `portalHost: "144.91.68.190"`, preserving the existing ports and management settings. The prior settings are backed up on the server as `controller-setting-before-portal-address.json` in the existing backup directory. The public HTTP portal returned 200, and the user confirmed that reconnecting now displays the redesigned login page. This verifies the redirect repair; a real voucher login remains a separate check.

## Telegram login page

Replaced the promotional split layout with a compact voucher form and a purchase button for the verified `@Olastech_bot`. Removed the WhatsApp click handler so the Telegram link works even when the controller configuration request fails. Existing native authentication payloads and alternative login fields are retained. The page explains how to buy a voucher through Telegram and return to the login form. Paystack has not been enabled; the bot’s current payment flow remains in place pending credentials and integration.

## Telegram button navigation

The user reported Google opening when tapping the Telegram purchase button. A live desktop browser test opened Telegram correctly in a new tab, so the phone’s captive-window behavior could not be reproduced directly. Changed the Telegram links from a new-window target to explicit same-window navigation and added a visible bot URL. Browser regression checks verify that clicking the purchase link navigates the current page to the exact Telegram bot address without creating another tab. The change does not modify the controller’s post-login destination.
