# Maintaining Recap Page

This guide owns the operational procedures for checking, extending, and releasing Recap Page.
[The contribution guide](../CONTRIBUTING.md) owns contribution policy and coding standards.
[The architecture guide](ARCHITECTURE.md) explains how the application is assembled.

The project has no browser build step and no runtime dependencies. `npm ci` installs development
tools only.

## Run the complete local check set

Start with a clean dependency install:

```text
npm ci
```

Run the same seven deterministic checks used by CI:

```text
npm run lint
npm test
npm run counts
npm run sizes
npm run anchors
npm run palette
npm run publication
```

All seven run in CI. The checks cover lint and tests, documentation counts, stated file sizes,
evidence anchors, contrast regressions, and publication content. The browser journeys below are
manual release checks because they require installed Edge and a driver outside the repository.

### Run the test suite directly

The test script is deliberately the bare Node test command:

```text
npm test
```

Do not replace it with a quoted glob. Node 20 treats that glob as a literal filename.

### Run the live API contract check

The contract check calls the live third-party metadata API, so it is intentionally outside CI:

```text
npm run contract
```

It confirms that the response fields the app consumes are still present. A network outage, rate
limit, or temporary API problem can fail it even when the repository is correct. Run it manually
before trusting a release.

To override the representative order or issue:

```text
MRT_CONTRACT_ORDER_ID=<order-id> MRT_CONTRACT_ISSUE_ID=<issue-id> npm run contract
```

On Windows PowerShell, use:

```text
$env:MRT_CONTRACT_ORDER_ID='<order-id>'; $env:MRT_CONTRACT_ISSUE_ID='<issue-id>'; npm run contract
```

## Run the browser check

Browser coverage uses `puppeteer-core` from a scratch installation outside this repository. It must
not become a dependency in `package.json`.

Install it once in a temporary directory. `MRT_PUPPETEER` may point to that directory, its
`node_modules/puppeteer-core` package, or the absolute entry-file path. Then run:

Windows PowerShell:

```text
$env:MRT_PUPPETEER='C:\path\to\scratch-directory'
npm run browser
```

Windows Command Prompt:

```text
set MRT_PUPPETEER=C:\path\to\scratch-directory
npm run browser
```

macOS or Linux:

```text
export MRT_PUPPETEER=/absolute/path/to/scratch-directory
npm run browser
```

The runner launches installed Edge by default and can use an explicit executable:

```text
MRT_EDGE=/absolute/path/to/browser npm run browser
```

The check normally serves the app on an ephemeral port, uses an isolated profile, stubs the catalog
network before the page loads, and exits nonzero on a failed journey. The temporary port keeps the
reading progress at the standard app address untouched. The targeted `cache-generations`,
`catalog-gaps`, and `reading-paths` journeys are the exceptions because their contracts require
`http://127.0.0.1:8787/`; they use that origin only inside Edge's temporary automation profile.
Stop the normal app server before any targeted run so the runner can bind that port. Each journey
prints its own assertion and timing totals.

### Prove the browser check detects failures

The proof runner introduces a reversible fault for one journey at a time:

```text
npm run browser:prove -- --only=<scenario-name>
```

Plan a bounded proof matrix before running it. Default to no more than three mutations, each aimed
only at the scenario that should detect that changed behavior.

Each run expects that journey to fail for the intended reason, restores the original source, and
runs the same journey again to prove it passes.
Never run the all-mutations, all-scenarios matrix
without explicit owner approval; calculate its command
cardinality first.

## Run the upgrade check

The upgrade runner reconstructs the v1.4.0 app from local Git history, runs that historical build,
and then replaces its folder with the current candidate at the same browser address:

```text
npm run upgrade
```

The historical server and complete source tree come directly from the local v1.4.0 tag, byte for
byte and without a network request. A missing tag or unreadable Git object fails as a prerequisite
instead of falling back to current source. The old build imports an order and marks one issue read;
the current build must preserve the order, issue sequence, read marker, and visible nonzero progress.
Run it only after the candidate version has been bumped: if both builds report 1.4.0, the runner
stops before opening Edge because it cannot prove that the folder swap loaded the candidate.

### Prove the upgrade check detects failures

The proof runner mutates one disposable copy at a time:

```text
npm run upgrade:prove
```

It expects each aimed assertion to fail, removes the disposable mutation, and then requires the
normal runner to pass. The upgrade proof has no single-scenario selector.

## Review pinned GitHub Actions

