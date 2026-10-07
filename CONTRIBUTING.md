# Contributing

Help improve Recap Page while protecting the reader's data and keeping the app simple.
The repository has been public since 2026-08-16 and accepts issues and pull requests.

To use the app, start with [the running guide](docs/RUNNING.md).

## What this project is trying to be

A local-first Marvel Unlimited companion that keeps your place in reading orders. There are no
accounts, hosted backends, analytics, or automatic uploads of saved reading data. Desktop uses a local
server and browser storage; Android has separate app storage. Readers can export their own backups.
Silent loss or corruption of saved reading progress is treated as a security issue.

## What will be declined, and why

Check these constraints before starting. Changes that break them will be declined.

- **Reading-data uploads, accounts, or new services.** Saved data stays local unless the reader
  explicitly exports it.
- **Comic artwork in app-controlled storage.** Store cover URLs, never image bytes. Do not host,
  proxy, or cache comic artwork.
- **Scraping Marvel's sites.** Link to them; get details from the third-party metadata service.
- **Packages loaded by the browser.** Runtime dependencies stay at zero. Development and CI tools
  may be added when justified.
- **A different loopback address or port.** Each address has separate browser storage. Changing it
  makes saved progress look missing; the address is not a configurable default.
- **Yes-or-no availability.** Keep unknown, scheduled, expected, explicitly available, and
  explicitly unavailable distinct. Unreliable upstream dates do not justify a claim of access.
- **Emulating the Marvel Unlimited app.** That was measured and closed, and
  [the reasons](docs/WHY_A_BROWSER_APP.md) are hardware findings rather than preferences.

The bundled metadata snapshot ends in 2025. Newer comics start without bundled covers or details.
Readers can add them by hand, request a Marvel Fandom lookup, or paste a Marvel Unlimited reader
link. The snapshot boundary is not a defect.

## Before you write anything

