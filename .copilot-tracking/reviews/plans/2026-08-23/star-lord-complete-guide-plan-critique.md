<!-- markdownlint-disable-file -->
# RPI Plan Critique: Star-Lord complete guide

## Metadata

* Task ID: MRT-002-C08
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/star-lord-complete-guide-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/star-lord-complete-guide-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: One and only final-candidate critique of the single Star-Lord
  release plan. Controlling caller requirements are user priority rank 15; a sequential separate
  release after merged pull request 176; exactly 99 issues in source order; fresh packet, mapping,
  current-library, peer, report and approval digests; Rocket and Groot as named peers; no edits to
  existing guides; no parser and no inferred metadata; complete-guide taxonomy; exact filter and
  chronology proof; fail-without-fix proof; all listed gates; exactly one later Review; and PR,
  hosted CI, and merge.
* Research and evidence considered: .copilot-tracking/research/2026-08-23/star-lord-complete-guide-research.md,
  .copilot-tracking/research/subagents/2026-08-23/star-lord-source-verification.md, and the exact
  repository paths those artifacts and the plan cite: scripts/data/cbh-character-inventory.json,
  scripts/lib/cbh-inventory.mjs, scripts/report-order-overlap.mjs, scripts/author-cbh-packet.mjs,
  scripts/data/cbh-packets/groot-reading-order.json, scripts/data/cbh-mappings/groot-reading-order.json,
  scripts/data/cbh-mappings/rocket-raccoon-reading-order.json, src/data/curated-lists.json,
  src/data/catalog.json, src/data/groot_reading_order.json, test/catalog-shelves.test.js,
  test/cbh-character-spotlight.test.js, and package.json.
* Decisions, dependencies, and acceptance criteria considered: the split-release decision, the
  accepted twelve-block source boundary with 99 rows, the two named peers, the ungrouped
  complete-guide taxonomy, insertion before xmen-claremont, the freshness and stale-rejection
  contracts, the locked change and test boundaries, and the delivery chain of one critique, one
  Review, PR, CI, and merge.
* Assessment boundary: the critique can conclude whether the planned evidence chain would actually
  detect the failures it claims to detect, whether the stated counts and baselines match the current
  tree, and whether the named gates and owners exist. It cannot conclude anything about metadata
  identities that only the live resolver can produce, and it did not fetch the external source.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| Rank 15 and separate sequential release | Covered | Plan User Decisions and Goals carry rank 15 and the separate release; the Star-Lord inventory record already holds the source identity and a deferral reason that the release must retire (PC-003). |
| Baseline is merged pull request 176 | Covered | Repository history confirms 233c463 is the merge commit of pull request 176 for the Groot guide, and it is the current tip of origin/main. |
| Exactly 99 issues in source order | Partial | The count and the block arithmetic reproduce cleanly, but the planned order proof is weaker than the shipped precedent and is blind to the one reordering the source invites (PC-001). |
| Fresh packet, mapping, library, peer, report, approval digests | Covered | Every digest named by the plan exists as a real contract in scripts/lib/cbh-inventory.mjs and is enforced by assertApprovedRelationshipReview in scripts/author-cbh-packet.mjs. |
| Rocket and Groot as named peers | Covered | buildReportForMapping accepts peer mapping paths, excludes peers from the library digest, and binds peerDigests, which is exactly the two-peer shape the plan assumes. |
| P02-T01 count of 96 comparisons | Covered | Independently reproduced: authorPacket builds expectedOrderIds from reviewed existing entries plus peers, so 96 manifest lists minus the 2 peers plus 2 peer comparisons is 96. |
| Rocket and Groot each share 25 issues | Covered | Independently reproduced from the shipped mappings: Guardians of the Galaxy (2008) numbers 1 to 25 is the only span Star-Lord shares with either peer, and it is present in both peer mappings in full. |
| All other current-library relationships | Partial | Only the two peer counts are pre-committed; every other relationship is pinned after the report is generated, which cannot fail (PC-004). |
| No existing-guide edits | Covered | P02-T02 requires diff-backed non-change evidence, and the authoring script independently refuses duplicate ids, outputs, and source files. |
| No parser, no inferred metadata | Covered | P01 boundaries exclude parser output and inferred rows, and the Marvel Super Special and free-comic-day notes are required as explicit reviewed notes. |
| Complete-guide taxonomy and filters | Covered | Current shelf test asserts best-of 5 and 5, complete-guide 4 and 4, other 4 and 3 across 13 readings and 12 stories, so the plan's post-release 14 and 13 with complete-guide 5 and 5 is arithmetically correct. |
| Chronology proof | Covered | The manifest orders rocket, then groot, then xmen-claremont, and the packet supplies its own insertionAnchor, so no shared constant needs editing. |
| Fail-without-fix proof | Covered | The plan requires stashing only the defended production files, observing failure, restoring, and rerunning, which matches the repository rule. |
| All listed gates | Partial | Named gates exist, but the committed browser gate is bypassed (PC-002), the anchors round does not stage new files first (PC-005), the dash scan method is unpinned (PC-006), and two named gates map to no command (PC-007). |
| Exactly one Review, then PR, CI, merge | Covered | P04 permits one Review, routes non-blocking findings, and requires reconciliation, required job conclusions, merge, and durable state. |
| Locked boundaries, removals, and test owners | Covered | Zero removals, five new production data files, zero new test files, and named existing owners are all consistent with the release shape. |
| Phase-level detail completeness | Partial | Three of four phase Context blocks still read as pending drafting in a plan declared a final candidate (PC-009). |