The workflow pins each third-party action to a full commit SHA. It runs deterministic repository
checks only; the Windows release archive and its checksum are built and reviewed during release
preparation rather than uploaded from CI. Before changing a pin:

1. Open the action repository's release page.
2. Confirm the release tag and immutable commit SHA.
3. Read the release notes and diff for the versions being crossed.
4. Change only the relevant `uses:` line.
5. Review the workflow diff.

```text
git diff -- .github/workflows/ci.yml
```

6. Run the complete local check set and confirm the pull request workflow passes.

Do not replace a full SHA with a floating tag such as `@v4`.

## Add a curated reading order

Curated orders are data, not application code. Append one entry to
`src/data/curated-lists.json`, then run:

```text
npm run vendor
```

To vendor an order means fetching it once and committing the result. The app reads that reviewed
file instead of calling the metadata API while someone is using it. The vendor run fills issue
details, writes the order under `src/data`, and rebuilds `src/data/catalog.json`.

An order comes from exactly one place: `sourceUrl` fetches an upstream HTTPS checklist, while
`sourceFile` reads a checklist committed under `src/data/orders`. Keep the `id` stable and unique.
Provide the reader-facing name and description, the order type and depth, discovery tags, source
credit, source license, and an expected issue count when one is known. Story groups and variants are
optional.

Every `character-run` also requires `spotlightKind`. Use `best-of` only for a deliberately selected
set of recommended stories, `complete-guide` only for a guide that follows its declared character or
group scope completely, and `other` when neither claim is accurate. The value is editorial: never
derive it from the number of issues, reading depth, title, description, or source address. Every
reading in one story group must use the same value. `other` keeps the card under All without adding a
visible fourth filter.

Rebuild only the order being added:

```text
npm run vendor -- --only=<id>
```

Re-vendoring every order costs hundreds of API requests and restamps files whose content did not
change. A malformed or unresolved entry fails rather than shipping a quietly shorter order.

One local source can be a partition parent. Give it a `partitionFile`, set `catalog` to `false`, and
keep the checked ledger under `scripts/data`. The vendor validates source-position coverage, the
pinned parent issue vector, child metadata, derived years, path order and overlaps before writing
anything. It then keeps the parent payload for provenance and existing saved lists while emitting
ordinary child payloads and catalog entries. Catalog-only regeneration is offline and still rebuilds
the children, generated path and overlap matrix. Its catalog and overlap timestamps reuse the newest
pinned payload timestamp, so unchanged inputs produce byte-identical output on a second run:

```text
npm run vendor -- --catalog-only
npm run vendor -- --only=<parent-or-generated-child-id>
```

A generated child ID resolves to its partition parent so the whole family remains coherent. Review
all generated files as one batch. Do not hand-edit a child payload or the overlap matrix.

### Preserve source evidence

Every manually curated order must have enough evidence for another maintainer to reproduce it.
[The data provenance guide](DATA_PROVENANCE.md) defines the required source packet and normalization
rules.

At minimum, record:

* The source URL and retrieval date.
* The source order as published.
* Every merge, split, replacement, or omission.
* The final resolved issue IDs.
* Independent verification for every non-mechanical correction.

Never scrape `marvel.com` or `read.marvel.com`. Do not commit comic images.

## Build a Comic Book Herald packet

For a modern continuity or character spotlight order, preserve five evidence layers before editing
product data:

1. A centrally frozen candidate packet containing the exact source boundary and ordered rows.
2. A worker-owned mapping that resolves every frozen row to one issue ID.
3. A factual relationship report against the live catalog and every mapped chunk peer.
4. A central approval in the mapping for every reported relationship.
5. A discrepancy and browser review report explaining every exception.

The central source owner writes `scripts/data/cbh-packets/<id>.json`. The packet fixes the inventory
identity, exact page and visible section, source boundary, exclusions, row order, expected count,
complete manifest proposal, chronology insertion anchor, and source-review identity. Its
`packetDigest` is SHA-256 over canonical JSON with recursively sorted object keys and preserved
array order. Changing any frozen field requires a new digest and a new downstream review.

When a source names the same whole issue more than once, keep one canonical row at its first source
occurrence and add `sourceOccurrenceCount` plus `repeatedSourceReferences`. Each repeated reference
records its full-source position, earlier canonical row, raw issue and range text, and normalized
title, year and issue number. Do not describe a required repeat as an exclusion and do not put the
same comic into canonical rows twice. Preparation reconstructs every canonical mapping
`sourcePosition`; approval re-derives those positions and the occurrence-total
`approvedSourceCount` from the packet before accepting downstream digests.

