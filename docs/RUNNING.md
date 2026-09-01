# Running Recap Page

Recap Page runs on your own computer and opens in a normal web browser. This guide covers the
download, source setup, first run, safe upgrades, and the problems most likely to look like lost
reading progress.

## Choose how to run it

All three routes open the same app at the same address. You can switch between them without moving or
losing progress.

### Microsoft Store

[Open Recap Page in Microsoft Store](https://apps.microsoft.com/detail/9PDJ7XR9Q40Q). Microsoft Store
is the primary Windows discovery and installation channel and delivers all updates for Store
installations. The listing may not offer installation until its current certification completes.

### Standalone Windows archive

1. [Download the Windows
   archive](https://github.com/raymond-nassar/recap-page/releases/latest/download/marvel-reading-tracker-windows.zip).
2. Unzip it.
3. Double-click **Start on Windows.cmd**.

Everything needed to run the tracker is inside the archive. There is no installer and no account.

### Run from source

Install [Node.js](https://nodejs.org) version 20 or newer. Git is optional: you can either clone the
repository or use GitHub's **Code**, **Download ZIP** option.

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

## The first-run warning

Windows or macOS may ask you to confirm the first run because the files came from the internet.
That warning is expected.

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

Use Edge, Chrome, Firefox, or Safari. Do not use a preview panel inside an editor. Preview panels
often block the reader tab that the **Read** button opens.

On a first run, Home asks where you want to start. You can preview the recommended modern-era setup
guide, browse curated Reading Lists by story or publication age, or open Reading paths from Home or
Browse to choose a complete journey. Each stop shows matching-list progress, another imported version
when needed, or **Not added**. Add comics remains available even when live metadata has to wait.

## Install it as a browser app

Edge and Chrome offer an install icon in the address bar. Safari calls the same feature **Add to
Dock**. Installing gives Recap Page its own window and application icon without changing its
storage.

After a successful first visit, an installed window can open while the server is stopped because
the browser keeps the app shell. Saved lists, progress, and bundled content already cached by the
worker remain available; a Reading List payload never requested before is not guaranteed to be
there. Recap Page now checks its local app connection and explains how to restore it when an
uncached Reading List needs the separate local copy.

Leave the browser-installed window open. Start Recap Page with **Start on Windows.cmd**,
**Start on macOS.command**, or the Microsoft Store installation. Return to the browser app
and choose **Check again** in its notice, or open **Backup & settings**, **Local app connection**,
and choose **Check connection**. Browser security does not allow the installed website to start
that separate local program by itself.

## Stop and restart

In the terminal window running the app, press **Ctrl+C**. This stops the local server, not the
browser storage holding your progress.

To start again, use the same start file or return to the folder and run `npm start`.

## Always use the same address

Your browser stores reading progress under the exact address in its address bar. A different
hostname or port is a different storage bucket and starts empty.

These are not the same storage location:

```text
http://127.0.0.1:8787/
http://localhost:8787/
http://127.0.0.1:8788/
```

Always return to <http://127.0.0.1:8787/>. If the tracker looks empty, check the address and browser
profile before doing anything else. The original progress is normally still under the original
address.

Progress is also separate by browser and browser profile. Opening Recap Page in Firefox does not
show progress saved in Edge, and it does not remove the Edge copy.

## Upgrade safely

Microsoft Store installations receive product updates only through Microsoft Store. Recap Page has
no in-app route to another update channel.

For a standalone archive or source copy, download the replacement manually, stop the old copy, and
start the new one at <http://127.0.0.1:8787/>. Progress carries over because it belongs to that
browser address, not to the folder being replaced.

Major versions mark a substantial new generation of the app and are also required when saved data
changes in a way an older build cannot read. Release notes state whether progress remains
compatible. Export a backup before upgrading.

## Troubleshooting

### Port 8787 is already in use

First open <http://127.0.0.1:8787/>. Recap Page may already be running in another window.

If another program owns the port, you can use a temporary alternative. Remember that the alternative
address has separate browser storage.

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

Install Node.js from [nodejs.org](https://nodejs.org), close the terminal, and open a new one. Confirm
the installation with:

```text
node --version
```

The version should begin with `v20` or a higher number.

### Double-clicking the start file does nothing useful

Read the message in the start window before closing it. If the window disappears, open a terminal in
the project folder and run `npm start` so the error remains visible. On a Mac, use the first-run
steps above.

### The page is blank or nothing loads

Check that the start window is still open and shows the running address. Type the complete address,
including `http://`. A previously installed copy may show its cached shell while live covers and
metadata remain unavailable until the local app connection is restored. If the shell opens, follow
its connection notice or use **Backup & settings**, **Local app connection**. Your lists and reading
progress stay in the browser while the connection is stopped.

### The Read button does nothing

Open Recap Page in a normal browser window rather than an editor preview. If it is already in a
normal browser, allow pop-ups for the local address. Reading comics requires your own Marvel
Unlimited subscription. Recap Page opens the official reader when a direct link is available and
otherwise opens the issue's official page on marvel.com.

### Reading progress has disappeared

Check all three parts of the storage location:

1. The hostname is `127.0.0.1`, not `localhost`.
2. The port is `8787`.
3. You are using the same browser and browser profile as before.

Returning to the original address and profile restores the original view because the progress was
never deleted.

## Getting help

[The support guide](../SUPPORT.md) explains what to include in a report and which problems belong to
Marvel or the metadata service. A suspected security problem must follow
[the security policy](../SECURITY.md) and must not be opened as a public issue.

## Microsoft Store package status

Recap Page is not available from the Microsoft Store yet. The current public Windows download
remains the ZIP described at the start of this guide.

An earlier x64 MSIX proof installed, launched from Start, started the same local server, and opened
the same browser address. The signed install preserved existing browser-profile progress and visible
busy-port guidance through an update from `2.0.0.0` to `2.0.0.1`. The first x64/ARM64 Store
submission then failed certification because its visible launch console could be closed with the
server attached. A cached browser shell remained, but uncached bundled data could no longer load.

The corrected launcher starts the server independently in the background and closes its launch
console after the exact package generation answers a health check. Closing the browser does not stop
that server. Starting Recap Page again reuses the matching server and opens the same address.
Updating or uninstalling the package ends its background process. If browser opening fails, the
launch window keeps the exact address visible so it can be opened manually.

That corrected replacement was submitted and failed certification because the shared app still
offered a GitHub ZIP as an update. The next replacement removes that route globally and adds final
package inspection for Store-only updates. It has not yet been submitted, certified, or published.

Installing or uninstalling the future package does not move or remove browser-owned progress. The
same address and browser profile remain the storage location. See the
[Microsoft Store package guide](MICROSOFT_STORE.md) for the maintainer proof status.
