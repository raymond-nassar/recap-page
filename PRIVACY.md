# Recap Page privacy policy

Last updated: 2026-09-29

Recap Page is a local reading companion. There is no account, advertising, analytics, behavioral
tracking, or telemetry. Reading progress, lists, notes, settings, availability overrides, and
custom entries are stored on your device. There is no automatic upload or cross-device sync of
that saved state. An explicit export gives the chosen file destination the data in that export.

## Data stored on the device

On desktop, Recap Page stores durable reader data in browser storage for the exact origin
`http://127.0.0.1:8787`. It also uses browser-managed IndexedDB and cache storage for disposable
metadata and the offline app shell.

The Windows package does not move this data into package storage. Stopping, updating, uninstalling,
or reinstalling the package does not remove browser-owned state. Another hostname, port, browser, or
browser profile has separate storage. Clearing site data for the exact origin removes that profile's
copy.

On Android, reader data lives in the app's private WebView storage, separate from your desktop
browser even though the displayed origin is also `http://127.0.0.1:8787`. This is an intercepted
address for bundled app assets, not a listening server. Android does not use the desktop
service-worker shell; the offline app files are in the APK. Disposable metadata uses IndexedDB.
Clearing Android app data or uninstalling removes the app's private state. Platform backup and
device transfer of app data are disabled by the package configuration. Export and independently
keep a backup before clearing data, uninstalling, or changing to a package that cannot update
the installed app.

Saved reading state has no automatic expiry. Cached metadata can include issue-search text in
request keys; expiry limits reuse, not guaranteed deletion at that instant.

## Export and import

You can export a JSON backup from **Backup & settings**, or export a list in the formats offered
by the app. Exports can contain reading progress and notes. On desktop the browser creates the
download. On Android, native import and export use a document picker: a selected provider supplies
the import file or receives the export's filename and contents. Both pickers request a local-only
provider; this is not a guarantee against that provider's own sync or retention.

Choose a destination you trust and keep backups outside the app. Recap Page does not automatically
upload backups, but an explicit save transfers the chosen content to that destination. Previously
exported files, and any partial documents a failed save leaves with a provider, must be managed
there separately.

## Direct network requests

Recap Page makes these direct requests when the related feature is used:

- On startup, it asks the configured comics metadata service whether it is reachable.
- Issue searches and imported-title matching send search text to that service.
- Series and creator name searches use bundled indexes locally. Fetching the issues for a
  selected series or creator sends their IDs to the metadata service.
- Issue detail and reader-link lookups send the issue identity to that service.
- In the Android prototype, opening an issue also sends its digital ID to
  `bifrost.marvel.com` to resolve a Marvel Unlimited app link. This request omits credentials
  and referrers, bypasses the HTTP cache, and is not saved in reading state. Marvel can see the
  digital ID and network address. The launcher retains an **Open in browser** alternative.
- Cover images load from Marvel's image host when cover art is enabled. It is on by default and
  can be switched off.
- **Read** opens Marvel Unlimited when a direct reader link is known, or opens the issue page on
  marvel.com when no reader link can be resolved.
- The optional hand-entry lookup sends the title you entered to the Marvel Fandom wiki only after
  you press its lookup button.

The receiving service can observe the request, network address, and issue or search information
needed to answer it. Recap Page does not send your saved lists, notes, read markers, settings, or
backup files to those services.

Recipient retention is not established by this policy. A `no-store` request controls HTTP caching;
it is not a promise of deletion from a recipient's logs or systems.

## Comic images and content

Recap Page stores cover URLs only. It never hosts, proxies, downloads into project storage, or
uploads comic image bytes. The browser may keep an ordinary web cache when it displays a cover from
Marvel's image host.

Recap Page contains no comic pages and does not bypass Marvel Unlimited. Reading requires your own
subscription and happens on Marvel's service.

## Windows package permissions

The Microsoft Store package declares `runFullTrust` so its bundled Node supervisor can start the
local server and open your configured default browser. The package binds only to
`127.0.0.1:8787`. It does not listen on the network, request elevation during ordinary use, add an
account, or add telemetry.

Microsoft Store packaging and update delivery do not change the browser storage boundary described
above. Recap Page does not contact an external software update service. Store package updates are
delivered only through Microsoft Store.

## Control and deletion

In **Backup & settings**, **Erase all local data** clears active reading data, including lists,
progress, notes, availability overrides and custom entries, when the save succeeds. Settings and
sidebar preferences remain. Removal of pre-restore and staging copies is attempted after a
successful erase, but storage failures can leave copies behind. The app reports a retained
pre-restore copy behind **Undo last restore**.

Salvage copies kept after a failed read are not removed by that erase. They have their own removal
controls under **Copies kept after a failed read**; removal is refused while a copy still protects
active unreadable data. Cache cleanup is also requested during erase, but that does not confirm
every cache was cleared. **Clear cached metadata** is a separate control that reports cleanup
failures.

Browser controls can clear the desktop origin's storage and caches. Uninstalling the Windows
package leaves that browser-owned data in place. Android clear-app-data or uninstall removes
private app storage instead. None of these actions recalls previously exported files, deletes
copies retained by a selected document provider, or removes a remote recipient's logs. Export a
backup first if you want to keep your reading data.

## Public project information and questions

The [project home](https://raymond-nassar.github.io/recap-page/) is an information page hosted by
GitHub Pages. It is not the tracker. It contains no script, form, analytics or telemetry and cannot
read the browser storage under `http://127.0.0.1:8787`. GitHub documents that Pages logs a visitor's
IP address for security purposes in [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages),
retrieved 2026-09-02. GitHub's privacy statement applies to GitHub's handling of those requests.

The home can send you, only when you choose its link, to a public GitHub question form framed by
maintained project documents. You need a GitHub account and must sign in. Your username, question,
and every reply are public, and GitHub hosts and processes that content under its privacy statement.

Recap Page sends nothing to the form automatically. The form asks which maintained source you
checked and tells you not to include reading progress, lists, notes, backups, personal information,
attachments or vulnerability details. Removing the form can stop new questions through that route,
but cannot recall an Issue, reply, notification or copy that already exists.

The Android About screen's **Privacy policy** link opens the public policy on GitHub in your
browser only when selected. GitHub receives that page request, not your saved reading data, and
its privacy statement applies to the request.

## Contact and security

Use the repository's [support guide](SUPPORT.md) for ordinary questions. Suspected vulnerabilities
must follow the [security policy](SECURITY.md) and must not be disclosed in a public issue.