Packets with no repeated issue omit both optional fields and retain their existing digest meaning.
The same rule applies to CBRO packets. In a CBRO inventory, `sourceRowCount` is the total source
occurrence count when the packet has repeats, while the manifest expectation and generated checklist
remain the distinct comic count.

For a `complete-guide`, enumerate every source-defined whole issue in that packet. A prose-only
recommendation or collected edition may stay outside the row set when the source does not make it an
issue in the sequence. An ambiguous identity blocks that candidate instead of permitting an inferred
replacement or a shorter guide. Missing optional metadata does not block publication when reviewed
evidence establishes the Marvel issue ID, title, number, series identity, and exact issue link.
Preserve those facts in the row and allow unavailable dates, cover, digital ID, page count, and
creators to remain `null` or empty in the pinned payload.

A source-defined guide may instead ship as `depth: partial` and `spotlightKind: other` when the user
has approved a gap-tolerant release. Keep exact issue identities in `rows`, including identities
established by reviewed evidence when the configured metadata provider omits them. Put every
unresolved or explicitly unavailable identity in optional `sourceGaps`, mirrored in the mapping and
excluded from Markdown and browser payloads. Each gap records its one-based source position, raw
issue and range references, normalized identity, kind and status, checked date, audit basis, sorted
evidence sources and a digest recomputed from that complete evidence. `published-metadata-gap` is
open and fillable; `availability-exclusion` is closed after an explicit availability disposition;
`source-correction` is closed and cannot become an issue. Link a maintained tracking Issue from the
gap evidence when future availability or metadata work has been assigned separately.

Exact rows, gaps and repeated references must partition every source position. Exact rows plus gaps
must also be unique, pairwise-disjoint source identities. Resolving an open gap requires either an exact row or a closed availability exclusion with the same
identity at the same position. Renew the packet first, then mapping, overlap report and central
approval; each unchanged downstream layer must fail stale until renewed. Closed gaps cannot become
exact rows later without a new policy decision. Moved positions, changed identities and unexplained
removals fail instead of becoming metadata.

The maintained source records are split by program. Modern event and crossover candidates remain in
`scripts/data/cbh-modern-inventory.json`, whose fixed 86-record baseline is unchanged. Character and
team guide identities live in `scripts/data/cbh-character-inventory.json`. Original Ultimate Marvel
Universe intake identities live in `scripts/data/cbh-ultimate-inventory.json`; that inventory keeps
the Earth-1610 boundary separate from the post-Secret-Wars and 2023 continuity guides. Named
preparation locates the packet's stable id in exactly one maintained inventory, then applies the
same packet, mapping, relationship, approval, authoring, and freshness checks. Do not merge their
queue counts or treat a character disposition as a modern continuity result.

Movie and streaming companion guides live in
`scripts/data/cbh-mcu-companion-inventory.json`. That inventory preserves all fourteen user-selected
sources in priority order, including deferred and source-blocked entries. Its selected mappings use
the same `cbh-packets`, `cbh-mappings`, and `cbh-overlaps` directories and the same central
relationship policy. The adapter validates inventory state and source digests; it does not duplicate
packet, mapping, overlap, approval, or authoring logic.

Prepare exactly one packet by its stable id:

```text
npm run cbh:prepare -- --only=<id>
npm run cbh:resolve -- scripts/data/cbh-mappings/<id>.json
```

The preparation command validates the packet against its inventory record and the current catalog.
It writes only `scripts/data/cbh-mappings/<id>.json`. A mapping worker may edit that one mapping and
nothing else. The worker does not choose source boundaries, chronology, overlap dispositions, or
manifest fields. Keep source sequence. Do not regroup issues just to make the file look cleaner.
Exclude prose-only recommendations, optional older runs, collected editions, and non-comic notes
unless the source clearly makes them part of the issue order.

When one page contains several distinct guides, keep its exact URL and set `sourceSection` to the
stable visible heading for each guide. The page and section together are the source identity. A
guide without `sourceSection` remains unique by URL alone. Never invent a URL fragment or DOM id.

### Resolve issue IDs deterministically

Use source links for canonical identity, vendored metadata for exact title and issue matches, and
the live API only when vendored data cannot resolve an issue. Group consecutive issues from the same
series into range-backed runs where the app's data model supports it.

Before shipping, verify:

