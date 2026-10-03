# Maintaining Recap Page

Use this guide to check, extend and release Recap Page.
[The contribution guide](../CONTRIBUTING.md) covers contribution policy and coding standards.
[The architecture guide](ARCHITECTURE.md) explains how the app fits together.

The app has no browser build step or runtime dependencies. `npm ci` installs development tools only.

## Run the complete local check set

Start with a clean dependency install:

```text
npm ci
```

Run the same eight deterministic checks used by CI:

```text
npm run lint
npm test
npm run counts
npm run sizes
npm run anchors
npm run spacing
npm run palette
npm run publication
```

All eight run in CI. They check lint and tests, documentation counts, stated file sizes,
evidence anchors, spacing, contrast and publication content. The browser journeys below are
manual release checks: they need installed Edge and a driver outside the repository.

Historical-anchor candidate paths use native Windows resolution before containment checks.
Different spellings of the same directory cannot bypass the worktree boundary. Resolution on
other platforms is unchanged.

### Run the test suite directly

The test script uses the bare Node test command:

```text
npm test
```

Do not replace it with a quoted glob. Node 20 treats that glob as a literal filename.

### Run the live API contract check

The contract check calls the live third-party metadata API and runs outside CI:

```text
npm run contract
```

It checks that the response fields the app uses still exist. Network outages, rate limits and
temporary API problems can fail it even when the code is correct. Run it manually before trusting
a release.

To override the representative order or issue:

```text
MRT_CONTRACT_ORDER_ID=<order-id> MRT_CONTRACT_ISSUE_ID=<issue-id> npm run contract
```

On Windows PowerShell, use:

```text
$env:MRT_CONTRACT_ORDER_ID='<order-id>'; $env:MRT_CONTRACT_ISSUE_ID='<issue-id>'; npm run contract
```

## Run the browser check

Use `puppeteer-core` installed outside this repository. Never add it to `package.json`.

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

The runner uses installed Edge by default. To choose another executable:

```text
MRT_EDGE=/absolute/path/to/browser npm run browser
```

The check normally uses an ephemeral port and an isolated profile, stubs catalog requests before
the page loads, and exits nonzero if a journey fails. Saved progress at the normal app address
stays untouched. The targeted `cache-generations`,
`catalog-gaps`, `reading-paths`, `reading-path-stop-actions`, `issue-return-visibility`,
`reading-shortcut`, `reading-list-empty-441`, `issue-action-names`, `issue-443-row-actions`,
`defer-next`, `defer-lifecycle`, `defer-persistence`, and `order-only-export` journeys require
`http://127.0.0.1:8787/`; they use that origin only inside Edge's temporary automation profile.
Stop the normal app server before any targeted run so the runner can bind that port. Each journey
prints its own assertion and timing totals.

The runner prints progress before creating each browser context and reports results as they
finish. Browser and cleanup failures preserve completed results and the primary failing stage.
Diagnostics include allowlisted browser and driver versions and observed numeric process exit
or signal values. An unavailable cause is `unknown`, not proof of a crash, resource limit or app
defect. Exits during requested cleanup are labelled separately.

Ordinary export scenarios declare the total expected native downloads in their isolated context.
Before closing it, the runner requires a browser `completed` event for every download within one
15-second deadline. Captured blob text alone is not completion. The count survives navigation.
A late start, canceled or missing download, invalid event, disconnect or missed deadline is
reported without replacing an earlier scenario failure. Cleanup is still attempted.
Unresolved completion stops the ordinary suite.

For a hosted browser-only check, dispatch **Windows App Certification Kit** at the exact
committed branch with `diagnostic_target=ordinary-browser`, `diagnostic_only=true`,
`native_only=false` and `release_preparation=false`. This runs the ordinary suite on Windows
without native proof, WACK or packaging. Its `qualified=false` record binds the source and
workflow commit to the installed driver version and locked driver digest. It uploads no artifacts
and cannot satisfy release or production acceptance. Invalid flag combinations fail before setup.

For the bounded context/export comparison, use `diagnostic_target=ordinary-browser-context-isolation`
with the same diagnostic-only flags. It runs two fresh Edge processes: blank context plus blank
sentinel, then the unchanged reader round-trip plus blank sentinel. The limit is four explicit
contexts and twelve create/page/close calls, with no retry. Edge 152.0.4191.66, Puppeteer 25.7.0,
the recorded driver lock and supported Page download events are required; a mismatch aborts.
Download observations retain pending, completed, canceled and unobserved states across navigation.
They do not change download policy or wait for completion. Observation can affect timing and
becomes partial after context close. Both arms passing cannot explain the late-suite failure.
A reader-arm failure points to that full path, not export alone. This mode produces no qualifying
artifact and does not replace the ordinary suite.

The fixed `diagnostic_target=ordinary-browser-download-completion` uses the same diagnostic-only
flags and exact toolchain gates. It compares the unchanged reader scenario without a completion
wait against the same scenario with the ordinary completion gate, each in a fresh browser with
one blank sentinel. Its maximum remains four explicit contexts and twelve create/page/close
calls. Only these fixed nonqualifying controls bypass the ordinary completion requirement.
Any arm failure remains nonzero, including when the treatment passes. A timeout or failure
after observed completion rejects the candidate; both arms passing does not establish causality.
Neither diagnostic proves a fix or satisfies full-suite or release acceptance.

To check repeated exports alone, `diagnostic_target=ordinary-browser-export-acceptance`
uses the same guarded diagnostic-only job. It runs `readable-markdown-export` followed by
`order-only-export` through their existing single-scenario selectors and stops on either failure.
The maximum is two Node commands, two fresh browsers and two isolated contexts, requiring
four and six native completions respectively. Final actions that confirm an export use focused
native Enter input; cancellation and deliberate-failure actions are unchanged. This checks input
without changing download policy. It does not explain why earlier native starts were missing.
It uploads no artifacts and is not full-suite or release qualification.

### Prove the browser check detects failures

The proof runner introduces a reversible fault for one journey at a time:

```text
npm run browser:prove -- --only=<scenario-name>
```

Plan the proof before running it. Default to no more than three mutations, each run only against
the scenario that should detect the changed behavior.

Each run requires the intended failure, restores the source, and reruns the same journey to prove
it passes. Never run every mutation against every scenario without explicit owner approval.
Calculate the number of commands first.

## Run the upgrade check

This check also pins the pre-deferral schema-2 build at
`ba23627bd7d094b649a7c3d113ab659bf88b4a8e`. It saves nonempty schema-3 intent in the candidate,
tries ordinary writes from a live stale older tab and a freshly loaded older build at the same
isolated origin, then returns to the candidate. Exact canonical bytes, read timestamps, list
identity and order must survive. This downgrade-refusal check does not cover deliberate
destructive recovery.

The runner recreates v1.4.0 from local Git history, runs it, then replaces its folder with the
current candidate at the same browser address:

```text
npm run upgrade
```

