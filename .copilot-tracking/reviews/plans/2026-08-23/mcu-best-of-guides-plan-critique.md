<!-- markdownlint-disable-file -->
# RPI Plan Critique: MCU best-of guides

## Metadata

* Task ID: MRT-004
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: One and only final-candidate critique for automatic RPI task MRT-004, slug mcu-best-of-guides. Settled user direction treated as authoritative and not reopened: all fourteen titles stay inventoried in exact user order; the first release is priorities 1 to 4 and 43 exact rows; every card lands under Marvel on Screen on the Hub; no new browse shelf or route; no Character Spotlight placement; type screen-companion and depth selected; reuse of guarded Comic Book Herald primitives; no collection inference; one plan critique; exactly one later post-implementation Review.
* Research and evidence considered: .copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md, .copilot-tracking/research/2026-08-23/mcu-best-of-source-boundaries.json, .copilot-tracking/research/2026-08-23/mcu-best-of-first-release-mapping.json, plus the directly relevant repository code and tests named in the findings below.
* Decisions, dependencies, and acceptance criteria considered: the plan's User Decisions and Requirements, Functional and Non-Functional Requirements, Acceptance Criteria, Dependencies, Follow-Up Items, Handoff, and Candidate Lock for Critique; every phase and task detail section P00 through P05.
* Assessment boundary: This critique can judge whether the plan's stated mechanisms, gates, and acceptance criteria are sufficient and consistent against current repository behavior and the supplied research evidence. It cannot revalidate the external Comic Book Herald sources or the live metadata snapshot, and it does not re-decide placement, scope, taxonomy, or review count, all of which user direction has settled.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| Fourteen-record inventory in user order (P00-T02, P01-T01) | Covered | Detail validation pins 14 positions, selected 1 to 4, ranked 5, 6, 7, 9, 10, 14, blocked 8 and 11 to 13, and priority 6's rejected identity. The supplied boundary evidence carries all fourteen records with content and issue-bearing digests. |
| Exact 43-row first release, counts 17, 17, 2, 7 (P01-T02, P03-T01) | Covered | The supplied mapping evidence holds 17, 17, 2 and 7 resolved rows, and the four declared cover ids 55415, 43170, 13683 and 12135 are each present in their own guide's rows, which the vendor cover rule requires. |
| Source-row completeness and explicit exclusions (P01-T02) | Covered | Exclusion rules are required to be non-empty, unique and candidate-specific, and omitted accepted rows are required to fail. |
| Complete-library and peer overlap plus central approval (P01-T03) | Partial | See PC-005. The plan's expected comparison count and the research evidence's comparison count differ because research included priority 6 as a peer. |
| screen-companion and selected taxonomy (P02-T01) | Covered | src/js/lib/catalog.js and src/js/lib/curated.js are both named, which is the full set of parse gates for a new type and depth. |
| Marvel on Screen Hub placement, Hub only (P02-T02) | Missing | See PC-001 and PC-002. The Hub's landing-age filter is not modeled, and the two existing tests that describe the Hub reconstruct it from the shelf table rather than from the render. |
| Browse reachability, accessibility, narrow layout (P02-T03) | Covered | The fallback shelf at src/js/lib/catalog.js does take an unnamed type, so Storylines reachability holds once the blurb is widened. |
| Manifest editorial fields for the four entries (P03-T01) | Partial | See PC-001 and PC-003. Insertion point and priority order are stated; timeline and beginner are not. |
| Documentation, counts, backlog, changelog (P03-T02) | Partial | See PC-009. Re-derivation of counts is required, but the backlog block's constraint gate line and the changes-record convention are unstated. |
| Failure proof for new checks (P04-T01) | Covered | Smallest-revert proof per new check family, with restoration and green rerun recorded. |
| Full gates and browser proof (P04-T02) | Partial | See PC-007. The anchors round omits the tracked-file precondition and the shift arithmetic. |
| Exactly one Review, findings routed not looped (P04-T03) | Covered | One artifact, one fix pass, unrelated findings routed to the backlog, no second Review. |
| Reconcile main, then open, monitor and merge (P05) | Partial | See PC-006. The reconciliation mechanism is unstated and is in tension with the stated exclusion of force-push. |
| Evidence freshness fails closed (Non-Functional Requirements) | Partial | See PC-004. A refreshed source that changes a row count collides with acceptance criteria that hard-code the counts. |
| Candidate Lock for Critique | Partial | See PC-002. The lock permits additions only, while the Hub change requires an existing invariant to be re-pointed. |