* Every source entry has a resolution or a documented exclusion.
* Every added issue ID exists.
* The mapping digest still matches the exact resolved rows and proposed manifest.
* The first and last entries match the intended boundaries.
* The relationship report covers every current catalog order and every mapped chunk peer.

Generate the factual relationship report after every candidate in the chunk is mapped:

```text
npm run orders:overlap -- scripts/data/cbh-mappings/<id>.json [peer-mapping-path...]
```

The report classifies each comparison as `exact`, `candidate-subset`, `existing-subset`, `partial`,
or `none`. Exact matches have no approval path. Either subset direction needs an explicit central
approval. Partial overlap needs a human or stronger-model authority with a rationale. A `none`
comparison may cite the maintained policy authority. Lower-cost mapping workers cannot approve any
relationship.

The central reviewer records one disposition per comparison in `relationshipReview.dispositions`,
plus the report, packet, mapping, library, and peer digests, reviewer identity, rationale, timestamp,
and `approvalDigest`. Review fields do not participate in `mappingDigest`, so adding a correct
approval cannot invalidate its own mapping evidence.

Only an approved, current mapping can be authored and vendored:

```text
node scripts/author-cbh-packet.mjs --only=<id>[,<id>...] [--peer=<shipped-peer-id>]
npm run vendor -- --only=<id>
```

Authoring validates every named candidate before writing any checklist or manifest entry. It stops
when the packet, mapping sequence, report, live catalog, peer mapping, disposition, or approved
manifest differs from the reviewed evidence. Omitting `--only` retains the existing legacy batch
behavior. Every resulting catalog card must credit Comic Book Herald and link to the exact guide
section followed.

Use `--peer` when a separately authored candidate was reviewed against a shipped guide's mapping.
Pass several reviewed peers as one comma-separated value when required. Each peer remains in the
manifest unchanged, is counted exactly once in the relationship report, and is excluded from the
ordinary reviewed-library digest. A partial relationship does not permit any source sequence to
lose shared issues.

An exact metadata issue can legitimately omit its number from the official title. A source-to-metadata
number translation may preserve that title only when the packet pins the exact candidate issue ID,
the returned metadata number matches, and the title contains no conflicting issue marker. The
Star-Lord FCBD row is the maintained example: source #1 is issue 62818, metadata number 0.

### Validate the packet

Run the targeted data tests first, then the full repository check set:

```text
npm test
npm run lint
npm run counts
npm run anchors
```

Open the finished order in a real browser and check the catalog name, description, group labels,
first issue, last issue, and reading sequence.

## Build a Comic Book Reading Orders historical event packet

Historical CBRO events use the same five evidence layers and central relationship policy as the CBH
workflow, but provider identity, source paths, attribution, and authoring remain separate. Do not put
CBRO evidence under a `cbh-` data path or use Comic Book Herald attribution for it.

The maintained inventory is `scripts/data/cbro-historical-inventory.json`. It contains the 58 event
timeline entries before Maximum Security; the cutoff itself and every later entry are absent. A
dedicated page packet records `sourceProvider`, the exact page URL, raw page SHA-256, visible issue
panel boundary, exclusions, row order, manifest proposal, chronology anchor, and central source
review. Timeline-only entries additionally require the visible event label as `sourceSection`.
Every record carries `universeScope`; only `marvel-2099` and `mc2` may use `alternate`.
Missing configured Marvel Unlimited metadata does not block an otherwise exact reading list when
the owner approves the gap bundle. Preserve every missing source position in ordered packet
provenance with its identity and failed lookup evidence, create a separate assigned repository
issue, and publish only the exact rows. Never substitute a nearby issue or silently delete a source
position.

The source publishes a five-second crawl delay. Use normal public access, wait between page requests,
and stop on a changed digest until the source boundary has been read and reviewed again. Copy no page
commentary, branding, images, or layout. Retain factual issue identities and order only.

For a timeline-range batch, commit the reviewed range specification, then freeze, prepare, approve,
author, and vendor the selected release:

```text
npm run cbro:freeze -- --file=scripts/data/cbro-timeline-batch-two.json
npm run cbro:prepare -- --release=<release-id>
npm run cbro:approve -- --release=<release-id>
npm run cbro:author -- --release=<release-id>
npm run vendor -- --only=<id>[,<id>...]
```

