# Contributing

This is a reading tracker for one person at a time, built to a particular standard, and the point
of this document is to make that standard something you can read rather than something you have to
infer from a review.

One thing to know before anything else: this repository was published on 2026-08-16, so the code is
visible, issues are open and changes can be sent. What follows describes how contributing works and
is now also how it happens, in the same way the security policy's private reporting route stopped
being a description and was switched on the same day. Nothing here is aspirational about the
standard itself, which is applied to every change already.

If you only want to read comics with the app, you do not need any of this. Start at
[the running guide](docs/RUNNING.md) instead.

## What this project is trying to be

A local-first companion to Marvel Unlimited that keeps your place in long reading orders. It has no
accounts, no hosted backend, no analytics and nothing uploaded anywhere. A small loopback server
serves the static files on your own machine. Your reading progress lives in one key in your own
browser, and there is no copy of it anywhere else, which is the promise the whole design is arranged
around and also the reason a defect in saving or restoring it is treated as the most serious kind of
bug this project can have.

## What will be declined, and why

These are settled. A change that needs one of them broken will be declined however well it is
built, so it is worth checking against the list before you spend an evening on it.

- **Anything that uploads reading progress, adds an account, or introduces a service.** The product
  promise is that nothing leaves the device.
- **Anything that copies, stores, proxies or caches comic artwork.** The app stores the address of
  a cover and never the bytes.
- **Anything that reads Marvel's own sites by scraping them.** The app links out to them and asks a
  third-party metadata database for details.
- **Anything that adds a package the browser would load.** Runtime dependencies are zero. Tooling
  that runs on a maintainer's machine or in CI is welcome and is discussed below.
- **Anything that moves the app off the loopback address it is served on.** Saved progress belongs
  to one exact address, port included, so serving it somewhere else silently shows an empty
  tracker. The address is not a default that can be relaxed.
- **Anything that reduces "can you read this issue yet" to yes or no.** The app deliberately
  distinguishes not knowing, a scheduled date, an expectation, and a reader saying either that they
  checked and it was there or that they checked and it was not. The upstream dates are unreliable
  enough that collapsing those would mean claiming things that are not true.
- **Emulating the Marvel Unlimited app.** That was measured and closed, and
  [the reasons](docs/WHY_A_BROWSER_APP.md) are hardware findings rather than preferences.

The bundled metadata snapshot ends in 2025. A later comic therefore starts with no bundled cover or
details, and the manual entry form is the mitigation: when the reader explicitly asks, it can look
up factual details on Marvel Fandom and can preserve a pasted Marvel Unlimited reader link. The
snapshot boundary itself is not a defect to fix.

## Before you write anything