## Verdict

* Verdict: Revise
* Rationale: The evidence chain, taxonomy, exclusion policy, review discipline and release gates are credible and match both the supplied research and the repository's existing primitives. One defect is decisive: the Hub renders only the stories that survive the landing-page publishing-age filter at src/js/main.js, and neither the plan, the phase details nor the research mentions that filter, the PUBLISHING_AGES boundary or the timeline field. If the four entries carry the years their content implies, the Marvel on Screen category the user fixed would render empty or partial while every other gate stayed green. Every finding below is a direct planner correction; none needs a new user decision.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [Critical]: The Hub's publishing-age filter is unmodeled, so Marvel on Screen can render empty

* Related IDs: P02-T02, P03-T01, C12, C17, Functional Requirement "The Hub renders the four selected stories"
* Evidence: src/js/main.js narrows the Hub to groupCatalog(all).filter(inHomeAge) before any grouping happens. src/js/lib/catalog.js returns false for a story whose earliest reading year is before the boundary, and src/js/lib/catalog.js sets that boundary at 1998. test/catalog-shelves.test.js already asserts that an older story is kept off the landing page. The four selected guides are built from 1963 to 2007 material, and the plan's own acceptance at .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md promises all four cards on the Hub.
* Concern: Nothing in the plan, the phase details or the research names inHomeAge, PUBLISHING_AGES or the timeline field. P03-T01 fixes only the insertion point and the card order at .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md. An implementer who records a truthful start year for these guides removes them from the Hub, and one who records a start year of 1998 or later scatters them into the dated run instead of keeping the four together.
* Impact: The single user-fixed product outcome of this release fails while the type, the category code, the tests named in the plan, the counts and the browse screens all pass. The failure is silent: an empty category is dropped by design, so the Hub simply would not show the heading.
* Smallest useful change: State in P03-T01 that all four manifest entries carry an explicit null timeline, with the reason, which is that a best-of selection spanning decades sits at no point on the shelf, matching the thirteen undated entries already shipped in src/data/curated-lists.json. Add a P02-T02 or P02-T03 validation expectation that every screen-companion story survives inHomeAge and is drawn under Marvel on Screen, and add the same relationship to the semantic test list.
* Action owner: planning parent
* Exact resolving evidence: Plan or details text pinning timeline null for the four entries, plus one assertion that groupCatalog(catalog.lists).filter(inHomeAge) contains all four screen-companion stories and that the Marvel on Screen partition holds exactly those four.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-002 -->
### PC-002 [High]: The two tests that describe the Hub will keep passing while no longer describing it

* Related IDs: P02-T02, P02-T03, Candidate Lock semantic test ownership
* Evidence: test/home-grid.test.js and test/home-grid.test.js both rebuild the Hub by calling shelfSections on the age-filtered stories rather than by reading the render, and the second asserts that every Hub heading is one of the three shelf headings. The plan replaces that call with a Hub-only partition at .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md, while src/js/main.js is the call site being changed. The Candidate Lock records exact removals as none at .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md and describes only targeted additions to that file at .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md.
* Concern: Neither test fails when the Hub gains a fourth group, because neither reads the Hub. They decay into assertions about a function the Hub no longer calls, and the "every heading is a screen name" guard becomes vacuous exactly when a heading that is not a screen name is introduced. The lock's additions-only wording invites an implementer either to leave them stale or to delete the guard.
* Impact: The repository loses its only automated statement that the landing page draws every eligible story exactly once under named groups, at the moment that statement stops being trivially true. This is the guard-decay failure the plan's own no-silent-omission posture exists to prevent.
* Smallest useful change: Name the superseded invariant in P02-T02 and state its replacement: both tests are re-pointed at the new Hub partition, "holds back nothing" is asserted against that partition, and the heading rule becomes that every Hub group name is either a browse shelf heading or a declared Hub category. Record in the Candidate Lock that these two existing assertions are re-pointed rather than added to.
* Action owner: planning parent
* Exact resolving evidence: P02-T02 detail text naming both superseded assertions and their replacements, and a Candidate Lock line distinguishing re-pointed existing guards from new additions.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-003 -->
### PC-003 [Medium]: The featured "where do I start" pick could move to the two-issue subset card

