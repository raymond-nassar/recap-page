# Support

Get help using Recap Page, report a problem, or suggest a change.

## Start with the troubleshooting section

The [troubleshooting guide](docs/RUNNING.md#troubleshooting) covers startup, Node.js, blank pages,
reader links, and missing progress.

If progress looks missing, check the browser, profile, and address first. Each hostname and port
has separate storage. Opening another address or profile does not delete the original data.
[Return to the same address](docs/RUNNING.md#always-use-the-same-address) and browser profile you
used before.

## Asking a question or reporting a problem

Open a repository issue and include:

- What you did, what happened, and what you expected instead.
- Whether any reading progress you had saved was affected.
- The address in the browser bar, copied exactly, port included.
- Your browser and its version.
- Anything red in the browser's developer console.

Repository issues are the only general support channel. There is no mailing list, chat, or forum.
This is a single-maintainer project, so replies may take a while.

## Reporting a reading-list correction

For a missing comic, wrong order, or incorrect comic/link, choose **Report a list problem** on a
completed list, then **Open feedback form**. The optional Microsoft Forms route works on desktop
and Android without reader sign-in, a name or email. It opens outside the app; saved reading data
and your thumb choice are not attached. Reporting does not require choosing **Did not enjoy**.

Enter a public list/guide title or link, or **Custom list**, then the comic series/year/issue and
the correction. Do not include private names, notes, progress, backups, credentials or personal
information. Reports are reviewed privately with manual raw-dashboard cleanup within 30 days;
no personal reply is promised because contact details are not collected. Microsoft processes the
form visit and report; see [list-feedback privacy](PRIVACY.md#optional-reading-list-feedback).
If the form is unavailable, try again later. General support still uses repository issues.

Reading-data loss/corruption or a suspected vulnerability belongs in the
[private security route](SECURITY.md), never this correction form or a public issue.

## Asking a public project question

Use the question form linked from the
[project home](https://raymond-nassar.github.io/recap-page/) to ask how the app works or about a
documented decision. The form asks which project documentation you checked and what remains unclear.

Sign in to GitHub to post. Submitting creates a public Issue: your username, question, and replies
are public, and GitHub hosts that content. Recap Page sends nothing automatically. Do not include
reading progress, lists, notes, backups, personal information, attachments, or vulnerability details.
Use the support route above for help with a problem, or the private security route below.

## A suspected security problem never goes in an issue

Follow the [security policy](SECURITY.md) to report privately, even if you're unsure it is a
vulnerability. Silent loss or corruption of reading progress is a security issue here.
A public disclosure cannot be taken back.

## Things that are somebody else's to fix

**Marvel's services.** Contact Marvel about the reader, `read.marvel.com`, `marvel.com`,
subscriptions, or whether a comic is available. Recap Page links to those services but cannot fix them.

**The metadata database.** Covers, titles, publication dates, and creator credits come from the
community-run Marvel Metadata API; see [Data provenance](docs/DATA_PROVENANCE.md).
Recap Page cannot fix its outages, rate limits, or incorrect source data.

- **If the service is down**, the app keeps working and shows pending details. Try again later.
  From a source checkout, `npm run contract` checks the live API directly. This diagnostic is not
  included in the Windows download.
- **If the database is right but Recap Page is wrong**, report it here.

You can point the app at your own self-hosted metadata mirror in settings.

**Comics published after 2025.** The bundled snapshot ends in 2025, so newer comics start without
bundled details or a cover. Add them by hand, use the optional Marvel Fandom lookup, or paste a
Marvel Unlimited reader link. Missing newer comics are expected; losing or changing details you
supplied is a problem worth reporting.

## Asking for a change

Check [the planning Project](https://github.com/users/raymond-nassar/projects/1) for existing work,
then read [the contributing guide](CONTRIBUTING.md) for the project's constraints before proposing
a change.

## Which version you have

Include the app version and saved-data format shown in **About this app** when reporting a problem.
Major versions mark a new product generation or a saved-data change older builds cannot read.
[The changelog](CHANGELOG.md) explains each release and its compatibility.