The historical server and complete source tree come byte for byte from the local v1.4.0 tag,
without a network request. A missing tag or unreadable Git object stops the run; it never falls
back to current source. The old build imports an order and marks one issue read. The candidate
must preserve the order, issue sequence, read marker and visible nonzero progress.
Bump the candidate version before running: if both builds report 1.4.0, the runner stops before
opening Edge because it cannot prove the folder swap loaded the candidate.

### Prove the upgrade check detects failures

The proof runner mutates one disposable copy at a time:

```text
npm run upgrade:prove
```

It requires each targeted assertion to fail, removes the mutation, then requires the normal runner
to pass. The upgrade proof has no single-scenario selector.

## Review pinned GitHub Actions

Workflows pin third-party actions to full commit SHAs. Ordinary CI runs only deterministic
repository checks. An explicitly requested manual Windows preparation run can retain the portable
ZIP and its provenance for review. Ordinary CI and Windows proof runs do not upload that archive.

The separate Windows package workflow runs for pull requests that change package behavior or the
workflow itself. It also supports manual dispatch. WACK uses the supported Windows Server 2022 x64
command-line host. Native installed jobs run the certification journey on x64 and Windows on Arm.
Every job uses a read-only token, telemetry opt-out and temporary randomly signed packages.
The browser driver stays outside repository dependencies. Proof jobs upload no package, certificate,
installer, browser profile, raw output or WACK report. The optional preparation job retains only the
portable ZIP and an allowlisted provenance record. The Store guide records the proof's limits,
result and cleanup requirements.
One Windows producer compiles the native x64/ARM64 GUI and isolated proof tools. Only those binaries
and source/output hash records pass to other jobs, which verify the producer digest against the
same commit and source bytes. Native console/UI observation is CI-only.

The installed proof's `puppeteer-core` graph is pinned in `.github/browser-proof/package-lock.json`.
The workflow copies the manifest and lock to its temporary directory and runs `npm ci` there.
This uses the locked dependencies, not newly resolved versions. The driver never enters the root
package; browser runtime dependencies stay at zero.

### Check the Microsoft Store submission packet

Review proposed Partner Center fields, owner-only stop points and sanitized listing assets without
entering Partner Center:

```text
npm run store:check
```

The check requires five 1920 by 1080 Desktop screenshots, the exact 300 by 300 purple panels tile,
listing copy within field limits, public HTTPS URLs, first-submission stop points and a separate
future-update policy. It reads no account data and makes no network request.

Regenerate the assets only with installed Edge and the same scratch `puppeteer-core` boundary as the
browser checks:

```text
$env:MRT_PUPPETEER='C:\path\to\scratch-directory'
npm run store:assets
```

The generator uses an isolated temporary profile with cover art off and fixed synthetic progress.
It checks visible text and layout before each capture and removes the profile afterwards.
Review every image before committing it. Package icons and package-copied files stay unchanged.

Before changing an action pin:

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

To add a curated order, append one entry to `src/data/curated-lists.json`, then run:

```text
npm run vendor
```

Vendoring fetches an order once for review and commit. The app reads that file instead of fetching
it from the metadata API during use. The command fills issue details, writes the order under
`src/data`, and rebuilds `src/data/catalog.json`.

Use exactly one source: `sourceUrl` fetches an upstream HTTPS checklist; `sourceFile` reads one
committed under `src/data/orders`. Keep the `id` stable and unique. Provide a reader-facing name
and description, order type and depth, discovery tags, source credit and license, and an expected
issue count when known. Story groups and variants are optional.

Every `character-run` requires `spotlightKind`. Use `best-of` only for selected recommended stories,
`complete-guide` only for a guide covering its declared character or group scope completely, and
`other` when neither fits. Choose this value editorially, never from issue count, reading depth,
title, description or source address. Every reading in a story group must use the same value.
`other` keeps the card under All without adding a visible fourth filter.

Rebuild only the order being added:

```text
npm run vendor -- --only=<id>
```

Re-vendoring every order costs hundreds of API requests and restamps files whose content did not
change. A malformed or unresolved entry fails rather than shipping a quietly shorter order.
For an approved single order with previously observed issue-detail responses, use
`--metadata-cache=<directory>` with `--only=<id>` to read its complete request-bound cache offline.
Each requested issue needs a file named for the SHA-256 of its exact metadata API URL.
A successful record contains `url`, `urlSha256`, `status: 200`,
`body` and `bodySha256`, with the hashes computed from the URL and `JSON.stringify(body)`.
A provider refusal may instead contain `url`, `urlSha256`, `status: 404`, `fetchedAt` and
`error: "404 <exact URL>"`, with no `body` or `bodySha256`; it remains an explicit
`detailsRefused` item using the approved checklist identity. Record only an actual observed
HTTP 404 this way. Missing records, unbound or corrupt responses, other HTTP errors and
transport failures abort before any output changes. Retain genuine successful records and
retry only missing requests under the existing vendoring rate limit.

A local source can be a partition parent. Give it a `partitionFile`, set `catalog` to `false`,
and keep the checked ledger under `scripts/data`. Before writing anything, the vendor validates
source-position coverage, the pinned parent issue vector, child metadata, derived years, path order
and overlaps. It keeps the parent payload for provenance and saved lists, then writes ordinary child
payloads and catalog entries. Offline catalog-only regeneration rebuilds the children, generated
path and overlap matrix. Catalog and overlap timestamps reuse the newest pinned payload timestamp,
so unchanged inputs produce byte-identical output on a second run:

```text
npm run vendor -- --catalog-only
npm run vendor -- --only=<parent-or-generated-child-id>
```

A generated child ID resolves to its partition parent, keeping the family together. Review all
generated files as one batch. Do not hand-edit a child payload or the overlap matrix.

### Preserve source evidence

Record enough evidence for another maintainer to reproduce every manually curated order.
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

The central source owner writes `scripts/data/cbh-packets/<id>.json`, fixing the inventory identity,
exact page and visible section, source boundary, exclusions, row order, expected count, complete
manifest proposal, chronology insertion anchor and source-review identity. Its
`packetDigest` is SHA-256 over canonical JSON with recursively sorted object keys and preserved
array order. Changing any frozen field requires a new digest and a new downstream review.

When a source repeats a whole issue, keep one canonical row at its first occurrence and add
`sourceOccurrenceCount` plus `repeatedSourceReferences`. Each repeated reference records its
full-source position, earlier canonical row, raw issue and range text, and normalized title, year
and issue number. Never classify a required repeat as an exclusion or duplicate it in canonical
rows. Preparation reconstructs every canonical mapping
`sourcePosition`; approval re-derives those positions and the occurrence-total
`approvedSourceCount` from the packet before accepting downstream digests.

Omit both optional fields when no issue repeats; the existing digest meaning stays unchanged.
CBRO packets follow the same rule. With repeats, a CBRO inventory's `sourceRowCount` counts all
source occurrences. The manifest expectation and generated checklist count distinct comics.