* Related IDs: P03-T01, Acceptance Criteria on Hub rendering and priority 3 scope
* Evidence: src/js/main.js picks the beginner-friendly order with the fewest issues, ties broken by catalog order. The shipped catalog's smallest beginner order is a five-issue one today. Priority 3 ships two issues, per the row counts in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md.
* Concern: The plan never states the beginner value for the four entries. If any of them is marked beginner, the two-issue Marvel Multiverse card becomes the landing page's featured first-run recommendation, which is the release's most scope-limited card and the one whose copy has to warn that it covers only the source's single issue-numbered pick.
* Impact: A first-run reader is steered to the narrowest card in the catalog by a rule nobody deliberately changed, and the failure is invisible to every count and shelf gate.
* Smallest useful change: State in P03-T01 that the four entries do not claim beginner status, and add the featured pick to the P02 or P04 regression expectations so the existing pick is asserted unchanged.
* Action owner: planning parent
* Exact resolving evidence: P03-T01 text pinning the beginner field for the four entries plus one assertion that pickFeatured returns the same order after the release as before it.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-004 -->
### PC-004 [Medium]: A refreshed source that changes a row count collides with hard-coded acceptance counts

* Related IDs: P00-T02, P01-T02, Non-Functional Requirement "Evidence freshness fails closed"
* Evidence: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md requires source content and issue-bearing digests to be recomputed and compared with Research. .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md and .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md then fix the counts at 17, 17, 2 and 7. .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md provides an amendment route for a changed relationship only.
* Concern: The research already records that these pages change and that modification timestamps are unreliable, and priority 5's title-versus-page count drift is direct evidence that headed picks move. If a refreshed page yields sixteen or eighteen rows for a guide, the plan tells the implementer both to bind the refreshed source and to satisfy an acceptance criterion naming the old number, with no stated precedence.
* Impact: Under pressure to make a fixed criterion pass, the cheapest resolution is to carry the stale count, which is the precise failure the freshness chain exists to prevent, and it would ship a card whose issue list does not match its cited source.
* Smallest useful change: Extend the P00 amendment route to cover a changed row count and a changed source boundary, and mark the four counts in the plan as derived from the frozen packets rather than as fixed targets, with a stated rule that a divergence is recorded in the changes record and the acceptance counts are re-derived.
* Action owner: planning parent
* Exact resolving evidence: A P00 or P01 statement giving refreshed source evidence precedence over the research counts, plus acceptance wording that names the frozen packet as the count authority.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-005 -->
### PC-005 [Medium]: The expected comparison count differs from the comparison count in the cited evidence

* Related IDs: P01-T03, Acceptance Criteria on reports, Q3
* Evidence: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md expects the comparison count to equal the pre-publication library count plus three peers, and .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md says the other three peers. The research reports one hundred comparisons for each candidate at .copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md, and .copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md explains why: each report covered ninety-six current readings plus four selected peers, because priority 6 was mapped as a feasibility candidate and compared as a peer.
* Concern: Ninety-nine is the right expectation for a four-guide release, so the plan's number is correct and the research's number is correct for a different peer set. The plan does not say so. Combined with the instruction to compare refreshed evidence with Research, an implementer can read the mismatch either as a regression to chase or as a reason to keep priority 6 in the peer set, which would drag a deferred guide's evidence into this release.
* Impact: Wasted reconciliation, or a peer set that no longer matches the shipped release, in the one place where digests are bound and approvals are issued.
* Smallest useful change: Add one line to P01-T03 stating that the release reports compare against the current library plus exactly the three shipped peers, that the research figure of one hundred reflects priority 6's inclusion as a feasibility peer, and that the difference is expected rather than drift. Note also that no shipped candidate had a non-none relationship with priority 6, so no disposition changes.
* Action owner: planning parent
* Exact resolving evidence: P01-T03 text naming the three-peer release set and reconciling it with the research figure.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-006 -->
### PC-006 [Medium]: The reconciliation mechanism is unstated and sits in tension with the no-force-push boundary

