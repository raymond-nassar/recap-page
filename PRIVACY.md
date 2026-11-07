# Recap Page privacy policy

Last updated: 2026-11-07

Recap Page keeps your reading lists, progress, notes and settings on your device. It sends only the
requests described below, plus a backup to your own OneDrive, or on iPhone and iPad to your own iCloud or
OneDrive, if you turn that on. You can delete cloud backups from the app or in OneDrive or iCloud
Drive, and erase the app's data on your device at any time.

## What stays on your device

Recap Page has no account, no ads, no analytics and no telemetry. You can use it without signing in.

The app saves your lists, reading progress, ratings, notes, completion dates, enjoyment choices,
custom entries, settings and any unfinished import on your device. Nothing expires on its own.

The app also keeps a cache of comic details, which can include your search text.
**Erase all local data** and **Clear cached metadata** remove it.

On Windows, this data lives in the storage of the browser that opens the app. Each browser and
browser profile keeps its own copy. On Android, it lives in the app's private storage. Android's
own backup and device transfer are turned off for the app.

On iPhone and iPad, it lives in the app's private web storage. Your device's own iCloud or computer
backups may include it, even if automatic backup in Recap Page is off.

You can export a backup file from **Backup & settings**. Wherever you save it receives its
contents. Restoring a backup replaces your saved data after you confirm.

## Optional OneDrive backup

OneDrive backup is off until you turn it on in **Backup & settings**. You sign in with a personal
Microsoft account in your browser. Connecting alone uploads nothing. Each device asks you
separately before it backs up. On iPhone and iPad, you choose iCloud or OneDrive, and the app backs
up to one of them at a time.

The app can reach only its own folder in your OneDrive. A backup holds your lists, progress, ratings,
notes, completion dates, enjoyment choices, custom entries, preferences, any unfinished import, and
the device label you choose. Each backup also carries a random ID that tells this device's backups
apart, and the time it was made. Leave out of notes and labels anything you would not want backed up.

