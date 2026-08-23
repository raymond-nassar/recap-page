<!-- markdownlint-disable-file -->
# RPI Phase Details: Reading list expansion

## Metadata

* Task ID: MRT-002
* Task slug: reading-list-expansion
* Related plan: .copilot-tracking/plans/2026-08-22/reading-list-expansion-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-22/reading-list-expansion-research.md and
  .copilot-tracking/research/2026-08-22/one-world-under-doom-expansion-research.md

## Phase Index

| Phase | Candidate set | Task range | Dependency |
|-------|---------------|------------|------------|
| P01 | Generic workflow | P01-T01 to P01-T05 | Research complete |
| P02 | Generations; X-Men Extermination | P02-T01 to P02-T05 | P01 |
| P03 | Spider-Geddon; Age of X-Man; Iron Man 2020 | P03-T01 to P03-T06 | At least one integrated and fully validated P02 list |
| P04 | The War of the Realms; Absolute Carnage | P04-T01 to P04-T05 | At least one integrated and fully validated P02 list |
| P05 | Empyre; X-Men: X of Swords; Heroes Reborn | P05-T01 to P05-T06 | At least one integrated and fully validated P02 list |
| P06 | Infinite Destinies; The Last Annihilation; X-Men Inferno | P06-T01 to P06-T06 | At least one integrated and fully validated P02 list |
| P07 | The Death of Doctor Strange; Devil's Reign; Reckoning War | P07-T01 to P07-T06 | At least one integrated and fully validated P02 list |
| P08 | Judgment Day; Dark Web; Sins of Sinister | P08-T01 to P08-T06 | At least one integrated and fully validated P02 list |
| P09 | Secret Empire | P09-T01 to P09-T04 | At least one integrated and fully validated P02 list |
| P10 | Hunt for Wolverine | P10-T01 to P10-T04 | At least one integrated and fully validated P02 list |
| P11 | Fall of the House of X and Rise of the Powers of X | P11-T01 to P11-T04 | At least one integrated and fully validated P02 list |
| P12 | One World Under Doom | P12-T01 to P12-T04 | P01 and recorded P08 outcomes |
| P13 | Queue reconciliation | P13-T01 to P13-T03 | P02 through P12 |

## Task-Level Context

### Context

The existing source program has a maintained 86-record modern Earth-616 inventory,
deterministic issue resolution, all-library overlap reporting, source identity checks, authoring,
vendoring, and multiple shipped production packets. The immediate gap is not application capability.
Future packet ids, chronology anchors, and source rows remain hard-coded in large shared scripts,
which makes low-cost worker delegation expensive and conflict-prone.

### Intent

Define an implementation sequence that creates a bounded one-list worker packet, a staged
current-library gate, and small central integration chunks for the original 22 candidates plus One
World Under Doom.

### Boundaries

* Included: build-time data and tools, one-list worker artifacts, no more than three-list integration
  chunks, current-library comparisons, generated list data, and directly required records.
* Excluded: browser changes, runtime dependencies, historical blocked-candidate adjudication,
  character/team inventory, Marvel scraping, and editorial decisions by lower-cost workers.

### Likely Targets

* `scripts/data/`: candidate source packets, mappings, overlaps, and integration chunk definitions.
* `scripts/`: generic preparation, status, overlap, and authoring entry points.
* `scripts/lib/`: reusable validation and source-packet parsing.
* `test/`: semantic contract coverage for the new packet and live-library gate.
* `src/data/orders/`, `src/data/curated-lists.json`, and generated order JSON: integration-owned list
  delivery targets after candidate approval.
* `docs/MAINTAINING.md`, `docs/DATA_PROVENANCE.md`, `PRODUCT_BACKLOG.md`, and `CHANGELOG.md`: only
  updates directly required by shipped workflow or list changes.

### Dependencies

* Completed MRT-002 research.
* Existing MRT-004 inventory, resolver, overlap, authoring, and vendoring contracts.
* Comic Book Herald credit-and-link permission record.

### Validation Expectations

* Semantic tests prove packet isolation, current-library completeness, relationship classification,
  stop conditions, generic id selection, and generated sequence fidelity.
* Existing repository gates stay green.
* Live contract checks run for chunks that add issue ids.
* Browser checks verify each integration chunk's cards and first, middle, and final sequence.

### Completion Evidence

* One critique-approved plan with aligned phase and task markers.
* Every task has explicit ownership, targets, dependencies, pass conditions, and stop conditions.

### Unresolved Items

* None. Candidate admission remains an implementation-time evidence gate rather than a planning
  decision.

## Worker and Integration Contract

### Lower-cost worker

* Owns one inventory id.
* Reads one centrally frozen source packet with an immutable digest.
* Writes only `scripts/data/cbh-mappings/<id>.json`.
* Does not edit the source packet, overlap report, approval fields, central manifest, catalog,
  product documents, or another candidate.
* Stops on packet digest drift, ambiguous or unmatched issue identity, count mismatch, metadata
  exception not already authorized by the packet, or placeholder.

