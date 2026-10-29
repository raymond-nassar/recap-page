# Recap Page

**Track Marvel reading orders and progress. Comics are not included.** [Open the project home](https://raymond-nassar.github.io/recap-page/) for a tour and setup.

Follow a Marvel story across series and keep your place with credited reading orders. Mark comics
read yourself, resume at the next unread issue, and keep private notes and custom entries.
No automatic device sync or offline comic reading.

[Android's Read](docs/ANDROID.md) uses an installed browser, not the Marvel Unlimited app.
No computer needed. The
[earlier beta](https://github.com/raymond-nassar/recap-page/releases/tag/android-v3.0.1-beta.2)
doesn't include all the current features. The released app is available on Google Play.
See the [phone previews](https://raymond-nassar.github.io/recap-page/#android)
and [beta guide](docs/ANDROID_BETA.md) before testing.

Marvel Unlimited reading ends December 7, 2026. Until that date, Read uses its web reader when a link
is recorded. From December 7, Read opens the Marvel Comics website, not a single-comic link.
Your saved lists, progress and backups stay unchanged.

## A reading session, from start to resume

An example with made-up progress:

1. On **Home**, open **Modern Timeline** and add **Civil War: Avengers and Aftermath Reading Order** from
   [Comic Book Herald's guide](https://www.comicbookherald.com/where-do-i-start-with-avengers-trade-collections/).
2. With the first six comics marked read, **Civil War (2006) #7** is next.
3. Choose Read. Until December 7, 2026, the Marvel Unlimited web reader opens in a separate tab when
   a link is recorded, with a comic details page as the fallback. From that date, Read opens the
   general Marvel Comics website, not a single-comic link.
4. Return and choose **Done**. **New Avengers (2004) #21** is next.
   Reading isn't detected automatically.
5. Reopen the list in the same browser profile to resume.

An issue marked read stays read across lists. Each list keeps its own order.
The screenshots show a different list, with cover art off.

![Recap Page Home with the Start with Modern Timeline and Search buttons and six reading-list
categories from Modern Timeline to Young readers, with cover art off](docs/screenshots/home-960.png)

![Avengers Disassembled showing the next issue, reading progress, and upcoming comics,
with cover art off](docs/screenshots/avengers-disassembled-reading-960.png)

## Made for long reading journeys

- **Explore Marvel.** Browse events, eras, characters, modern continuity runs, MCU Prep, and stories
  for young readers.
- **See what's next.** Keep the current comic, next issue, part labels, and progress in view.
- **Make your own lists.** Select comics from issue, series, and creator searches, then save them
  to a named Reading List. Mark issues read or unread, write notes, and add custom comics.
- **Remember your favorites.** Rate individual issues from half a star to five stars. Open
  **About this comic**, then **Rate this issue**. The saved score stays compact in the row with
  **Read**.
- **Read at your own pace.** Defer a comic in one list without marking it read. Revisit deferred or
  earlier issues, and reveal descriptions when you're ready.
- **Follow a reading path.** On Modern Timeline, follow one connected story stop by stop, with
  **You are here** and the path's own progress.
- **Keep finished lists.** Mark a list as completed, record whether you enjoyed it, and find it
  again in **Completed lists** without losing notes or comic progress.
- **Find comics.** Filter curated lists by category, or find issues, series, and creators in Search.
- **Check availability.** Unknown, scheduled, and expected stay separate from your own available or
  unavailable checks.
- **Back up your progress.** Restore a backup on this device or another. Android and desktop save
  separately. Reading data and completion history have separate backups; each restore replaces
  only that kind of data.
- **Share an order.** Preview a personal Markdown checklist or export an order without notes,
  reading history, or availability overrides.
- **Choose your browser.** Use Edge, Chrome, Firefox, or Safari, or install Recap Page as a browser app.

### Build a list from search

In **Search**, look up an issue title, series, or creator. A single matching series or creator
opens its comics; when several names match, choose **Browse comics** beside the one you want.
Searching and browsing never add comics to your saved lists.

Select individual comics, or filter the results and use **Select all** to select every loaded
match, including those beyond the first visible rows. Your selection stays with you across the
three searches and while you inspect an issue. Title searches show up to 50 matches; narrow the
search if you need a different comic.

Once you select a comic, a bar at the bottom of the window shows how many are selected and stays
in view as you scroll; on a phone it sits above the navigation bar. Choose **Save selected comics**
there, then give the new list a name and choose **Create Reading List**, or explicitly choose an
existing destination and use **Add to Reading List**. Existing lists keep their order and skip
duplicate comics. If loading stops, you can select from the clearly marked partial results or
search again. **Clear selection**, in the same bar, returns to search without changing saved lists.
A new search replaces earlier save feedback, but keeps your selected comics and destination.
Unfinished selections are not saved across a reload; the browser warns before you leave with one.

### Record a list you have already read

Open the saved Reading List, expand **List actions** (**List options** on Android), and choose
**Mark All Read**, then confirm the unread count in the dialog. This includes
deferred comics and issues hidden by filters, and keeps existing read dates unchanged.
Read progress is shared, so the same comics count as read in other lists too.

**Undo mark all read** reverses the newly added read marks during this session, until your next
saved reading-data change. It does not undo comics that were already read. The action does not
change the list's Completed status, notes, order or deferrals. To correct progress later, use the
individual read checkboxes in **Full Reading List**.

### Finish a reading list without removing it

Choose **Mark as Completed** when you are finished, even if you skipped or deferred comics.
While comics are still queued it waits in **List actions** (**List options** on Android). Once
nothing is queued it moves onto the page, into the wrap-up or under **Nothing queued**.
The list keeps its order, notes, and actual reading progress. It leaves active reading shelves,
but remains available under **Library > Completed lists**. **Reopen list** brings it back.
Older saved lists receive the same completion confirmation and keyboard focus after their
existing saved identity has been made stable.

Thumb icons are optional and stay on your device. On a touch screen or a narrow window each shows
its name beside it; otherwise hover over or focus one for its name.
**Enjoyed** filters your completed collection;
clicking a selected thumb clears that choice. **Did not enjoy** saves only that preference.
**Report a list problem** separately opens instructions for missing comics or a wrong order
without changing your thumb choice. Desktop and Android use the same optional Microsoft Forms
link, with no reader account, name or email required. Your saved data and thumb choice are not
attached. Reports are reviewed privately; private data-loss or security concerns use the separate
policy link. See [list-feedback privacy](PRIVACY.md#optional-reading-list-feedback).

The wrap-up suggests later Reading Path or Modern Timeline stops, and lists with verified shared
writers or later issues in the same series. Suggestions use bundled metadata, not an external
recommendation service. A saved suggestion opens your existing copy; another opens Preview.
When no relationship can be verified, browse for your next list instead.

**Remove from library** is a separate action. It removes your saved copy, including its personal
note and custom order, but keeps shared comic progress and the bundled reading-list definition.
The existing **Undo removal** offer can put that copy back.

Completion dates and enjoyment choices have their own export and restore controls in
**Backup & settings**. Export both backups to carry both kinds of data to another device.
If a pasted import draft is present, also download its separately labeled import-draft backup.
These independent files do not include settings. Each backup keeps its download beside its restore.
Reading-data replacement asks for confirmation and keeps the prior data as a downloadable saved
copy. Undo is offered once in the restoring tab; after Undo or reload, the retained copy uses an
explicit saved-copy action rather than a misleading Undo label.
It contains the original source, unresolved positions and selected matches, not just saved comics.
Resolved comics publish even when other positions remain unresolved. Matching a gap fills its
source position; duplicate occurrences remain in the draft without duplicating list membership.
Saved source has no automatic expiry: resume it after reload or explicitly discard it from Search.
Restoring reading data does not replace completion history; matching saved lists can reveal
their retained history again.

### Your issue ratings

Issue ratings are private, optional and shared wherever that comic appears. Choose a star, adjust
by half a star, then **Save rating**. **Cancel** or Escape leaves the previous score alone;
**Remove rating** clears it. Rating does not mark an issue read, advance your list or change a
Reading List's enjoyment choice. Marking unread keeps the score. There is one editable score,
not a history of first reads and rereads.

Library shows up to six of your **Top-rated comics**, those scored four stars or higher.
**See all ratings** opens **Your ratings**, which lists every comic you have rated, from any list,
and filters by **Minimum rating**, **Title or series** and **Character guide**. A Character
guide match means the comic sits in a reading guide tagged with that character. It is not a promise
that the character appears in that issue. Filters live in the address, so Back and reload keep them,
and browsing never changes your saved data.

Ratings travel in the ordinary reading-data JSON backup. Markdown exports do not include them.
Restoring an older backup replaces reading data with that backup, including no ratings; **Undo
last restore** can recover the previous data. Saved data now uses schema 4. Older builds cannot
read it and enter their protective recovery mode, so keep a backup before changing versions and
use a rating-capable build to restore a backup containing ratings.

## Privacy

### Your data stays with you

There is no account and no analytics or tracking. Saved reading data is not uploaded automatically.
Lists, progress, issue ratings, completion dates, enjoyment, notes, settings, overrides, and custom entries stay
on your device. You can export reading data, but not device settings. Completion history has
its own backup.
See the [privacy policy](PRIVACY.md) for details.

Some features make direct requests:

- Startup checks whether the comics database is reachable.
- Issue searches send the words you type to the comics database and fetch matching details.
- Series and creator name searches use bundled indexes. Browsing a series or creator requests its
  comics from the database. Selecting comics and choosing where to save them stays on your device.
- Cover images load from Marvel's own image servers unless cover art is switched off in **Backup & settings**.
- Before December 7, 2026, **Read** opens the Marvel Unlimited web reader when a direct link is
  known. Otherwise it looks up the missing link or opens the recorded comic details page.
  From the start of December 7 on the device's local clock, it opens the general Marvel Comics
  website without a reader-link lookup. This is not a single-comic link.
- Android's Read uses an installed browser, not the Marvel Unlimited app. Recap Page no longer
  contacts Bifrost to resolve app links. **Open in browser** remains available if a browser does
  not open.
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

1. Export a reading backup from **Backup & settings**, and a completion-history backup if you
   want to keep completion dates and enjoyment choices too. Also export the separate import-draft
   file when one is present.
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