For a `complete-guide`, list every source-defined whole issue. Exclude prose-only recommendations
or collected editions only when the source does not place them in the issue sequence.
An ambiguous identity blocks the candidate; never infer a replacement or shorten the guide.
Missing optional metadata does not block publication if reviewed evidence establishes the Marvel
issue ID, title, number, series identity and exact issue link. Keep those facts in the row.
Unavailable dates, cover, digital ID, page count and creators may stay `null` or empty in the
pinned payload.

A user-approved gap-tolerant guide may ship as `depth: partial` and `spotlightKind: other`.
Keep exact identities in `rows`, including those established by reviewed evidence but omitted by
the metadata provider. Put every unresolved or explicitly unavailable identity in optional
`sourceGaps`, mirror it in the mapping, and exclude it from Markdown and browser payloads.
Each gap records its one-based source position, raw issue and range references, normalized identity,
kind and status, checked date, audit basis, sorted evidence sources and a digest recomputed from
that complete evidence. `published-metadata-gap` is open and fillable; `availability-exclusion` is
closed after an explicit availability disposition; `source-correction` is closed and cannot become
an issue. Link a maintained tracking Issue from the gap evidence when future availability or
metadata work has been assigned separately.

Exact rows, gaps and repeated references must partition every source position. Exact rows plus gaps
must also have unique, pairwise-disjoint identities. Resolve an open gap only with an exact row or
closed availability exclusion at the same position with the same identity. Renew the packet first,
then the mapping, overlap report and central approval. Each downstream layer must fail as stale
until renewed. A closed gap cannot become an exact row without a new policy decision.
Moved positions, changed identities and unexplained removals fail; they cannot become metadata.

The maintained source records are split by program. Modern event and crossover candidates remain in
`scripts/data/cbh-modern-inventory.json`, whose fixed 86-record baseline is unchanged. Character and
team guide identities live in `scripts/data/cbh-character-inventory.json`. Original Ultimate Marvel
Universe intake identities live in `scripts/data/cbh-ultimate-inventory.json`; that inventory keeps
the Earth-1610 boundary separate from the post-Secret-Wars and 2023 continuity guides. Named
preparation locates the packet's stable id in exactly one maintained inventory, then applies the
same packet, mapping, relationship, approval, authoring, and freshness checks. Do not merge their
queue counts or treat a character disposition as a modern continuity result.

Creator guides already present in the character intake retain their identity and position but use
`guideType: creator-run`, not a character classification. The Donny Cates guide is the maintained
example. Its manifest also uses `creator-run`, needs no `spotlightKind`, and appears on the line-wide
shelf. Scope and reading depth describe the source selection, not an exhaustive creator bibliography.

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

Preparation checks the packet against its inventory record and current catalog, then writes only
`scripts/data/cbh-mappings/<id>.json`. A mapping worker may edit only that mapping, not source
boundaries, chronology, overlap dispositions or manifest fields. Keep the source sequence.
Do not regroup issues to make the file look cleaner.
Exclude prose-only recommendations, optional older runs, collected editions, and non-comic notes
unless the source clearly makes them part of the issue order.

When a page has several guides, keep its exact URL and set `sourceSection` to each guide's stable
visible heading. Page and section together identify the source. Without `sourceSection`, the URL
alone must be unique. Never invent a URL fragment or DOM id.

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
plus report, packet, mapping, library and peer digests, reviewer identity, rationale, timestamp
and `approvalDigest`. Review fields are excluded from `mappingDigest`, so a correct approval
cannot invalidate the mapping evidence.

Only an approved, current mapping can be authored and vendored:

```text
node scripts/author-cbh-packet.mjs --only=<id>[,<id>...] [--peer=<shipped-peer-id>]
npm run vendor -- --only=<id>
```

Authoring checks every named candidate before writing any checklist or manifest entry.
It stops if the packet, mapping sequence, report, live catalog, peer mapping, disposition or approved
manifest differs from reviewed evidence. Omitting `--only` keeps the legacy batch behavior.
Every catalog card must credit Comic Book Herald and link to the exact guide section followed.

Use `--peer` when a separately authored candidate was reviewed against a shipped guide's mapping.
Pass multiple reviewed peers as one comma-separated value. Each stays unchanged in the manifest,
appears exactly once in the relationship report, and is excluded from the ordinary reviewed-library
digest. A partial relationship never permits dropping shared issues from a source sequence.

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

Historical CBRO events use CBH's five evidence layers and central relationship policy.
Keep provider identity, source paths, attribution and authoring separate. Never put CBRO evidence
under a `cbh-` data path or attribute it to Comic Book Herald.

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
issue IDs, metadata series IDs and reviewed source-to-metadata alias notes. It uses the shared CBRO
packet-digest function and never fetches, copies or reproduces source prose. Preparation writes one
exact mapping per frozen packet. A mapping worker cannot choose source boundaries, exclusions,
manifest fields, aliases, chronology or relationship dispositions. Approval regenerates a factual report against
every shipped order and selected peer. Exact duplicates cannot be approved. Subset and partial
relationships need central decisions.
Without a named release, the original five-guide release is the default. A release ID selects one
known complete source-order or chronology-order set. Unknown releases, incomplete or mixed sets,
duplicates and wrong order are refused. An omitted guide must not become an ordinary library
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

Owner-authored MCU Prep selections keep owner credit and an ordered selection ledger in
`scripts/data/owner-selections/`, not the fixed Comic Book Herald inventory. Preserve every supplied
position and record any approved collection expansion on its intake Issue. The Daredevil example
uses the existing provider-configurable packet validator, exact mapping and complete-library overlap
review under `scripts/data/owner-packets/`, `owner-mappings/` and `owner-overlaps/`. Its baseline names
all visible orders, including generated chapters, plus retained noncatalog parents. The provenance
record freezes that reviewed scope without rewriting it for future unrelated additions.
Do not run the CBH-specific checklist author on an owner selection, because it supplies CBH credit.
Use the ordinary local-checklist vendor with `--only` and verify the owner credit on the generated
card. Provider gaps remain ordered provenance and get a separately assigned gap Issue; a collection
identity conflict requires an owner decision rather than a neighboring substitution.

## Create reading paths and collected-edition groups

A reading path names a sequence of existing order IDs. Put an authored path in the `paths` array
beside the curated lists in `src/data/curated-lists.json`. Put a partition path in its ledger;
its child IDs exist only after generation. Each step is a list `id`, not a story-group key.
Include a stable path ID, reader-facing name and description, source credit and at least two steps.

The vendor run refuses missing list IDs, duplicate stories, duplicate path IDs, stale generated
steps, and paths with fewer than two steps. Tests also verify that shipped path stops do not overlap.

A hand-authored checklist can group issues into collected editions under `##` subheadings.
Each subheading names the edition. A `#` heading names the order and ends any open edition.
Without subheadings, the checklist remains an ordinary issue order.

In the order description, credit the volume lineup and name any omitted issues; the curator owns
that grouping claim. Issue read state stays shared across grouped and ordinary orders.

## Regenerate event orders

The script uses the series IDs Marvel branded with each event, fetches their issues and writes
a publication-order checklist under `src/data/orders`:

```text
node scripts/build-event-order.mjs
node scripts/build-event-order.mjs civil-war
node scripts/build-event-order.mjs --dry-run
node scripts/build-event-order.mjs --audit
```