## Verdict

* Verdict: Revise
* Rationale: The plan is structurally sound, its counts and baseline reproduce exactly against the
  current tree, and its two headline relationship claims of 25 shared issues were independently
  confirmed. One high-severity gap is material: as written, the exact-sequence proof would pass on a
  guide whose issues are correct but whose order is wrong in the one span where the source is not in
  numeric order. Six further findings tighten evidence and gate execution. All are direct planner
  corrections and none requires a user decision.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: The exact-sequence proof cannot detect the one reordering the source invites

* Related IDs: P01-T01, Functional Requirement "Freeze all 99 source-defined whole issues in displayed order", Research W1 to W3
* Evidence: .copilot-tracking/details/2026-08-23/star-lord-complete-guide-phase-details.md P01-T01 Validation Expectations; .copilot-tracking/research/subagents/2026-08-23/star-lord-source-verification.md block sums and ordered sequence; test/cbh-character-spotlight.test.js, which pins Groot with a full expected sequence array and a literal expected source-blocks digest
* Concern: three defects compound. First, the pinned rows are ten start and end pairs covering 1 and
  12, 13 and 37, 38 and 47, 48 and 50, 51 and 58, 59 and 64, 65 and 77, 78 and 82, 83 and 87, 88 and
  99. The verification lane's own block arithmetic of 12, 25, 10, 3, 8, 6, 7, 6, 5, 5, 6, 6 puts
  block ends at 71 and 93 as well, so the claim to pin every source block boundary is false; and
  under the seventeen printed source bullets it is false at more points still. Second, source rows 66
  to 77 are displayed out of numeric order, as 1, 2, 4, 6, 8, 10 followed by 3, 5, 7, 9, 11, 12. A
  numeric sort of that span leaves row 65 and row 77 exactly where they are, so every pinned row
  still passes while twelve rows are silently in the wrong order. Third, the stated remedy that the
  packet's "fresh sequence digest represents the complete normalized ordered list" is self-computed
  from whatever rows exist and is therefore tautological, and the research's independently derived
  sequence hash 8e604a0e5f77a1d927be683aa5325da0ede70a658dacf9b7d0661f4213813aa8 is never named as
  the value the packet must reproduce.
* Impact: the release could ship 99 correct issues in the wrong reading order and pass the packet
  validator, the digest checks, the exact-sequence test, the filter tests, the chronology test, and
  every gate in P03-T02. Order is the entire product of a reading order, so this is a silent
  correctness failure in the one thing the guide exists to provide.
* Smallest useful change: replace the boundary-row list in P01-T01 with the shipped Groot pattern.
  Require a full 99-entry expected sequence literal in the semantic test, derived from the ordered
  list in the subagent artifact, plus a literal expected source-blocks digest asserted outside the
  packet, and record the research sequence hash in P01-T01 as the acceptance value the packet must
  reproduce.
* Action owner: planning parent
* Exact resolving evidence: P01-T01 Validation Expectations name a 99-entry expected sequence and a
  literal digest assertion, and P03-T01 shows a negative case in which reordering rows 66 to 77 into
  numeric order fails a named assertion.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-002 -->
### PC-002 [Medium]: The browser evidence plan bypasses the committed browser gate

