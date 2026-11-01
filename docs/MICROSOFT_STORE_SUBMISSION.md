# Microsoft Store submission packet

This packet prepares the reviewable values and assets for Recap Page's replacement Microsoft Store
submission. On 2026-09-01 the owner authorized replacing the failed package and selecting **Submit
for certification** after every gate in this packet passes against the exact accepted source and
bundle. That direction does not authorize an account change, new legal acceptance, capability
change, publication, or change to the existing GitHub ZIP release.

Official requirements and public URLs were rechecked on 2026-08-29. Partner Center remains
authoritative when its live wording or validation differs from this packet.

The 4.3.0 listing, requirements, privacy answers, restricted-capability explanation, certification
text and release notes below were approved by the owner on 2026-10-30. This approves text only,
not a build, upload, submission or publication. The 2.0.2 first-submission procedures and package
details remain historical. The screenshots have not yet been accepted for the 4.3.0 listing.

## Owner review card

This card records the first submission, not an approval to submit 4.3.0.

| Decision | Recommended value | Owner action |
|---|---|---|
| Product | Rejected packages: `2.0.0.0` and `2.0.1.0`. Replacement release: Recap Page 2.0.2, package `2.0.2.0`. | Confirm the exact release candidate |
| Publisher display | PanelStack Labs | Confirm |
| Initial market | United States only | Approve or replace |
| Price | Free, no trial, no sale | Confirm |
| Audience and visibility | Public audience, available and discoverable | Confirm the permanent public-audience choice |
| Publication timing | No scheduled release, manual publishing hold | Select the hold and later approve Publish now |
| Category | Books + reference, Reference | Confirm |
| Listing language | English (United States) | Confirm |
| Personal information answer | Yes | Review the distinction below |
| Privacy, support, and website URLs | Public GitHub pages listed below | Open each anonymously and approve |
| Age rating | Live IARC questionnaire required | Review every current question and generated rating |
| Restricted capability | `runFullTrust` | Approve the justification in the live request |
| Package | Final x64 and ARM64 MSIX bundle only | Verify hash before upload |
| Product update channel | Microsoft Store only; no in-app products | Confirmed 2026-09-01 |