### Central source owner

* Freezes source page, visible section, ordered rows, exclusions, expected count, proposed manifest
  fields, and chronology insertion anchor.
* Runs duplicate inventory-id, catalog-id, source-page, and source-section checks before dispatch.
* Uses stronger review for Secret Empire and Hunt for Wolverine and explicit metadata-boundary review
  for Fall and Rise of X.

### Central relationship reviewer

* Regenerates comparisons after candidate mappings are complete.
* Compares every candidate with every then-current shipped list and every mapped peer in its chunk.
* Rejects exact duplication, requires explicit approval for either subset direction, and requires
  stronger-model or human rationale for partial overlap.
* Records approval authority and comparison input digests. A lower-cost worker cannot approve.

### Central integrator

* Receives no more than three passing candidate mappings and their current approved reports.
* Rechecks identity, mapping, overlap, and library digests immediately before authoring.
* Applies approved shared manifest, generated data, inventory, documentation, backlog, and changelog
  changes once.
* Routes any failed candidate out of the chunk without weakening its gate.

## Shared Pass and Stop Conditions

| Owner | Pass condition | Stop condition |
|-------|----------------|----------------|
| Source owner | Unique identities, exact visible boundary, ordered rows, expected count, exclusions, manifest proposal, insertion anchor, reviewer identity, and stable packet digest | Duplicate identity, unclear boundary, mixed or hidden section, missing chronology decision, or metadata outside the snapshot |
| Lower-cost worker | Unchanged packet digest, every row resolves exactly, expected count matches, issue ids are unique, and placeholders are zero | Packet mutation, unmatched or ambiguous row, count mismatch, unauthorized exception, or placeholder |
| Relationship reviewer | Comparison count covers all current orders and mapped peers; every relationship has an allowed disposition; report records input digests and authority | Exact match, unapproved subset, unapproved partial overlap, missing comparison, or stale input |
| Integrator | All prior gates remain current; source order equals Markdown, generated JSON, and catalog sequence; credit and source link are exact; all required checks pass | Any stale digest, sequence drift, missing provenance, generated mismatch, gate failure, or browser mismatch |

## Approval and Freshness Artifact Contract

The packet is the one new logical schema. Mapping and overlap files extend their existing formats.
Digest serialization uses UTF-8 JSON with object keys sorted recursively, array order preserved, and
no insignificant whitespace. Every digest is SHA-256 over that canonical serialization.

| Artifact or field | Canonical location and digest domain |
|-------------------|--------------------------------------|
| `packetDigest` | Frozen packet file; covers every packet field except `packetDigest` itself, including source identity, section, exclusions, ordered rows, expected count, proposed manifest, insertion anchor, and source-review identity |
| `mappingDigest` | Existing mapping file; covers all worker-owned fields: id, inventory id, packet digest, source fields, counts, exclusions, proposed manifest, candidate metadata, and resolved rows; excludes `mappingDigest`, `reviewStatus`, `packetReview`, `approvedManifest`, and `relationshipReview` |
| `libraryDigest` | Overlap report; covers the complete canonical `src/data/curated-lists.json` content plus the ordered issue-id sequence loaded from every generated order named by that manifest |
| `peerDigests` | Overlap report; sorted object from every mapped peer id in the chunk to its `mappingDigest` |
| `reportDigest` | Overlap report; covers candidate id, packet digest, mapping digest, library digest, peer digests, and every factual comparison; excludes `reportDigest` itself |
| `relationshipReview.dispositions` | Existing mapping file; one row per report comparison with order id, observed relationship, decision, rationale, authority type, authority identity, and review timestamp; `none` may name policy authority, subset and partial require stronger-model or human authority, and exact has no approval |
| `approvalDigest` | Existing mapping file inside `relationshipReview`; covers report digest, packet digest, mapping digest, library digest, peer digests, all dispositions, authority, rationale, and timestamp; excludes `approvalDigest` itself |
| Existing approval fields | `reviewStatus`, `packetReview`, and `approvedManifest` remain in the mapping; `approvedManifest` must equal the frozen proposal before authoring |

The write order is fixed:

1. Freeze the packet and write `packetDigest`.
2. Prepare and resolve the worker-owned mapping, then write `mappingDigest`.
3. Read the live canonical manifest and all generated order sequences, read mapped peers, write the
   factual overlap report, then write `reportDigest`.
4. A central reviewer writes `relationshipReview`, `approvalDigest`, `reviewStatus`, `packetReview`,
   and `approvedManifest`. Review fields are excluded from `mappingDigest`, so approval does not
   invalidate its own factual inputs.
5. Authoring recomputes and validates every digest and disposition for every candidate in the chunk
   before making any canonical write. Any source, mapping sequence, library, peer, report, disposition,
   or approved-manifest drift stops the entire pre-write check.
6. After all candidates pass the pre-write check, the integrator writes the chunk's canonical inputs
   and regenerates outputs. The old library digest is expected to become stale only after this write.