Say what you are planning first, in an issue. Not because permission is needed, but because the
[planning Project](https://github.com/users/raymond-nassar/projects/1) weighs active work against
everything else waiting rather than judging it on the day it arrives. Some items have been waiting
a while on purpose.

Then read, in this order: what the app is trying to do, in the first half of the README; how it is
put together, in [the architecture record](docs/ARCHITECTURE.md); and the
[maintainer guide](docs/MAINTAINING.md), which covers running the checks, reviewing a pinned action,
adding a curated reading list and cutting a release.

## How a change is judged

Three rules do most of the work.

**One thing per pull request, unless the maintainer explicitly combines a delivery.** If you find
something else worth doing while you are in there, it ordinarily becomes an entry in the backlog
rather than another commit on the branch. This is not tidiness: a pull request that does two things
cannot be reverted for one of them. The combined UX delivery on 2026-08-22 is the recorded exception,
made by the maintainer after reviewing the work in progress rather than inferred by a contributor.

**Claims carry evidence.** A statement about this codebase carries the file and the line it is true
at, written the way the existing documents write them. A statement about anything outside carries a
link and the date you retrieved it. Recollection is not evidence, and neither is a number that was
correct when someone wrote it down.

Those references are checked automatically, by the content of the lines rather than by the numbers,
so editing code moves them and the check goes red. That is the check working. Re-aim each one at
whatever now says what the claim says, and read every pairing the tool prints before accepting it.
Accepting them wholesale to clear a red build locks the wrong lines in permanently, which is the
exact failure the check exists to end.

**Numbers are re-derived, not carried forward.** Counts of anything, in any document you touch, are
recomputed rather than copied from the previous version. Two of them were wrong here for a while
and every automated check passed the whole time.

## Writing

Comments explain why, with evidence, rather than restating what the line does. "Measured in Edge on
a first run with storage cleared, speaking surfaces went from 9 to 3" is the register.

No em dashes anywhere in anything a reader sees. Commas, colons and full stops instead.

A pull request opens with a plain English summary, before any section written for someone who
already knows the codebase. Name no file and no identifier in it: say what the thing does instead.
Say what a person using the app would notice, and say so plainly when the answer is nothing, which
it often is. Give the reason before the mechanism. Four short paragraphs at most. It goes first
because the technical sections were making it harder to tell whether a change was right, not
easier. The template that appears when you open a pull request puts it first for the same reason,
and its other sections are the rest of this document in the order a reviewer reads them.

## The checks

```
npm ci
```

Installs the linting tools, and nothing it installs reaches the browser. You need it for the
linter only. The app has no parts to install, so `npm start` and `npm test` both work in a fresh
copy with nothing installed.

```
npm test
npm run lint
npm run anchors
npm run counts
npm run sizes
npm run palette
npm run publication
```

All seven run in CI on every pull request. `npm test` runs the unit tests. `npm run lint` runs
ESLint. `npm run anchors` checks that every file-and-line citation still names lines saying what
the citation claims. `npm run counts` recomputes the figures the backlog states about its own
ranked table, and `npm run sizes` recounts any file a sentence states the length of. `npm run
palette` checks colour contrast. `npm run publication` checks that nothing in the history or the
tracked files would be a problem if this repository were made public.

### Historical evidence anchors

Ordinary citations still describe the tree being checked. A small set of frozen claims instead uses
the required historical registry. Each registry entry keeps the existing citation and occurrence key
but binds it to one full commit id, literal repository path, line range, exact content SHA-256, and
normalized claim SHA-256. The checker never fetches, follows a rename, searches for similar text,
trusts the generated lock as provenance, or falls back to current content. Missing, malformed,
unavailable, duplicate, stale, or partial history stops both check and bless.

The registry is canonical JSON and normal blessing cannot change it. Prepare a new sealed target only
after every source, test, and documentation edit is final:

```text
npm run anchors -- --prepare-history <target-path> --output <absolute-path-outside-worktree>
npm run anchors -- --apply-history <candidate-path> --approved-sha256 <candidate-sha256>
```

Generate the candidate twice on the unchanged tree and require byte-identical files. Read every
printed claim against its immutable line, record the candidate digest, then apply exactly those
bytes. Any tracked-file or occurrence change invalidates approval and requires a new candidate.
Apply atomically replaces only the historical registry. Run the ordinary anchor inspection and
bless cycle afterwards; a clean final check still means zero drifted, zero new, and zero removed.

Historical checks require full local Git history. A shallow clone, missing object, noncommit object,
nonancestor source, missing or binary path, invalid range, blank range edge, content mismatch, claim
mismatch, orphan entry, or incomplete sealed target is a broken evidence state, not a reason to
weaken the check.

```
npm run contract
```

Deliberately outside CI, because it calls a live third-party API and would fail builds for reasons
that have nothing to do with the change under test. Run it by hand before trusting a release.

```
npm run browser
```

Also outside CI. It drives the installed Edge browser through the application and must finish with
zero failed assertions before a change that touches routes, rendering or interaction is trusted.
Its browser driver is deliberately installed in a scratch directory outside this repository, so a
missing driver is a prerequisite failure rather than a reason to add a dependency here.

## Tests

A new check has to be seen to fail before it is worth anything. Stash your fix, watch the check go
red, restore it, and say in the pull request that you did. One check written here passed on the
broken tree for a reason nobody would have guessed, and it looked green and proved nothing.

Prefer the smallest revert that turns it red. Reverting a whole module tells you the suite notices
the change; removing one line tells you which line each test defends, and that second answer is the
one worth writing down.

## The fault harness destroys data on purpose

The app ships a page at `src/dev-faults.html` whose buttons deliberately damage saved reading data,
so that the recovery paths can be exercised against real damage rather than against a mock. It is
served alongside the app and shares its storage, which is what makes it useful and also what makes
it dangerous.

**Take both backups before you open it.** The page offers two and they are not alternatives: a
downloaded file, which survives anything that happens to the browser, and a snapshot inside the
browser, which is what the page's own one-click restore uses. The snapshot lives in the same storage
the faults damage, and the button that removes all tracker data removes it too, along with every
other key the app owns. After that one the downloaded file is the only copy left, which is why the
page calls it the copy that cannot fail.

Reporting that this page destroys data is reporting what it is for. Reporting that it destroyed
data it should not have, or that a recovery path did not put things back the way it said it did, is
a real and serious bug.

Recovery code deserves the hardest review in the repository, and this is measured rather than
assumed: twice now, across two separate review passes, the most dangerous code in a change was the
code added to prevent data loss. It runs only when something has already gone wrong, so it is the
least exercised path in the app. When you review it, ask what happens when the recovery itself
fails, when it is offered twice, when the thing it points at no longer exists, and when the reader
reaches the same state by a different route in between.

## Adding or correcting data

Everything under `src/data/` is either generated by a script or pinned by hand, and
[the data provenance record](docs/DATA_PROVENANCE.md) sets out file by file where each field came
from and under what terms. A change there needs the same, in the pull request: where it came from,
and what allows it to be here.

Covers are addresses, never bytes. Marvel's own pages are linked, never scraped. An order authored
for this project carries a source trail that someone else could follow.

The mechanics of adding a curated list, including the manifest fields and the scripts that build
one, are in [Add a curated reading order](docs/MAINTAINING.md#add-a-curated-reading-order).

## Dependencies

Runtime dependencies stay at zero and that is not negotiable. Development tooling is a different
question and the answer is usually yes, if it earns its place: name it in the pull request with
what it does and why the thing it checks is worth checking automatically.

Anything the workflow calls is pinned to a full commit revision rather than a tag, because a tag is
a pointer its owner can move and calling one means agreeing in advance to run whatever they publish
next. [Review pinned GitHub Actions](docs/MAINTAINING.md#review-pinned-github-actions) explains what
to check before merging one of those.

## Reporting problems

A suspected security problem never goes in a public issue. [The security policy](SECURITY.md)
explains how to report one and what counts as one here, and the short version is that anything
which silently loses or corrupts saved reading progress is treated as a security issue.

Everything else, including where to ask a question and what is out of scope, is in
[the support guide](SUPPORT.md).

## Conduct

[The code of conduct](CODE_OF_CONDUCT.md) applies to everything in this repository. It is short and
worth the two minutes.

## Who decides

[The governance record](GOVERNANCE.md) says how roadmap, release, moderation and maintainer
decisions are made, and by whom. The honest summary is that there is one maintainer, and the value
of writing it down is that the reasoning is inspectable even when the decision is one person's.
