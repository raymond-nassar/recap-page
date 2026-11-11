# How the app is put together

Recap Page is a reading tracker, not a comic reader. It shows reading orders, saves your place
on your device, and opens an external reader when you press Read.

The browser loads ordinary HTML, CSS and JavaScript modules directly. There is no browser
framework, build step or runtime package dependency. Desktop uses a local Node.js server at
`http://127.0.0.1:8787`; the Android and iOS wrappers serve the shared pages inside their apps.

## Find the part you need

| If you are changing... | Start here |
|---|---|
| App startup and coordination between screens | `src/js/app.js`, then `src/js/main.js` |
| A screen or its interactions | `src/js/views/`; shared controls in `src/js/ask.js` and `src/js/views/shared/` |
| Page structure or appearance | `src/index.html` and `src/styles.css` |
| Saved reading data and recovery | `src/js/storage.js`; data transformations in `src/js/lib/model.js` |
| Navigation | `src/js/lib/route.js`; addresses after `#/` select screens |
| Comic details from the metadata service | `src/js/api.js`, `src/js/hydrate.js` and `src/js/cache.js` |
| Reader launch behavior | `src/js/reader.js`, `src/open.html` and `src/open.js` |
| Bundled reading orders and their sources | `src/data/`, `scripts/data/` and `scripts/vendor-orders.mjs` |
| Shared backup rules | `src/js/lib/completeBackup.js`, `completeRestore.js` and `cloudProtocol.js` in that same folder |
| Cloud account access on desktop | `host/`; browser code never receives provider tokens |
| Windows, Android or iOS wrappers | `packaging/windows/`, `packaging/android/` and `packaging/ios/` |
| The public project website, not the tracker | `pages/` and `scripts/build-pages.mjs` |
| Automated checks | `test/`, `scripts/check-*.mjs` and `.github/workflows/` |
| Design studies and maintainer procedures | `docs/archive/mockups/` and `docs/` |

For your first change, follow [Contributing](../CONTRIBUTING.md). The sections below explain the
main boundaries and link to the [detailed architecture reference](ARCHITECTURE_REFERENCE.md).
Those contracts still apply; read the affected section before changing its behavior.
Folder names in this map describe the current tree. [Layout proposals](REPOSITORY_LAYOUT_PROPOSALS.md)
are recommendations only.

## The three entry points