P01-T03 tests exact rejection, approved subset behavior, approved partial behavior, complete
comparison coverage, and approval without self-staleness. P01-T04 tests rejection after packet,
mapping-sequence, library, peer, disposition, or approved-manifest drift.

## P01: Generic candidate workflow

### Context

The preparation script embeds source data and packet membership, the authoring script embeds packet
ids and insertion anchors, and exact overlap is rejected before the reporter can classify it. P01
turns those shared-code edits into one validated data contract while preserving the existing
resolver, mapping, overlap, authoring, and vendoring entry points.

### Boundaries

* Included: one packet schema, generic selection, complete relationship classification, approval
  policy, stale-report enforcement, focused semantic tests, and maintainer instructions.
* Excluded: a new script, a runtime dependency, browser behavior, candidate list delivery, and
  per-candidate test files.

### Task Details

| Task | Owner and likely targets | Dependencies | Completion evidence | Stop condition |
|------|--------------------------|--------------|---------------------|----------------|
| P01-T01 | Central implementer; `scripts/lib/cbh-inventory.mjs`, `scripts/data/cbh-modern-inventory.json`, and new `scripts/data/cbh-packets/<id>.json` inputs | None | One schema validates source identity, boundary, exclusions, ordered rows, expected count, manifest proposal, insertion anchor, review identity, and digest; invalid and cross-candidate inputs fail | A required field remains embedded only in shared code or allows editorial choice after freeze |
| P01-T02 | Central implementer; `scripts/prepare-cbh-batch.mjs` and existing resolver tests | P01-T01 | `npm run cbh:prepare -- --only=<id>` loads any valid packet without candidate-specific code and writes only the matching mapping | A candidate needs a new branch, constant, or unrelated source edit |
| P01-T03 | Central implementer; `scripts/lib/cbh-overlap.mjs`, `scripts/report-order-overlap.mjs`, `scripts/author-cbh-packet.mjs`, and overlap tests | P01-T02 | Reporter classifies exact, candidate-subset, existing-subset, partial, and none; policy blocks exact, requires approved subsets, and reserves partial approval for stronger-model or human authority | Exact still throws before report, coverage can omit an order, or a worker can approve |
| P01-T04 | Central implementer; `scripts/author-cbh-packet.mjs`, existing contract checks, and data digests | P01-T01 through P01-T03 | Named approved ids author without packet constants or insertion maps; mapping, report, or library drift stops authoring | Shared hard-coding remains or stale evidence can pass |
| P01-T05 | Central implementer; existing `test/cbh-*.test.js`, `test/order-overlap-report.test.js`, `docs/MAINTAINING.md`, backlog, and changelog | P01-T01 through P01-T04 | At most 11 new P01 semantic cases have been seen to fail without their guarded change; repository gates pass; ownership and commands are documented | Coverage proves only regression presence, a required failure was not observed, or limits are exceeded without a plan amendment |

### Validation Ownership

* P01-T01 owns packet schema, digest, identity, and isolation tests.
* P01-T02 owns generic id selection and preparation output tests.
* P01-T03 owns full comparison coverage and relationship-policy tests.
* P01-T04 owns stale-evidence and sequence-fidelity tests.
* P01-T05 owns the combined gate run and failure-proof record.
* P13-T02 separately owns exactly one terminal-queue assertion in the existing inventory test file.

## P02 to P08: Routine delivery chunks

### Context

These phases use the same proven contract. Central work freezes source boundaries and integrates
shared records. Each mapping task is an independent, one-candidate lower-cost worker assignment.
Relationship review waits until all available mappings in the chunk exist because issue overlap is
not knowable before resolution. Each phase can ship fewer than its listed candidates.

### Common Targets

* Source owner: `scripts/data/cbh-packets/<id>.json` and the candidate inventory record.
* Worker: `scripts/data/cbh-mappings/<id>.json` only.
* Reviewer: `scripts/data/cbh-overlaps/<id>.json` and approval fields in the mapping.
* Integrator: `src/data/orders/<id>.md`, generated order JSON, `src/data/curated-lists.json`,
  `scripts/data/cbh-modern-inventory.json`, provenance, backlog, changelog, and required checks.

### Lower-Cost Worker Dispatch Table

Each worker receives only its frozen packet and this row. It runs both listed commands in order and
may write only the listed mapping path.

