# Recap Page

**A private reading companion for Marvel Unlimited.**

Recap Page turns long comic events and character runs into clear reading sessions. Pick a curated
reading order, follow it issue by issue, and keep your place without creating an account.
Everything runs locally in your browser.

It does not include comics, bypass a subscription, or replace Marvel Unlimited. When a direct
Marvel Unlimited link is available, **Read** opens the official reader in a new tab. Otherwise the
new tab looks up that link and falls back to the issue's official page on marvel.com when none can
be resolved. You need your own subscription to read included issues.

![Recap Page Home recommending Setup to Modern Timeline and showing Reading Paths among its discovery
choices with cover art off](docs/screenshots/home-1280.png)

![Avengers Disassembled open at the first issue with no progress marked and cover art
off](docs/screenshots/avengers-disassembled-reading-1280.png)

## Made for long reading journeys

- **Start with a story, not a spreadsheet.** Browse curated events, eras, characters, modern
  continuity runs, and MCU Prep companion picks.
- **Always know what comes next.** The current issue, next issue, part labels, and completion
  progress stay visible.
- **Read your way.** Choose an issue, mark anything read or unread, add notes, or track a custom
  issue outside the curated catalog.
- **Move through a whole universe.** Open Reading Paths from Home or Browse, choose a journey, and
  see every stop in order with progress from the matching list, another imported version, or **Not added**.
- **Find anything quickly.** Search curated Reading Lists under Browse, or find issues, series, and
  creators under Add comics.
- **Keep control of availability.** Scheduled, expected, unknown, and both explicit override states
  remain distinct.
- **Protect your progress.** Export a backup whenever you like and restore it on the same or another
  computer.
- **Use the browser you already trust.** Recap Page works in Edge, Chrome, Firefox, and Safari, and
  can be installed as a browser app.

## Privacy

### Your data stays with you

There is no account, no analytics or tracking, and your reading progress is never sent anywhere.
Reading state, notes, settings, overrides, and custom entries stay in your browser storage.

Recap Page makes a small number of direct requests so it can show live information:

- When the app starts, it asks the comics database whether the service is reachable.
- Searching for an issue sends the words you typed to the comics database and downloads matching
  metadata.
- Adding a series or creator asks the comics database for every issue in that run.
- Cover images load from Marvel's own image servers unless cover art is switched off.
- Pressing **Read** opens Marvel Unlimited directly when the reader link is known. Otherwise the new
  tab asks the comics database for that link and falls back to the issue page on marvel.com.
- Those requests reveal which issues you are looking at to the service receiving them.
- The hand-entry title lookup sends the title you typed to the Marvel Fandom wiki only when you press
  **Look up on Marvel Fandom**. It does not fetch a cover.
- The app can ask GitHub for the latest release number once a day. That check is optional.

Recap Page stores cover URLs only. It never hosts, proxies, or writes comic image bytes to storage
it controls. The browser may manage its ordinary web cache when it loads an image from Marvel.

## Run it on your computer

### Download for Windows

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

**Always use that exact address.** A different hostname or port has separate browser storage and
looks like a fresh app. Use a normal browser window rather than an editor preview so the **Read**
button can open Marvel's reader.

[The complete running guide](docs/RUNNING.md) covers first-run warnings, browser installation,
stopping and restarting, safe ports, and troubleshooting.

## Upgrade without losing progress

1. Export a backup from **Backup & settings**.
2. Stop the old copy.
3. Download the latest archive or source.
4. Start the new copy at <http://127.0.0.1:8787/>.

Your progress belongs to that exact browser address, not to the folder you replace. Staying on
`127.0.0.1:8787` in the same browser profile keeps it in place.

The app checks GitHub once a day for a newer version number and never installs updates
automatically. Automatic checks can be switched off. Major versions mark a substantial new
generation of the app and are also required for any saved-data change an older build cannot read.
The release notes state whether progress remains compatible. Export a backup before upgrading.

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
- [Microsoft Store package status](docs/MICROSOFT_STORE.md): local x64 proof and remaining publication gates
- [Changelog](CHANGELOG.md): what changed in each release

## Disclaimer

Unofficial fan project. Not affiliated with or endorsed by Marvel Entertainment. Marvel characters,
names, and related marks belong to their respective owners. Cover art and issue metadata are
requested from third-party services and remain subject to their terms. Recap Page contains no comic
pages and does not bypass Marvel Unlimited.

## License

[MIT](LICENSE)