Run the audit first. It scans the full series catalog and fails if a matching series is in neither
the include list nor the explicit rejection record. Review the generated order's data diff before
vendoring and committing it.

## Rebuild series and creator indexes

The metadata API has no working server-side search for series or creators, so the app uses committed
local indexes:

```text
npm run vendor:index
```

The command reads every page of the series and creator catalogs and writes compact snapshots to
`src/data/series-index.json` and `src/data/creators-index.json`. The app loads each file when its
search card opens. Rebuild the snapshots to make new upstream records searchable.

## Activate Microsoft Store update automation

The first Microsoft Store submission is manual. Do not activate automated updates until that free
submission is certified and live. Before merging the implementation, create the protected
environment. Otherwise GitHub creates it without protection rules.

Before the Store workflow reaches the default branch:

1. Create the `microsoft-store-production` environment in repository settings.
2. Require the owner as a deployment reviewer and prevent self-review when repository settings
   support it.
3. Select deployment branches, then confirm only the default branch is accepted for manual
   Validate and Submit dispatches. Application tags are checked inside the job.
4. Do not merge the workflow if this protection cannot be expressed and enforced.

The environment needs no credentials before Store certification. Reject every deployment approval
until the first version is live. Then create an Entra application with Partner Center Manager access
and add these environment secrets:

```text
PARTNER_CENTER_TENANT_ID
PARTNER_CENTER_CLIENT_ID
PARTNER_CENTER_CLIENT_SECRET
```

Add the Store product identity as the environment variable
`MICROSOFT_STORE_PRODUCT_ID`. Never place those values in repository variables, workflow text,
logs, issue comments, or artifacts.

Before the first production update, manually dispatch **Microsoft Store release** from the default
branch. Protected approval must appear before the job starts. The rehearsal builds, inspects and
WACK-tests the current bundle, authenticates, and reads the application and exact last published
submission through Microsoft's submission API. It checks that the bundle version exceeds every
published package version. Require **read-only activation rehearsal passed**. The rehearsal cannot
create, update or commit a submission, upload a package, delete, poll, or operate a rollout or flight.

If the rehearsal reports an unrecognized pricing field, package field, or rollout field, stop.
Update the fixture-backed contract using the documented API and observed sanitized field shape.
Never accept a missing value or create a draft to test the contract.

### Operate a Store update

Complete release preparation below, including version-bound Store notes. A GitHub release does not
start the Store job. Explicitly dispatch Submit from the default branch with the stable
`v<version>` tag and full source SHA. Protected approval authorizes building and submitting that
release. Reject approval if the Store product has pending work or this is not the intended next
Store update.

The job verifies the tag commit is on the default branch, builds once, inspects packages, runs WACK
and confirms the bundle hash is unchanged. Only then does it authenticate, reject unsafe Partner
Center state, create one draft, record its submission ID, upload the bundle archive, set immediate
publication with rollout disabled, verify that draft and commit the same ID once. HTTP mutations
are sent once, without automatic retries. Creation fails rather than deleting an existing pending
submission.

A commit acknowledgement is not publication. For at most five minutes, read-only requests track
acknowledgement, processing, certification, publication pending and Published. The publisher
independently verifies the exact ingested package/version and approved notes, then checks preserved
nonpackage intent. Local observation or proof blockers report `verification-pending`, not Store
rejection, and retain the acknowledged commit and last valid Store status. Missing required proof
at the deadline returns nonzero. Confirmed terminal/error outcomes remain `failed`.
Neither result sends another mutation. Only Published with every required proof counts as published;
verified ingestion during processing or certification does not. The summary contains safe identity,
stage/code, status, independent proof results and notes hash.

Microsoft publishes automatically after certification, which can take up to three business days.
There is no second manual publishing hold. A pending observation is not a claim of delivery.

#### Catch up an already published release

Do not rerun an old release workflow after correcting the publisher: that run uses its old source.
From the default branch, explicitly dispatch **Microsoft Store release** with `mode=Submit`,
`release_tag=v<version>` and `source_sha=<full immutable application commit>`. The existing published
release must be non-draft and non-prerelease, match the application version, and resolve to that exact
commit on the default branch. The workflow checks out the application there and the reviewed
publisher at the dispatch workflow commit separately. Its summary records both identities and the
WACK-qualified bundle hash. This does not move the public tag or replace its ZIP.

Protected environment approval authorizes the specific submission. Manual dispatch defaults to
`Validate`, with no tag, source SHA or Store mutation. Both paths require a live free product,
a strictly higher version and no pending submission. Never use catch-up to resume or replace a draft.

### Recover a Store update

| Point reached | Required action |
|---|---|
| Failure before draft upload | Correct the source, package, configuration, or read-only state problem. A deliberate rerun is safe only after confirming Partner Center still has no pending submission. |
| Existing pending submission found | Stop. Inspect it in Partner Center and decide manually whether to finish or delete it. The workflow never deletes it. |
| Failure during or after draft creation | Do not rerun. Treat the result as ambiguous and inspect the reported submission read-only. API-created submissions must continue through the API, not portal edits; any recovery requires a separate decision. |
| Draft commit accepted | Monitor certification in Partner Center. Do not rerun the workflow or move the release tag. |
| Certification failed | Use the certification report, correct the application, and publish a new GitHub release with a higher version. |
| Runner lost after commit | Treat Partner Center as authoritative. The pending guard prevents another upload while Store work remains. |

The summary contains no raw Store response; the workflow uploads no package or diagnostic artifact.
Cleanup always runs to remove generated packages, temporary Store JSON and upload archives, WACK
reports, package registration and temporary certificate trust. Access tokens stay in process
memory only. A cleanup failure is a release failure. Resolve it before another run.

When changing the Store submission API script, WinApp CLI, checkout action, or Node setup action,
review the upstream contract or release notes, replace any affected immutable pin, update the
workflow contract test, and repeat the read-only rehearsal before the next production submission.
The Store release and standalone certification workflows download the fixed WinApp CLI v0.6.0
archive and verify SHA-256
`f6dc42e3b4e4709c8f617003008e2cfdd9a51735e04e7170d60edda258db78a8` before extraction or
execution.