| Task | Inventory id | Frozen packet | Sole mapping output | Exact commands |
|------|--------------|---------------|---------------------|----------------|
| P02-T02 | `generations` | `scripts/data/cbh-packets/generations.json` | `scripts/data/cbh-mappings/generations.json` | `npm run cbh:prepare -- --only=generations`; `npm run cbh:resolve -- scripts/data/cbh-mappings/generations.json` |
| P02-T03 | `x-men-extermination` | `scripts/data/cbh-packets/x-men-extermination.json` | `scripts/data/cbh-mappings/x-men-extermination.json` | `npm run cbh:prepare -- --only=x-men-extermination`; `npm run cbh:resolve -- scripts/data/cbh-mappings/x-men-extermination.json` |
| P03-T02 | `spider-geddon` | `scripts/data/cbh-packets/spider-geddon.json` | `scripts/data/cbh-mappings/spider-geddon.json` | `npm run cbh:prepare -- --only=spider-geddon`; `npm run cbh:resolve -- scripts/data/cbh-mappings/spider-geddon.json` |
| P03-T03 | `age-of-x-man` | `scripts/data/cbh-packets/age-of-x-man.json` | `scripts/data/cbh-mappings/age-of-x-man.json` | `npm run cbh:prepare -- --only=age-of-x-man`; `npm run cbh:resolve -- scripts/data/cbh-mappings/age-of-x-man.json` |
| P03-T04 | `iron-man-2020` | `scripts/data/cbh-packets/iron-man-2020.json` | `scripts/data/cbh-mappings/iron-man-2020.json` | `npm run cbh:prepare -- --only=iron-man-2020`; `npm run cbh:resolve -- scripts/data/cbh-mappings/iron-man-2020.json` |
| P04-T02 | `war-of-the-realms` | `scripts/data/cbh-packets/war-of-the-realms.json` | `scripts/data/cbh-mappings/war-of-the-realms.json` | `npm run cbh:prepare -- --only=war-of-the-realms`; `npm run cbh:resolve -- scripts/data/cbh-mappings/war-of-the-realms.json` |
| P04-T03 | `absolute-carnage` | `scripts/data/cbh-packets/absolute-carnage.json` | `scripts/data/cbh-mappings/absolute-carnage.json` | `npm run cbh:prepare -- --only=absolute-carnage`; `npm run cbh:resolve -- scripts/data/cbh-mappings/absolute-carnage.json` |
| P05-T02 | `empyre` | `scripts/data/cbh-packets/empyre.json` | `scripts/data/cbh-mappings/empyre.json` | `npm run cbh:prepare -- --only=empyre`; `npm run cbh:resolve -- scripts/data/cbh-mappings/empyre.json` |
| P05-T03 | `x-of-swords` | `scripts/data/cbh-packets/x-of-swords.json` | `scripts/data/cbh-mappings/x-of-swords.json` | `npm run cbh:prepare -- --only=x-of-swords`; `npm run cbh:resolve -- scripts/data/cbh-mappings/x-of-swords.json` |
| P05-T04 | `heroes-reborn-2021` | `scripts/data/cbh-packets/heroes-reborn-2021.json` | `scripts/data/cbh-mappings/heroes-reborn-2021.json` | `npm run cbh:prepare -- --only=heroes-reborn-2021`; `npm run cbh:resolve -- scripts/data/cbh-mappings/heroes-reborn-2021.json` |
| P06-T02 | `infinite-destinies` | `scripts/data/cbh-packets/infinite-destinies.json` | `scripts/data/cbh-mappings/infinite-destinies.json` | `npm run cbh:prepare -- --only=infinite-destinies`; `npm run cbh:resolve -- scripts/data/cbh-mappings/infinite-destinies.json` |
| P06-T03 | `last-annihilation` | `scripts/data/cbh-packets/last-annihilation.json` | `scripts/data/cbh-mappings/last-annihilation.json` | `npm run cbh:prepare -- --only=last-annihilation`; `npm run cbh:resolve -- scripts/data/cbh-mappings/last-annihilation.json` |
| P06-T04 | `x-men-inferno` | `scripts/data/cbh-packets/x-men-inferno.json` | `scripts/data/cbh-mappings/x-men-inferno.json` | `npm run cbh:prepare -- --only=x-men-inferno`; `npm run cbh:resolve -- scripts/data/cbh-mappings/x-men-inferno.json` |
| P07-T02 | `death-of-doctor-strange` | `scripts/data/cbh-packets/death-of-doctor-strange.json` | `scripts/data/cbh-mappings/death-of-doctor-strange.json` | `npm run cbh:prepare -- --only=death-of-doctor-strange`; `npm run cbh:resolve -- scripts/data/cbh-mappings/death-of-doctor-strange.json` |
| P07-T03 | `devils-reign` | `scripts/data/cbh-packets/devils-reign.json` | `scripts/data/cbh-mappings/devils-reign.json` | `npm run cbh:prepare -- --only=devils-reign`; `npm run cbh:resolve -- scripts/data/cbh-mappings/devils-reign.json` |
| P07-T04 | `reckoning-war` | `scripts/data/cbh-packets/reckoning-war.json` | `scripts/data/cbh-mappings/reckoning-war.json` | `npm run cbh:prepare -- --only=reckoning-war`; `npm run cbh:resolve -- scripts/data/cbh-mappings/reckoning-war.json` |
| P08-T02 | `judgment-day` | `scripts/data/cbh-packets/judgment-day.json` | `scripts/data/cbh-mappings/judgment-day.json` | `npm run cbh:prepare -- --only=judgment-day`; `npm run cbh:resolve -- scripts/data/cbh-mappings/judgment-day.json` |
| P08-T03 | `dark-web` | `scripts/data/cbh-packets/dark-web.json` | `scripts/data/cbh-mappings/dark-web.json` | `npm run cbh:prepare -- --only=dark-web`; `npm run cbh:resolve -- scripts/data/cbh-mappings/dark-web.json` |
| P08-T04 | `sins-of-sinister` | `scripts/data/cbh-packets/sins-of-sinister.json` | `scripts/data/cbh-mappings/sins-of-sinister.json` | `npm run cbh:prepare -- --only=sins-of-sinister`; `npm run cbh:resolve -- scripts/data/cbh-mappings/sins-of-sinister.json` |
| P09-T02 | `secret-empire` | `scripts/data/cbh-packets/secret-empire.json` | `scripts/data/cbh-mappings/secret-empire.json` | `npm run cbh:prepare -- --only=secret-empire`; `npm run cbh:resolve -- scripts/data/cbh-mappings/secret-empire.json` |
| P10-T02 | `hunt-for-wolverine` | `scripts/data/cbh-packets/hunt-for-wolverine.json` | `scripts/data/cbh-mappings/hunt-for-wolverine.json` | `npm run cbh:prepare -- --only=hunt-for-wolverine`; `npm run cbh:resolve -- scripts/data/cbh-mappings/hunt-for-wolverine.json` |
| P11-T02 | `fall-house-x-rise-powers-x` | `scripts/data/cbh-packets/fall-house-x-rise-powers-x.json` | `scripts/data/cbh-mappings/fall-house-x-rise-powers-x.json` | `npm run cbh:prepare -- --only=fall-house-x-rise-powers-x`; `npm run cbh:resolve -- scripts/data/cbh-mappings/fall-house-x-rise-powers-x.json` |
| P12-T02 | `one-world-under-doom` | `scripts/data/cbh-packets/one-world-under-doom.json` | `scripts/data/cbh-mappings/one-world-under-doom.json` | `npm run cbh:prepare -- --only=one-world-under-doom`; `npm run cbh:resolve -- scripts/data/cbh-mappings/one-world-under-doom.json` |

