# Recap Page privacy policy

Last updated: 2026-09-02

Recap Page is a local reading companion. There is no account, advertising, analytics, behavioral
tracking, or telemetry. Reading progress, lists, notes, settings, availability overrides, and
custom entries stay in the browser profile where they were created.

## Data stored on the device

Recap Page stores durable reader data in browser storage for the exact origin
`http://127.0.0.1:8787`. It also uses browser-managed IndexedDB and cache storage for disposable
metadata and the offline app shell.

The Windows package does not move this data into package storage. Stopping, updating, uninstalling,
or reinstalling the package does not remove browser-owned state. Another hostname, port, browser, or
browser profile has separate storage. Clearing site data for the exact origin removes that profile's
copy.

You can export a JSON backup from **Backup & settings**. The file is created by your browser and is
not uploaded by Recap Page.

## Direct network requests

Recap Page makes these direct requests when the related feature is used:

- On startup, it asks the configured comics metadata service whether it is reachable.
- Issue, series, and creator searches send the search terms or selected identity to that service.
- Issue detail and reader-link lookups send the issue identity to that service.
- Cover images load from Marvel's image host when cover art is enabled.
- **Read** opens Marvel Unlimited when a direct reader link is known, or opens the issue page on
  marvel.com when no reader link can be resolved.
- The optional hand-entry lookup sends the title you entered to the Marvel Fandom wiki only after
  you press its lookup button.

The receiving service can observe the request, network address, and issue or search information
needed to answer it. Recap Page does not send your saved lists, notes, read markers, settings, or
backup files to those services.

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

You can export a backup, erase active Recap Page data from **Backup & settings**, remove individual
recovery copies, clear site data in the browser, or uninstall the Windows package. Browser controls
govern browser storage and caches. Package removal governs package files. They are separate actions.

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

## Contact and security

Use the repository's [support guide](SUPPORT.md) for ordinary questions. Suspected vulnerabilities
must follow the [security policy](SECURITY.md) and must not be disclosed in a public issue.