* Related IDs: P00-T01, P05-T01, P05-T02
* Evidence: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md asks for safe integration and conflict resolution without naming the mechanism, and .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md excludes force-push and amend at the same stage. .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md excludes a destructive reset but names no positive procedure.
* Concern: A second reconciliation after the branch is pushed can be done by merging main into the branch, which needs no force-push, or by rebasing, which does. The plan forbids the consequence without choosing the mechanism. The repository's standing guidance is explicit that a suppressed failing checkout followed by a reset has already destroyed work here, and that a conflict resolution invalidates any citation re-aim computed against the other side.
* Impact: The most destructive operations in the task are left to improvisation at the point of highest time pressure, and a rebase would either be blocked by the stated exclusion or performed against it.
* Smallest useful change: Name merge-from-main as the reconciliation mechanism in both P00-T01 and P05-T01, keep the force-push exclusion, and require that the integration command's exit status is read rather than suppressed before any dependent command runs.
* Action owner: planning parent
* Exact resolving evidence: P00-T01 and P05-T01 text naming the merge mechanism and the exit-status rule, consistent with the P05-T02 exclusion.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-007 -->
### PC-007 [Medium]: The anchors round omits the tracked-file precondition and the shift arithmetic

* Related IDs: P03-T02, P04-T02, P05-T01
* Evidence: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md requires the anchors run to reach zero drifted, zero new and zero removed after a read, re-aim and bless cycle. This release adds roughly twenty-five new tracked files, including the adapter, the inventory, twelve evidence files, four order documents, four payloads and a new test, and it edits documents that carry citations into code that is moving.
* Concern: The gate enumerates tracked files only, so an anchors run made before the new files are added reports a clean pass on a corpus that excludes them. The plan also asks only for reading the bless print. The repository's own record is that the print cannot reveal a range that has slid onto a leading blank line, and that the shift has to be derived twice, once by searching for the head text the lock holds and once from the diff hunks, because each method is unsound where the other holds.
* Impact: A false green anchors round, or citations blessed onto lines that do not carry the claim, which is permanent and silent once blessed. The tracking directory is additionally covered by an ignore rule at .gitignore while 154 files inside it are already tracked, so a new artifact there is invisible to both the status output and the gate until it is force-added, which is the least visible version of this failure.
* Smallest useful change: Add two validation expectations: new files are added to the index before the first anchors run, with the tracking artifacts force-added past the ignore rule, and every re-aimed citation's target is derived both from the lock's head text and from the diff hunks, with disagreements reconciled before the bless. Repeat the second expectation in P05-T01 for citations touched by conflict resolution.
* Action owner: planning parent
* Exact resolving evidence: P04-T02 and P05-T01 validation text naming the index precondition and the two-way derivation.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-008 -->
### PC-008 [Low]: "The heading is navigable" can be read as a link, which would push toward a fourth route

* Related IDs: P02-T02, P02-T03, Functional Requirement on Hub rendering
* Evidence: .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md states that the heading is navigable, and .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md asks for a navigable one-column Hub group at narrow width. The Hub's existing group headings are plain heading elements, built by the shared section head helper in src/js/main.js, and carry no link.
* Concern: Every other Hub heading names a browse screen, and this one cannot, because the user forbade a fourth route. An implementer reading "navigable" as a link has nowhere truthful to point it.
* Impact: Either a heading that promises a destination that does not exist, or pressure to add the route the user excluded.
* Smallest useful change: State that navigable means heading-level navigation and accessible name only, and that the Marvel on Screen heading is not a link.
* Action owner: planning parent
* Exact resolving evidence: Plan or details wording that defines the navigability claim as heading-level.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-009 -->
### PC-009 [Low]: The backlog block's constraint gate line and the changes-record convention are unstated