### Phase and Task Matrix

| Phase | Task | Owner | Exact output | Dependency | Completion evidence |
|-------|------|-------|--------------|------------|---------------------|
| P02 | P02-T01 | Central source owner | Frozen packets for Generations and X-Men Extermination | P01 | Both packets pass identity, boundary, count, anchor, and digest gates |
| P02 | P02-T02 | Lower-cost worker | `generations.json` mapping only | P02-T01 | Exact count-matched mapping or stop evidence |
| P02 | P02-T03 | Lower-cost worker | `x-men-extermination.json` mapping only | P02-T01 | Exact count-matched mapping or stop evidence |
| P02 | P02-T04 | Central reviewer | Current-library and peer reports for available pilot mappings | P02-T02 and P02-T03 outcomes | Complete coverage and explicit dispositions |
| P02 | P02-T05 | Central integrator | Passing pilot lists and shared records | P02-T04 | Up to two lists pass all repository, contract, provenance, sequence, and browser checks |
| P03 | P03-T01 | Central source owner | Frozen packets for Spider-Geddon, Age of X-Man, and Iron Man 2020 | At least one integrated and fully validated P02 list | Three packets pass admission gates |
| P03 | P03-T02 | Lower-cost worker | Spider-Geddon mapping only | P03-T01 | Exact mapping or stop evidence |
| P03 | P03-T03 | Lower-cost worker | Age of X-Man mapping only | P03-T01 | Exact mapping or stop evidence |
| P03 | P03-T04 | Lower-cost worker | Iron Man 2020 mapping only | P03-T01 | Exact mapping or stop evidence |
| P03 | P03-T05 | Central reviewer | Current-library and peer reports for available P03 mappings | P03-T02 through P03-T04 outcomes | Complete coverage and explicit dispositions |
| P03 | P03-T06 | Central integrator | Passing P03 lists and shared records | P03-T05 | Up to three lists pass all required checks |
| P04 | P04-T01 | Central source owner | Frozen packets for The War of the Realms and Absolute Carnage | At least one integrated and fully validated P02 list | Two packets pass admission gates |
| P04 | P04-T02 | Lower-cost worker | The War of the Realms mapping only | P04-T01 | Exact mapping or stop evidence |
| P04 | P04-T03 | Lower-cost worker | Absolute Carnage mapping only | P04-T01 | Exact mapping or stop evidence |
| P04 | P04-T04 | Central reviewer | Current-library and peer reports for available P04 mappings | P04-T02 and P04-T03 outcomes | Complete coverage and explicit dispositions |
| P04 | P04-T05 | Central integrator | Passing P04 lists and shared records | P04-T04 | Up to two lists pass all required checks |
| P05 | P05-T01 | Central source owner | Frozen packets for Empyre, X-Men: X of Swords, and Heroes Reborn | At least one integrated and fully validated P02 list | Three packets pass admission gates |
| P05 | P05-T02 | Lower-cost worker | Empyre mapping only | P05-T01 | Exact mapping or stop evidence |
| P05 | P05-T03 | Lower-cost worker | X-Men: X of Swords mapping only | P05-T01 | Exact mapping or stop evidence |
| P05 | P05-T04 | Lower-cost worker | Heroes Reborn mapping only | P05-T01 | Exact mapping or stop evidence |
| P05 | P05-T05 | Central reviewer | Current-library and peer reports for available P05 mappings | P05-T02 through P05-T04 outcomes | Complete coverage and explicit dispositions |
| P05 | P05-T06 | Central integrator | Passing P05 lists and shared records | P05-T05 | Up to three lists pass all required checks |
| P06 | P06-T01 | Central source owner | Frozen packets for Infinite Destinies, The Last Annihilation, and X-Men Inferno | At least one integrated and fully validated P02 list | Three packets pass admission gates |
| P06 | P06-T02 | Lower-cost worker | Infinite Destinies mapping only | P06-T01 | Exact mapping or stop evidence |
| P06 | P06-T03 | Lower-cost worker | The Last Annihilation mapping only | P06-T01 | Exact mapping or stop evidence |
| P06 | P06-T04 | Lower-cost worker | X-Men Inferno mapping only | P06-T01 | Exact mapping or stop evidence |
| P06 | P06-T05 | Central reviewer | Current-library and peer reports for available P06 mappings | P06-T02 through P06-T04 outcomes | Complete coverage and explicit dispositions |
| P06 | P06-T06 | Central integrator | Passing P06 lists and shared records | P06-T05 | Up to three lists pass all required checks |
| P07 | P07-T01 | Central source owner | Frozen packets for The Death of Doctor Strange, Devil's Reign, and Reckoning War | At least one integrated and fully validated P02 list | Three packets pass admission gates |
| P07 | P07-T02 | Lower-cost worker | The Death of Doctor Strange mapping only | P07-T01 | Exact mapping or stop evidence |
| P07 | P07-T03 | Lower-cost worker | Devil's Reign mapping only | P07-T01 | Exact mapping or stop evidence |
| P07 | P07-T04 | Lower-cost worker | Reckoning War mapping only | P07-T01 | Exact mapping or stop evidence |
| P07 | P07-T05 | Central reviewer | Current-library and peer reports for available P07 mappings | P07-T02 through P07-T04 outcomes | Complete coverage and explicit dispositions |
| P07 | P07-T06 | Central integrator | Passing P07 lists and shared records | P07-T05 | Up to three lists pass all required checks |
| P08 | P08-T01 | Central source owner | Frozen packets for Judgment Day, Dark Web, and Sins of Sinister | At least one integrated and fully validated P02 list | Three packets pass admission gates |
| P08 | P08-T02 | Lower-cost worker | Judgment Day mapping only | P08-T01 | Exact mapping or stop evidence |
| P08 | P08-T03 | Lower-cost worker | Dark Web mapping only | P08-T01 | Exact mapping or stop evidence |
| P08 | P08-T04 | Lower-cost worker | Sins of Sinister mapping only | P08-T01 | Exact mapping or stop evidence |
| P08 | P08-T05 | Central reviewer | Current-library and peer reports for available P08 mappings | P08-T02 through P08-T04 outcomes | Complete coverage and explicit dispositions |
| P08 | P08-T06 | Central integrator | Passing P08 lists and shared records | P08-T05 | Up to three lists pass all required checks |

