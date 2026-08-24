<!-- markdownlint-disable-file -->
# RPI Phase Details: Repeated source occurrences and Iron Man

## Metadata

* Task ID: MRT-002-C09-DUP
* Task slug: repeated-source-occurrences
* Related plan: .copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md;
  historical commits `06c2a5b6d6367706d241fcbefe41ce71aaa08f02` and
  `8a3c8629253e079e117fc7218b5b9bc8a070d876`
* Baseline: current project default `main` at `b9367d8bdf40cf335caf1c6b2d46dfedb5e25826`

## Phase Index

| Phase ID | Name | Status | Detail sections |
|---|---|---|---|
| P01 | Implement the shared occurrence contract | complete | P01, P01-T01, P01-T02, P01-T03 |
| P02 | Preserve the exact Iron Man blocker | complete | P02, P02-T01 |
| P03 | Document and prove the shared release | complete | P03, P03-T01, P03-T02 |
| P04 | Review and deliver the release | in progress | P04, P04-T01, P04-T02, P04-T03 |

## Task-Level Context

### Context

Research selected an optional flat repeated-reference ledger at the frozen-packet seam. P01 now
implements that model for CBH and CBRO, migrates Groot from 84 source occurrences to 76 canonical
issues, preserves all existing output identities, and proves Iron Man 815/813, Old Man Logan 98/96,
and Planet Hulk 109/104 shapes.

Iron Man was conditionally authorized only if all 813 distinct issues resolved exactly. That gate is
closed. The accepted source requires Crimson Dynamo #1-4, Iron Man: Viva Las Vegas #3-4, and Iron Man
Legacy #2, #5, and #10. The configured metadata contract cannot resolve those nine issues. Current
scope therefore ships the shared contract and Groot migration without an Iron Man product file.

### Intent

Complete one fail-closed source-occurrence feature, preserve the exact Iron Man blocker instead of
shortening its source, prove unchanged product behavior, and deliver the bounded shared release
through one Review, PR, hosted CI, and merge.

### Boundaries

* Included: shared packet schema, source-position reconstruction, mapping freshness, provider
  compatibility, approval derivation, conditional Markdown provenance, Groot migration, Iron Man
  blocker evidence, direct records, tests, gates, browser checks, one Review, PR, CI, merge, and
  durable completion.
* Excluded: Iron Man, Old Man Logan, or Planet Hulk cards; any new product data file; parsers;
  inferred issues; scored metadata; exceptions; unique-id relaxation; runtime dependencies;
  unrelated cleanup; second critique; and second Review.

### Current Evidence and Readiness

* Research status: Complete and Ready.
* Sole critique: Complete; PC-001 through PC-003 resolved.
* P01 focused tests: 34 passed, 0 failed.
* P01 no-fix proof: implementation stash made the focused suite exit 1 with three failures; restored
  implementation returned all 34 tests to passing.
* Groot: 84 occurrences, 76 canonical mapping rows, eight exact repeated references, unchanged
  selected ids and factual relationships.
* Catalog remains: 96 readings, 13 Character Spotlight readings, 12 stories, and 4 Complete guides.
* Active blocker: Iron Man publication only; the shared release is not blocked.

### Locked Test and Change Boundary

* Exact removals: none.
* New product data files: zero.
* New test files: zero.
* Shared guard owner: `test/cbh-batch.test.js`.
* Character compatibility owner: `test/cbh-character-spotlight.test.js`.
* Historical provider owner: `test/cbro-historical-events.test.js`.
* Catalog owners change only if unchanged-count assertions require direct updates.
* Browser conditions: installed Edge at 1280x900 and 390x844.

### Unresolved Items

* None for the shared release.
* Iron Man remains a later product blocker until all nine missing source-required issues can resolve.

<!-- rpi:phase id=P01 -->
## P01: Implement the shared occurrence contract

### Context

The original contract had one packet row per output comic, chained freshness digests, and strong
mapping, overlap, and authoring uniqueness, but no machine-readable way to retain later source
mentions. Groot stored eight required mentions as exclusion prose.

### Intent

Add occurrence evidence at the packet freshness root without moving duplicates into canonical rows
or weakening downstream identity guards.

### Boundaries

* Included: optional packet and mapping fields, strict record validation, always-on canonical packet
  uniqueness, full-source position reconstruction, source counts, digest mirrors, approval-time
  derivation, CBRO compatibility, conditional provenance, Groot migration, exact fixtures, and
  failure proofs.
* Excluded: selected-id filtering, source parsing, candidate publication, and unrelated schema work.

### Likely Targets