* Related IDs: P03-T02, Locked Change and Test Boundaries, Non-Functional Requirement "Release evidence remains bounded and reviewable"
* Evidence: package.json scripts browser and browser:prove; scripts/browser-check.mjs header, which states that it exists because earlier browser evidence lived outside the tree and a clean clone could rerun none of it, and that it is the only place where a claim about what the interface does in a browser can be checked rather than argued
* Concern: the plan specifies a temporary non-committed script and requires the temporary browser
  files to be removed, and neither the plan nor the details name the committed browser gate anywhere
  in the gate list. The temporary route has a defensible reason, since the committed check
  deliberately stubs fixtures rather than the real catalog, but the plan neither runs the committed
  gate nor records why an additional script is needed.
* Impact: a release that changes catalog shelf composition would leave no rerunnable browser
  evidence and would skip an existing repository gate, which is the exact failure the committed
  script was written to end.
* Smallest useful change: add the committed browser gate to the P03-T02 gate list, and add one line
  stating that the temporary script exists only because the committed check runs against fixtures
  rather than the real catalog.
* Action owner: planning parent
* Exact resolving evidence: P03-T02 Validation Expectations name the committed browser gate alongside
  the temporary real-catalog script, with the reason for the second recorded.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-003 -->
### PC-003 [Medium]: The inventory record's known-stale digest and blocked status are outside the change boundary

* Related IDs: P02-T02, Acceptance Criteria "Inventory retains 128 identities", Research C1 and C2, W3
* Evidence: scripts/data/cbh-character-inventory.json Star-Lord record, which currently carries
  disposition deferred, a reason that defers the guide because of the Rocket overlap, empty
  overlapIds and catalogIds, deliveryStatus not-applicable, centralDisposition deferred, a
  sourceContentSha256 beginning 1870f303, sourceBoundaryStatus exact-page-snapshot, and
  metadataHorizonStatus blocked-exact-resolution-not-run; research W3, which proves the current
  rendered content is 22,513 characters hashing to a digest beginning fc6fe927
* Concern: the only inventory acceptance the plan states is that 128 identities are retained and
  Star-Lord is marked shipped with fresh overlap ids. Nothing requires the stale whole-page digest,
  the now-false deferral reason, or the blocked metadata status to advance. The record's identity
  count is verified at 128, so that half of the criterion is sound.
* Impact: the release would ship a durable maintained record asserting a source digest its own
  research disproved, and a deferral rationale contradicted by the guide sitting in the catalog.
* Smallest useful change: name sourceContentSha256, sourceBoundaryStatus, metadataHorizonStatus,
  disposition, reason, catalogIds, overlapIds, deliveryStatus, and centralDisposition in P02-T02 as
  the exact fields the release must advance.
* Action owner: planning parent
* Exact resolving evidence: P02-T02 Validation Expectations enumerate those fields, and the semantic
  test asserts the shipped record's digest equals the packet's fresh source evidence.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-004 -->
### PC-004 [Medium]: Only the two peer relationships are pre-committed; the rest are pinned after the fact

* Related IDs: P02-T01, P03-T01, Functional Requirement "Factual comparison and central approval cover the complete current library plus Rocket and Groot"
* Evidence: .copilot-tracking/details/2026-08-23/star-lord-complete-guide-phase-details.md P02-T01, which states that every additional non-none current-library relationship is asserted with its exact count after report generation
* Concern: an expectation written from the output it is supposed to check cannot fail, which is the
  same defect as a self-computed digest. An independent expectation is derivable now and was derived
  during this critique by intersecting the 99 source labels against all 96 shipped payloads: exactly
  three orders share issues with Star-Lord, namely the Rocket guide at 25, the Groot guide at 25, and
  war-of-kings at 7, all of them Guardians of the Galaxy (2008) issues, with 93 comparisons expected
  to be none. The war-of-kings figure is corroborated because the same order is already asserted as a
  7-issue partial of Groot in the shipped semantic test.
* Impact: a mapping that resolved one row to the wrong issue could add or drop a relationship, and
  the planned assertion would record the wrong value as the expected one and pass.
* Smallest useful change: record the expected non-none set as Rocket 25, Groot 25, war-of-kings 7,
  and 93 none, in P02-T01 Validation Expectations, to be confirmed against the freshly generated
  report rather than read out of it.
* Action owner: planning parent
* Exact resolving evidence: P02-T01 names that expected set before generation, and P03-T01 asserts it
  against the committed report.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-005 -->