### Routine Delivery Validation

* Worker validation is limited to packet digest, exact row resolution, expected count, uniqueness, and
  zero placeholders.
* Reviewer validation recomputes complete current-library and peer coverage from live inputs.
* Integrator validation runs focused semantic checks, lint, the full Node test suite, anchors, the live
  contract when issue ids are added, and browser checks of each card and first, middle, and final issue.
* No later candidate creates a new test file or candidate-specific code branch.
* P02 exits successfully only when P02-T05 integrates and fully validates at least one pilot list.
  If both candidates stop, P03 through P12 remain blocked and the planning parent must amend the
  pilot or P01/P02 from the recorded failure evidence.

## P09 to P12: Isolated strong-review chunks

### Context

Secret Empire and Hunt for Wolverine have source-boundary complexity that must be resolved before a
lower-cost worker receives rows. Fall and Rise of X and One World Under Doom reach the finished
metadata horizon and must not invent missing issue identities. Isolation keeps these decisions out
of routine chunks and prevents one failed candidate from delaying passing peers.

### Task Details

| Phase and task | Owner and exact output | Dependency | Completion evidence | Stop condition |
|----------------|------------------------|------------|---------------------|----------------|
| P09-T01 | Strong central reviewer; Secret Empire packet or immediate `blocked` record | Successful P02 exit | Exact packet, or `blocked` with reason, evidence, and route owner | More than one defensible boundary remains or the source cannot support exact rows |
| P09-T02 | Lower-cost worker; Secret Empire mapping only, or recorded not applicable | Recorded P09-T01 outcome | Exact mapping and expected count, or not applicable after source stop | Any shared worker stop condition |
| P09-T03 | Central reviewer; complete report, `blocked` relationship outcome, or recorded not applicable | Recorded P09-T01 and P09-T02 outcomes | Every current order compared and disposed, or not applicable after earlier stop | Any shared reviewer stop condition |
| P09-T04 | Central integrator; shipped or `blocked` terminal record | Recorded P09-T01 through P09-T03 outcomes, including stops | Full delivery evidence or `blocked` reason, evidence, and route owner; skipped work is not applicable | A task outcome is missing rather than explicitly stopped or not applicable |
| P10-T01 | Strong central reviewer; Hunt for Wolverine packet or immediate `blocked` record | Successful P02 exit | Exact packet, or `blocked` with reason, evidence, and route owner | More than one defensible boundary remains or the source cannot support exact rows |
| P10-T02 | Lower-cost worker; Hunt for Wolverine mapping only, or recorded not applicable | Recorded P10-T01 outcome | Exact mapping and expected count, or not applicable after source stop | Any shared worker stop condition |
| P10-T03 | Central reviewer; complete report, `blocked` relationship outcome, or recorded not applicable | Recorded P10-T01 and P10-T02 outcomes | Every current order compared and disposed, or not applicable after earlier stop | Any shared reviewer stop condition |
| P10-T04 | Central integrator; shipped or `blocked` terminal record | Recorded P10-T01 through P10-T03 outcomes, including stops | Full delivery evidence or `blocked` reason, evidence, and route owner; skipped work is not applicable | A task outcome is missing rather than explicitly stopped or not applicable |
| P11-T01 | Strong central reviewer; Fall and Rise of X packet or immediate `blocked` record | Successful P02 exit | Every row is inside the snapshot and all packet gates pass, or `blocked` with reason, evidence, and owner | Any row requires invented or unavailable metadata |
| P11-T02 | Lower-cost worker; Fall and Rise of X mapping only, or recorded not applicable | Recorded P11-T01 outcome | Exact mapping and expected count, or not applicable after source stop | Any shared worker stop condition |
| P11-T03 | Central reviewer; complete report, `blocked` relationship outcome, or recorded not applicable | Recorded P11-T01 and P11-T02 outcomes | Every current order compared and disposed, or not applicable after earlier stop | Any shared reviewer stop condition |
| P11-T04 | Central integrator; shipped or `blocked` terminal record | Recorded P11-T01 through P11-T03 outcomes, including stops | Full delivery evidence or `blocked` reason, evidence, and route owner; skipped work is not applicable | A task outcome is missing rather than explicitly stopped or not applicable |
| P12-T01 | Strong central reviewer; One World Under Doom packet or immediate `blocked` record | P01 and recorded P08 outcomes | The live 86-row source boundary, repeated Fantastic Four (2025) #1 row, and every API-missing issue are preserved in a valid exact packet or evidence-backed terminal blocker | Any row must be removed, duplicated identity accepted, or unavailable metadata invented to admit the packet |
| P12-T02 | Lower-cost worker; One World Under Doom mapping only, or recorded not applicable | Recorded P12-T01 outcome | Exact mapping and expected count, or not applicable after source stop | Any shared worker stop condition |
| P12-T03 | Central reviewer; complete report, `blocked` relationship outcome, or recorded not applicable | Recorded P12-T01 and P12-T02 outcomes | Every current order and available peer mapping compared and disposed, or not applicable after earlier stop | Any shared reviewer stop condition |
| P12-T04 | Central integrator; shipped or `blocked` terminal record | Recorded P12-T01 through P12-T03 outcomes, including stops | Full delivery evidence or `blocked` reason, evidence, and route owner; skipped work is not applicable | A task outcome is missing rather than explicitly stopped or not applicable |