* `scripts/lib/cbh-inventory.mjs`
* `scripts/prepare-cbh-batch.mjs`
* `scripts/prepare-cbro-event.mjs`
* `scripts/lib/cbro-evidence.mjs`
* `scripts/author-cbh-packet.mjs`
* `scripts/author-cbro-packet.mjs`
* Existing Groot packet, mapping, report, and order Markdown
* Existing shared, character, and historical-provider tests

### Dependencies

* Complete Research and dispositioned sole critique.

### Validation Expectations

* Current no-repeat CBH and CBRO evidence remains valid.
* Intended repeated shapes reconstruct exact first-source positions.
* Accidental duplicates, malformed records, stale evidence, and self-consistent derived-value
  tampering fail.
* Groot output sequence and product surfaces remain unchanged.

### Completion Evidence

* Complete. 34 focused tests pass and no-fix proof exits 1.

### Unresolved Items

* None.

<!-- rpi:task id=P01-T01 -->
### P01-T01: Add packet occurrence validation and digest plumbing

#### Context

The packet digest already hashes all accepted fields, but the validator did not allow or validate
occurrence evidence.

#### Intent

Keep canonical packet rows unique and give every later source mention an exact position and earlier
canonical target.

#### Boundaries

* Included: paired optional fields, exact allowed and required record fields, occurrence total,
  ordered unique positions, backward target, normalized identity match, canonical reconstruction,
  always-on canonical identity uniqueness, and mapping digest fields.
* Excluded: schema-version bump, parser, resolution changes, or output filtering.

#### Likely Targets

* `scripts/lib/cbh-inventory.mjs`
* `test/cbh-batch.test.js`

#### Dependencies

* Research selected recommendation.

#### Validation Expectations

* Half-present fields, empty ledger, count mismatch, position and target failures, identity mismatch,
  missing/empty/invalid/extra fields, and unannotated canonical duplicates fail.
* No-repeat packets retain index-based positions and old digest meaning.

#### Completion Evidence

* Complete in the shared focused suite.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Propagate provider, approval, and Markdown provenance

#### Context

Preparation and authoring needed occurrence mirrors, occurrence-total source counts, exact derived
position checks, and conditional provenance.

#### Intent

Carry occurrence evidence through both providers while keeping canonical output unchanged.

#### Boundaries

* Included: reconstructed mapping positions, mapping mirrors, occurrence-total
  `approvedSourceCount`, mapping digest selection, packet-to-mapping equality, approval-time
  re-derivation, CBRO inventory fallback, and one conditional Markdown sentence.
* Excluded: report set logic, disposition policy, selected-id guards, payload shape, and no-repeat
  Markdown changes.

#### Likely Targets

* CBH and CBRO preparation, validation, approval, and authoring modules
* Shared and historical-provider tests

#### Dependencies

* P01-T01.

#### Validation Expectations

* Self-consistently re-digested wrong mapping positions and approved source counts fail for both
  providers.
* No-repeat Markdown stays unchanged.
* Repeated Markdown names total occurrences, repeat count, and first-occurrence output.

#### Completion Evidence

* Complete in the shared focused suite.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T03 -->
### P01-T03: Migrate Groot and prove all occurrence shapes

#### Context

Groot has eight later Annihilators references after 71 canonical source occurrences. They occupy
source positions 72-79 and target canonical rows 8-15.

#### Intent

Replace prose-only repeat treatment with exact evidence and prove every supplied blocker shape.

#### Boundaries

* Included: Groot packet/mapping/report/approval/Markdown refresh and in-memory exact Iron Man, Old
  Man Logan, and Planet Hulk fixtures.
* Excluded: Groot selected-id, relationship, payload, card, catalog, or inventory lifecycle changes;
  product files for the three deferred candidates.

#### Likely Targets

* Existing Groot evidence and three existing test owners

#### Dependencies

* P01-T01 and P01-T02.

#### Validation Expectations

* Groot canonical row 72 maps to source position 80.
* Iron Man canonical row 710 stays at position 710 and row 716 maps to position 718.
* Groot retains the same 76 selected ids and three factual partial relationships.

#### Completion Evidence

* Complete. Packet digest
  `b9cd22d29d38539fa16d44d15db0cea8108ad414319828c0108845d0f3d267c7`;
  mapping digest `8f693cbf39f09350230965373d28a9bf3cb4fc34175ed848b751778a41d16523`;
  report digest `a83bdf4ba3b9bfcee2524abe830219d9754b82d5c637f49191a313c19052870f`;
  approval digest `b4acc491b8240f8b9343fba015e3891ad7a0dca9c996f765a93e130515f37e54`.

#### Unresolved Items

* None.

<!-- rpi:phase id=P02 -->
## P02: Preserve the exact Iron Man blocker

### Context

The source ledger is exact at 815 occurrences and 813 distinct issue identities. Publication was
authorized only if all 813 mapped exactly. Targeted configured-metadata checks found nine
source-required gaps before any candidate packet was frozen.