### PC-005 [Medium]: The anchors round does not stage the new files before the first run

* Related IDs: P03-T02
* Evidence: .copilot-tracking/details/2026-08-23/star-lord-complete-guide-phase-details.md P03-T02, which requires re-aiming, reading every bless pairing, and a final report of zero drifted, zero new, and zero removed, but never stages the new files; repository instructions record that the anchors gate enumerates tracked files only, so a new file that has not been added is invisible locally and fails in CI; the repository ignore rules exclude the whole tracking directory, and the 154 tracking artifacts already in the index are there because they were force-added
* Concern: the release adds five new production data files plus a changes record and a review log,
  and P03-T02 names the changes record among its own targets. The tracking artifacts are ignored by
  default, so they need a forced add to become part of the corpus at all, and an anchors pass run
  before staging would report a clean tree while the hosted run disagreed.
* Impact: a green local gate followed by a red CI run, on the one gate whose recovery path is the
  most error-prone in this repository.
* Smallest useful change: add one line to P03-T02 requiring the new and changed files to be staged
  before the first anchors run.
* Action owner: planning parent
* Exact resolving evidence: P03-T02 Validation Expectations state that files are staged before the
  first anchors run and re-run after the bless.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-006 -->
### PC-006 [Low]: The dash scan method is unpinned, and the wrong form reports zero for every diff

* Related IDs: P03-T02, Non-Functional Requirement "Writing and anchors remain valid"
* Evidence: .copilot-tracking/details/2026-08-23/star-lord-complete-guide-phase-details.md P03-T02, which names a dash scan and a zero result but no method; repository instructions record a measured case in which the piped form printed 0 while the file-based form printed 8 on the same diff, because the shell re-encodes what crosses the pipe
* Concern: the plan's acceptance is a zero result, and the failure mode of the wrong method is
  exactly a zero result.
* Impact: constraint 11 could be breached in shipped copy with the gate reporting clean.
* Smallest useful change: pin the file-based form in P03-T02, writing the diff to a file and reading
  it back rather than piping it.
* Action owner: planning parent
* Exact resolving evidence: P03-T02 names the file-based dash scan explicitly.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-007 -->
### PC-007 [Low]: Two named gates have no command, and the counts gate is narrower than the plan implies

* Related IDs: P03-T02, User Decisions and Requirements gate list
* Evidence: package.json, whose scripts resolve lint, test, counts, anchors, sizes, palette,
  publication, contract, browser, and upgrade; scripts/check-counts.mjs, whose document constant
  scopes it to PRODUCT_BACKLOG.md and whose header states that its figures are all derived from the
  ranked table in that same file
* Concern: "release checks" and "diff inspection" name no command, so neither can be shown to have
  run. Separately, the plan updates counts in the changelog, the publication runbook, the provenance
  document, and the UX study, none of which the counts gate reads, so those figures are entirely
  hand-derived while the plan lists a counts gate among its protections.
* Impact: an unrunnable gate reads as coverage it does not provide, and a stale figure outside the
  backlog would survive every gate, which is the documented failure class in this repository.
* Smallest useful change: enumerate the exact gate commands in P03-T02, and add one line stating that
  the counts gate covers the backlog only, so figures in the other touched documents must be
  re-derived by hand.
* Action owner: planning parent
* Exact resolving evidence: P03-T02 lists the exact commands and the manual re-derivation note.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-008 -->
### PC-008 [Low]: Four Star-Lord-titled issues already shipped inside Groot will be absent from the Star-Lord guide

* Related IDs: P01-T01, P03-T02, Research contradictions, subagent Contrarian Findings
* Evidence: scripts/data/cbh-mappings/groot-reading-order.json, which contains the four issues of the
  2007 Annihilation Conquest Starlord miniseries;
  .copilot-tracking/research/subagents/2026-08-23/star-lord-source-verification.md, which records
  that the Star-Lord page links the same miniseries with no issue-bearing line and that including it
  would produce 103 rather than 99
* Concern: the exclusion is correct and evidence-backed, but it is recorded only in research and in
  the packet's excluded references. The plan's documentation task does not require it to be stated
  anywhere a reader of the product records would see it.
* Impact: the most likely objection at the single permitted Review, and the most likely user-visible
  oddity, would arrive with its answer stored only in a tracking artifact.
* Smallest useful change: require P03-T02 to state the exclusion and the inclusion rule behind it in
  one user-facing record, so the Review can confirm rather than reopen it.