The range freezer accepts only explicit visible labels, inclusive issue-number ranges, candidate
issue IDs, metadata series IDs, and reviewed source-to-metadata alias notes. It creates packets
through the shared CBRO packet-digest primitive and does not fetch, copy, or reproduce source prose.
Preparation writes one exact mapping per frozen packet. A mapping worker does not choose source
boundaries, exclusions, manifest fields, aliases, chronology, or relationship dispositions. Approval
regenerates a factual report against every current shipped order and every selected peer. Exact
duplicates have no approval path. Subset and partial relationships remain central decisions.
The original five-guide release remains the default when no release is named. A release ID selects
one known complete source-order or chronology-order set. Unknown releases, incomplete or mixed sets,
duplicates, and the wrong order are refused so an omitted guide cannot become an ordinary library
comparison instead of a bound peer.

The maintained historical program currently ships 39 guides. The ninth continuation release has two
guides and 14 exact rows, which is why release validation names a complete known release rather than
assuming every release contains five guides. MC2 and Apocalypse: The Twelve retain complete blocker
records for 273 source rows and 21 exact gaps. MC2 keeps `universeScope: "alternate"` in the
inventory; blocker records remain on schema version 1 and do not duplicate universe scope. All
earlier blocker records remain unchanged. Second Clone Saga is blocked with 20 metadata gaps across
its complete 161-row source order. Marvel 2099 now publishes 172 distinct exact issues from all 271
source positions while preserving one repeated occurrence and 98 owner-approved metadata
exclusions. It keeps `universeScope: "alternate"` in the inventory. Position 58 is the final
maintained pre-Maximum Security entry, so the sequential source is exhausted and there
is no next cursor.

Authoring validates provider, source, packet, mapping, report, complete-library, peer, approval,
manifest, and chronology evidence before writing. Every resulting card must use
`Compiled for this project from Comic Book Reading Orders`, link to the exact event page, and keep
`sourceLicense` null.

For a Character Spotlight addition, also check the real catalog at desktop and narrow widths. Record
the reading and story counts under All, Best of, and Complete guides, and confirm the new card appears
only in the subsets named by its authored `spotlightKind`.

For an MCU Prep addition, keep `type` as `screen-companion`, `depth` as `selected`,
`timeline` as `null`, and `beginner` as `false`. Confirm the shared Home and Browse gateways expose
MCU Prep only when populated, and that its generated child page contains every selected card
once in inventory priority order at desktop and narrow widths. Do not add a fourth canonical shelf or
a Character Spotlight classification; Storylines remains the canonical shelf.

## Create reading paths and collected-edition groups

A reading path is a named sequence of existing order IDs. An ordinary authored path belongs in the
`paths` array beside the curated lists in `src/data/curated-lists.json`. A partition path belongs in
its ledger because its child IDs do not exist until generation. Each step is a list `id`, not a
story-group key. Include a stable path ID, reader-facing name and description, source credit, and at
least two steps.

The vendor run refuses missing list IDs, duplicate stories, duplicate path IDs, stale generated
steps, and paths with fewer than two steps. Tests also verify that shipped path stops do not overlap.

A hand-authored checklist can divide issues with `##` subheadings. Each subheading names a collected
edition and groups the issues beneath it. A `#` heading remains the order title and ends any open
edition. Orders without subheadings remain ordinary issue orders.

The grouping is the curator's claim, so say in the order description where the volume lineup came
from and which issues it leaves out. Issue read state remains shared across grouped and ordinary
orders.

## Regenerate event orders

The generated event orders use the series IDs Marvel branded with each event. The script fetches
their issues and writes a checklist in publication order under `src/data/orders`:

```text
node scripts/build-event-order.mjs
node scripts/build-event-order.mjs civil-war
node scripts/build-event-order.mjs --dry-run
node scripts/build-event-order.mjs --audit
```

Run the audit before regeneration. It scans the full series catalog and fails when a matching series
is in neither the include list nor the explicit rejection record. The output is committed, so review
the order as a data diff before vendoring it.

## Rebuild series and creator indexes

The metadata API has no working server-side search for series or creators, so the app uses committed
local indexes:

```text
npm run vendor:index
```

The command pages the complete series and creator catalogs and writes compact snapshots to
`src/data/series-index.json` and `src/data/creators-index.json`. The app loads each file only when
its search card opens. A new upstream record is not searchable until the snapshots are rebuilt.

## Cutting a release

Release preparation and GitHub publication are separate actions. Prepare and merge the release
commit first. Create the GitHub release from the exact merged commit on the default branch, never
from an unmerged branch commit.

### 1. Finalize the release record

Move the current changelog entries under a version heading. Keep the release notes benefit-led and
link to the full changelog.

Update all three version sources together:

```text
npm version <major|minor|patch> --no-git-tag-version
```

The npm version lifecycle updates the browser version constant in the same operation. Confirm all
three values agree and the stored-data schema is still correct. Use a major version for a
substantial new product generation. A major version is also required whenever an older build cannot
read data written by the new build, but a product-generation release may preserve the existing
schema. Use a minor version for features within the current generation and a patch for behavior
fixes that intentionally change neither data nor interface.

### 2. Run release validation

Repeat the seven deterministic gates from the start of this guide. Fetch the current remote state,
run the remote publication-surface gate, then run the live contract, browser, upgrade, and package
checks:

```text
git fetch --prune
npm run publication:surface
npm run contract
npm run browser
npm run upgrade
npm run pack
```

Review the generated archive checksum:

```text
Get-FileHash -Algorithm SHA256 dist/marvel-reading-tracker-windows.zip
```

Do not commit `dist`.

### 3. Merge before tagging

Open the release pull request and wait for every required check. After merge, confirm the merge
commit on the default branch is the exact code being released.

If a CI run was cancelled by a newer push, inspect its job conclusions before treating it as a
product failure. Trigger a manual run when the merge commit has no run:

```text
gh workflow run CI --ref main
```

### 4. Create the release from the merged commit

Create the GitHub release with tag `v<version>`, choose the merged commit as its target, paste the
prepared release notes, and attach `dist/marvel-reading-tracker-windows.zip`. Creating the release is
what creates the tag. Do not create the tag on the feature branch: squash merging would leave it
pointing to a commit that never reaches the default branch.

### 5. Verify the published release

Confirm:

* The tag resolves to the intended merged commit.
* The release is public and not a draft.
* The Windows archive is attached.
* The published checksum matches the locally reviewed archive.
* The stable download URL in the root README resolves to the new archive.
* A clean download opens at `http://127.0.0.1:8787/`.

Do not delete or move an existing release tag. Correct the release record without changing what the
tag names.

## Maintain runtime Reading Paths

Treat the parsed generated catalog as the browser's authority for Reading Paths. Ordinary path
declarations live in `src/data/curated-lists.json`, while a reviewed chapter partition can emit
another path through `scripts/lib/chapter-orders.mjs`. Reading only the manifest would therefore
drop a valid generated path. After vendoring, validate the resolved set with:

```text
node --test test/reading-path.test.js test/modern-timeline.test.js
```

The aggregate Reading paths screen and shelf badges answer different questions. The aggregate model
keeps every path independently, including a future story shared by more than one path. Shelf
placement intentionally keeps the first path for one stable badge. Do not reuse the shelf placement
map to build the complete screen.

The route has one path-specific query, `path=<validated-id>`. A selection belongs to browser history,
not saved state or the reading filter. Preserve the requested id while the catalog loads, reject
stale render continuations, and canonically replace a missing or invalid id after resolution.

Progress for each stop must continue to prefer the exact imported catalog id, then the first imported
sibling in catalog order, then **Not added**. State replacement from another tab and whole-origin
clearing update only those progress labels; rebuilding the selector would discard its DOM identity
and keyboard focus.

## Build and prove the x64 MSIX

[The Microsoft Store package guide](MICROSOFT_STORE.md) owns the exact production identity, activation
decision, local trust procedure, proof matrix, cleanup, and remaining Store gates.

Use winapp CLI 0.6.0 exactly. The packer stops on any other version:

```text
winapp --version
npm run msix:pack
```

The packer writes two signed x64 packages under ignored `dist/msix/`. It fetches and checksum-checks
the same Node runtime as the ZIP packer, compiles the console launcher with the Windows inbox .NET
Framework compiler, generates package assets, signs both versions with one transient certificate,
and deletes the private key and password. Never commit anything under `dist/`.

The public CER requires an administrator-approved trust step before `.msix` installation. No owner
credential or Store signing secret is used. Run the three proof scenarios only after that trust step:

```text
npm run msix:prove -- --scenario=start-profile-reader-relaunch
npm run msix:prove -- --scenario=busy-port-refusal
npm run msix:prove -- --scenario=update-state-continuity
```

Loose registration is useful for activation debugging but is not installation evidence. Record it
as such. The final proof must remove the exact package, its recorded processes, and the temporary
trusted root, then confirm port 8787 is free.

`npm run pack` remains the GitHub ZIP build. Do not merge the ZIP and MSIX paths or rename the stable
ZIP asset. The Store package cannot replace that release until certification passes and the owner
changes release policy explicitly.
