# Recap Page

**A private reading companion for Marvel Unlimited.** [Open the project home](https://raymond-nassar.github.io/recap-page/) for a tour and setup.

Follow a Marvel story across series, open the next unread comic, and keep your place. Recap Page
runs locally in your desktop browser without an account, with an Android app in development.
No automatic device sync or offline comic reading.

The [Android development build](docs/ANDROID.md) has phone-sized controls, Marvel Unlimited app
links and a browser fallback. No computer needed. The
[earlier beta](https://github.com/raymond-nassar/recap-page/releases/tag/android-v3.0.1-beta.2)
doesn't include all the current features. Not available on Google Play.
See the [phone previews](https://raymond-nassar.github.io/recap-page/#android)
and [beta guide](docs/ANDROID_BETA.md) before testing.

Comics and a Marvel Unlimited subscription aren't included. On desktop, **Read** opens a separate
tab: the official reader if a link is found, or the comic's official issue page on marvel.com.
A link doesn't guarantee access. Recap Page cannot replace Marvel Unlimited or bypass a subscription.

## A reading session, from start to resume

An example with made-up progress:

1. In **Browse**, add **Civil War: An Avengers Reading List** from
   [Comic Book Herald's guide](https://www.comicbookherald.com/where-do-i-start-with-avengers-trade-collections/).
2. With the first six comics marked read, **Civil War (2006) #7** is next.
3. Choose **Read** to open the official reader where a link is available.
4. Return and choose **Done, next**. **New Avengers (2004) #21** is next.
   Reading isn't detected automatically.
5. Reopen the list in the same browser profile to resume.

An issue marked read stays read across lists. Each list keeps its own order.
The screenshots show a different list, with cover art off.

![Recap Page Home with a recommended starting guide and focused discovery choices,
with cover art off](docs/screenshots/home-960.png)

![Avengers Disassembled showing the next issue, reading progress, and upcoming comics,
with cover art off](docs/screenshots/avengers-disassembled-reading-960.png)

## Made for long reading journeys

- **Explore Marvel.** Browse events, eras, characters, modern continuity runs, and MCU Prep.
- **See what's next.** Keep the current comic, next issue, part labels, and progress in view.
- **Make your own lists.** Choose issues, mark them read or unread, write notes, and add custom comics.
- **Read at your own pace.** Defer a comic in one list without marking it read. Revisit deferred or
  earlier issues, and reveal descriptions when you're ready.
- **Follow Reading Paths.** From Home or Browse, see each stop's progress from the matching list,
  another imported version, or **Not added**.
- **Find comics.** Search curated lists in Browse, or issues, series, and creators in Add comics.
- **Check availability.** Unknown, scheduled, and expected stay separate from your own available or
  unavailable checks.
- **Back up your progress.** Restore a backup on this device or another. Android and desktop save
  separately. Restoring replaces the app's saved data.
- **Share an order.** Preview a personal Markdown checklist or export an order without notes,
  reading history, or availability overrides.
- **Choose your browser.** Use Edge, Chrome, Firefox, or Safari, or install Recap Page as a browser app.

## Privacy

### Your data stays with you

There is no account and no analytics or tracking. Saved reading data is not uploaded automatically.
Lists, progress, notes, settings, overrides, and custom entries stay on your device. You can export them to a
destination you choose; see the [privacy policy](PRIVACY.md) for details.

Some features make direct requests:

- Startup checks whether the comics database is reachable.
- Issue searches send the words you type to the comics database and fetch matching details.
- Series and creator name searches use bundled indexes. Adding a series or creator requests every issue.
- Cover images load from Marvel's own image servers unless cover art is switched off in **Backup & settings**.
- **Read** opens Marvel Unlimited if the reader link is known. Otherwise the new tab asks the
  comics database for that link, falling back to the issue page on marvel.com.
- Android also sends the digital issue ID to Marvel's Bifrost service to find an app link.
  It sends no credentials, lists, notes, or read markers, saves no returned app identifier,
  and keeps **Open in browser** available.
- **Look up on Marvel Fandom** sends your hand-entered title to that wiki only when you choose it.
  It does not fetch a cover.

These services can see your network address and the issue or search details needed for the request.
They do not receive your saved lists, progress, or notes.

Recap Page stores cover URLs, not image bytes. It never hosts or proxies comic images.
Your browser may cache images it loads from Marvel.

## Run it on your computer

### Install from Microsoft Store

[Open Recap Page in Microsoft Store](https://apps.microsoft.com/detail/9PDJ7XR9Q40Q), the primary
Windows installation channel. Microsoft Store is the app's only product update channel.
A version still in certification may not be available to install yet.

### Standalone Windows archive

Use the archive for manual installs and testing. The app does not check for, download, or direct
updates from this channel.

1. [Download the latest Windows
   archive](https://github.com/raymond-nassar/recap-page/releases/latest/download/marvel-reading-tracker-windows.zip).
2. Unzip it.
3. Double-click **Start on Windows.cmd**.

### Run from source

Install [Node.js](https://nodejs.org) version 20 or newer, then run:

```text
npm start
```

The app opens at:

<http://127.0.0.1:8787/>

**Always use that exact address and the same browser profile.** Another address, port, or profile
has separate storage. Use a normal browser window, not an editor preview, so **Read** can open
Marvel's reader.

[The running guide](docs/RUNNING.md) covers first-run warnings, browser installation,
restarting, safe ports, and troubleshooting.

## Upgrade without losing progress

Microsoft Store installations receive product updates only through Microsoft Store.

For a standalone archive or source copy:

1. Export a backup from **Backup & settings**.
2. Stop the old copy.
3. Download the latest archive or source.
4. Start the new copy at <http://127.0.0.1:8787/>.

Progress belongs to that browser address and profile, not the folder or package you replace.
Keep using `127.0.0.1:8787` in the same profile. Major versions mark a new product generation or a
saved-data change older builds cannot read. Read the release notes for compatibility details.

## Learn more

- [Running Recap Page](docs/RUNNING.md): detailed setup, upgrades, and troubleshooting
- [Maintaining Recap Page](docs/MAINTAINING.md): checks, data authoring, and release operations
- [Data provenance](docs/DATA_PROVENANCE.md): where reading orders and metadata come from
- [Architecture](docs/ARCHITECTURE.md): modules, storage, data flow, and boundaries
- [Why this is a browser app](docs/WHY_A_BROWSER_APP.md): the tested platform decision
- [Support](SUPPORT.md): where to ask for help
- [Contributing](CONTRIBUTING.md): standards and pull request expectations
- [Security policy](SECURITY.md): supported versions and private reporting
- [Privacy policy](PRIVACY.md): browser storage, direct requests, and Windows package permissions
- [Microsoft Store package status](docs/MICROSOFT_STORE.md): package proof, certification, and publication status
- [Microsoft Store submission packet](docs/MICROSOFT_STORE_SUBMISSION.md): owner-reviewed listing fields, certification notes, and sanitized assets
- [Changelog](CHANGELOG.md): what changed in each release

## Disclaimer

Unofficial fan project. Not affiliated with or endorsed by Marvel Entertainment. Marvel characters,
names, and related marks belong to their respective owners. Cover art and issue metadata are
requested from third-party services and remain subject to their terms. Recap Page contains no comic
pages and does not bypass Marvel Unlimited.

## License

[MIT](LICENSE)
