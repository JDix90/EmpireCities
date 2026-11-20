# Store release — iOS App Store

Where the iOS app stands on the way to the App Store, and the checklist for getting it there.
How the app is built, what it needs from the server and how to test it on a device are in
[MOBILE_CAPACITOR.md](MOBILE_CAPACITOR.md); this page does not repeat them.

Google Play is not being prepared yet; see [Google Play](#google-play).

## Decisions

Recorded 15 November 2026.

| Question | Decision | What follows from it |
|----------|----------|----------------------|
| iPhone only, or iPad too? | **iPhone and iPad** | The Xcode target stays `TARGETED_DEVICE_FAMILY = "1,2"`. The listing needs iPad screenshots, and Apple reviews the app on an iPad as well |
| Chat in the app at launch? | **Yes, with GIF search off in the app** | Chat needs the report and block tools switched on (below). GIF search is hidden in the app only; a GIF sent from the website still shows there and can be reported |
| Apple Developer Team ID | **`4RNR4T2NYM`** (enrolled; recorded 20 November 2026) | Universal links need it in `frontend/public/.well-known/apple-app-site-association`, where it now is; it takes effect when the website is deployed ([check](MOBILE_CAPACITOR.md#before-it-works-the-team-id)). The server's `APNS_TEAM_ID` is the same value |
| Legal name and contact emails | **Not provided yet** | `PRIVACY_POLICY.md` and `TERMS_AND_CONDITIONS.md` keep their bracketed placeholders. The in-app pages name `support@borderfall.gg` (`VITE_SUPPORT_EMAIL`) and no legal entity |
| Sign in with Apple | Not required | The app has no third-party sign-in |
| In-app purchase | Not required | Nothing is sold for real money; gold and gems are earned |

## What is built

| | State |
|---|---|
| Opens as an app, not the website (guideline 4.2): play at `/`, no search-engine pages, links to other sites in an in-app sheet, no "Add to Home Screen" prompts | Built |
| Report a chat message, block a player (guideline 1.2) | Built, behind `chat_safety_enabled` (off by default) |
| Delete an account inside the app, guests included (guideline 5.1.1(v)) | Built, behind `guest_account_deletion_enabled` (off by default) |
| Minimum app version, with an "update required" screen | Built; no minimum set |
| App and website told apart in analytics | Built |
| Privacy page covers chat reports, blocks, iOS push tokens, crash reports and where to delete an account | Built |
| Native build: required server addresses, clean app shell, shared links that point at the website | Built |
| Push notifications on iPhone and iPad, sent straight to Apple; asked for only from the existing controls | Built; off until the server has the Apple push key (`APNS_*`). Not yet confirmed on a device |
| Links that open the app (sign-in, password reset, invites, replays, your-turn links), and a sign-in code to type when a link lands in a browser | Built; needs the website deployed (the association file now has the Team ID), and `sign_in_code_enabled` (off by default). Not yet confirmed on a device |
| Staying signed in: a refresh token in the iOS Keychain, sent only by the app; survives a force-quit and a reinstall | Built; off until the server sets `NATIVE_APP_ORIGINS`. Not yet confirmed on a device |

## What is still to do before the App Store process can start

**Confirm on a device.** Staying signed in, links that open the app and push notifications
are built but have only been tested in simulation: this work was done without access to an
iPhone. The device test list in
[MOBILE_CAPACITOR.md](MOBILE_CAPACITOR.md#testing-on-a-device) covers each. Treat any failure
there as a blocker.

**Details only the owner can supply**

- [ ] Legal name (or company) and the privacy and support contact emails, for the placeholders
      in `PRIVACY_POLICY.md` and `TERMS_AND_CONDITIONS.md`. The governing-law and venue
      placeholders in the terms need a decision too. Have counsel read both.
- [ ] An Apple push key (`.p8`), created in the Apple Developer account and copied to the
      server ([how](MOBILE_CAPACITOR.md#push-notifications)).
- [x] The Apple Developer Team ID, in the association file. Still to do: deploy the website and
      run the `curl` check ([how](MOBILE_CAPACITOR.md#before-it-works-the-team-id)).

**Server, before the first device build**

- [ ] `CORS_ORIGINS` includes `capacitor://localhost`, backend restarted
      ([how](MOBILE_CAPACITOR.md#1-allow-the-apps-origin)).
- [ ] `NATIVE_APP_ORIGINS=capacitor://localhost`, so the app stays signed in
      ([how](MOBILE_CAPACITOR.md#2-let-the-app-stay-signed-in)).
- [ ] `APNS_KEY_PATH`, `APNS_KEY_ID` and `APNS_TEAM_ID`, with the key file in place
      ([how](MOBILE_CAPACITOR.md#4-give-the-server-the-apple-push-key)).
- [ ] `chat_safety_enabled`, `guest_account_deletion_enabled` and `sign_in_code_enabled`
      switched on (Admin → Config). Once they have been checked on production, promote their
      code defaults to on.
- [ ] Every migration in `database/migrations/` applied (`pnpm run db:migrate`);
      `057_chat_safety.sql` is the one the report and block tools need.
- [ ] Someone reads Admin → Reports. Apple expects reports of objectionable content to be
      acted on promptly.

**Worth deciding before submission**

- [ ] Whether the Terms of Service should say outright that objectionable content and abusive
      behaviour are not tolerated and that reports are reviewed. Apple asks apps with
      user-generated content for terms to that effect; the current terms forbid unlawful
      content in chat but make no statement about reports.
- [ ] Whether a GIF sent from the website should show in the app's chat at all.

## The App Store process

None of this has been started. It is listed so that nothing is discovered late.

### Apple account and identifiers

- [x] Apple Developer Program enrolment
- [ ] App ID `com.borderfall.app`, a new listing, distinct from the legacy
      `com.chronoconquest.app`
- [ ] Capabilities on the App ID, when their features are built: Associated Domains (universal
      links), Push Notifications
- [x] The Team ID put in `frontend/public/.well-known/apple-app-site-association`
- [ ] The website deployed with it, and the `curl` check passing

### The build

- [ ] The device test list in [MOBILE_CAPACITOR.md](MOBILE_CAPACITOR.md#testing-on-a-device)
      passes on an iPhone and an iPad
- [ ] `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` set for the release
- [ ] App icon: `AppIcon.appiconset` holds one 1024×1024 image today; confirm it is the final
      artwork, with no transparency
- [ ] Launch screen (`LaunchScreen.storyboard`, `Splash.imageset`) is the final artwork
- [ ] Export compliance: the app uses only standard HTTPS. `Info.plist` does not yet declare
      `ITSAppUsesNonExemptEncryption`; without it App Store Connect asks at every upload
- [ ] Privacy manifest: the project has no `PrivacyInfo.xcprivacy` of its own. Check whether
      the app's own code needs one (Capacitor and its plugins ship theirs)
- [ ] Built with `scripts/build-ios-release.sh` (never a plain `pnpm run build`), archived in
      Xcode, uploaded

### App Store Connect

- [ ] Display name **Borderfall**, category Strategy
- [ ] Privacy Policy URL (`https://<the site>/privacy`) and Support URL, both live
- [ ] **App Privacy answers.** What the app and server actually collect, to be mapped onto
      Apple's categories:
  - email address, when an account is saved (guests have none)
  - username and an account ID
  - gameplay: matches, stats, ratings, saved game state, sign-in times
  - chat reports: the reported message, sender, reporter and reason; and blocks
  - feedback a player sends, with device type and screen size
  - a push token, if notifications are allowed
  - a sign-in token kept in the device Keychain by the app (it stays on the device)
  - crash and error reports, sent to Sentry when `VITE_SENTRY_DSN` / `SENTRY_DSN` are set
  - first-party usage events (`analytics_events`), including device class and platform
  - IP address and browser or device type in server logs
  - Nothing is used to track players across other companies' apps or sites, and no
    advertising SDK is present.
- [ ] Age rating questionnaire (strategy, mild combat; chat between players is user-generated
      content)
- [ ] Screenshots for the required iPhone and iPad sizes, taken from the app, not the website
- [ ] Review notes. Paste as written; the second paragraph names what the app does that the
      website cannot, which is what a reviewer weighs under guideline 4.2 ("more than a
      repackaged website"):

      > Tap Play Free Now to play as a guest; no account is needed. Report and Block are in the
      > menu on any chat message from another player. Blocked players is in Settings. Delete
      > account is in Settings → Account.
      >
      > Built for iPhone and iPad: turn alerts through Apple Push Notifications, asked for only
      > when the player turns them on; the account kept in the iOS Keychain, so a guest's game
      > survives quitting and reinstalling; universal links, so sign-in, invite, replay and
      > your-turn links open the app; haptic feedback in play; and a layout for iPad, including
      > Split View.

      Every claim in it is built and is in the device test list; recheck it against the build you
      submit
- [ ] TestFlight: internal testing first
- [ ] Once the listing has an ID, put its URL in Admin → Config → `native_app` →
      `ios_store_url`, so the "update required" screen can open it
      ([how](MOBILE_CAPACITOR.md#the-minimum-version))

### After release

- [ ] Leave `ios_min_version` empty until a second version is live in the store. Never set it
      above the newest live version
- [ ] Follow the [compatibility rule](MOBILE_CAPACITOR.md#the-compatibility-rule) for every
      API change from now on: shipped apps cannot be redeployed
- [ ] Watch Admin → Analytics → By platform for the app's signups and returns

## Listing copy (draft)

**Short description:** Turn-based territory strategy across historical eras: draft, attack,
fortify, conquer.

**Full description:** Borderfall is a free strategy game inspired by classic territory
conquest. Command armies across historical world maps and regional theaters, research
technologies, play ranked matches, daily challenges, and async games with friends. No
real-money purchases: gold and cosmetics are earned through play.

Do not reuse the website's description (`STORE_DESCRIPTION` in
`frontend/src/constants/brand.ts`) as it stands: it says "Free to play in your browser".

## Google Play

Not being prepared. The Android project builds, but it cannot talk to a production server yet
([why](MOBILE_CAPACITOR.md#android)), and none of the iOS product work above has been checked
on Android. When it is taken up: Play Console account, application ID `com.borderfall.app`,
Data safety form (the same inventory as App Privacy above), content rating, an internal
testing track, and a signed upload key kept out of the repository.
