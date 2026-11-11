# Contributing

Help improve Recap Page while protecting saved reading progress.
The repository has been public since 2026-08-16 and accepts issues and pull requests.

## Before you write anything

1. Find an [open Issue](https://github.com/raymond-nassar/recap-page/issues?q=is%3Aissue+is%3Aopen+no%3Aassignee+label%3A%22good+first+issue%22%2C%22help+wanted%22)
   labeled **good first issue** or **help wanted**, with nobody assigned.
   Read its scope, acceptance criteria, dependencies and discussion. Search before proposing new work.
2. Comment `/take` by itself. A bot assigns you if the Issue is still open, labeled and unassigned.
   Check **Assignees** before starting. If someone is assigned, coordinate with them instead.
   For other Issues, discuss scope with the maintainer first. You do not need write access.
3. Use your fork and a branch for one change. Link the Issue in your pull request.
   Keep progress, questions and handoffs on that Issue so others can pick up where you stop.
4. Read the [app map](docs/ARCHITECTURE.md), then the reference for the part you will change.
   Use [the running guide](docs/RUNNING.md) for platform setup.

The [planning Project](https://github.com/users/raymond-nassar/projects/1) holds priorities.
You do not need access to it to discuss an Issue. The sole maintainer decides scope and what merges;
see [governance](GOVERNANCE.md). Do not edit the frozen historical backlog.

## Run a checkout

Install Node.js 20 or newer. From the repository root:

```text
npm ci
npm start
```

Open `http://127.0.0.1:8787`. Use that exact address: a different address has different saved data.
There is no build step. The installed packages are development tools, not browser dependencies.
Use a separate browser profile for testing, not your personal reading data.

## What this project is trying to be

Recap Page keeps your place in Marvel reading orders. Reading progress stays on the device.
Optional cloud backup sends saved data only to the reader's own storage account after consent.
There are no Recap Page accounts, hosted backends or analytics.

## What will be declined, and why

Do not add project-run services, store comic image bytes, add browser runtime packages, change the
desktop address, or claim a comic is available from unreliable dates. Keep all five availability
states distinct. Marvel scraping is prohibited except for the narrow owner-approved cover-address
lookup in [data provenance](docs/DATA_PROVENANCE.md). Android emulation is closed.

The [full product constraints](docs/CONTRIBUTOR_REFERENCE.md#what-will-be-declined-and-why)
and [dependency rules](#dependencies) apply to every change. The bundled metadata ending in 2025
is a known limit, with manual entry available, not a bug.

## How a change is judged

Keep one purpose per pull request. Agree on shared-file ownership when work overlaps; leave unrelated
improvements for another Issue. Describe what changed, why, and how you checked it.
Do not overwrite another contributor's work when resolving conflicts.

Use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md). Include the Issue, exact check
results and any missing evidence. Follow [release bookkeeping](GOVERNANCE.md#release-bookkeeping)
for release notes and saved-data compatibility. The maintainer reviews and merges; opening a
pull request does not authorize a release.

## Writing

Use plain American English, short paragraphs and concrete verbs. Explain unfamiliar terms.
Use no em or en dashes. Comments explain why, not what the code already says.
Begin pull requests with the template's **In plain English** summary: why the change matters and
what a reader would notice, without file names or code terms. Keep technical evidence below it.

Code claims need checked file-and-line evidence; external claims need a URL and retrieval date.
Recompute counts you change. Follow the
[citation workflow](docs/MAINTAINING.md#relocate-citations-and-resolve-renumber-only-conflicts)
before accepting moved or retired citations.

## Interface design

Make the main action clear, keep optional detail out of the way, and preserve keyboard focus and
truthful save feedback. Before changing app markup, styles or interaction, read the mandatory
[full interface contract](docs/CONTRIBUTOR_REFERENCE.md#interface-design) and
[UI workflow](.github/instructions/ui.instructions.md).

### Brand

Follow the [brand guidelines](docs/BRAND_GUIDELINES.md) for the retained icon, wordmark and colors.

### Controls and transitions

Use the [control, focus and feedback rules](docs/CONTRIBUTOR_REFERENCE.md#controls-and-transitions).
They cover links versus buttons, dialogs, field errors, pending work and failed saves.

### Layout, tokens and preferences

Use the [layout and preference rules](docs/CONTRIBUTOR_REFERENCE.md#layout-tokens-and-preferences)
for shared design values, themes, small screens and accessible pointer targets.

### Accepted patterns and check owners

Start with the [existing helpers and their checks](docs/CONTRIBUTOR_REFERENCE.md#accepted-patterns-and-check-owners).
Record real browser results and identify any human or device checks still unverified.

## The checks

Run these from the root before handing off a change:

```text
npm test
npm run lint
npm run anchors
npm run counts
npm run sizes
npm run spacing
npm run palette
npm run publication
```

All eight run in CI on every pull request. They check behavior, code, documentation evidence,
counts, sizes, visual rules and publication safety. A failed check needs investigation, not a
weaker rule. New files must be staged before the anchors check can see them.

The live API check (`npm run contract`) stays outside CI; run it before a release.
UI changes also need the relevant installed-browser checks and explicit missing-human-evidence
records in [the full check requirements](docs/CONTRIBUTOR_REFERENCE.md#the-checks).
The [maintainer guide](docs/MAINTAINING.md#run-the-complete-local-check-set) explains each command.

### Historical evidence anchors

Frozen claims use a separate registry that ordinary blessing cannot change.
Follow the mandatory [historical evidence procedure](docs/CONTRIBUTOR_REFERENCE.md#historical-evidence-anchors),
including its review and digest checks. Never rewrite a historical record to make a check pass.

## Tests

Prove a new check fails without the fix, then restore the fix and see it pass.
Use the [failure-before-fix procedure](docs/CONTRIBUTOR_REFERENCE.md#tests).
Test the smallest affected behavior while iterating, then run all required final checks.

## The fault harness destroys data on purpose

The development fault page shares the app's saved data. Before using it, take both a downloaded
backup and the in-browser snapshot. Read the
[fault harness warnings](docs/CONTRIBUTOR_REFERENCE.md#the-fault-harness-destroys-data-on-purpose).

## Adding or correcting data

Record sources and permissions. Keep cover addresses, never image bytes.
Follow [data provenance](docs/DATA_PROVENANCE.md) and
[reading-order authoring](docs/MAINTAINING.md#add-a-curated-reading-order).

## Dependencies

Browser runtime dependencies stay at zero. Development tools need a reason; the Android-only
Google sign-in exception does not apply to the browser. Pin workflow actions to full commits.
Follow the [full dependency policy](docs/CONTRIBUTOR_REFERENCE.md#dependencies) before an update.

## Reporting problems

Report suspected security problems or silent data loss through [the security policy](SECURITY.md),
never a public Issue. Use [support](SUPPORT.md) for other problems.

## Conduct

Follow the [code of conduct](CODE_OF_CONDUCT.md).

## Who decides

The sole maintainer decides. [Governance](GOVERNANCE.md) explains how decisions are recorded.

## On-demand workflow skills

Coding agents can use the [task-specific workflow skills](docs/CONTRIBUTOR_REFERENCE.md#on-demand-workflow-skills).
They do not replace the repository's checks or the maintainer's approval.
