# Recap Page Android beta: what to try

Recap Page follows reading lists and keeps your place. It does not include comics or replace
Marvel Unlimited. This early sideloaded prototype is not a Google Play release.
Most checks do not need a Marvel subscription.

## Before you start

- Use the maintainer's APK, not one from an unrelated download site. You need Android 8 or newer
  and an up-to-date Android System WebView.
- Start with a throwaway reading list and made-up notes. Do not use this test installation as
  your only copy of progress you care about.
- Export a JSON backup before updating an existing prototype. Differently signed test builds
  may require uninstalling the old one, which removes its saved data.
- If Android asks to allow installation from this source, agree only if you trust the supplied
  file. Do not disable Play Protect or other security protections. Report blocked-install messages.
- Sign in only in the official Marvel app or website. Never send us passwords, account details,
  subscription receipts or your backup file.

The planned official app is a separate installation, not an update to this debug beta. That
preparation does not authorize a new package. Once an official build is approved, keep the
prototype and a checked local JSON backup until you have restored and verified progress in the
new app. Restore replaces destination reading data; it does not merge. Reapply device-specific
settings. If transfer is uncertain, do not uninstall or clear either app. See
[the future transfer guidance](ANDROID.md#future-prototype-to-official-transfer).

## Main checks

Choose checks that fit your phone and time. You can send useful feedback without passing them
all. Stop if progress is lost or an unexpected destructive action occurs.

| Try this | What should happen |
|---|---|
| **Start and browse.** Open Recap Page, open Navigation, then Browse. Choose a short list such as House of M and add it to your Library. | Text is readable, buttons respond to a normal tap, and the list appears in your Library. No computer needs to be running. |
| **Open a comic.** On the reading screen, tap **Read**. | The launcher resolves an app link and attempts to open Marvel Unlimited. Record whether the correct comic appears, only the app's home/login screen appears, or an error is shown. The launcher must explain lookup or missing-app failures without marking anything read. |
| **Try browser escape.** Return to Recap Page after an app handoff and tap **Open in browser** in the retained launcher. Also try it while a lookup is still pending. | A browser opens the web reader or issue page, with a browser choice if necessary. A pending lookup must not open Marvel Unlimited later. Cancelling the browser choice or having no browser must leave the launcher usable. |
| **Return and continue.** Return to Recap Page with Android Back or the recent-apps screen. Tap **Done** once. | Your reading place is still there. The current issue is marked read and the next unread issue appears. Simply opening Marvel must not mark the comic read automatically. |
| **Make a small edit.** Add a made-up note, mark an issue read and then unread, and try **Defer for later** followed by reviewing deferred issues and resuming one. | Each change is visible and can be found again. Deferring does not falsely count an issue as read. |
| **Close and reopen.** Leave the app, dismiss it from recent apps, then launch it again. | Your test list, note and reading progress remain. |
| **Check phone layouts.** Rotate to landscape and back. In Backup & settings try light and dark themes. Increase Android's text size, then enter a note or a manual issue title with the keyboard open. | Labels remain readable, actions stay tappable, and the keyboard does not hide the field you are editing. You should not need to scroll the whole page sideways. Restore your preferred text size afterwards. |
| **Check the starting choices.** On Home with an empty test library, try Browse and Add. Then open Modern Timeline. | Home has two direct starting actions and no Setup callout. Modern Timeline still offers the optional Setup guide and its Preview action. |
| **Try List options.** Open a Reading List, tap **List options**, then try Rename, Note and the Export choices. Cancel each editor or confirmation. Reopen the sheet and dismiss it with Back or by tapping outside. | Options appear in a bottom sheet, one action per row. Each editor replaces the sheet rather than stacking over it. Cancellation leaves the list unchanged. |
| **Navigate and filter.** Tap Browse, then Modern Timeline. Use the parent link above the title, and swipe the filter row sideways to reach its other choices. | Touch navigation does not leave a box around the page title. The parent link goes to the named page. The selected filter is underlined and narrows the results; choosing All restores them. Only the filter row scrolls sideways, not the page. |
| **Check Back.** Open Navigation and press Back. Open a note or confirmation dialog and press Back without saving or confirming. | Back closes the open navigation or dialog before leaving that screen. Cancelled edits or destructive actions do not happen. |
| **Go offline briefly.** Turn on airplane mode, reopen Recap Page and open your test list. Restore your connection afterwards. | Saved progress and bundled lists remain usable. Live search, fresh cover art and Marvel reading may be unavailable; the app must not lose your data. |

For the first attempt with Marvel Unlimited installed, leave Android's normal link settings
unchanged. Tell us if you already changed **Open supported links** for Marvel. Do not change a
default to make the test pass; report what happens.

## Backup check

Use throwaway data only. If you imported real progress, export and safely keep a separate backup
first. Skip restore if you are unsure.

1. In **Backup & settings**, export a JSON backup to **Downloads** or another on-device folder.
   Wait for the saved confirmation and check the file exists in your Files app. Choose local storage;
   a cloud folder may upload the file through its provider.
2. Start another export, then cancel the Android file picker. Recap Page should report
   cancellation, not success, without changing progress.
3. Change one read marker in the throwaway list, then restore the file from step 1.
   The saved marker should return. Restore replaces the app's reading data; it does not merge.
4. If offered, try **Undo last restore**. It should return to the state just before restore
   without losing the list.

## Send back a short report

Reply where the maintainer shared the test, or use the project's issue tracker. Report one
problem at a time. If everything worked, say so.

Include:

```text
Phone model:
Android version:
Recap Page product version, platform build and source (About this app), and APK filename:
Marvel Unlimited installed: yes / no
Marvel Unlimited app version:
Where Read opened: browser / Marvel app / nowhere
Open in browser result:

What I tried:
What I expected:
What actually happened:
Does it happen every time?

Checks that worked:
```

For layout problems, include orientation and whether Android text/display size is enlarged.
For link problems, the comic title and issue number are enough. Browser and Android System WebView
versions are optional if you know them.

You can attach a screenshot or short recording of **Recap Page only**, with made-up data.
Crop out notifications, account information and personal notes. Do not include comic pages,
Marvel login screens, passwords or full backup files.

Automated emulator checks cover several basic flows. Use your phone to check real Marvel-app
handoff, touch comfort, device-specific file pickers and everyday interruptions.