Describe your proposal in an issue first and check the
[planning Project](https://github.com/users/raymond-nassar/projects/1) for existing work and priorities.

Read the README, [architecture guide](docs/ARCHITECTURE.md), and
[maintainer guide](docs/MAINTAINING.md) before changing code. The maintainer guide covers checks,
pinned actions, curated lists, and releases.

Follow [release bookkeeping](GOVERNANCE.md#release-bookkeeping) when preparing a feature PR or
a final version release PR.

## How a change is judged

Three rules do most of the work.

**One thing per pull request, unless the maintainer explicitly combines a delivery.** File unrelated
work as a repository Issue, not another commit on the branch. This keeps changes independently
revertible. The maintainer-approved combined UX delivery on 2026-08-22 is an exception, not a precedent
contributors should infer.

**Claims carry evidence.** Cite the file and line for codebase claims. For external claims, give the
URL and retrieval date. Use evidence you checked, not recollection.

The anchors check fingerprints cited content, not just line numbers. After an edit, re-aim each
affected citation and read every claim-and-line pairing before blessing it. Never bless a mismatch
just to clear a failed check.

**Recompute counts.** Verify counts in the part of a document you change. An old number is not
evidence, and the automated gates do not check every count.

## Writing

Write for the reader's task. Use familiar words, direct verbs, and short paragraphs. Put the action
or outcome before implementation details, and remove repetition rather than useful information.
Keep exact commands, control names, limits, and safety warnings. Avoid commentary about the document
itself when you can simply give the information.

Code comments explain why, with evidence where needed. Do not restate the code.

No em dashes anywhere in anything a reader sees. Commas, colons and full stops instead.

Start each pull request with `## In plain English`. In at most four short paragraphs, explain why
the change matters and what a reader will notice, including when nothing changes for them. Use no
file names, identifiers, commands, or backlog IDs; describe what those things do instead.
Give the reason before the mechanism. Keep the technical sections after this summary.

## Interface design

This is the local UI contract: make the action clear and keep the screen quiet across the app.
Use concise labels and one prominent primary action per task group, not one for the whole page.
Give secondary and repeated row actions less visual weight, and avoid explanatory paragraphs
after controls or repeated information.

Put supplementary guidance in concise tooltips available on both hover and keyboard focus.
Connect nonredundant descriptions to their controls for screen readers. Keep required labels,
meaningful status, errors, save confirmation and safety warnings visible; tooltips do not replace
essential information or system feedback.

Follow Fluent's [button guidance](https://fluent2.microsoft.design/components/web/react/core/button/usage)
and [tooltip guidance](https://fluent2.microsoft.design/components/web/react/core/tooltip/usage),
checked on 2026-10-03. This is an app-wide standard, not a convention limited to Add comics.

### Controls and transitions

- **Destinations and actions.** Use native anchors with meaningful `href` values for
  destinations, including app hash routes. Intercept only plain primary activation; preserve
  middle-click, modifier keys, browser Back and open-in-new-tab behavior. Use buttons for
  commands, submissions and opening dialogs, with an explicit appropriate `type`. A clickable
  container is not a substitute for either.
- **Names.** Include the visible label text in the accessible name. Add context to repeated
  controls, for example `Remove <list name>`, without changing the visible action's meaning.
  Give icon-only buttons a meaningful name; keep decorative local icons out of the name.
- **Dialogs and focus.** Reuse the shared in-page questions rather than browser-native
  `alert`, `confirm` or `prompt`. Name the purpose and the confirmation action. Choose initial
  focus for the task: the field for typing, a safe choice for destructive confirmation, or a
  focusable heading when readers need to inspect structured content first. Keep modal focus
  contained and provide Escape and a visible cancel/close control. Cancel leaves the action
  unapplied. Restore a usable opener, or choose a logical successor when it is gone or the
  task has advanced. Do not leave focus inside a hidden disclosure or stack modal questions.
- **Fields and errors.** Associate a visible label with each visible field. A placeholder is not a
  label. Associate actionable error text with the field while preserving its hint; mark the
  invalid state, reveal any containing disclosure and focus the field needing correction.
  Clear stale invalid state as the reader edits. Explain what to correct, not just "invalid".
- **State and feedback.** Define the affected idle, hover, focus, selected and disabled
  states plus pending, success, error, empty, cancel and failed-save outcomes where relevant.
  Pending work needs visible progress and duplicate-submit protection; restore usable controls
  when it settles. Empty results need a next step. Failure needs an actionable explanation
  and retained input or a safe recovery path. Retire stale feedback when its task changes;
  announce updates through the existing feedback/live-region pattern without relying on colour.
- **Truthful outcomes.** Show saved, added or completed only after the corresponding saved
  state succeeds; distinguish a refused save from success and keep recovery available. A reader
  handoff is not proof of availability or completed reading. Preserve the existing fresh-tab
  user-activation path and keep help conditional when no tab appears. Report observed
  validation or dispatch failures; a null `window.open` result with `noopener` does not prove
  a popup was blocked. Keep the five availability distinctions required above.
  External-reader success needs evidence from that environment.

### Layout, tokens and preferences

- Put optional detail and advanced controls behind the existing native disclosure pattern.
  Use a meaningful `summary`, preserve draft state on expansion/collapse, and keep the task's
  required controls and essential feedback reachable without guessing where they went.
- Reuse the palette, spacing and type tokens and native-field styles in `src/styles.css`.
  Use the existing checker owners for any new paint or geometry; do not bypass a gate or lower
  a threshold to accept it. Selection, disabled and error states need a non-colour cue.
- Check light, dark and system themes, keyboard focus, reduced motion and forced colours for
  affected components. Preserve browser zoom and visible focus indicators. Use the current
  responsive navigation and wrapping patterns so narrow or zoomed views retain labels,
  controls, feedback and focus without clipping or avoidable horizontal page scrolling.
- Preserve the existing larger hit targets. For changed pointer targets, meet the
  [WCAG 2.2 AA minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
  of 24 by 24 CSS pixels or record the specifically applicable exception and its evidence.
  A larger preferred target is not the AA minimum.

### Accepted patterns and check owners

Use these starting points rather than inventing another control/helper system. Select the
owners for the changed contract; extend missing coverage with observable behavior assertions.

| Contract | Local pattern to reuse | Existing check owners |
|---|---|---|
| Destinations and route intent | `formatRoute` and `isPlainNavigation` in `src/js/lib/route.js` | `test/route.test.js`; `semantic-destinations`, `narrow-navigation` |
| Questions, cancellation and focus | `askConfirm`, `askText` and `askNote` in `src/js/ask.js` | `test/ask.test.js`; `responsive-controls` |
| Field validation | `wireFieldValidation` in `src/js/views/shared/field-validation.js` | `test/add-view.test.js`; `responsive-controls` |
| Decorative icons | `uiIcon` in `src/js/lib/uiIcon.js` and the local SVG symbols | `test/portable-icons.test.js` |
| Action hierarchy and disclosures | Native `details`/`summary` and the existing Add view action groups | `test/add-view.test.js`; `copy-density` |
| Theme and reflow | Tokens and native controls in `src/styles.css` | `test/theme.test.js`, `scripts/check-palette.mjs`; `responsive-reflow`, `responsive-controls` |
| Spacing | `--space-*` and classified geometry in `src/styles.css` | `test/spacing.test.js`, `scripts/check-spacing.mjs` |

The browser owner names in this table belong to [scripts/browser-check.mjs](scripts/browser-check.mjs).
They are focused regression checks, not a claim that every screen or accessibility requirement
is covered. Preserve the distinction between these evidence types:

- **Enforced lint, unit and static gates:** `npm run lint` includes built-in `no-alert` for
  production `src` JavaScript; only `src/dev-faults.js` is exempt from that rule for its
  deliberate native fault-harness dialogs. Unit owners, `npm run palette` and `npm run spacing`
  check their declared behavior and source contracts. They do not prove rendered interactions.
- **Real-browser evidence:** exercise applicable owners with installed Edge as described in
  [the checks](#the-checks). Record the surface, state/transition, expected and observed
  result, exact command, checked revision and evidence location. A screenshot alone does not
  prove keyboard operation, dialog focus, cancellation, zoom or a saved-state result.
- **Manual, native and subjective evidence:** for each affected task, check label clarity
  and action hierarchy; for changed semantics or focus, record the relevant native assistive-
  technology observation; for changed handoff, record the external reader/subscription
  outcome. Identify the surface, action/state, expected and observed result and environment.
  Browser emulation and agent simulation are not those observations. If access or a reviewer
  is unavailable, record the missing evidence, reason and rerun condition as unverified.

Record justified exceptions for maintainer disposition with the affected rule, reason and
evidence; do not silently weaken tests or mark human checks complete. Fill all UI entries in
the [pull request template](.github/PULL_REQUEST_TEMPLATE.md). Non-UI changes may state
`Not applicable` with a reason. Instructions and checks reduce risk; neither guarantees that
future changes are free of UX defects.

These requirements use the applicable interaction principles, not React-specific APIs, from
[Fluent 2 dialog](https://fluent2.microsoft.design/components/web/react/core/dialog/usage),
[field](https://fluent2.microsoft.design/components/web/react/core/field/usage),
and [accessibility](https://fluent2.microsoft.design/accessibility). Context-dependent focus and naming also follow
[WAI-ARIA modal dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and
[WCAG label in name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html).
These references and the target-size guidance were retrieved on 2026-10-07.

## The checks

```
npm ci
```

This installs lint tooling only; none of it reaches the browser. With Node.js installed,
`npm start` and `npm test` work in a fresh checkout without installing packages.

```
npm test
npm run lint
npm run anchors
npm run counts
npm run sizes
npm run spacing
npm run palette
npm run publication
```

All eight run in CI on every pull request. They check unit behavior, lint, evidence anchors, backlog
counts, stated file sizes, spacing, colour contrast, and publication safety. The publication check
covers tracked files and Git history.

### Historical evidence anchors

Ordinary citations describe the tree being checked. Frozen claims use the required historical
registry, which binds each existing citation and occurrence key to a full commit id, literal path,
line range, content SHA-256, and normalized claim SHA-256. The checker never fetches, follows renames,
searches for similar text, uses the lock as provenance, or falls back to current content.

Normal blessing cannot change the canonical JSON registry. Prepare a sealed target only after all
source, test, and documentation edits are final:

```text
npm run anchors -- --prepare-history <target-path> --output <absolute-path-outside-worktree>
npm run anchors -- --apply-history <candidate-path> --approved-sha256 <candidate-sha256>
```

Generate the candidate twice from the unchanged tree and require byte-identical files. Read every
claim against its immutable line, record the digest, and apply those exact bytes. Any tracked-file
or occurrence change requires a new candidate. Apply atomically replaces only the registry.
Then inspect and bless ordinary anchors. The final check must show zero drifted, zero new, and zero
removed.

Historical checks require full local Git history. Check and bless both fail on a shallow clone,
missing or noncommit object, nonancestor source, missing or binary path, invalid or blank-edged range,
content or claim mismatch, malformed or duplicate entry, orphan entry, or incomplete sealed target.
Fix the evidence; do not weaken the check.

```
npm run contract
```

Run this by hand before a release. It stays outside CI because a live third-party API outage should
not fail an otherwise valid build.

```
npm run browser
```

This also runs outside CI, using installed Edge. Require zero failed assertions for changes to
routes, rendering, or interaction. Install its driver in a scratch directory outside the repository,
never as a project dependency.

## Tests

Prove each new check fails without the fix. Stash the smallest relevant change, run the check,
restore the fix, and record the result in the pull request. A targeted failure shows which behavior
the test protects; reverting a whole module proves less.

## The fault harness destroys data on purpose

The fault harness at `src/dev-faults.html` deliberately damages saved reading data to exercise
recovery paths. It is served alongside the app and shares its storage.

**Take both backups before using a fault button:** a downloaded file and the in-browser snapshot.
The snapshot supports one-click restore, but the fault that removes all tracker data deletes it too.
After that fault, the downloaded file is the only backup left. Keep it outside browser storage.

Expected damage from a fault button is not a bug. Unexpected damage, or a recovery result that
differs from what the app reports, is serious.

Review recovery code especially carefully. Check what happens when recovery fails, is offered
twice, points to data that no longer exists, or follows another route to the same state.

## Adding or correcting data

For changes under `src/data/`, state the source and permission to use it in the pull request.
Follow [the data provenance record](docs/DATA_PROVENANCE.md), which documents each file and field.

Covers are URLs, never bytes. Link to Marvel's pages; never scrape them. Every reading order needs
a source trail someone else can follow.

For manifest fields and scripts, see
[Add a curated reading order](docs/MAINTAINING.md#add-a-curated-reading-order).

## Dependencies

Runtime dependencies stay at zero. To propose a development tool, explain what it checks and why
automating that check is useful.

Pin workflow actions to full commit revisions, not movable tags. Follow
[Review pinned GitHub Actions](docs/MAINTAINING.md#review-pinned-github-actions) before updating one.

## Reporting problems

A suspected security problem never goes in a public issue. Follow
[the security policy](SECURITY.md), including for silent loss or corruption of reading progress.

For other questions and problems, see [the support guide](SUPPORT.md).

## Conduct

[The code of conduct](CODE_OF_CONDUCT.md) applies throughout the repository.

## Who decides

The sole maintainer makes roadmap, release, and moderation decisions.
[The governance guide](GOVERNANCE.md) explains the process and where decisions are recorded.