The API contract is grounded in Microsoft's [submission lifecycle](https://learn.microsoft.com/windows/uwp/monetize/manage-app-submissions),
[commit response](https://learn.microsoft.com/windows/uwp/monetize/commit-an-app-submission),
[status response](https://learn.microsoft.com/windows/uwp/monetize/get-status-for-an-app-submission)
and [first-party client](https://github.com/microsoft/msstore-cli/blob/65fec5f1fd4a666db76cb76ec6c7121a4f50f38e/MSStore.API/SubmissionClient.cs),
retrieved 2026-09-19. Learn specifies `CommitStarted`, not a numeric success code. The publisher
accepts only 200 or 202 plus that valid body, a narrower compatibility policy than the first-party
client's general successful-response handling. No 202 commit response was observed in the 3.0.0
incident: it stopped before commit. Creation accepts 200/201; update and GET require 200; blob upload
requires 201. Read-back compares unrelated mutable settings, not a whole-object hash: server status,
upload authorization, generated submission/package identities and read-only pricing metadata are
excluded; the publish date is irrelevant under Immediate and rollout percentage when rollout is off.

### Prepare the preserved Store draft

For the owner-approved existing draft in #488, use **Temporary Store draft handoff**
on the default branch with the normal protected approval. It builds only the pinned
2.1.0 application, independently records the workflow source, installs that application's
locked inspection tooling, then runs the existing production build, inspection and WACK.
The normal publisher and its pending-draft rejection are unchanged.

Accept the one-day artifact only after the entire job, including both cleanup steps,
succeeds. Verify its run/attempt, both source identities, exact two-file root set,
receipt fields and bundle hash. Only the 2.1.0.0 x64/ARM64 bundle and receipt may leave
the runner; no proof package, certificate or raw report is a handoff. This is not a
public installer or Store-signed package, and optional WACK warnings are not certification.
The coordinator owns the existing-draft upload and final-release listing updates,
read-back of intended edits and unchanged unrelated settings, and deletion of the
exact temporary local copies and cloud artifact after verified upload.
Do not install the bundle locally or submit for certification through this route.
Keep #488 open until handoff, draft read-back and disposal finish; publishing is separate.

## Cutting a release

Select affected platforms using [the coordinated release policy](RELEASING.md). Product version,
platform build number and publication approval are separate. Update the delivered matrix only
after confirmed platform delivery. An Android-only release does not publish Windows.

Prepare and merge the release commit before GitHub publication. Create the release from that exact
merged commit on the default branch, never an unmerged branch commit.

### 1. Finalize the release record

Move current changelog entries under a version heading. Lead release notes with what improves for
readers and link to the full changelog.

Update the canonical application version and its synchronized release files together:

```text
npm version <major|minor|patch> --no-git-tag-version
```

The npm version lifecycle also updates the browser version constant. The MSIX packer derives Store
revision `.0` and proof-only revision `.1` from it; do not maintain package versions separately.
Confirm package metadata, lock file and browser constant agree, and the stored-data schema is
correct. Use a major version for a substantial new product generation or data an older build cannot
read. A new generation may keep the existing schema. Use a minor version for features within the
current generation and a patch for behavior fixes that change neither data nor interface.

### 2. Run release validation

Repeat the eight deterministic gates above. Check that every advertised branch is the default or
the head of an open pull request in this repository. Fetch current remote state and run the full
publication-surface gate. The local branch-only check uses GitHub's public API without a token.
Set `GITHUB_TOKEN` for a private fork or when the unauthenticated rate limit is unavailable.
Then run the live contract, browser, upgrade and package checks:

```text
npm run publication:branches
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

For hosted preparation, manually dispatch **Windows App Certification Kit** at the clean,
committed candidate with `release_preparation=true`, `native_only=false` and
`diagnostic_only=false`. The option defaults off and never runs on a pull request.
The separate Windows preparation job runs the eight gates, live contract, full ordinary
browser suite, actual historical upgrade, Store packet check and existing portable packer.
Browser tooling uses the external locked driver and a temporary profile.

The one-day `portable-candidate-<commit>` artifact contains exactly
`marvel-reading-tracker-windows.zip` and `release-preparation.json`. The latter records the
source commit/tree, application version, run/attempt, ZIP size/hash and bundled Node
version/architecture/hash, not the build driver's version. The hosted verifier compares
every portable file with its source or the checksum-verified official runtime archive.
The ZIP keeps `Start on Windows.cmd`, its persistent command window and official x64 Node;
the native branded startup belongs only to MSIX. No launcher or package behavior changes.

An uploaded ZIP is not enough: all five jobs and cleanup must pass, including native controls
and all five installed journeys. Save the two retained files and verify their hashes before expiry.
Keep the original candidate provenance after merge; never claim a later commit built them.
Store packages, certificates, private inputs and raw reports remain temporary. This route creates
no tag or GitHub release and cannot submit a Store update. Run the protected read-only Store
rehearsal separately after merge.

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

Publishing this release does not request a Store deployment. A separate explicit protected Submit
dispatch submits the MSIX bundle; it does not change or replace the attached GitHub ZIP.

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

Use the parsed generated catalog for browser Reading Paths. Ordinary declarations live in
`src/data/curated-lists.json`; reviewed chapter partitions can generate another path through
`scripts/lib/chapter-orders.mjs`. The manifest alone misses generated paths. After vendoring,
validate the resolved set:

```text
node --test test/reading-path.test.js test/modern-timeline.test.js
```

The Reading paths screen keeps every path, including a future story shared by several paths.
Shelf badges keep only the first path for a stable badge. Never build the complete screen from
the shelf placement map.

The route has one path-specific query, `path=<validated-id>`. Selection belongs to browser history,
not saved state or the reading filter. Keep the requested id while the catalog loads, reject stale
render continuations, and canonically replace missing or invalid ids after resolution.

For each stop's progress, prefer the exact imported catalog id, then the first imported sibling in
catalog order, then **Not added**. After another tab replaces state or the whole origin is cleared,
update only progress labels. Rebuilding the selector loses its DOM identity and keyboard focus.

## Build and prove the Microsoft Store bundle

[The Microsoft Store package guide](MICROSOFT_STORE.md) defines the exact production identity,
activation decision, isolated trust procedure, proof matrix, cleanup and remaining Store gates.

Use the controlled Windows Actions workflow, not the personal Store installation. The native
producer requires the hosted Visual Studio 2022 x64/ARM64 tools and SDK 10.0.26100.0. It builds
the native GUI with a static runtime and records the exact inputs and output hashes. The packer
requires that verified artifact and winapp CLI 0.6.0; it stops rather than substituting a launcher:

```text
winapp --version
.\scripts\build-native-launcher.ps1 -IncludeProofTools
npm run msix:pack
```

The packer writes signed x64 and ARM64 packages at `<application-version>.0` and their bundle under
ignored `dist/msix/`. The x64 `<application-version>.1` update artifact goes under `dist/msix-proof/`
and cannot enter the Store bundle. Both official Node archives are checked against Node's published
SHA-256 list. Each package activates its native GUI, which starts the official architecture-matched
Node coordinator without a console. That coordinator controls readiness, browser handoff and the
unchanged detached server. Startup inputs are included before generation hashing. The packer
generates assets and signs all outputs with one transient certificate, then deletes the private
key and password. Never commit anything under `dist/`.

On any build host, inspect every package and both bundle slices without starting a foreign runtime.
Check identity, updater absence, Node hashes, the exact native-plus-Node executable set, native
source/hash binding and PE machine/subsystem fields:

```text
npm run msix:inspect -- --structural
```

On Windows on Arm, `npm run msix:inspect` also measures the x64-emulated and native ARM64 runtime
processes. Certification workflows use the structural form, then leave native execution to the
matching installed-proof host.

Before installation, temporarily trust the public CER as administrator in the disposable runner.
No owner credential or Store signing secret is used. Hosted jobs then run the three proof scenarios.
Never run them against a personal installation:

```text
npm run msix:prove -- --scenario=certification-functionality
npm run msix:prove -- --scenario=busy-port-refusal
npm run msix:prove -- --scenario=update-state-continuity
```

Those commands default to the standalone x64 package. Add
`--architecture=arm64 --source=bundle` to the first two scenarios to prove that Windows selects the
ARM64 slice from the final bundle. The update journey remains x64 because the `.1` package is
proof-only and never belongs in the Store bundle.

Loose registration can debug activation but is not installation evidence; label it accordingly.
The final proof must remove the exact package, its recorded processes and the temporary
TrustedPeople certificate, then confirm port 8787 is free.

`npm run pack` remains the GitHub ZIP build. Do not merge the ZIP and MSIX paths or rename the stable
ZIP asset. The Store package cannot replace that release until certification passes and the owner
changes release policy explicitly.

## Publish and maintain the project home

The GitHub Pages home is an information artifact, not another tracker build. Its source lives under
`pages/`. Build it with:

```text
npm run pages:build
```

The command replaces ignored `dist/pages/` only after a complete candidate has been assembled. The
only permitted outputs are:

```text
index.html
site.css
assets/home-960.png
assets/avengers-disassembled-reading-960.png
assets/android-feature-graphic.png
assets/android-library-preview.png
assets/android-reading-preview.png
```

The two 960 by 900 images use a clean demo profile, cover art off, and the collapsed sidebar.
Keep them byte-identical to their namesakes under `docs/screenshots/`.

The three Android images live under `pages/assets/`. The feature graphic is owner-supplied;
the two phone layouts are selected, inspected copies from `npm run play:assets`, generated from
the source revision recorded in [the asset provenance](project-home-assets.json). That record
binds the source, renderer, fictional fixture and image hashes; it is not deployed with the site.
The page labels these as desktop-rendered development previews, not native-device screenshots
or approved Play assets. Keep that distinction and the earlier-beta warning visible. A new
capture does not authorize a store listing, release or publication.

Refresh these copies deliberately, with the provenance and image contracts in
`test/pages-home.test.js`. The original generated preview packet remains ignored; never
force-add it. Keep every image local to the Pages artifact, with its real dimensions and
meaningful alternative text. The page's larger feature tour remains bounded by its word budget.
Do not add
`src`, an app manifest, a service worker, a script, a form, an iframe, an external font, analytics,
telemetry or another application origin to the artifact.

### Maintain the public question form

The project-question route is `.github/ISSUE_TEMPLATE/project-question.yml`. It uses the default
`question` label and creates a public GitHub Issue for a human answer. Its introduction must explain
that GitHub sign-in is required, the username, question and replies are public, GitHub hosts that
content, and Recap Page sends nothing automatically.

Keep links to the overview, running guide, privacy policy, architecture, data provenance,
governance, contribution guide and releases in the introduction. Route troubleshooting to
SUPPORT.md, faults to the bug form, improvements to the feature form, catalogue corrections to the
data form and suspected vulnerabilities to SECURITY.md.

The form has four controls:

1. A required topic covering the product or running it, privacy or saved data, architecture,
   provenance, governance or contribution or releases, and no suitable source.
2. A required project question.
3. A required source-context answer naming the maintained source checked and what remains unclear,
   or stating that none fits.
4. Required acknowledgements that the Issue and replies are public and that the submission contains
   no reading progress, lists, notes, backup content, personal information, attachments or
   vulnerability details.

Do not add browser details, the local app address, reading state, file uploads, screenshots or other
private troubleshooting fields. `test/intake-config.test.js` discovers every form and owns generic
schema, label, YAML and citation checks. `test/pages-home.test.js` owns this form's exact semantic
contract and the Page disclosure that precedes its direct link.

An earlier individual Copilot project guide was permanently deleted after the public question form
and project home passed hosted verification. It is not part of the public route, and no legacy access
role remains.

### Prepare Pages without publishing

Re-read current release notes and action definitions before pinning any Pages action. The workflow
uses GitHub Actions as its Pages build type, relative artifact paths and no custom domain, so it does
not need `actions/configure-pages`.

Create the `github-pages` environment with `main` as its only deployment branch. Do not add a
required reviewer, which would deadlock this single-maintainer repository. Add no environment secret.
Read the Pages and environment settings back after writing them and before merging.

The Pages workflow runs only for `main` pushes and manual dispatches on `main`. Its build job has
`contents: read`; only the deployment job has `pages: write` and `id-token: write`. The existing
required Node 20 and Node 24 jobs discover the Pages contract through bare `npm test`, so do not add
a separate required branch check.

### Publish and verify

The public transitions are separate decisions:

1. Re-enable the Pages workflow. This does not replay a push that happened while it was disabled.
2. Merge the exact checked corrective pull request. That publishes the question form, and the
   resulting `main` push triggers the corrected Pages deployment.
3. Verify the deployed Page and rendered question form before setting the repository homepage.
4. Set the homepage to `https://raymond-nassar.github.io/recap-page/`.

Verify the Page uses HTTPS and corresponds to the merged commit. Check its exact artifact inventory,
desktop and 320-pixel navigation, keyboard focus, forced-color boundaries, reduced-motion behavior,
fixed-origin warning, maintained document links, issue forms, private security route, source and
issue history. Check the question form signed out and signed in without submitting an Issue.

### Roll back hosted surfaces first

Public-transition approval must include authority to stop exposure immediately if a hosted check
fails:

1. Cancel an in-progress Pages deployment where possible.
2. Unpublish the current Pages deployment.
3. Clear the repository homepage if it was set.
4. Disable the publication path so another push cannot republish.
5. Verify the Page route is no longer available.
6. Prepare a reviewed source revert to remove the Page links or public question form.

Deleting source or workflow files does not remove a current deployment. Deleting the Pages site or
the deployment environment is a separate permanent action and needs separate approval.

The question form is published from the default branch and has no independent visibility switch.
Removing it requires a reviewed source change, and cannot recall an Issue, reply, notification or
copy that already exists. The earlier private Copilot project guide is not part of the current route;
keeping or deleting it cannot recall a chat GitHub already processed. Keep those limits in the
delivery record.

## Interpret qualified startup evidence

The controlled Windows proof reports `app-startup-contract-v2`, not every window on the machine.
It requires the exact installed startup closure and activation, a source-bound producer receipt
from real creation-option tests, a qualified native64 command environment, every internal startup
actor, calibrated app-client terminal evidence, declared behavior and completed capture-owned
cleanup. A required unknown is inconclusive, not a pass.

The accounted Console API host is still part of the app's actor and terminal evidence. Exact
system-image and validated client-parent identity do not prove invisibility. Do not extend that
role to arbitrary system children or allow its children to inherit a CMD external-URI boundary.
Its arguments are a Windows-owned protocol, not a matched app script, and its normal completed
exit is0 independently of an expected client refusal.

The host reads both AutoRun hives without changing them and compares expected inbox helper
identities before and after capture. A window-observing negative counts only with its intended
failure and a complete qualified `host-completion-v2` record. An early expected failure cannot hide
a failed final host sample. Decoder-only N1 collects no host evidence.

Report unassessed global activity and external URI-handler UI as separate uncertainty. An image
label, a PID outside the app tree or a previous result is no exemption. Installed functionality,
busy-port and update journeys must each complete successfully after package and scenario cleanup.
Keep primary and secondary failures in order. After driver completion, the bounded final report
read imports a specific native failure before a generic failed-exit fallback. Only an imported
specific record is marked consumed. Keep earlier genuine faults, poisoned reports and later
cleanup failures in order.

Each installed command must return exit0 and exactly one matching final journey record after
its outer cleanup; capture or behavior output alone is not completion. An unsettled CLI fails
at process quiescence rather than exiting successfully. The foreign busy-port holder owns at
most64 accepted sockets, discards their input without replying, and requires actual listener
and socket closure within its referenced2000ms cleanup deadline.

The native-only workflow input checks compilation and prerequisites, not installed certification.
A complete run rebuilds its producer artifacts at the same settled source head. Keep the approved
run limit, exact input hashes, actual inner command counts, skipped stages and original preview
flags. No proof result alone authorizes a PR or Store release.

## Store release-note payloads

### Inspect a stopped Store submission

If creation succeeds but a later step fails, do not rerun the publisher or delete the draft.
Dispatch **Read-only Store recovery inspection** from the default branch and approve only that
reviewed run through the existing production environment. Its report contains the exact pending
and last-published IDs, statuses, package versions, publication modes and content fingerprints.
Upload diagnostics include only the hostname, expiry and boolean checks. The path, signature,
query string and full upload URL are never included.
After an update passes but read-back differs, **Read-only Store draft difference diagnosis**
can compare the fixed 3.0.0 draft without another upload, update or commit. It reconstructs the
original only if its sealed fingerprint matches exactly, then reports changed field paths and
hashes rather than private values. A failed reconstruction is a blocker, not permission to guess.
The bounded reconstruction uses only values observed in the authenticated baseline and current
draft, with at most eight differing fields and an exact full-fingerprint match required.
Its package-array candidate reverses only the known replacement: remove the exact added target,
restore the retained old entry's observed Uploaded status, and preserve its authenticated metadata.
It performs only authentication and Store GET requests, keeps raw responses in process memory,
and uploads no artifact. A failed inspection is not evidence that no pending draft exists.
An API-created draft must be finished through the API, not edited through Partner Center.
Any mutation requires a separately reviewed, exact-draft recovery; ordinary publishing still
rejects pending submissions. The public release tag and qualified package source remain immutable.

Keep each release's Store notes in `docs/releases/<application-version>-store.json` with exactly
`version`, `locale` and `text`. Use the canonical application version, `en-us`, and concise
hyphen-bullet lines totaling at most 1500 characters. Include important upgrade compatibility
guidance, not GitHub download instructions.

Both protected workflow paths pass the file to `publish-store-update.ps1` as `ReleaseNotesPath`.
Before creating a draft, the publisher validates the version, text and existing English base listing.
It changes only that listing's release notes; other languages, descriptions, images and unrelated
settings stay unchanged. Exact note read-back is required before the one-time draft commit.
A missing or ambiguous listing field blocks the run. Never create or substitute one.

Run `node --test test/microsoft-store-release.test.js` for the payload and delivery contracts.
Repeat the protected read-only rehearsal after changing publisher behavior, as required above.

### Finish the identified 3.0.0 draft

The temporary **Recover the existing 3.0.0 Store draft** workflow is only for submission
`1152921505701916536`, identified by protected inspection run `35208196676`.
The exact upload host is bound from protected inspection `35211901090`, not a documentation example.
It binds that pending draft and published baseline `1152921505701831258` to the observed content
fingerprints. Changed content, another ID, processing status or a rerun stops before mutation.
Do not use it for another release or rerun a failed mutation.

Reviewed tooling and the immutable `40b6a529dbdc462799f613d9a3430912f7dde22e` application are checked
out separately. The hosted Windows runner builds and inspects the unchanged 3.0.0 application,
runs WACK, and binds the upload archive to that exact bundle. Packages and raw responses are not
published as artifacts. Generated packages, temporary trust and scratch material are removed.

The recovery preserves existing listing, pricing and publication intent. Only the old bundle is
replaced and the approved English bullet notes are updated. Exact metadata read-back and a final
application/baseline check precede one commit request. Only a valid `CommitStarted` response counts
as submission started, never as certification or publication. A response error or timeout may
follow a successful mutation: inspect the same draft read-only instead of trying again.

### Diagnose a current Store readback without changing it

Use **Read-only Store readback diagnosis** for current or future stopped submissions.
The 3.0.0 workflows above apply only to that incident. Dispatch only from the default branch,
coordinate with the current Store operator, and keep the required owner review on
`microsoft-store-production`. Shared production concurrency does not cancel an active operation.
Approval permits observation only, never resumption or commit.

Supply `release_tag`, full `source_sha`, `expected_pending_id`, `expected_published_id`,
`bundle_sha256` and `notes_sha256`. Hash the exact approved `text` string's UTF-8 bytes with SHA-256,
not the JSON file. The diagnostic runs at its own reviewed workflow commit and reads version and
notes from a separate immutable release checkout. Before authentication, it requires an existing
non-draft, non-prerelease public release, the exact tag commit on the default branch, a matching
package version and filename, and the approved notes hash. It never builds MSIX packages, moves
a tag, alters a public release or calls the publisher.

Each check reports a fixed identifier, pass/fail result and code. Store reads cover only the
application, exact configured published and pending submissions, pending status, and final
application/published rechecks. Responses stay in memory; no raw response or private baseline
goes to disk or an artifact. HTTP errors, malformed fields and mismatches do not suppress other
checks. There is no retry. Authentication is the only POST; Store mutation count must stay zero.

The report shows allowlisted statuses, numeric package versions, file statuses and filename-match
booleans. It distinguishes missing package versions from null. Other values appear only as types,
hashes and counts. Never emit status messages, only documented error/warning codes and counts.
Paths use known API field names, a conservative locale allowlist and array indices; other keys
are hashed. Each view allows at most 100 difference records and states the total and any truncation.

The expected update uses the **current** published submission, approved release notes and package
replacement. It shares the publisher's exact `mutableIntent`, new-package metadata handling and
narrow deleted-bundle omission rule below. Additional views show differences before new-package
and general normalization, excluding upload authorization and status detail bodies. These are
observations, not acceptance rules. The publisher still requires no pending submission and a higher
version. Failures include fixed contract codes and safe semantic paths, not just the stage name.

Set `read_uploaded_bundle=true` only with the operator's approval to read the upload. This GET
accepts only an unexpired HTTPS Azure Blob ingestion URL, sends no Authorization header and refuses
redirects. Transfer and expanded bundle size are each capped at 256 MiB, with a 60-second deadline.
The archive must be non-ZIP64 with no comment, holding a single exact-name stored or deflated bundle
with matching sizes and a calculated payload CRC-32. Bytes stay in memory. The report gives current
ZIP and bundle hashes/sizes and compares the bundle with the supplied qualified hash.
Denial, timeout, unsupported ZIP layout, limits or mismatch explicitly fail; metadata checks still
complete. Metadata naming the expected package proves nothing about uploaded bytes.

The original upload ZIP digest is **UNRECORDED**. A current upload read can establish its current
bytes, not invent an original ZIP digest or prove when those bytes were uploaded. Without that
read, the bundle hash is only an operator-supplied binding. Historical created/published payloads
are explicitly unavailable, not reconstructed or resealed. Current baseline comparison cannot
prove the historical copy relationship; sequential GETs are not an atomic snapshot. A clean
diagnosis does not authorize a resume and does not imply that Store submission was committed or
published. Public GitHub release state and Store submission state remain separate.

The field and read-only contracts follow Microsoft's
[submission resource](https://learn.microsoft.com/windows/uwp/monetize/manage-app-submissions),
[submission GET](https://learn.microsoft.com/windows/uwp/monetize/get-an-app-submission),
[status GET](https://learn.microsoft.com/windows/uwp/monetize/get-status-for-an-app-submission)
and [commit boundary](https://learn.microsoft.com/windows/uwp/monetize/commit-an-app-submission),
retrieved 2026-09-19. Microsoft documents package-derived fields as server-populated. In particular,
missing new-package version may explain a strict inspection failure but does not by itself explain
a publisher readback failure. Diagnose the actual failed checks before considering a policy change.

### Commit an already uploaded, verified Store update

Use **Commit verified existing Store update** only after the Store operator reviews a fresh
read-only diagnosis and explicitly approves committing that exact current submission.
This is separate from normal publishing and incident-bound recovery. It cannot create a submission,
upload a blob, PUT a draft, delete anything, rebuild the app or change a release/tag.
The normal publisher still refuses pending submissions and requires a higher version.

Supply the diagnosis inputs plus `current_zip_sha256`, the approved SHA-256 of the **current remote
upload ZIP**, and explicitly select `commit_only=true`. The inner `bundle_sha256` must come from
the previously qualified package, not its filename or API metadata. Never substitute the current
ZIP hash for an unrecorded original-upload digest. Hash the approved UTF-8 note text, not its JSON
container. Inputs are reusable; this path has no built-in incident submission, release or hash.

Dispatch on the default branch at the reviewed workflow commit. Check out current tooling and
immutable application source separately; only the tooling executes. Keep required owner approval
on `microsoft-store-production`. Shared concurrency has cancellation disabled; the token has only
`contents: read`. Before Store authentication, preflight refuses missing explicit approval or any
`GITHUB_RUN_ATTEMPT` other than `1`. Never retry by rerunning. The script also requires
`--commit-only`; its default operation and `--diagnose` stay read-only.

Approval covers **current verified intent**: the expected current published submission plus approved
package replacement and notes. Historical created/published snapshots are unavailable, not
reconstructed, recovered or resealed. Shared checks require exact references, source/tag/version,
free pricing, pending state without errors, old/new package identities and statuses, approved notes,
immediate publication, disabled rollout and unchanged editable settings. A fresh remote ZIP read
must pass the bounded single-entry, exact-name, CRC, size and inner-bundle hash checks.
Its current ZIP hash must equal the separately approved runtime input.

After checking bytes, the workflow re-reads application references, published and pending intent,
notes/packages and status immediately before commit. Changed intent, upload location, processing
state or an error blocks the POST. Sequential reads cannot prevent external races. Coordinate with
the sole Store operator and never edit the draft in Partner Center.

The transport permits one Store mutation: one POST to the validated pending submission's commit
endpoint. Only HTTP 200 or 202 with a body containing solely `CommitStarted` status acknowledges
it. Timeout, malformed response, HTTP error or report-writing failure preserve the attempt and
submission ID in the safe outcome. Never retry an ambiguous commit or send an automatic follow-up
GET. Inspect that exact submission separately before deciding what to do.
Acknowledged commits use the normal publisher's shared five-minute observer. Package/version,
approved English notes and preserved nonpackage intent have separate proof results. An editable-intent
mismatch can leave package and notes `verified` while intent is `review-required`. The overall
result stays `verification-pending` and the CLI/workflow exits nonzero. No mismatched field is
normalized away. Changed notes or a wrong package also require review, not a claim of Store rejection.

Transport errors, malformed/unknown status, unexpected None/PendingCommit after acknowledgement,
readback identity failures and missing required proof at the deadline also mean incomplete local
verification. Reports keep the acknowledged commit and last validated Store status with a fixed
stage/code; malformed status cannot overwrite it. Confirmed terminal states such as CommitFailed
or an observed nonempty error list remain `failed`. Failure and incomplete verification both exit
nonzero without retry. Certification with complete proofs is a successful observation, not
publication or a reason to resubmit. Published without every required proof never succeeds.
Reports contain safe identities, phases, statuses, hashes and proof results. They never contain raw
errors, response objects, upload paths, SAS URLs, credentials or private metadata.

In particular, `allowTargetFutureDeviceFamilies` remains an editable device-family:boolean
dictionary. Neither Microsoft's
[submission resource](https://learn.microsoft.com/windows/uwp/monetize/manage-app-submissions) nor its
[typed submission model](https://github.com/microsoft/msstore-cli/blob/65fec5f1fd4a666db76cb76ec6c7121a4f50f38e/MSStore.API/Packaged/Models/DevCenterSubmission.cs)
establishes contractual equivalence between an absent key and `false` (retrieved 2026-09-20).
Precommit comparisons are unchanged and postcommit omission still requires review. A later diagnostic
difference can suggest why an earlier observation stopped; it cannot prove the contents of an
earlier response that was not retained.

The shared comparison permits just one new normalization: `targetPlatform` may be absent from the
actual exact-filename-matched **old MSIX bundle** only when both expected and actual entries are
`PendingDelete` and the expected value is a nonempty string. Present null, a different present
value, an active/new-package omission or any unrelated semantic change still fails. Raw diagnostic
differences retain the known `targetPlatform` path without exposing its value.
Microsoft's [typed package model](https://github.com/microsoft/msstore-cli/blob/65fec5f1fd4a666db76cb76ec6c7121a4f50f38e/MSStore.API/Packaged/Models/ApplicationPackage.cs)
omits the field and has no extension-data member; its
[submission model](https://github.com/microsoft/msstore-cli/blob/65fec5f1fd4a666db76cb76ec6c7121a4f50f38e/MSStore.API/Packaged/Models/DevCenterSubmission.cs)
uses that package type. Those first-party non-roundtrip models and the observed omission on a
deleted bundle support this narrow rule. The Learn package resource does not list the field;
it does **not** explicitly designate it read-only. References retrieved 2026-09-20.

This implementation alone has not committed anything to the Store. It changes no app version,
public release, immutable download or saved reading data. Review its frozen head and green checks
before the operator performs a separately authorized protected commit-only dispatch.