## P13: Queue reconciliation

### Context

The maintained inventory, not a conversational checklist, owns the final status of the 23 selected
candidates. P13 does not force every list to ship. It proves that each candidate is shipped
or `blocked` with a specific reason, evidence pointer, and route owner, and that no stale `pending`
state remains.

### Task Details

| Task | Owner and likely targets | Dependencies | Completion evidence | Stop condition |
|------|--------------------------|--------------|---------------------|----------------|
| P13-T01 | Central integrator; `scripts/data/cbh-modern-inventory.json` and all phase evidence | P02 through P12 | Every selected id is `shipped` or `blocked`; every blocked record has a specific reason, evidence pointer, and route owner | Any candidate outcome exists only in conversation or temporary output |
| P13-T02 | Central tester; existing `test/cbh-modern-inventory.test.js` | P13-T01 | Exactly one new assertion, proven to fail against the pre-reconciliation inventory, reports zero of the 23 selected ids as `pending` and preserves unrelated records | The test silently changes the queue, accepts an unknown state, or was not seen to fail before reconciliation |
| P13-T03 | Central integrator; `docs/MAINTAINING.md`, `docs/DATA_PROVENANCE.md`, `PRODUCT_BACKLOG.md`, `CHANGELOG.md`, and final gates | P13-T02 | Documents match final behavior and counts; lint, tests, anchors, and applicable live and browser checks pass | Any record claims a list shipped without matching catalog evidence |

