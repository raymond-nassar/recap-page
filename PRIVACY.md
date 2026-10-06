# Recap Page privacy policy

Last updated: 2026-10-04

Recap Page keeps your reading progress, lists, completion dates, enjoyment choices, notes,
settings, availability choices, and custom entries on your device. There is no account,
advertising, analytics, behavioral tracking, or telemetry. Saved data is not uploaded or synced
automatically. If you export it, the destination you choose receives that file's contents.

## Data stored on the device

On desktop, reading data stays in browser storage at `http://127.0.0.1:8787`.
Browser-managed IndexedDB and cache storage hold cached metadata and offline app files.

The Windows package does not own this storage. Stopping, updating, uninstalling, or reinstalling it
does not remove browser-owned state. Another hostname, port, browser, or profile has separate
storage. Clearing site data for this address removes that profile's copy.

On Android, data stays in private WebView storage, separate from your desktop browser. The displayed
address is also `http://127.0.0.1:8787`, but it opens bundled app files, not a listening server.
Android does not use the desktop service-worker shell; offline files are bundled in the APK and
cached metadata uses IndexedDB.

Clearing Android app data or uninstalling removes its saved data. Platform backup and device
transfer are disabled. Export a backup and keep it outside the app before clearing data,
uninstalling, or switching to a package that cannot update the installed copy.

Saved reading data has no automatic expiry. Metadata cache keys can include issue-search text.
Cache expiry limits reuse; it does not guarantee immediate deletion.

Completion and enjoyment are stored separately from reading data. Reopening a list keeps its
optional enjoyment choice. Removing a list from the library hides its completion record but
retains it for a matching removal Undo or reading-data restore. A newly created or duplicated
list does not inherit that record.

## Export and import

Export a JSON backup from **Backup & settings**, or export a list in an offered format. Files can
contain progress and notes. Desktop uses a browser download. Android uses a document picker: the
selected file provider supplies an import or receives the export's filename and contents. Both
pickers request a local-only provider; this is not a guarantee against its own sync or retention.

Choose a destination you trust and keep backups outside the app. Backups are not uploaded
automatically, but saving transfers the chosen content to that destination. Manage previously
exported files and any partial documents left by a failed save at the destination.

Reading backups do not contain completion dates or enjoyment choices. **Backup & settings**
offers a separate completion-history backup containing saved list identities, completion dates,
and optional thumbs. Each restore replaces only its own kind of data. A reading-data restore or
its Undo does not replace completion history. Download both files to preserve both kinds of data.
The separately labelled saved-value troubleshooting copy is not a normal history backup.
Reading and history backup controls are adjacent. Settings are not part of this transfer.
A reading restore keeps the exact prior reading-data bytes as a saved copy. A one-shot Undo
is identified only in the tab that performed the restore. Undo, reload or a replaced snapshot
leaves a clearly named saved-copy action instead, never an unlabeled reverse Undo. Replacement
requires confirmation; changes made while that confirmation is open are refused.
The saved copy can also be downloaded exactly, even when this version cannot restore it.

Pasted imports retain exact source text, recognized source positions and selected matches in a
separate local draft, including unresolved and duplicate occurrences. Source can contain arbitrary
personal text. There is no automatic expiry or upload. For a complete transfer, also export the
separately labeled import-draft file when present. Current reading/history formats remain unchanged.
Draft restore changes only that draft; it preserves prior draft sources inside the new bounded file
and requires explicit Resume review. A replacement that exceeds the size limit is refused.
Reading restore and Undo retain source but invalidate automatic application. An uncertain interrupted
operation never blindly replays historical read markers. Failed writes retain visible unsaved source
or guarded recovery; when storage outcome cannot be verified, export retained source before reloading.
That export includes adopted current source alongside failed source candidates. If their combined
file exceeds the draft limit, export is refused explicitly and retained work stays guarded in the
open page; no source is silently omitted to make a file fit.
Browser downloads are requests, not confirmation that a file was saved.

## Direct network requests

These features make direct requests:

- Startup checks whether the configured comics metadata service is reachable.
- Issue searches and imported-title matching send it search text.
- Series and creator name searches use bundled indexes locally. Fetching the issues for a
  selected series or creator sends their IDs to the metadata service.
- Issue detail and reader-link lookups send the issue identity to that service.
- Opening an issue in the Android prototype also sends its digital ID to `bifrost.marvel.com`
  for a Marvel Unlimited app link. The request has no credentials or referrer, bypasses the HTTP
  cache, and is not saved in reading state. Marvel sees the digital ID and network address.
  **Open in browser** remains available.
- Cover images load from Marvel's image host when cover art is enabled. It is on by default and
  can be switched off.
- **Read** opens Marvel Unlimited when a direct reader link is known, or opens the issue page on
  marvel.com when no reader link can be resolved.
- The optional hand-entry lookup sends your title to the Marvel Fandom wiki only after you press
  the lookup button.

Each service can see the request, your network address, and the issue or search details it needs.
Recap Page does not send those services your saved lists, notes, read markers, completion dates,
enjoyment choices, settings, or backups.

Next-reading suggestions use same-origin bundled reading orders, paths, writer credits, and
publication dates. There is no external recommendation service.