Recap Page does not encrypt backups itself, so Microsoft can read them. They travel over a secure
connection, and your Microsoft account protects them. The developer never receives a copy. Microsoft's
[privacy statement](https://privacy.microsoft.com/privacystatement) covers what Microsoft receives.

While backup is on and the app is open, it backs up about ten seconds after your changes stop, or
within ten minutes if you keep making changes. It backs up no more than once every five minutes,
except that it also backs up at once when you leave the page. These are attempts, not a guarantee:
a lost connection, a full OneDrive or a closing app can stop one. Check the time of the last
successful backup before you rely on it.

The app aims to keep the two most recent regular backups for each device. To show the backup list,
it downloads the recent backups in your cloud account, including other devices' backups, and checks
that each is complete and readable. The list shows the device, the time and the number of lists.

When OneDrive backup is on, the app also checks other devices' newest backups at launch, after you
return to the app and after sign-in. It may download those backups to compare your saved data. If
progress differs, you choose which copy to use; the app never merges them. While a choice is
waiting, the app checks periodically for a changed or removed backup. Before loading another
device's progress, it keeps a separate copy in OneDrive when this device has data or settings to
preserve or an earlier kept copy, as well as the existing local recovery copy. The app aims to keep
the newest three recorded cloud copies for this device and connection. Copies it cannot check or
remove, and copies from earlier connections, may remain and need deleting in their cloud folders.
**Go back to what was on this device before** offers the most recently kept copy; any other kept
copies are not listed by that control.

The app keeps the backup list's short summaries only while it is open. It also keeps the last
matched and declined content digests, recorded kept-copy references and a pending-check marker on
this device so it can remember your choice, protect those copies and pause uploads during a check.
Those records are not included in a backup.
Only a restore you confirm replaces your saved data.

The app keeps your Microsoft sign-in on your device so backups can continue. It also keeps your
account name or email there to show which account is connected. Neither is part of a backup. On
Windows, all browser profiles for the same Windows user share the sign-in. On Android, it is kept
in the app's protected private storage. On iPhone and iPad, it is kept in the device's keychain for
this app only, and it does not move to other devices.

## Optional iCloud backup

iCloud backup is only in the iPhone and iPad app, and is off until you turn it on in **Backup &
settings**. There is no sign-in in the app: it uses the iCloud account your device is signed in to,
with iCloud Drive turned on. Connecting alone uploads nothing, and the app asks you before it backs
up.

Backups go to the Recap Page folder in your iCloud Drive, which you can see in the Files app. A
backup holds the same things as a OneDrive backup, described above, and regular backups are made
and listed the same way, except that older backups are deleted only after a newer backup has
uploaded. The automatic progress check and offer are not yet available for iCloud. If iCloud has
not yet uploaded the latest backup, the app says so.

Recap Page does not encrypt backups itself, so treat them like your other files in iCloud Drive. The
developer never receives a copy. Apple's [privacy policy](https://www.apple.com/legal/privacy/)
covers what Apple receives.

To notice when your device signs in to a different iCloud account, the app keeps an identifier Apple
provides for the account on your device. The app never learns your Apple Account name or email, and
the identifier is not part of a backup.

## Requests the app makes to other services

Some features use the internet. None of these requests carries your saved lists, notes, ratings,
progress or backups.

- When the app starts, it checks that its comics information service is reachable.
- Searching for issues, and matching titles when you import a list, sends your search text to
  that service.
- After you import a list or add comics, the app fetches missing comic details from that service
  in the background, starting with the comics you will read next. The order of those requests can
  hint at where you are in a list.
- Opening a series, creator or issue asks that service for its details.
- Cover images load from Marvel's image servers. You can turn covers off.
- The optional hand-entry lookup sends your title to the Marvel Fandom wiki, only when you press
  its button.
- Before December 7, 2026, **Read** opens the Marvel Unlimited web reader when a link is known,
  and may look up a missing link first. Otherwise it opens the comic's details page. From
  December 7, 2026, by your device's clock, **Read** opens the Marvel Comics website instead. On
  Android, **Read** opens your browser, not the Marvel Unlimited app.

Each service sees the request and your network address. How long it keeps them is up to that
service.

Comics are not included. Recap Page saves cover links only, never the images, though your browser
may keep copies of covers it shows. Marvel decides who can read on its services.

**Open feedback form** opens a Microsoft Forms page in your browser. The app attaches nothing; a
report holds only what you type, so leave out private list names, notes and personal details. The
maintainer deletes raw reports within 30 days. Useful comic or reading-order corrections from a
report may be kept after that, without personal details. Microsoft's privacy statement covers the
form. The project website, the question form and this policy are GitHub pages, covered by GitHub's
privacy statement. Questions posted there are public.

## Deleting your data

- To stop future backups, turn automatic backup off.
- To delete this device's regular backups and the kept copies recorded for its current connection
  from OneDrive or iCloud, choose **Delete this device's cloud backups** in **Backup & settings**.
  When you disconnect, you can also choose **Also delete this device's cloud backups**. Copies from
  earlier connections may need deleting by hand in their cloud folders. If deletion cannot be
  completed, the app reports what could not be confirmed, removed or recorded.
- You can also delete the files in OneDrive itself. OneDrive keeps deleted files in its recycle
  bin for up to 30 days; empty it to remove them sooner.
- On iPhone and iPad, you can also delete the files in the Recap Page folder of iCloud Drive in the
  Files app. iCloud Drive keeps deleted files in Recently Deleted for up to 30 days; delete them
  there to remove them sooner.
- To end the app's access, remove it from your Microsoft account's app permissions.
- Erasing local data, uninstalling, or disconnecting without deleting does not remove backups
  already in OneDrive or iCloud. Microsoft's own logs and copies are covered by its privacy
  statement, and Apple's by its privacy policy.

**Erase all local data** in **Backup & settings** removes your lists, progress, notes, ratings,
completion history, custom entries and any unfinished import from this device, and turns cloud
backup off for it. Settings remain, and so do any copies kept after a failed read until you remove
them. The app tells you if anything could not be removed.

On Android, clearing the app's data or uninstalling removes everything saved in the app. On Windows,
uninstalling leaves your data in that browser. To remove it, clear the browser's site data for
127.0.0.1:8787.
Export a backup first if you want to keep your reading. Neither removes exported files.

## The Windows package

The Microsoft Store version runs a small helper program on your computer and opens the app in your
default browser. It needs Windows' full trust permission to do that. It accepts no
connections from other computers, asks for no administrator rights, and updates only through
Microsoft Store.

## Contact

Ask questions through the [support guide](SUPPORT.md). Report security problems privately through
the [security policy](SECURITY.md), not in a public issue.