### Implementation Evidence

P13-T01 through P13-T03 are complete. All 23 selected inventory records are terminal: 20 shipped
and three blocked. The single aggregate assertion was observed failing with 22 pending candidates
against the pre-reconciliation inventory and passes with zero pending after restoration. Final
reports bind all 20 admitted mappings to one stable 86-list catalog snapshot, cover 1,700
relationships, and retain four directional partial results for explicit approval. The final
repository, live-contract, anchor, and consolidated browser gates all pass.

## Change Limits

| Item | Limit |
|------|-------|
| File removals | None |
| New scripts | 0 |
| New runtime dependencies | 0 |
| New logical data schemas | At most 1 frozen candidate-packet schema |
| New test files | 0 |
| New semantic test cases | At most 12: at most 11 owned by P01 and exactly 1 owned by P13-T02 |
| Maximum catalog additions | 23, restricted to the original pending ids plus `one-world-under-doom` in the worker dispatch table |
| Per-candidate code branches | 0 after P01 |
| Lists integrated in one chunk | At most 3 |

## Canonical and Generated Targets

* Canonical: the modern inventory, frozen source packets, candidate mappings, approved overlap reports
  and dispositions, curated order Markdown, and curated-list manifest.
* Generated: browser order JSON and catalog payloads derived by existing repository commands.
* Semantic coverage: packet validation, exact mapping, comparison completeness, relationship policy,
  stale evidence, and sequence fidelity.
* Regression coverage: all existing resolver, batch, inventory, overlap, API, model, count, lint,
  anchor, live contract, and browser checks.

## Assumptions and Escalation Rules

* Queue completion means every selected record becomes shipped or `blocked` with a specific
  reason, evidence pointer, and route owner. It does not mean forcing every candidate into the catalog.
* Approved subsets require central authority. Exact duplicates have no approval path.
* Chronology insertion anchors are source-owner decisions frozen before worker dispatch.
* A failed candidate leaves passing peers eligible for integration.
* Any material change to source boundary, row order, manifest proposal, mapping sequence, current
  library, or overlap disposition invalidates downstream approval and requires regeneration.

## Inventory State Transitions

| Implementation outcome | Terminal inventory transition and required evidence |
|------------------------|-----------------------------------------------------|
| Source identity, visible boundary, chronology, or metadata admission stops | Set `deliveryStatus` to `blocked`; reason names the unresolved source or metadata decision; record the supporting artifact and central source-review owner |
| Mapping has unmatched, ambiguous, count-mismatched, unauthorized, or placeholder rows | Set `deliveryStatus` to `blocked`; reason names the affected rows and resolver outcome; record the mapping and stronger metadata-review owner |
| Relationship is exact | Set `deliveryStatus` to `blocked`; reason names the duplicate catalog id and report; no approval path |
| Subset or partial relationship lacks required approval | Set `deliveryStatus` to `blocked`; reason names the relationship, compared order, and missing decision; record the report and central relationship-review owner |
| Candidate-specific integration or validation fails | Set `deliveryStatus` to `blocked`; reason names the failed gate and evidence; record the integration owner |
| Candidate passes all delivery checks | Set `deliveryStatus` to `shipped` and record its catalog id |
| Downstream task cannot run because an earlier stop already made the record terminal | Record the task outcome as not applicable; do not create placeholder packet, mapping, or report data |

## Final Queue

| Chunk | Candidate lists | Planning basis |
|-------|-----------------|----------------|
| A | Generations; X-Men Extermination | Compact pilot: 10 and 9 source-order items after explicit section freeze |
| B | Spider-Geddon; Age of X-Man; Iron Man 2020 | Explicit checklists with 25, 32, and 18 source-order items |
| C | The War of the Realms; Absolute Carnage | Routine 2019 event pair |
| D | Empyre; X-Men: X of Swords; Heroes Reborn | 2020-2021 historical events |
| E | Infinite Destinies; The Last Annihilation; X-Men Inferno | 2021 event group |
| F | The Death of Doctor Strange; Devil's Reign; Reckoning War | Late 2021 through mid-2022 |
| G | Judgment Day; Dark Web; Sins of Sinister | 2022-2023 events |
| H | Secret Empire | Isolated source-complex review |
| I | Hunt for Wolverine | Isolated source-complex review |
| J | Fall of the House of X and Rise of the Powers of X | Isolated metadata-horizon review |
| K | One World Under Doom | Isolated source-identity and metadata-horizon review after P08 |

Chunk admission remains conditional until each candidate has a frozen source boundary, exact mapping,
metadata coverage, and current-library relationship. A candidate may move to `blocked` with evidence
without pulling passing peers out of the queue.