### Intent

Record the genuine publication blocker and keep complete-looking Iron Man artifacts absent.

### Boundaries

* Included: exact source names and issue numbers, configured API results, inventory reason, changes
  evidence, follow-up, and absence assertions.
* Excluded: packet, mapping, report, order, payload, card, inferred replacement, shortened source,
  exception row, or overlap claim.

### Likely Targets

* `scripts/data/cbh-character-inventory.json`
* `test/cbh-character-spotlight.test.js`
* `.copilot-tracking/changes/2026-08-23/repeated-source-occurrences-changes.md`

### Dependencies

* P01 complete.

### Validation Expectations

* Source ledger still names Crimson Dynamo #1-4, Iron Man: Viva Las Vegas #1-4, and Iron Man Legacy
  #1-11.
* Configured search returns no Crimson Dynamo issue; Viva Las Vegas series 4850 contains only #1-2;
  Iron Man Legacy series 9347 omits #2, #5, and #10.
* No Iron Man candidate product or evidence file exists.

### Completion Evidence

* Exact API evidence, updated inventory blocker, absence assertions, and changes record.

### Unresolved Items

* None for this release. Metadata availability is the future clearing action.

<!-- rpi:task id=P02-T01 -->
### P02-T01: Verify and record unavailable source-required issues

#### Context

The first missing source identity is Crimson Dynamo #1 at canonical/source position 425. Eight more
gaps are confirmed in later ranges.

#### Intent

Close the conditional Iron Man release path honestly and preserve the full boundary.

#### Boundaries

* Included: the nine exact missing issue references, source count, repeat positions, candidate-file
  absence, inventory reason, and follow-up.
* Excluded: completing the remaining metadata map after the first definitive blockers, guessing
  series, or manufacturing candidate files.

#### Likely Targets

* Iron Man inventory record, Character Spotlight semantic owner, changes record

#### Dependencies

* P01.

#### Validation Expectations

* The inventory remains deferred and not applicable for delivery.
* Reason text names the exact blocker class and counts without claiming a complete mapping ran.
* Packet, mapping, overlap, order, payload, and catalog id remain absent.

#### Completion Evidence

* Focused blocker and absence test plus API evidence.

#### Unresolved Items

* None.

<!-- rpi:phase id=P03 -->
## P03: Document and prove the shared release

### Context

The shipped change is a maintainer-visible source contract and a provenance correction for Groot.
Product counts and selected comic sequences do not change.

### Intent

Align direct records with the actual shared release and prove local and browser behavior remains
stable.

### Boundaries

* Included: backlog, changelog, provenance, maintenance, publication, touched counts and anchors,
  full gates, live contract, dash and diff scans, and wide/narrow Edge checks.
* Excluded: Iron Man product docs or counts, unrelated cleanup, historical artifact rewrites, and
  committed browser tooling.

### Likely Targets

* `PRODUCT_BACKLOG.md`
* `CHANGELOG.md`
* `docs/DATA_PROVENANCE.md`
* `docs/MAINTAINING.md`
* `docs/PUBLICATION_RUNBOOK.md`
* `docs/anchors.lock.json`
* Existing tests only

### Dependencies

* P02 complete.

### Validation Expectations

* Direct records describe the explicit occurrence model, Groot 84/76, and Iron Man blocker.
* Catalog stays at 96 readings; Character Spotlight stays 13 readings / 12 stories / 4 Complete
  guides.
* All required local and browser checks pass with exact results.

### Completion Evidence

* Updated records, full validation, browser observations, and changes evidence.

### Unresolved Items

* None.

<!-- rpi:task id=P03-T01 -->
### P03-T01: Update direct records and blocker state

#### Context

The feature changes how maintainers record repeated source evidence and corrects Groot provenance.

#### Intent

Make every directly affected record agree without claiming an Iron Man release.

#### Boundaries

* Included: one backlog item/status, Unreleased changelog, source provenance, maintenance and
  publication instructions, touched count claims, citations, and anchor lock.
* Excluded: unrelated documents, stale count copying, or product-facing Iron Man entry.

#### Likely Targets

* Direct records listed at phase level

#### Dependencies

* P02-T01.

#### Validation Expectations

* All touched counts are re-derived.
* No product documentation points into `.copilot-tracking/`.
* Added prose has no em or en dash.

#### Completion Evidence

* Direct diff, count check, dash scan, and final anchors cycle.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Prove the release locally and in installed Edge

#### Context

Repository gates plus real Edge checks establish that the shared change did not alter product
behavior.

#### Intent

Produce complete pre-Review evidence.

#### Boundaries

* Included: targeted/full tests, lint, counts, anchors report/re-aim/bless/final cycle, publication,
  release, live contract, dash/diff checks, and Edge at 1280x900 and 390x844.