`src/index.html` starts the tracker. `src/open.html` handles an external-reader launch in a new tab.
`src/dev-faults.html` is a development tool that deliberately damages saved data.
See [startup details](ARCHITECTURE_REFERENCE.md#the-three-entry-points).

## The module graph, drawn as ownership

`main.js` connects services and screens. Views handle a screen's controls and temporary state.
Library modules in `src/js/lib/` provide shared rules and transformations.
The [ownership diagram](ARCHITECTURE_REFERENCE.md#the-module-graph-drawn-as-ownership)
shows which part creates and holds each service.

## Routes and generated views

Navigation uses the hash, the part of the address after `#`, so it does not change the app's
storage address. Some catalog screens are generated from shared definitions rather than copied
markup. See [routing contracts](ARCHITECTURE_REFERENCE.md#routes-and-generated-views).

## How reading content reaches the browser

Reviewed reading orders ship as local JSON files. Browsing them does not need the metadata API.
Optional live requests fill in comic details; summaries stay temporary. Cover images load from
external addresses and are never stored by the app.
See [content and reader-launch flow](ARCHITECTURE_REFERENCE.md#how-reading-content-reaches-the-browser).

## Marking one issue read

A screen asks the Store, the object responsible for saving reading progress, to apply a data
change. It saves first, then the screens show the result. A failed save restores the previous
state and reports the failure instead of claiming success.
See [saving, Undo and import contracts](ARCHITECTURE_REFERENCE.md#marking-one-issue-read).

## Where a reader's data lives

Reading data uses `mrt.state.v2` in localStorage. Completion history, preferences, recovery copies,
cached metadata and offline app files have separate owners and lifetimes. Do not treat clearing
a cache as permission to erase progress. Changing the desktop address or browser profile selects
different saved data, not a fresh view of the same data.
See the [complete storage map](ARCHITECTURE_REFERENCE.md#where-a-readers-data-lives).

### One thing the drawing found

Recovery can lose data too. The [salvage-copy case study](ARCHITECTURE_REFERENCE.md#one-thing-the-drawing-found)
explains why repeated recovery and failed recovery need explicit checks.

## Complete backups

A complete backup combines reading data, completion history, portable preferences and a saved
import draft. Restoring it coordinates the separate stores and keeps a recovery journal in case
the app stops part way through. Read the
[restore and interruption contracts](ARCHITECTURE_REFERENCE.md#complete-backups) before changing this path.

## Cloud backup

Cloud backup is optional and requires consent on each device. Shared browser code validates
backups; platform code signs in and accesses the person's own cloud storage. No project-run
storage service is involved. See [backup, consent and provider contracts](ARCHITECTURE_REFERENCE.md#cloud-backup).

## What is intentionally centralized

Keep shared coordination in the controller, screen-local work in views, and ordinary reading
writes in the Store. A Read press must open its new tab before waiting for a metadata lookup.
See [the boundaries to preserve](ARCHITECTURE_REFERENCE.md#what-is-intentionally-centralized).

## Reading Paths are a catalog projection

A Reading Path is an ordered set of bundled reading lists, not another saved-data format.
Modern Timeline shows it using the catalog and existing reading progress.
See [path resolution and navigation](ARCHITECTURE_REFERENCE.md#reading-paths-are-a-catalog-projection).

## Modern Timeline position is a Store projection

The current place is calculated from saved progress, not stored as a separate cursor.
Filtering does not change that progress.
See [position and refresh rules](ARCHITECTURE_REFERENCE.md#modern-timeline-position-is-a-store-projection).

## Completion is independent history, not a reader migration

List completion and enjoyment live in a companion history store. Individual comic ratings live
in the primary reading data. Keep those different identities and backups intact.
See [history, ratings and recommendations](ARCHITECTURE_REFERENCE.md#completion-is-independent-history-not-a-reader-migration).

## Where to read next

Use [the running guide](RUNNING.md) to start the app, [data provenance](DATA_PROVENANCE.md) for
content sources, and [the maintainer guide](MAINTAINING.md) for checks and releases.
[Why a browser app](WHY_A_BROWSER_APP.md) explains the platform choice.
The [historical-documents index](HISTORICAL_DOCUMENTS.md) separates old design records from current rules.

## The Windows package is a launch envelope

Windows packages start the same local server and open an external browser. They check the server
before reusing it and do not hold the browser's saved progress.
See [Windows startup details](ARCHITECTURE_REFERENCE.md#the-windows-package-is-a-launch-envelope)
and [packaging procedures](MICROSOFT_STORE.md).

## The public project home is not an app entry point

GitHub Pages hosts information, not the tracker. Its approved file list excludes app pages and
saved data. See [the website boundary](ARCHITECTURE_REFERENCE.md#the-public-project-home-is-not-an-app-entry-point).

## The iOS app serves the same pages from its own origin

iPhone and iPad use the shared pages in WebKit with app-local storage and a native file handler.
Their storage address is separate from desktop. See
[iOS serving and storage](ARCHITECTURE_REFERENCE.md#the-ios-app-serves-the-same-pages-from-its-own-origin)
and [the iOS guide](IOS.md).

### iCloud Drive backup

Native code coordinates cloud files; shared code checks their contents and confirms uploads.
See [iCloud contracts](ARCHITECTURE_REFERENCE.md#icloud-drive-backup).

### OneDrive on iPhone and iPad

Only a build with release-supplied configuration offers OneDrive. Credentials stay in native
storage. See [OneDrive contracts](ARCHITECTURE_REFERENCE.md#onedrive-on-iphone-and-ipad).

## Small-screen navigation and readable feedback

Phones use the shared screens with responsive navigation, wrapping controls and dialogs that
keep essential actions reachable. See
[small-screen behavior](ARCHITECTURE_REFERENCE.md#small-screen-navigation-and-readable-feedback)
and the mandatory [interface contract](../CONTRIBUTING.md#interface-design).