Stop for every unresolved action named in [Live-review stop points](#live-review-stop-points).

## Product identity and package-derived fields

Partner Center reads these values from the uploaded package and reserved product. They are not
listing copy to improvise.

| Field | Exact value | Source |
|---|---|---|
| Product name | Recap Page | Reserved name and package display name |
| Package identity | `PanelStackLabs.RecapPage` | Package manifest |
| Package publisher | `CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472` | Package manifest |
| Publisher display name | PanelStack Labs | Package manifest |
| Package family | `PanelStackLabs.RecapPage_we33aa8nvkpcc` | Partner Center identity |
| Package version | Rejected: `2.0.0.0` and `2.0.1.0`. Replacement: `2.0.2.0`. | Bundle package manifests |
| Architectures | x64 and ARM64 | Bundle package manifests |
| Device family | Windows Desktop | Package manifest |
| Minimum Windows version | Windows 10 version 2004, build `10.0.19041.0` | Package manifest |
| Supported language | `en-us` | Package manifest |
| Restricted capability | `runFullTrust` only | Package manifest |

On the Packages page, upload only the final `.msixbundle`. Partner Center must show the exact
identity, version, both architectures, English language, Desktop device family, and only
`runFullTrust`. Remove and rebuild the package rather than accepting any mismatch. Do not enable
future device families because the manifest intentionally targets Desktop.

## Pricing, availability, and properties

### Pricing and availability

| Partner Center field | Requirement | Recommended value |
|---|---|---|
| Markets | Required, defaults to all possible markets | United States only for the first release |
| Audience | Required, defaults to public | Public audience |
| Discoverability | Required, defaults to discoverable | Make this product available and discoverable in the Microsoft Store |
| Schedule | Required, defaults to release as soon as possible and never stop acquisition | No release date; never stop acquisition |
| Base price | Required | Free |
| Free trial | Optional | None |
| Sale pricing | Optional | None |
| Organizational licensing | Optional | Leave the portal default unless the owner wants organizational acquisition |

The United States only recommendation is deliberately conservative. The app has one `en-us`
listing, opens third-party services whose country availability is not expressed as a complete
official market list, and Microsoft leaves local-law compliance with the publisher. Other markets
can be added in later submissions without changing the package. Do not enable automatic addition of
future markets without a new review.

For the first submission, the owner selected **Don't publish this submission until I select Publish
now** in Submission options. The protected update process instead publishes after certification,
as described under [Future Store updates](#future-store-updates). Public audience is a one-way
choice: Microsoft says a product first submitted to a public audience cannot later become a
private-audience product.

### Category

Use **Books + reference** with the **Reference** subcategory. Microsoft describes the category as
interactive access to material generally found in print and explicitly gives comics as an example.
Recap Page is a reference and progress companion, not a game or a comic reader. Leave secondary
category blank for the first submission.

### Privacy and support

The following is the approved 4.3.0 answer. Saving the live declaration remains a separate owner action.

### Personal-information answer and package-data declaration

Answer Yes to accessing, collecting or transmitting personal information. Optional OneDrive backup
sends the reader's saved data to the reader's own Microsoft account. Searches and lookups send
search text or comic identities to the services named in the privacy policy. Nothing goes to the
developer.

Keep Windows automatic backup of package data disabled. That setting is separate from the app's
optional OneDrive backup. No new package capability is requested.

### Public privacy and support URLs

| Field | Public HTTPS value | Source |
|---|---|---|
| Privacy policy | https://raymond-nassar.github.io/recap-page/privacy.html | Project home page built from `PRIVACY.md` |
| Support contact | https://raymond-nassar.github.io/recap-page/support.html | Project home page built from `SUPPORT.md` |
| Website | https://github.com/raymond-nassar/recap-page | Public source and product overview |

Microsoft accepts a support URL or email and requires support contact information only for Xbox, so
the support guide is sufficient for this Desktop app. No private email, phone number, or address is
placed in this repository. If Partner Center asks for regulatory contact details, the owner enters
them privately.

The privacy and support values were repository file views until the project home began publishing
both documents as ordinary web pages, because store reviewers treat a file in a code repository as
a weak policy host. Each page is rebuilt from its maintained file on every `main` deploy, has no
sign-in or download requirement, and the privacy page states storage, requests, recipients,
controls, and deletion. Changing the Partner Center fields is an owner action; open each page after
the deploy before entering it. If the live form offers direct policy text, paste the same
maintained policy there as well as supplying the URL.

### Product declarations and requirements

- Do not select purchases outside Microsoft commerce. Recap Page sells nothing. A separate Marvel
  Unlimited subscription is an external reading dependency, not an in-app purchase.
- Do not claim Microsoft's accessibility declaration until the complete listed keyboard, contrast,
  screen reader, Magnifier, on-screen keyboard, high-contrast, high-DPI, Inspect, and AccChecker
  evidence has been completed.
- Keep alternate-drive and removable-storage installation enabled. The package reads from its
  installed location and saves no reader state there.
- Follow the current package-data declaration above for Windows automatic backup.
- Do not select pen and ink, game recording, mixed reality, or generative AI.
- Leave optional hardware checkboxes blank. Package eligibility already limits acquisition to
  supported x64 and ARM64 Windows Desktop systems.

### Customer-facing requirements

1. A supported default web browser.
2. Internet access for comic details, covers, reading links and optional OneDrive backup.
3. A personal Microsoft account only if you choose OneDrive backup.
4. Comics are not included. Marvel decides access to its reading services.

## English (United States) Store listing

### Product name

Recap Page

### Short description

Keep your place in Marvel stories with credited reading orders and optional backup to your own OneDrive. Comics are not included. Marvel Unlimited reading ends December 7, 2026.

### Long description

Follow any Marvel story across series and pick up at your next unread comic. Recap Page gives you credited reading orders for events, eras and characters, with private progress, notes and ratings.

Mark comics read as you go, or mark a whole list read at once. Save everything to a backup file, or turn on automatic backup to your own OneDrive. OneDrive is optional and off until you choose it. Microsoft can read your backups, your account protects them, and the developer never receives them.

No Recap Page account, ads, analytics or telemetry. Covers and comic details load from Marvel and a community comics information service.

Comics are not included. Reading in Marvel Unlimited ends December 7, 2026. Until then, Read opens its web reader when a link is known. After that, Read opens the Marvel Comics website.

Reading orders credit Comic Book Herald and Comic Book Reading Orders where their guides supply the issues and order.

This is an unofficial fan companion, not affiliated with or endorsed by Marvel Entertainment or Disney. Marvel names and marks belong to their owners.

### Feature fields

1. Credited reading orders for Marvel events, eras and characters
2. Reading Paths across connected lists
3. Pick up at your next unread comic
4. Private notes, ratings and custom entries
5. One-file backup of your reading data and settings
6. Optional automatic backup to your own OneDrive
7. No Recap Page account, ads, analytics or telemetry

### Keywords

comic reading tracker
reading order
Marvel reading tracker
comic checklist
reading progress
comic events
comic books

### Keyword guidance

Keywords were formerly called Search terms. Each keyword is below Microsoft's 40-character limit.
Together they use fewer than 21 unique words.

### Copyright and trademark information

Copyright (c) 2026 Raymond Nassar. Unofficial fan companion, not affiliated with or endorsed by
Marvel Entertainment or Disney. Marvel names and marks belong to their respective owners.

Use **PanelStack Labs** for **Developed by**. Leave short title, sort title, and voice title blank.

Leave **Additional license terms** blank. Microsoft's Store license terms govern acquisition of the
Store package, while the source repository separately publishes its code under MIT. Pasting the MIT
text into the Store field would blur those distinct roles. The Website field leads to the repository
and its source license.

The next heading retains the reviewed packet's label; its field text is approved.

### What's new in this version: proposed exact field

Back up automatically to your own OneDrive, or keep everything in one backup file. Mark a whole list read at once, with Undo. Explore the new Professor X spotlight and reading path. Marvel Unlimited reading ends December 7, 2026, and Read then opens the Marvel Comics website.

### Availability guidance

Historical Marvel Unlimited badges do not establish access to Marvel Comics. After December 7,
Read opens the general website, not a single-comic link.

## Age-rating answer draft

The table below records the first submission, not the current answers. Its no-transfer rows describe
that earlier build, not 4.3.0. Review the current live questionnaire, including the optional
OneDrive transfer described above.

Every question presented by IARC is required. IARC says its questionnaire is available only inside a
participating storefront. Microsoft says the first category answer controls later questions, and
IARC can revise the questionnaire. This table is a product-fact draft, not reconstructed portal
wording. The owner must read each live question and its information control before answering.

| Topic likely presented | Draft answer | Product evidence and caution |
|---|---|---|
| Existing IARC certificate | No | No prior rating ID is known |
| App category | Reference or the live equivalent for other apps | This is not a game or comic reader |
| Violence, blood, or gore | No for content shipped by Recap Page | The app displays issue titles and labels, not comic pages or narrative descriptions |
| Fear or horror | No for shipped content | Some issue titles contain genre words, but no depicted scenes ship |
| Sexual content or nudity | No | None ships |
| Profanity or crude humor | No | None is intentionally shipped |
| Alcohol, tobacco, or drugs | No | None is intentionally shipped |
| Gambling or simulated gambling | No | None |
| Purchases or randomized purchases | No | The app sells nothing; reading may require a separate existing subscription |
| Users interact with each other | No | No account, chat, multiplayer, social feed, or shared profile |
| User-generated content visible to others | No | Notes, custom entries, and lists stay local |
| Location sharing | No | No location access |
| Advertising | No | None |
| Live generative AI | No | None |
| Directed specifically to children | No | General-audience reference tool |
| External links or online content | Yes if asked | Specific metadata, Marvel, Marvel Fandom, and GitHub requests exist |
| Unrestricted Internet access | Read the live definition | The app is not a browser, but it opens specific pages in the external default browser |
| Personal information sharing | No saved-state sharing | Search queries and issue identities can be sent; saved notes and progress are not |

Optional cover art is enabled in a fresh browser profile and may contain comic imagery supplied by
Marvel's image hosts. The app can switch it off, and the submitted screenshots do so. If the live
questionnaire asks about remotely delivered visual content, answer from that actual behavior rather
than only from the sanitized screenshots.

Microsoft shares the publisher display name and publisher email address with IARC. Review every
generated regional rating before continuing. If IARC refuses a market, remove that market rather
than trying to bypass the result.

## Restricted capability justification

`runFullTrust` is the only restricted capability. The live Partner Center capability request is an
owner-only action and may add certification time. The following explanation is the approved 4.3.0
text.

### Restricted-capability explanation

Recap Page declares runFullTrust so it can start its bundled Node runtime as a local server and open the user's default browser. The server binds only to 127.0.0.1:8787 and accepts no remote connections. It requests no elevation, installs no background service, creates no account and sends no telemetry. Optional OneDrive backup goes only to the user's own Microsoft account, never to the developer.

## Notes for certification

The fixed text below is approved for 4.3.0. A separate submission approval and final evidence are
still required.

### Notes for certification: fixed text

Prepared for Recap Page 4.3.0, package version 4.3.0.0.

Launching Recap Page starts a hidden local server on 127.0.0.1:8787 and opens the default browser there. No console stays open. No account or test credentials are needed to track lists.

Core test path:
1. Launch Recap Page from Start and confirm that the default browser opens http://127.0.0.1:8787/ without leaving a console open.
2. On Home, open Modern Timeline and find House of M. Preview it, add it to the library, mark an issue read and add a note.
3. Close the browser and relaunch in the same profile. Confirm the saved progress and note remain.
4. In Backup & settings, export a complete backup. Restoring it requires confirmation and replaces its saved components; use test data.
5. OneDrive is optional. To test it, use a personal Microsoft test account that the tester controls, connect it under Backup & settings, review existing backups and turn automatic backup on. Make a reading change and check the successful backup status. Use test data for a confirmed restore.
6. Delete this device's cloud backups removes recognized files for this installation. Disconnect also offers deletion. OneDrive can retain deleted files in its recycle bin; local erase and uninstall do not delete cloud copies.

The app contains no comic pages. Requests go to a community comics information service, Marvel's image and reading sites, the optional Marvel Fandom lookup, and Microsoft sign-in and OneDrive only when chosen. Backups are compressed but not encrypted by the app, are readable by Microsoft, and never sent to the developer.

Before December 7, 2026, Read opens the Marvel Unlimited web reader when a link is known, or a comic details page. From December 7 on the device's clock, it opens the Marvel Comics website. Comics and access credentials are not provided.

The app has no updater, release check, download link or in-app purchases. It updates only through Microsoft Store. Its only restricted capability is runFullTrust.

### Certification evidence attachment, not yet available

Add the final package-input commit, bundle hash, native, WACK and installed run URLs and result
counts only after protected main qualification. Review any measured warning against that exact
result. The fixed text above does not approve a submission or claim a passing WACK run.

### Historical certification evidence

The optional Blocked executables test may identify the required Node runtime.
DPIAwarenessValidation warned on its console process. Partner Center certification remains authoritative;
review the current result rather than copying these earlier observations into the 4.3.0 submission.

The rejected package's historical WACK record contained 22 `PASS` categories, one optional
`FAIL`, and one `WARNING`. Those counts are not evidence for the replacement package and must not be
copied into the bracketed line above.

## Listing assets

The four screenshots were captured at 1920 x 1080 from installed Edge with an isolated temporary
profile. Cover art was off, and the app contains no update controls. The first two views use empty
state. The remaining views use one synthetic House of M import with the first five of 20 issues
marked read at fixed January 2026 timestamps and no notes. No private browser profile, progress,
path, email, or account data entered the captures.

| File | Caption for Partner Center |
|---|---|
| `01-home-discovery.png` | Home offers a first step on Modern Timeline and category cards for Storylines, Character spotlights, Young readers, and more. |
| `02-browse-reading-lists.png` | Storylines, reached from Home's category cards, lists story-arc Reading Lists with filters, era groups, and source credits. |
| `03-reading-paths.png` | Modern Timeline follows a Reading Path stop by stop and marks where you are. |
| `04-reading-progress.png` | A demonstration Reading List keeps the next issue, issue order, and local completion progress together. |
| `store-tile-300.png` | Exact 300 x 300 Store tile derived from the existing purple panels app icon. |

Each PNG is below 50 MB and contains only image data chunks. Keep critical content in the top
two-thirds because Store overlays may cover the bottom third. Package icons are separate and remain
unchanged.

Reviewed asset measurements:

| File | Dimensions | Bytes | SHA-256 |
|---|---:|---:|---|
| `01-home-discovery.png` | 1920 x 1080 | 166307 | `CC506A5D60FF519011015664341044C95A1925ECF0C54420C2AF9DED51B8BA37` |
| `02-browse-reading-lists.png` | 1920 x 1080 | 159962 | `87C56A2D5FF958D70467264748B51FFE8D71A96915D014FC23E808651F64E1A1` |
| `03-reading-paths.png` | 1920 x 1080 | 103175 | `1373B4E38405468AD7568BA202D46EEDE591608D5F9FA4CF53A9A82566024AD5` |
| `04-reading-progress.png` | 1920 x 1080 | 250981 | `920A38B28B18C6D29C6906461B0B4AAE2AC652FBFC225DC0EDBF666B6F8D15FC` |
| `store-tile-300.png` | 300 x 300 | 3060 | `F61B2F972D66CEF3ECBB6723FBE222ADA2C9234A83B4CEB1A8F90336C95C3ECF` |

Omit trailers, 16:9 Super hero art, game poster art, box art, Xbox art, and Holographic art. The
300 x 300 tile is the only new Store logo. A Super hero image is optional promotional artwork with
different safe-area rules, not a stretched version of the purple app icon.

## Final upload handoff

### 4.3.0 owner gate

In Partner Center, remove the existing About screenshot before submitting 4.3.0. The owner
chooses and separately approves how the approved listing and certification notes are coordinated
with the package; the protected Store updater does not change listing text, images or
certification notes.

### Historical 2.0.2 replacement

The first submitted bundle failed certification and must not be reused. The runtime fix is merged,
and release integration packages those exact corrected bytes at the final replacement version.
Before the owner uploads a replacement:

1. Freeze the final default branch after every intended release pull request has merged.
2. Confirm the application version is `2.0.2` and the Store package version is `2.0.2.0`.
3. Confirm the submission packet commit is based on that exact branch and the tree is clean.
4. Run lint, tests, counts, sizes, anchors, palette, publication, and the Store packet check.
5. Confirm the installed x64 and ARM64 certification journeys and WACK apply to those exact
   package-copied bytes.
6. Run structural inspection and verify identity, publisher, version, Desktop family, minimum OS,
   `en-us`, x64 and ARM64 slices, only `runFullTrust`, executable count, PE machines, and official
   Node hashes.
7. Compute SHA-256 and record the replacement bundle file name, byte length, hash, package input commit, inspection
   time, and WACK run URL in the private transfer handoff.
8. Transfer only the bundle to the owner. Do not transfer a development PFX, password, raw WACK
   report, runtime download, or machine-path log.
9. After upload, require Partner Center validation to show the expected identity, version,
   architectures, language, Desktop family, and capability before saving the package section.

The rejected submission measured SHA-256
`EB5A6655882B261F87255F3A5D438B69A0233E55996B67F48410FE0200A52C1B`. That value identifies evidence
only and must not appear as the replacement candidate. Microsoft re-signs Store MSIX packages after
certification, so a local development signature is not a production-signing claim.

## Live-review stop points

The 2026-09-01 direction authorizes replacing the package and selecting **Submit for
certification** only when all maintained values remain unchanged and every package gate passes.
Stop for live review before any of these:

1. Selecting or changing markets, audience, discoverability, pricing, or publication timing.
2. Entering private regulatory contact details or changing notification recipients.
3. Saving the personal-information declaration or privacy-policy text.
4. Answering each live IARC question and accepting the generated regional ratings.
5. Approving final listing copy, legal terms, screenshots, tile, and URLs.
6. Requesting approval for `runFullTrust`.
7. Saving a package section whose validation result does not match this packet.
8. Changing the existing GitHub ZIP release policy.
9. Selecting **Publish now** after certification.

Do not upload or submit a package that differs from the accepted source, reviewed hash, or maintained
fields. Do not publish without a separate explicit direction. Do not close issues #188, #360, or
#368 from this preparation work.

Issue #188 can close only after the owner sees the final Partner Center listing and confirms that
the title is exactly **Recap Page**, Marvel appears only as accurate descriptive copy, and the
unofficial, no-comics, and own-subscription disclosures are present.

## Future Store updates

Above this heading, the listing's descriptions, feature fields, keywords and release notes, the
personal-information and package-data answers, customer-facing requirements, restricted-capability
explanation, and the certification notes are kept current for the next submission. The screenshot
set needs a separate 4.3.0 review. Everything else above it records the first submission. Its
package version, reviewed hash, manual upload,
certification submission, and manual publishing hold remain the factual first-release procedure.
They do not authorize or describe a later update. The packet as it stood on 2026-09-01, when the
owner authorized the replacement submission, is preserved at commit `8e4a773d`, copy and
screenshots included.

After that first free version is live, an explicit default-branch dispatch may start the separate
Microsoft Store release workflow. Publishing a GitHub or Android release does not start it.
The entire job waits at the protected `microsoft-store-production`
environment before it builds or receives Partner Center credentials. The owner must approve that
environment deployment before any update can be uploaded.

The workflow refuses drafts, prereleases, mismatched tags, a product that is not live and free, an
existing pending submission, and a package version that is not greater than the last published
version. It builds the release tag once, inspects and WACK-tests that exact bundle, verifies its hash
again, creates one draft through Microsoft's submission API, and captures its submission ID. It
uploads the bundle archive, sets immediate publication with gradual rollout off, verifies that exact
draft, and commits the same ID once.

Immediate publication means Microsoft publishes the update automatically after certification. It
does not bypass certification or make workflow completion mean the update is already visible. The
workflow never waits for certification to finish, deletes a draft, retries a Store mutation automatically, or
changes the GitHub ZIP release. Every Store mutation is one HTTP request without an automatic retry
policy. A bounded read-only observation reports status and ingested package verification separately.

If any failure occurs at or after draft upload, do not rerun the workflow. Inspect Partner Center
read-only first. An API-created draft must continue through the API, not portal edits, after a
separate recovery decision. A certification failure requires a corrected,
higher-version release rather than moving or reusing the failed release tag.

## Official sources

Retrieved 2026-08-29 and 2026-08-30:

- [Submission checklist](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/create-app-submission)
- [Pricing and availability](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/price-and-availability)
- [Markets](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/market-selection)
- [Visibility](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/visibility-options)
- [Properties](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/enter-app-properties)
- [Categories](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/categories-and-subcategories)
- [Privacy and support](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/support-info)
- [Product declarations](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/product-declarations)
- [System requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/system-requirements)
- [Age ratings](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/age-ratings)
- [IARC questionnaire availability](https://globalratings.com/faq/)
- [Package upload](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/upload-app-packages)
- [Package requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Store listing fields](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info)
- [Keywords, copyright, license terms, and Developed by](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/add-additional-information)
- [Screenshots and images](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/screenshots-and-images)
- [Submission options](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/manage-submission-options)
- [Restricted capabilities](https://learn.microsoft.com/windows/apps/package-and-deploy/app-capability-declarations)
- [Certification](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/app-certification-process)
- [Microsoft Store Policies 7.19](https://learn.microsoft.com/windows/apps/publish/store-policies)
- [Desktop Bridge WACK tests](https://learn.microsoft.com/windows/uwp/debug-test-perf/windows-desktop-bridge-app-tests)
- [Manage app submissions](https://learn.microsoft.com/windows/uwp/monetize/manage-app-submissions)
- [Create an app submission](https://learn.microsoft.com/windows/uwp/monetize/create-an-app-submission)
- [Update an app submission](https://learn.microsoft.com/windows/uwp/monetize/update-an-app-submission)
- [Commit an app submission](https://learn.microsoft.com/windows/uwp/monetize/commit-an-app-submission)
