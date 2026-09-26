# Recap Page Android beta: what to try

Thanks for helping test Recap Page on Android. It follows reading lists and keeps your place;
it does not include comics or replace Marvel Unlimited. This is an early sideloaded prototype,
not a Google Play release. You do not need a Marvel subscription to test most of the app.

## Before you start

- Use the APK supplied by the project maintainer, not an APK from an unrelated download site.
  Android 8 or newer and an up-to-date Android System WebView are required.
- Treat this as a test installation. Start with a throwaway reading list and made-up notes.
  Do not rely on it as the only copy of reading progress you care about.
- If you already use this prototype, export a JSON backup before updating. Differently signed
  test builds may require uninstalling the old one, which removes its saved data.
- Android may ask whether this source is allowed to install apps. Only allow the source if you
  trust the supplied file. Do not disable Play Protect or other security protections to install
  it; report any blocked-install message instead.
- Only sign in to your account in the official Marvel app or website. Never send us passwords,
  account details, subscription receipts or your backup file.

## Main checks

Try the checks that fit your phone and available time. Passing everything is not required to
send useful feedback. Stop if you see lost progress or an unexpected destructive action.

| Try this | What should happen |
|---|---|
| **Start and browse.** Open Recap Page, open Navigation, then Browse. Choose a short list such as House of M and add it to your Library. | Text is readable, buttons respond to a normal tap, and the list appears in your Library. No computer needs to be running. |
| **Open a comic.** On the reading screen, tap **Open in Marvel Unlimited**. | You leave Recap Page for an official Marvel destination. Tell us whether the browser or Marvel Unlimited app opened, whether you reached the correct comic or only a landing page, and whether a login was needed. Opening the native Marvel app is not yet guaranteed. |
| **Return and continue.** Return to Recap Page with Android Back or the recent-apps screen. Tap **Done, next** once. | Your reading place is still there. The current issue is marked read and the next unread issue appears. Simply opening Marvel must not mark the comic read automatically. |
| **Make a small edit.** Add a made-up note, mark an issue read and then unread, and try **Defer for later** followed by reviewing deferred issues and resuming one. | Each change is visible and can be found again. Deferring does not falsely count an issue as read. |
| **Close and reopen.** Leave the app, dismiss it from recent apps, then launch it again. | Your test list, note and reading progress remain. |
| **Check phone layouts.** Rotate to landscape and back. In Backup & settings try light and dark themes. Increase Android's text size, then enter a note or a manual issue title with the keyboard open. | Labels remain readable, actions stay tappable, and the keyboard does not hide the field you are editing. You should not need to scroll the whole page sideways. Restore your preferred text size afterwards. |
| **Check Back.** Open Navigation and press Back. Open a note or confirmation dialog and press Back without saving or confirming. | Back closes the open navigation or dialog before leaving that screen. Cancelled edits or destructive actions do not happen. |
| **Go offline briefly.** Turn on airplane mode, reopen Recap Page and open your test list. Restore your connection afterwards. | Saved progress and bundled lists remain usable. Live search, fresh cover art and Marvel reading may be unavailable; the app must not lose your data. |

If Marvel Unlimited is installed, leave Android's normal link settings as they are for the first
attempt. Tell us if you have already changed **Open supported links** for Marvel. Do not force
a different default just to make the test pass. The useful finding is what actually happens.

## Backup check

Do this only with throwaway data. If you have imported real progress, export and safely keep a
separate backup first; skip the restore step if you are unsure.

1. In **Backup & settings**, export a JSON backup to **Downloads** or another on-device folder.
   Wait for the saved confirmation and check that the file exists in your Files app. A cloud
   folder may upload the file through that provider, so choose local storage for this test.
2. Start another export, then cancel the Android file picker. Recap Page should report
   cancellation, not success, and your reading progress should remain unchanged.
3. Change one read marker in your throwaway list, then restore the file from step 1.
   The original saved marker should return. Restoring replaces the app's reading data;
   it does not merge two sets of progress.
4. If **Undo last restore** is offered, try it. It should return to the state immediately before
   the restore, without losing the list.

## Send back a short report

Reply where the maintainer shared this test, or use the project's issue tracker. One problem per
report is easiest to follow. A short report that says everything worked is useful too.

Copy this:

```text
Phone model:
Android version:
Recap Page version (About this app) and APK filename:
Marvel Unlimited installed: yes / no
Where Read opened: browser / Marvel app / nowhere

What I tried:
What I expected:
What actually happened:
Does it happen every time?

Checks that worked:
```

For a layout problem, include your orientation and whether Android text/display size is enlarged.
For a link problem, the comic title and issue number are enough. You can optionally include your
browser and Android System WebView versions if you know them.

A screenshot or short recording of **Recap Page only**, using made-up data, can help. Crop out
notifications, account information and personal notes. Do not include comic pages, Marvel login
screens, passwords or full backup files.

The automated emulator checks already cover several basic flows. Your phone is especially useful
for real Marvel-app handoff, touch comfort, device-specific file pickers and everyday interruptions.