* Action owner: planning parent
* Exact resolving evidence: P03-T02 Boundaries name the exclusion note as a required documentation
  output.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-009 -->
### PC-009 [Low]: Three of four phase Context blocks still read as pending in a final-candidate plan

* Related IDs: P02, P03, P04
* Evidence: .copilot-tracking/details/2026-08-23/star-lord-complete-guide-phase-details.md, whose P02, P03, and P04 phase Context sections read that task detail is pending final candidate drafting, and .copilot-tracking/plans/2026-08-23/star-lord-complete-guide-plan.md, whose planning status is final candidate and whose Critique Disposition row says targets are still being locked before dispatch
* Concern: the task-level detail under those phases is in fact complete, so the stale phase text is
  not a missing plan. It does conceal that state from a reader, and the Critique Disposition row now
  contradicts the plan it introduces.
* Impact: the single permitted Review, and any later reader reconstructing the decision, would have
  to determine which claim about readiness is current.
* Smallest useful change: replace the three phase Context lines with the actual phase context and
  update the Critique Disposition row to record this critique.
* Action owner: planning parent
* Exact resolving evidence: no phase Context block states pending drafting, and the disposition table
  names this critique and its findings.
* Decision route: direct planner correction

## Strengths and Residual Risk

* Every quantitative claim in the plan that could be checked against the current tree reproduces
  exactly. The baseline commit is the merge of pull request 176; the manifest holds 96 lists; the
  inventory holds 128 identities; the current shelf test asserts 13 readings across 12 stories with
  best-of 5 and 5, complete-guide 4 and 4, other 4 and 3, which makes the planned 14 and 13 with
  complete-guide 5 and 5 correct; and the 99-row block arithmetic sums correctly.
* The 96-comparison figure is not an estimate. The authoring script builds its expected order ids
  from reviewed existing entries plus named peers, so 96 lists minus 2 peers plus 2 peer comparisons
  is exactly 96, and the same script refuses any missing or duplicated disposition.
* The two headline relationship claims are independently confirmed. Guardians of the Galaxy (2008)
  numbers 1 to 25 is present in full in both peer mappings and is the only span either peer shares
  with the Star-Lord source list, so 25 and 25 is the arithmetically forced answer rather than an
  inherited number.
* The insertion anchor is carried in the packet itself and read from there by the authoring script,
  so publishing before xmen-claremont requires no edit to a shared constant. The plan's claim that
  no shared helper needs changing holds at this point.
* Residual risk, accepted by the workflow rather than by this plan: the semantic test pins a
  pre-publication library digest by excluding the candidate and its peers, so each future guide must
  add itself to that exclusion list. This is the established pattern already visible for the
  historical-event ids and is not a defect in this release.
* Residual risk: the metadata resolver must reproduce all 99 identities, including the free-comic-day
  row that the source numbers 1 and the metadata numbers 0. The plan correctly treats this as a
  fail-closed implementation gate rather than an assumption.

## Questions or Blocking Evidence Gaps

* None. No finding requires a user decision, and no decision-critical evidence was unavailable.

## Limitations

* The external source was not refetched. Claims about the live page, the archived snapshot, and the
  rendered-content digest are taken from the supplied research and subagent artifacts as recorded
  evidence rather than reverified.
* Metadata identities cannot be assessed here. Whether all 99 rows resolve exactly is deterministic
  implementation output, and the plan is right to gate on it.
* The expected non-none relationship set in PC-004 was derived by matching series titles and issue
  numbers across the shipped payloads. It is strong evidence for the three partners it names, but an
  issue recorded under an unexpected title could add one, so it is a pre-commitment to confirm rather
  than a substitute for the generated report.
* Two repository paths outside the artifacts' explicit citations were read to check that named gates
  exist: package.json and scripts/browser-check.mjs. This was bounded verification of the plan's own
  gate claims, not open-ended research.
* This critique deliberately carries no line-numbered citations. Tracking artifacts enter the index by
  a forced add, as the 154 already there did, and once one is tracked the evidence anchors gate
  collects its citations as live claims. Findings are therefore anchored to stable ids, headings, and
  symbol names instead.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: planning parent
* Smallest next action: revise P01-T01 and P03-T01 to require a full 99-entry expected sequence
  literal, a literal expected source-blocks digest, and the recorded research sequence hash as the
  acceptance value, then apply PC-002 through PC-009 as direct edits and finalize without a second
  critique.
* User response required: no