* Excluded: sandboxed webview, committed `puppeteer-core`, suppressed output, or unread anchor bless.

#### Likely Targets

* Existing scripts, tests, and temporary browser evidence only

#### Dependencies

* P03-T01.

#### Validation Expectations

* All gates pass.
* Edge shows unchanged shelf/filter counts, Groot remains in All and Complete only, and no horizontal
  overflow appears.
* Temporary files and processes are removed.

#### Completion Evidence

* Exact gate counts and browser observations in the changes record.

#### Unresolved Items

* None.

<!-- rpi:phase id=P04 -->
## P04: Review and deliver the release

### Context

The caller authorized current-main reconciliation, one independent Review on the reconciled
candidate, one PR, hosted CI, merge, and durable completion.

### Intent

Reconcile and refresh evidence, obtain one independent quality judgment, and merge only the bounded
shared feature.

### Boundaries

* Included: reconciliation before Review, affected gates, one Review, in-scope blocker fixes,
  unrelated finding routing, commit trailer, plain-English-first PR, final no-drift fetch, Node 20,
  Node 24, lint jobs, merge, post-merge PR comment, and parent completion record.
* Excluded: repeated Review, unrelated fixes, destructive git commands, suppressed output, or merge
  with material findings.

### Likely Targets

* `.copilot-tracking/changes/2026-08-23/repeated-source-occurrences-changes.md`
* `.copilot-tracking/reviews/logs/2026-08-23/repeated-source-occurrences-review.md`
* Bounded implementation files when Review requires a material fix

### Dependencies

* P03 complete.

### Validation Expectations

* Reconciliation and affected gates precede Review.
* One Review records all findings and dispositions.
* Final fetch is a no-drift stop gate.
* Node 20, Node 24, and lint job conclusions pass.

### Completion Evidence

* Review log, commit SHA, PR, hosted jobs, merge SHA, post-merge comment, default-branch verification,
  and parent handoff.

### Unresolved Items

* None unless reconciliation or Review exposes a genuine blocker.

<!-- rpi:task id=P04-T01 -->
### P04-T01: Reconcile current main and refresh final evidence

#### Context

Counts, anchors, and tracked evidence depend on current main.

#### Intent

Create the final review candidate and rerun affected checks.

#### Boundaries

* Included: visible fetch, safe reconciliation, count and anchor refresh, affected gates, and changes
  evidence.
* Excluded: Review itself, destructive git commands, hidden output, or PR.

#### Likely Targets

* Bounded implementation and evidence files

#### Dependencies

* P03.

#### Validation Expectations

* Branch contains current main.
* Shared, Groot, blocker, count, and anchor evidence remains correct.

#### Completion Evidence

* Reconciled commit identity and exact gate results.

#### Unresolved Items

* None unless reconciliation changes the contract evidence.

<!-- rpi:task id=P04-T02 -->
### P04-T02: Run one independent Review and route findings

#### Context

Validation, freshness, and recovery paths need one adversarial review.

#### Intent

Find material defects once and resolve or route them without looping.

#### Boundaries

* Included: full diff, occurrence model, provider compatibility, Groot migration, failure proofs,
  Iron Man blocker, docs, tests, and release evidence.
* Excluded: style-only findings, unrelated fixes, or second Review.

#### Likely Targets

* Review log and bounded implementation files

#### Dependencies

* P04-T01.

#### Validation Expectations

* No material in-scope finding remains open.
* Any fix reruns affected gates and updates changes evidence.

#### Completion Evidence

* One review log and final disposition.

#### Unresolved Items

* None after disposition.

<!-- rpi:task id=P04-T03 -->
### P04-T03: Open the PR, pass CI, and merge

#### Context

Pre-merge artifacts cannot contain the future merge SHA, so post-merge identity belongs in the PR
record and parent completion state.

#### Intent

Deliver one CI-green merged shared release.

#### Boundaries

* Included: final no-drift fetch, non-interactive commit with co-author trailer, PR beginning
  `## In plain English`, exact verification counts, push, job-level CI inspection, merge,
  default-branch confirmation, post-merge PR comment, and parent message.
* Excluded: new implementation after Review, destructive git commands, hidden failures, or merge
  while CI is blocked.

#### Likely Targets

* Final bounded diff, PR record, and parent completion state

#### Dependencies

* P04-T02.

#### Validation Expectations

* Commit trailer is exact.
* PR plain English names no file, identifier, command, or backlog id.
* Node 20, Node 24, and lint jobs pass.
* Merge commit contains the bounded feature.

#### Completion Evidence

* Commit SHA, PR URL, CI jobs, merge SHA, post-merge comment, and parent message.

#### Unresolved Items

* None unless final fetch or hosted CI blocks delivery.
