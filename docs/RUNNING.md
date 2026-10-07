# Running Recap Page

Recap Page runs on your computer in a normal web browser.

## Take a reading list to another app

Open **Export** on Reading and choose **Export personal checklist**, or choose it in
**Backup & settings**, under **Checklist and sharing options**. Review the preview, then choose **Download Markdown**.

The file includes the list title and every comic in saved reading order, with read checkboxes.
Filters do not remove comics from the export, and deferred comics keep their positions.
Clear **Read checkboxes** for ordinary bullets instead.

List descriptions, collected-edition headings, official comic links and personal notes are
optional. **My list and issue notes** is off for each new export; including notes once does not
include them next time. Export uses known details without looking anything up or changing saved
data.

For an unread order with available source credit, choose **Export order only**.
Neither `.md` file is a complete backup. Use **Download JSON backup** to keep a restorable copy
of lists, notes, progress and other saved choices in Recap Page.

## Jump within a long collection

Reading paths have a **Jump to stop** selector. Long publishing-age pages have
**Jump to Reading List**. Choose a named destination, then activate **Jump** to focus
its existing action or title. Keyboard users can type a name or use the native arrow,
Home and End keys, then Tab to Jump and press Enter. The full original order stays visible.

In a reading path, **Next unfinished stop** means the first stop not explicitly marked
completed in its current saved version. Reading every issue does not mark a list completed.
Jump does not open a list, switch saved versions, change progress or save a destination.
Activate the focused action separately to preview or open it.

## Choose how to run it

All three routes use the same app and address. Switching between them does not move or lose progress.

### Microsoft Store