* Related IDs: P03-T02, P00-T01, Handoff
* Evidence: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md asks for one shipped backlog block, and .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md asks for every count in a touched section to be re-derived. The repository's shipped backlog blocks carry an explicit constraint gate line recording a check against the eleven standing constraints, and the changes record is written as numbered change sections rather than as free prose.
* Concern: Both conventions are load-bearing in this repository and neither is named in the plan, so a correct-looking backlog block can land without the gate line and the changes record can land without the section identifiers the later Review refers back to.
* Impact: The release's own record diverges from every neighbouring entry, and the one Review loses the identifiers it needs to cite.
* Smallest useful change: Name the constraint gate line as part of the backlog block in P03-T02, and name the numbered change-section convention where the changes record is first written in P00-T01.
* Action owner: planning parent
* Exact resolving evidence: P03-T02 and P00-T01 text naming both conventions.
* Decision route: direct planner correction

## Strengths and Residual Risk

* The evidence chain is the strongest part of the plan. Packets, mappings, complete-library and peer reports, and central approvals are reused rather than reinvented, and the repository's existing mapping records confirm that approval and review live inside the mapping file, so the lock's count of twelve evidence files plus four approved reviews is consistent with how the primitives already work.
* The four declared cover ids each appear in their own guide's mapped rows, which satisfies the vendor rule that a cover issue must be inside the order it represents. That is the kind of detail that usually surfaces only at generation time.
* Exclusion policy, no-inference policy and attribution boundaries are stated in the terms the existing licence and provenance gates already enforce, so the documentation work has a defined shape rather than being left to taste.
* Residual risk explicitly accepted by user direction: priority 3 ships two issues that both already appear in two shipped Claremont paths. The relationship is candidate-subset rather than exact and the plan requires central approval plus scope wording, but the card's value remains purpose-based rather than issue-based and is the release's most contestable product claim.
* Residual risk not owned by this plan: the release depends on live third-party source pages and a live metadata snapshot at authoring time, and neither is under repository control.

## Questions or Blocking Evidence Gaps

* None. Every finding is resolvable from evidence already in the repository or in the supplied research, and no finding requires a decision the user has not already made.

## Limitations

* External sources and the live metadata contract were not re-fetched, so source-row counts and issue identities are assessed only as recorded in the supplied research evidence.
* The critique did not execute the repository gates. Claims about test behavior are read from the test sources named in the findings, not from a run.
* This artifact adds new path and line citations. They are accurate against the tree as read on 2026-08-23, and the implementation's anchors round is where they are enrolled, which is one more reason PC-007 matters. This file is itself covered by the tracking-directory ignore rule and will not be enrolled until it is force-added.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: planning parent
* Smallest next action: Revise P03-T01 to pin an explicit null timeline for the four manifest entries and add the landing-page age assertion to P02, then apply PC-002 through PC-009 as direct corrections and finalize without another critique.
* User response required: no

| Artifact | Description |
| [.copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md](.copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md) | Candidate plan under critique |
| [.copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md](.copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md) | Phase and task details under critique |
| [.copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md](.copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md) | Primary research evidence |
| [.copilot-tracking/research/2026-08-23/mcu-best-of-source-boundaries.json](.copilot-tracking/research/2026-08-23/mcu-best-of-source-boundaries.json) | Fourteen source identities and digests |
| [.copilot-tracking/research/2026-08-23/mcu-best-of-first-release-mapping.json](.copilot-tracking/research/2026-08-23/mcu-best-of-first-release-mapping.json) | Exact mapping, library and peer relationships |
| [.copilot-tracking/reviews/plans/2026-08-23/mcu-best-of-guides-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-23/mcu-best-of-guides-plan-critique.md) | This critique |

## Next Steps

* No user action is required. The verdict returns to the active automatic RPI parent, which applies PC-001 through PC-009 as direct planner corrections and continues to implementation without a second critique.