This policy does not establish how long recipients keep request data. A `no-store` request controls
HTTP caching, not deletion from their logs or systems.

## Comic images and content

Recap Page stores cover URLs only. It never hosts, proxies, saves to project storage, or uploads
comic image bytes. Your browser may cache covers it displays from Marvel's image host.

Comics are not included. Reading happens on Marvel's service and needs your own subscription.
Recap Page does not bypass Marvel Unlimited.

## Windows package permissions

The Microsoft Store package declares `runFullTrust` to start its local server and open your default
browser through its bundled Node supervisor. It binds only to `127.0.0.1:8787` and requests no
administrator privileges during ordinary use. It adds no account or telemetry.

Packaging and updates do not change where browser data is saved. Recap Page does not contact an
external software update service. Store updates come only through Microsoft Store.

## Control and deletion

In **Backup & settings**, **Erase all local data** clears lists, progress, notes, availability
overrides, and custom entries after verifying the saved empty reading data. Completion and
enjoyment history are removed only after that verification and only while the checked reader
and history values remain unchanged. Failed or unconfirmed history cleanup is reported as
partial cleanup, not successful erasure of all data. Settings and sidebar preferences remain.
Removal of pre-restore and staging copies is attempted afterwards; storage failures can leave copies
behind. The app reports a retained pre-restore copy through its saved reading-data copy controls.
Old removal Undo and temporary reader links are withdrawn when reader erasure is verified,
before later cleanup waits. New reading changes, their Undo, completion history, and restore copies
made during those waits are kept. The final report checks current saved values and explicitly
warns when any required value cannot be read rather than assuming it is absent.

Salvage copies kept after a failed read are not removed. Remove them separately under
**Copies kept after a failed read**; a copy cannot be removed while it protects active unreadable
data. Erase also requests metadata cache cleanup and reports cleanup failures; it does not erase
offline app files. **Clear cached metadata** remains a separate control.

Verified reading erase also removes the captured import draft and its retained source snapshots.
If reading data or the draft changes during confirmation/cleanup, or removal cannot be verified,
the draft is kept or its uncertain outcome is reported. Explicit draft discard removes source
without removing published comics. Start fresh and clearing cached metadata do not discard drafts.
Neither erase nor discard removes exported files.

Use browser controls to clear desktop storage and caches; uninstalling the Windows package leaves
them in place. On Android, clearing app data or uninstalling removes private app storage. These
actions do not remove exported files, provider-held copies, or a recipient's logs. Back up first if you
want to keep your reading data.

## Public project information and questions

The [project home](https://raymond-nassar.github.io/recap-page/) is a GitHub Pages information site,
not the tracker. It has no script, form, analytics, or telemetry and cannot read storage at
`http://127.0.0.1:8787`. GitHub logs visitors' IP addresses for security, as documented in
[What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages),
retrieved 2026-09-02. GitHub's privacy statement covers those requests.

Choosing the home's question link opens a public GitHub form about the project documentation.
Posting requires GitHub sign-in. Your username, question, and replies are public; GitHub hosts and
processes them under its privacy statement.

Recap Page sends nothing to the form automatically. It asks which documentation you checked.
Do not include reading progress, lists, notes, backups, personal information, attachments, or
vulnerability details. Removing the form can stop new questions through that route, but cannot
recall an Issue, reply, notification, or existing copy.

The Android About screen opens **Privacy policy** on GitHub in your browser only when selected.
GitHub receives the page request, not your saved reading data. Its privacy statement applies.

## Optional reading-list feedback

Thumbs record a private enjoyment preference only. Choosing **Did not enjoy** does not open a report;
it does not submit feedback. **Report a list problem** opens those instructions without changing
your rating. On desktop and Android, **Open feedback form** deliberately opens Microsoft Forms
outside Recap Page. No reader account, name or email is required.

Recap Page attaches no saved list name, notes, progress, completion date, rating or backup. The
static link identifies the form only. Reports contain what you manually enter: a public list or
guide reference, the problem category, correction details and an optional platform choice.
Use a public title/link or **Custom list**, never a private saved-list name. Do not include notes,
backups, reading progress, credentials, personal information or vulnerability details.

The maintainer reviews reports privately. Contact details are not collected, so no personal reply
is promised. The maintainer manually removes raw reports from the Forms response dashboard within
30 days; there is no automatic expiry. Useful, sanitized comic/order facts may remain in project
work after the raw report is removed. No public response summary, collaborators, automatic
notification copies, exports or reporting integrations are configured.

Microsoft processes your form visit and submitted report under its
[privacy statement](https://privacy.microsoft.com/privacystatement). Account-free does not mean
network anonymity: anonymous results can retain response identifiers and times. The 30-day
dashboard policy is not an all-copy deletion promise for Microsoft logs, backups or recoverable
data; their lifetimes and complete individual-report purge are not established here.

If the form is unavailable, try again later. Recap Page does not submit on your behalf, claim a
report was received, or silently switch to public GitHub reporting. Reading-data loss or corruption
and suspected vulnerabilities use the separate [private security policy](SECURITY.md), not this
reading-list form.

## Contact and security

Use the repository's [support guide](SUPPORT.md) for ordinary questions. Suspected vulnerabilities
must follow the [security policy](SECURITY.md) and must not be disclosed in a public issue.