[Open Recap Page in Microsoft Store](https://apps.microsoft.com/detail/9PDJ7XR9Q40Q), the main place
to find and install the Windows app. Store installations receive all updates through Microsoft
Store. Installation may be unavailable until the current certification is complete.

### Standalone Windows archive

1. [Download the Windows
   archive](https://github.com/raymond-nassar/recap-page/releases/latest/download/marvel-reading-tracker-windows.zip).
2. Unzip it.
3. Double-click **Start on Windows.cmd**.

The archive contains everything needed to run the tracker. No installer or account is needed.

### Run from source

Install [Node.js](https://nodejs.org) version 20 or newer. Clone the repository with Git, or choose
**Code**, **Download ZIP** on GitHub without installing Git.

To clone it:

```text
git clone https://github.com/raymond-nassar/recap-page.git
cd recap-page
```

Start it from a terminal:

```text
npm start
```

You can also double-click **Start on Windows.cmd** on Windows or **Start on macOS.command** on a Mac.

## When Read opens the wrong comic

Open the saved comic's **Issue Details**, then **Edit temporary reader link**. Paste its exact
Marvel Unlimited reader address. Review the normalized destination, then choose **Use temporarily**.

Accepted addresses use http or https on `read.marvel.com` with a root `/#/book/` reference of up
to 12 digits. Comic information pages, other hosts and custom ports are not accepted. Page
position and extra query details are discarded. The app cannot verify the comic or subscription
access. Applying the address does not open a reader tab.

Read uses the temporary address across lists sharing that comic in the current tab.
**Use original link** removes it. Another tab does not inherit it.

Temporary links clear when you reload or close the document, replace saved data, or lose the
comic's saved reference. Leaving the document and returning through browser history also clears
them. Ordinary progress saves, including another tab's updates, keep valid links.

An uncertain saved-data outcome withdraws links until the saved references can be trusted again.
A failed replacement known to leave data unchanged keeps them. If the comic changes while you
are editing, cancel and reopen the editor.

Temporary links do not change comic identity, availability checks, progress, notes, original
metadata or backups. There is no permanent link database.

To report a correction, open the optional **Report details**. Review or edit the summary of the
comic, original link and proposed link. Manually copy only what you want to share, then open the
project's GitHub correction form. Opening it sends no report details. Review and submit on
GitHub, which may require sign-in.

Do not include private notes, lists, progress, credentials, local paths or logs. A report may help
maintainers find a permanent fix, but does not correct Marvel data or prove access.

## The first-run warning

Windows or macOS may ask you to confirm the first run because the files came from the internet.

On Windows, choose **More info**, then **Run anyway**. On a Mac, if double-clicking does nothing or
opens the file in a text editor, right-click it, choose **Open**, and confirm. If macOS reports
permission denied, run this once from the project folder:

```text
chmod +x "Start on macOS.command"
```

The Windows archive includes the official Node.js runtime fetched from nodejs.org and checked
against its published checksum when the archive is built.

## Open the app

The start window should print:

```text
Recap Page running at http://127.0.0.1:8787/
Always use this exact address. Other addresses are separate browser storage.
Press Ctrl+C to stop.
```

The browser normally opens automatically. If it does not, open this exact address:

<http://127.0.0.1:8787/>

Use Edge, Chrome, Firefox, or Safari, not an editor's preview panel. Preview panels often block
the reader tab opened by **Read**.

On first run, Home offers Browse and Add, curated Reading Lists by story or publication age,
and complete Reading paths. The optional Setup guide appears on Modern Timeline, not Home.
Open Reading paths from Home or
Browse. Each stop shows matching-list progress, another imported version when needed, or
**Not added**. Add comics stays available even when live metadata has to wait.

## Install it as a browser app

Use the install icon in Edge or Chrome's address bar, or **Add to Dock** in Safari.
Recap Page gets its own window and app icon without changing its storage.

After a successful first visit, the installed window can open its cached app shell with the server
stopped. Saved lists, progress and bundled content already cached by the worker remain available.
A Reading List never requested before may be missing. Recap Page checks its local app connection
and explains how to reconnect when an uncached Reading List needs the separate local copy.

Leave the installed window open. Start Recap Page with **Start on Windows.cmd**,
**Start on macOS.command**, or the Microsoft Store installation. Return to the window and choose
**Check again** in its notice, or **Backup & settings**, **Local app connection**,
**Check connection**. Browser security prevents the installed website from starting that separate
local program itself.

## Stop and restart

Press **Ctrl+C** in the app's terminal window. This stops the local server without removing
progress from browser storage.

To start again, use the same start file or return to the folder and run `npm start`.

## Always use the same address

Your browser saves progress under the exact address in its address bar. A different hostname or
port has separate storage and starts empty.

These are not the same storage location:

```text
http://127.0.0.1:8787/
http://localhost:8787/
http://127.0.0.1:8788/
```

Always use <http://127.0.0.1:8787/>. If the tracker looks empty, check the address and browser
profile first. Progress is normally still at the original address.

Each browser and profile also has separate storage. Opening Recap Page in Firefox does not show
or remove progress saved in Edge.

## Defer a comic without marking it read

Choose **Defer for later** on the next comic or in a row's actions to continue past it without
marking it read. This affects only this Reading List. The comic keeps its position and still
appears in **All** and **Unread**.

**Review deferred** on Home or Reading opens the full list with the **Deferred** filter selected.
Choose **Resume in this list** to return a comic to the queue at its existing position.
Progress counts only read comics; deferred unread comics are counted separately. When only
deferred unread comics remain, you see **Nothing queued**, not the finished-order message.

Read markers are shared across lists. Marking a deferred comic read keeps its deferral choice,
which applies again if you mark it unread. On a read row with a retained choice, **Clear deferral**
removes it without changing read status.

Duplicated lists have independent copies of these choices. Imported lists start without
deferrals. JSON backups preserve deferrals, including choices retained on read comics.

## Undo an issue removal

**Remove from list** removes an issue immediately. **Undo remove** restores its position and
collected edition without undoing later progress, notes or availability choices. Other Reading
Lists are unchanged.

Undo also restores the comic's deferral choice. Later choices for other comics and global read
changes are kept, even if the restored comic is now read.

Only the most recent **successfully** removed issue can be restored this way. The offer has no
countdown. It stays in this tab's memory, not in backups. **Dismiss**, reloading or closing the
tab ends it. A failed removal keeps any earlier valid offer.

Navigation, filters, read progress, issue notes, list renaming and list notes keep the offer.
Changing that list's issue order, membership or edition assignments ends it. So does deleting
or replacing the source list, adopting another tab's saved data, or reloading data during restore.
Undoing a whole-list deletion does not bring back the issue-removal offer.

If recovery leaves saved data uncertain, the offer is withdrawn to avoid restoring into the
wrong list. A refused Undo offers **Try again** only while the original context is valid.

## Upgrade safely

Microsoft Store installations update only through Microsoft Store. Recap Page has no in-app route
to another update channel.

For an archive or source copy, download the replacement manually, stop the old copy, and start
the new one at <http://127.0.0.1:8787/>. Progress belongs to that browser address, not the replaced
folder, so it carries over.

Major versions mark a substantial new generation of the app. They are also required for saved-data
changes older builds cannot read. Check the release notes for progress compatibility, and export
a backup before upgrading.

The 3.0 candidate uses saved-data schema 3 for per-list deferrals, with the same browser address
and storage key. Older backups load without invented deferral choices. Once this build saves
progress, older schema-2 builds refuse ordinary edits to avoid dropping the new choices. Return
to a compatible build to continue. **Start fresh** deliberately discards data; it is not a way
to downgrade without losing progress.

## Troubleshooting

### Port 8787 is already in use

First open <http://127.0.0.1:8787/>. Recap Page may already be running in another window.

If another program owns the port, you can use a temporary alternative with separate browser storage.

Windows PowerShell:

```text
$env:MRT_PORT=8788; npm start
```

Windows Command Prompt:

```text
set MRT_PORT=8788 && npm start
```

macOS or Linux:

```text
MRT_PORT=8788 npm start
```

Then open <http://127.0.0.1:8788/>. Return to port 8787 to see progress stored there.

### npm is not recognized or command not found

Install Node.js from [nodejs.org](https://nodejs.org), then close and reopen the terminal. Check with:

```text
node --version
```

The version should begin with `v20` or a higher number.

### Double-clicking the start file does nothing useful

Read the start window's message before closing it. If it disappears, open a terminal in the project
folder and run `npm start` to keep the error visible. On a Mac, use the first-run steps above.

### The page is blank or nothing loads

Check that the start window is open and shows the running address. Type the full address,
including `http://`. An installed copy may show its cached shell while live covers and metadata
remain unavailable until the local app connection returns. Follow the shell's connection notice,
or open **Backup & settings**, **Local app connection**. Lists and progress stay in the browser
while disconnected.

### The Read button does nothing

Use a normal browser window, not an editor preview, and allow pop-ups for the local address.
Reading comics requires your own Marvel Unlimited subscription. Recap Page opens the official
reader when a direct link is available; otherwise it opens the issue's official page on marvel.com.

### Comic details and reading actions

Reading keeps **Read** and **Done, next** together. **About this comic** opens its details without
marking it read. **More comic actions** contains **Defer for later** and the external issue-page
link. A completed list offers **Browse Reading Lists**; deferred comics retain their separate
review and resume actions.

Comic details put **Read** near the title. Creator information, dates and any saved note remain
in the main view. **Trouble opening this comic?** contains the full Unlimited availability status,
temporary-link editor and optional correction-report tools. A temporary-link warning stays visible near Read even when help
is closed. A reader link still does not establish availability or subscription access.

Add starts with **Search issues** and **Find a series**. **More ways to add** contains creator,
paste and manual-entry choices. Search keeps its alternatives in **Other ways to find comics**,
and an empty result offers **Add an issue by hand** directly.

Under **Backup & settings**, reading-data and completion-history backup controls are grouped
together above exceptional recovery tools. For a complete reading and history transfer, download
both files and the separate import-draft file when a draft or retained draft source is present.
Settings are not included; these formats cannot be substituted for each other.

Reading-data restore and saved-copy replacement ask for confirmation. The previous exact reading
data is retained and downloadable. **Undo last restore** is a one-shot offer in the restoring tab.
After Undo or reload, **Restore saved reading-data copy** names the retained copy without inventing
its direction. The summary describes its scope and warns about intervening edits. A change while
confirmation is open refuses replacement; review the current data before trying again.
Completion history is independent. Its saved-value/retry tools are inside troubleshooting, which
opens when history needs attention. A malformed backup leaves its data unchanged and names the
correct backup file to choose before technical details.
**Checklist and sharing options** contains the optional Markdown exports and their differences.
The metadata-source form is under **Advanced**, inside **Metadata source**. Restore, undo,
recovery copies and error reports are not hidden by these disclosures.

### Checking a recovery download

A desktop download request is not confirmation that a file was saved. Check the browser's
downloads before relying on any exported backup.

When saved data cannot be read, the original stays untouched while saving is paused.
If the browser cannot keep a recovery copy, choose **Download a copy of the unreadable data**,
then **Verify downloaded copy** and select that saved file. The app checks the whole file locally
against the current unreadable data; it does not restore or upload it. Only a matching verified
file, a completed Android file save, or an in-browser recovery copy permits **Start fresh**.
Verification lasts only for this incident in this tab. A wrong, unreadable or cancelled file
does not permit replacement. Keep the verified file outside browser storage.

Reading-data storage and cached metadata use separate storage. **Clear cached metadata** cannot
repair a reading-data quota failure. Download and check a backup before removing unneeded
recovery copies or reading lists. After the same change saves successfully, its earlier
not-saved warning disappears; unrelated warnings remain.

### Choosing when to see story summaries

**Hide story summaries until I reveal them** is on by default. **Fetch synopses** asks permission to
fetch a Reading List's descriptions without revealing them. Use **Show story summary (may contain
spoilers)** on Reading or Issue Details to see one, and **Hide story summary** to close it.
For an unfetched description, Issue Details offers the same **Show story summary** action with
confirmation before loading and revealing it. Neither action is needed to open the official reader.

With hiding on, every issue starts collapsed, including read and untracked issues. Its last
reveal or hide choice follows that exact issue between views in this tab. Changing its read flag
does not change the choice or reveal the next issue.

Reloading or saving the metadata-source setting clears descriptions and choices. Neither is saved
in lists or backups. Revealing does not change progress or notes. Titles, covers and cross-story
references may still contain spoilers.

To show fetched descriptions without Reveal/Hide controls, turn hiding off in
**Backup & settings**, under **Personalization**. Fetching still needs consent. Changing the
setting resets individual choices in both views but keeps fetched text. Turning hiding back on
starts collapsed again.

Only the boolean preference is saved, separately from progress and backups. If saving fails, a
warning says it applies to this tab only.

### Reviewing earlier comics

Choose **Review earlier issues** on Home or Reading to start just before the next unread comic
in the selected list's current order. Move through the earlier portion with **Earlier** and
**Later**, one comic at a time. A completed list starts at its final comic. Empty lists and lists
whose first comic is unread have no earlier candidate; use **Open full Reading List** instead.

The picker does not fetch or reveal descriptions. Open a comic's details for description
controls, then go Back to the picker. With hiding off, Details can show text already fetched.
Return to Reading's **Read next issue** to continue the order. The reader button in Details opens
the comic you are inspecting.

The picker follows current list order, not your previous reading session. If the list or position
changes, an invalid selection is withdrawn, not replaced with another comic. Provider descriptions
may be missing or insufficient to recap the story. The app does not generate replacements, collect
wiki summaries or guarantee an issue-specific spoiler cutoff.

### Reading progress has disappeared

Check all three parts of the storage location:

1. The hostname is `127.0.0.1`, not `localhost`.
2. The port is `8787`.
3. You are using the same browser and browser profile as before.

If you opened a different address or profile, return to the original one. That change does not
delete the progress stored there.

## Export an order without your reading history

Open **Export** on Reading and choose **Export order only**, or choose it in **Backup & settings**
under **Checklist and sharing options**,
to download a local Markdown file for someone else. Before downloading, review the confirmation:
the file includes the list name, ordered issue titles, official links and section labels. Every
checkbox starts unread. Notes, descriptions, read timestamps and availability overrides are
excluded. Saved reading data is unchanged, and Recap Page does not upload the file.

An exact match in the already-loaded catalog supplies available source credits and its source
link. Export does not fetch the catalog. Missing attribution is stated, not invented.
Manual or unresolved comics without a supported link stay as plain checklist rows. Import asks
you to resolve those rows rather than guessing identities. You can export an empty list, but
importing a file with no issues does not create one.

**Export personal checklist** opens a preview with read checkboxes by default and notes available
only when selected. Notes do not re-import from either Markdown format.
On a narrow reading screen, open **List actions**, then **Export**. The same editing and fetch
commands remain available there. **Mark as Completed** and active fetch status/Stop controls stay
outside the disclosure. Widening the screen opens it without moving focus; narrowing it returns
focus to **List actions** before hiding a focused editing command.
**Download JSON backup** preserves all reader data, including notes and progress. Use it to
protect saved data, not to share a reading order.

## Getting help

Use [the support guide](../SUPPORT.md) to report a problem or find help from Marvel or the metadata
service. For a suspected security problem, follow [the security policy](../SECURITY.md).
Do not open a public issue.

## Microsoft Store package status

Recap Page is not available from the Microsoft Store yet. The public Windows download is still
the ZIP.

An earlier x64 MSIX proof installed, launched from Start, started the same local server, and opened
the same browser address. The signed install preserved existing browser-profile progress and visible
busy-port guidance through an update from `2.0.0.0` to `2.0.0.1`. The first x64/ARM64 Store
submission then failed certification because its visible launch console could be closed with the
server attached. A cached browser shell remained, but uncached bundled data could no longer load.

The corrected launcher starts an independent background server. Its launch console closes once
the exact package generation answers a health check. Closing the browser leaves the server running.
Starting Recap Page again reuses the matching server and opens the same address. Updating or
uninstalling the package ends its background process. If the browser fails to open, the launch
window keeps the exact address visible for you to open manually.

That corrected replacement was submitted and failed certification because the shared app still
offered a GitHub ZIP as an update. The next replacement removes that route globally and adds final
package inspection for Store-only updates. It has not yet been submitted, certified, or published.

Installing or uninstalling the future package does not move or remove progress. It stays in the
same browser profile at the same address. See the [Microsoft Store package guide](MICROSOFT_STORE.md)
for the maintainer proof status.
