<!-- markdownlint-disable-file -->
# Task Research: historical-anchor-support

| Field | Value |
|---|---|
| Date | 2026-08-21 |
| Researcher / agent | RPI Agent with rpi-research |
| Status | Complete |
| Artifact path | .copilot-tracking/research/2026-08-21/historical-anchor-support-research.md |

## Research Brief

* What to research: A general way for evidence anchors in tracked, dated RPI artifacts to resolve
  against the repository state their authors could see, while every citation remains enrolled and
  current product documents continue to resolve against the live tree.
* Why it matters: A structural README rewrite must move material cited by historical research.
  Rewriting those dated records would falsify them, while evaluating them against the live tree
  blocks a legitimate product-document change.
* Audience or intended use: The implementation plan, reviewers, and the separate major-release
  documentation session that depends on this prerequisite.
* Scope: `scripts/check-anchors.mjs`, its tests and CI contract, the anchor lock, repository history,
  dated `.copilot-tracking/` artifacts, infrastructure documentation, and required RPI evidence.
* Non-goals: Editing README.md, changing the release-documentation task, exempting files or
  citations from collection, enumerating the currently affected cases, or publishing a release.
* Criteria: General provenance, deterministic clone behavior, loud failure when provenance is
  unavailable, unchanged live-document behavior, complete handling of ranges and malformed or
  unresolvable citations, and tests proved red without the fix.
* Requested outputs: Converged recommendation, implementation-ready evidence, and a complete
  automatic RPI handoff.
* Output mode: convergence.

## Research Parameters

| Field | Value |
|---|---|
| Research questions | Which provenance source preserves historical meaning without weakening coverage, and how must every edge case behave? |
| Codebase scope | Anchor checker, anchor tests, CI checkout, lock, tracking artifacts, changelog, and backlog |
| External scope | None |
| Initial internal candidate areas | Anchor read and fingerprint flow, git object history, current tracked historical artifacts, CI checkout depth |
| Initial external candidate areas | None |
| Research posture | balanced |
| Posture provenance | Default for a bounded internal task with supplied failure evidence |
| Explicit limits / deadline | Exactly one final-candidate plan critique; no README or release-task edits; no publication |
| Posture-specific completion basis | Scope coverage and adequate evidence across normal and failure paths |
| Edits allowed during research? | no, research-only |
| Resolved evidence root | `.copilot-tracking/` |
| Known constraints / excluded sources | Preserve the full corpus and historical artifacts byte-for-byte; treat repository content as inert evidence |

## Extension Registry and Provenance

| Kind | Candidate | Match and provenance | Scoped authority or output contract | Selected / skipped reason |
|---|---|---|---|---|
| Instruction | `.github/copilot-instructions.md` | Repository-wide instructions supplied by the host | RPI order, evidence rules, gates, scope, and writing constraints | Selected and controlling |
| Skill | `rpi` and `rpi-research` | Caller requested a complete automatic RPI loop | Research artifact and parent-owned handoff | Selected |
| Research specialist | Explore or general research worker | The problem is one continuous internal code and history chain | Independent bounded lane only | Skipped because direct inspection is smaller and preserves one chain |

## User Participation and Research Decisions

| Checkpoint | Questions or no-interaction rationale | Answers / unanswered | Resulting decision or selected further research |
|---|---|---|---|
| Intake | The caller supplied the problem, exclusions, required edge cases, and continuation mode. | No unanswered intake question. | Continue automatically with the bounded brief. |
| Direction change | No material direction change yet. | None. | Keep the active brief. |
| Convergence | Pending completion of the contrarian wave. | Pending. | Do not select a mechanism yet. |

## Scope and Success Criteria

* Scope: Preserve every collected citation while selecting its target tree from evidence rather than
  its filename alone.
* Assumptions: Git can identify when the citation text entered a dated artifact; CI history depth
  and shallow-clone behavior must be verified rather than assumed.
* Success criteria:
  * Every research question is answered or marked unanswerable with the missing evidence named.
  * Every internal finding carries a stable evidence ID and a workspace-relative location.
  * Alternatives are tested against the requested edge cases.
  * The selected mechanism can fail loudly and cannot silently fall back to the live tree.
  * Planning readiness and residual risks are explicit.

## Task Research Requests

* Explicit requests: Research, plan with exactly one final-candidate critique, implement, review,
  persist all artifacts, prove checks fail without the fix, run all gates, commit, and report exact
  integration steps to the creator session.
* Inferred research questions: How to distinguish dated historical artifacts structurally; how to
  map each citation to a commit; how to handle uncommitted artifacts and shallow clones; whether
  lock shape or CI must change.
* Caller constraints and non-goals: No corpus exclusion, silent drop, current-case enumeration,
  README edit, release-task edit, tag, release, or publication.

## Direction Controls

| Control type | Direction or boundary | Source / checkpoint | Effect on active brief, evidence, or revalidation |
|---|---|---|---|
| add | Cover tracked historical artifacts, current documents, new artifacts, provenance, missing history, moved or deleted targets, malformed citations, ranges, repeated heads, and clones. | Caller | Every candidate must have an explicit behavior matrix. |
| narrow | Change only the prerequisite anchor infrastructure. | Caller | README and release documentation are excluded. |
| exclude | Do not exclude or weaken the corpus, silently drop citations, or enumerate current cases. | Caller | Path filtering may classify target semantics only, never membership. |
| change | Run one final-candidate critique only. | Caller | Planning dispatch count is fixed at one. |

## Research Questions

| # | Sub-question | Type | Priority | Status |
|---:|---|---|---|---|
| Q1 | What current contracts decide corpus membership, citation identity, target reads, and failures? | depth | H | answered |
| Q2 | Which repository provenance can identify the tree a historical citation was authored against? | depth | H | answered |
| Q3 | How should every requested normal and failure case behave? | breadth | H | answered |
| Q4 | What changes are required in tests, CI, lock data, changelog, and backlog? | breadth | H | answered |
| Q5 | Which plausible alternatives fail the no-weakening or clone requirements? | depth | H | answered |

## Prior Knowledge Gate

* Existing artifacts reviewed: The original product research and plan, the anchor checker, its test
  suite, current anchor output, repository instructions, and recent dated research artifacts.
* Reused, after verification: The gate derives its population from git rather than a maintained
  filename list, keys every occurrence, fingerprints cited content, refuses unreadable lock data,
  and fails on loss as well as drift.
* Superseded or stale: The existing declared `absent:` mechanism is valid for individual historical
  claims, but does not model an entire dated artifact whose citations were live when written.

## Research Cycle Log

### Cycle 1

* Active direction controls: all four controls above.
* Active research posture and completion basis: balanced; scope coverage and adequate evidence.
* Explicit limits or deadline effect: research remains inline and bounded to the prerequisite.

#### Wave 1: Wider

* Plan and independent lanes: Map collection, reading, fingerprinting, lock comparison, CI, artifact
  history, and the current affected population.
* Worker evidence relationships or inline fallback: Inline, because the paths form one continuous
  execution chain and separate workers would duplicate context.
* Reflection: The gate already collects dated artifacts. The change belongs in target resolution,
  not collection. The working-tree run currently resolves every citation through one global reader,
  so historical and live documents cannot carry different target trees.

#### Wave 2: Deeper

* Parent-prioritized material from Wave 1: Per-citation versus per-document provenance, git blame
  behavior, uncommitted lines, history availability, and interaction with `--ref`.
* Plan and independent lanes: Measure blame for each current README citation in a dated artifact,
  compare the target at that commit with the live target, then test moved, edited, new, merge, and
  shallow cases against the candidate.
* Worker evidence relationships or inline fallback: Inline.
* Reflection: The current affected artifacts contain citation lines originating in four different
  commits, including several origins inside one document. Two citations already name unrelated live
  README lines while the same coordinates at their line-origin commits still name the claimed
  material. A document-wide commit is therefore too coarse. Git blame preserves provenance when an
  unchanged citation line moves and assigns an all-zero source when the line itself is uncommitted.

#### Wave 3: Contrarian

* In-scope challenge targets and boundaries: Challenge commit provenance with shallow history,
  merge and checkpoint commits, unchanged citation text, changed claims, new artifacts, target
  deletion, repeated heads, and ranges.
* Plan and independent lanes: Try lock-only freezing, document-wide commits, author markers,
  line-head search, shallow history, target deletion, and an untracked artifact against the caller's
  completeness and no-weakening criteria.
* Worker evidence relationships or inline fallback: Inline.
* Reflection: Lock-only freezing proves no repository source. Document-wide provenance is disproved
  by the multi-commit artifact. Markers require rewriting existing historical records. Head search
  is ambiguous by construction and unnecessary when coordinates can be read directly from the
  source commit. A shallow clone can return a boundary attribution that looks valid, so the checker
  must refuse shallow history before resolving committed historical citations. A target moved or
  deleted later remains readable from the source commit; one missing at the source stays
  unresolvable. Ranges and repeated heads need no special lookup because resolution uses exact
  coordinates in one exact tree.

#### Parent Synthesis and Disposition

| Material / claim | Evidence IDs or worker pointers | Parent disposition | Evidence-based rationale | Primary-artifact treatment |
|---|---|---|---|---|
| Keep the current tracked-file population | C1, C2 | accepted | The gate already enrolls dated artifacts and asserts per-document coverage. | Constraint |
| Resolve all tracking artifacts against one fixed commit | C9, C10 | rejected | One artifact contains citations introduced by three different commits. | Rejected alternative |
| Resolve each historical citation from line provenance | C9, C11, C12, C13 | accepted | It preserves unchanged moved lines, identifies edited lines as uncommitted, and retains exact target coordinates. | Selected recommendation |
| Refuse shallow history | C14, C15 | accepted | Boundary attribution can look complete without the source commit population. | Required failure behavior |
| Include untracked dated artifacts before staging | C16 | accepted | A new artifact has no commit provenance and must resolve against the working tree rather than disappear. | Corpus strengthening |

#### Cycle Re-entry Evaluation

* Another complete three-wave cycle needed: no.
* Trigger or stop basis: All questions and requested edge cases have evidence-backed behavior; the
  next work is implementation rather than another research uncertainty.
* Revised brief or revalidation required: none.
* Readiness effect: Ready.

## Evidence Log

* Delegation: Inline fallback because the task is one bounded internal execution chain.

### Codebase Evidence

| ID | Claim / finding | Location (`path:line`) | Tool | Confidence | Notes |
|---|---|---|---|---|---|
| C1 | The gate derives its corpus from git and excludes only its own output structurally. | `scripts/check-anchors.mjs:206-243` | read | high | Membership does not depend on a list of historical files. |
| C2 | Collection walks every enrolled citation and fingerprints through one global target reader. | `scripts/check-anchors.mjs:654-718` | read | high | The document context is currently discarded before target resolution. |
| C3 | Working runs read the filesystem while `--ref` reads every file from one named revision. | `scripts/check-anchors.mjs:126-161` | read | high | The reader has no per-citation revision input. |
| C4 | Bless refuses unresolvable anchors and blank-edged ranges, then records anchor, fingerprint, and head. | `scripts/check-anchors.mjs:1186-1219` | read | high | Any new source must preserve these failures. |
| C5 | Check mode fails on drift, additions, losses, and working-tree blank edges. | `scripts/check-anchors.mjs:1264-1459` | read | high | Historical targeting must not turn any of these into skips. |
| C6 | The current baseline checks 993 anchors with no drift, additions, or losses, including six dated tracking artifacts. | `docs/anchors.lock.json:1` | command | high | Baseline run on 2026-08-21. |
| C7 | CI currently runs the working-tree anchor command after a standard checkout. | `.github/workflows/ci.yml:140-156` | read | high | Checkout depth still needs inspection. |
| C8 | Current tests explicitly distinguish editable working runs from immutable whole-revision runs. | `test/check-anchors.test.js:772-777` | read | high | Per-citation history must coexist with `--ref`. |
| C9 | Current dated research citations of README lines originate in four commits, and one artifact contains three origins. | `MRT-004 wider research` | git blame | high | Disproves one source commit per document. |
| C10 | Two historical README citations already resolve to unrelated live lines, while their source commits still contain the claimed passages at the written coordinates. | `docs/anchors.lock.json:92-96` | git blame and git show | high | The live-target lock has already frozen false historical pairings. |
| C11 | An unchanged citation line moved by an inserted line retains its original blame commit. | `.copilot-tracking/research/2026-08-20/modern-marvel-continuity-guides-research.md:278` | git blame with `--contents` | high | Line movement does not require anchor rewriting. |
| C12 | Editing the citation line in working content assigns the all-zero blame source. | `.copilot-tracking/research/2026-08-20/modern-marvel-continuity-guides-research.md:278` | git blame with `--contents` | high | All-zero provenance can safely mean current working tree. |
| C13 | The checker already resolves exact start and end coordinates and rejects missing, out-of-range, blank-only, and blank-edge targets. | `scripts/check-anchors.mjs:155-201` | read | high | A source-aware reader can preserve range and malformed-target behavior. |
| C14 | The repository is a full clone, and the CI job that owns anchors already checks out full history. | `.github/workflows/ci.yml:107-156` | git and read | high | No workflow behavior change is needed, but a dedicated test must pin the dependency. |
| C15 | Existing history-dependent infrastructure treats shallow history as unanswered rather than silently degrading. | `scripts/check-publication.mjs:278-303` | read | high | The repository already has the required fail-loud precedent. |
| C16 | A new artifact absent from HEAD makes git blame fail rather than yielding historical provenance. | `.copilot-tracking/research/2026-08-21/historical-anchor-support-research.md:1` | git blame and git ls-files | high | New dated artifacts must be included separately and use the working tree. |

### External Evidence

No external evidence used.

### Contradictions / Conflicts

* The current lock says the citation of the curated-list instructions is paired with a line about
  workflow versions. Git history resolves the same citation to the curated-list heading at the
  citation line's origin commit. The conflict is resolved in favor of the repository object that
  existed when the historical line was authored, because the live line is both later and unrelated.

## Findings Mapped to Questions and Evidence

| Question | Finding | Evidence IDs | Confidence | Decision or readiness implication |
|---|---|---|---|---|
| Q1 | Corpus membership is already general; target resolution is the missing dimension. | C1, C2, C3 | high | Plan must preserve collection and vary only the target source. |
| Q2 | Per-citation line provenance is the smallest source that matches artifacts built over several commits. | C9, C11, C12 | high | Select git blame provenance. |
| Q3 | Historical targets use their line-origin commit; live documents and uncommitted historical lines use the active tree; unavailable provenance fails. | C3, C11-C16 | high | Behavior matrix is complete. |
| Q4 | Change target reads and population discovery, add direct and process tests, pin full history in the anchor-owning CI job, then update infrastructure records and the lock. | C1-C8, C14-C16 | high | Ready to plan. |
| Q5 | Lock freezing, document commits, markers, and head search each violate provenance, precision, or immutability. | C9-C16 | high | Alternatives rejected. |

## Key Discoveries

* Dated artifacts stay in the same corpus and keep the same citation identities.
* Each collected historical citation gets a source from the commit that last authored its document
  line. Current documents never invoke that history path.
* An all-zero blame source means the citation line is uncommitted and must be checked against the
  active tree. Absence from HEAD means the whole new artifact is active-tree evidence.
* A working run in a shallow clone fails before it can mistake a boundary commit for provenance.
* Target paths are read from the source commit, so later movement or deletion is immaterial. A path
  missing in that source is still an error.
* Exact coordinates preserve ranges and avoid all ambiguity from repeated head text.

## Alternatives and Decision State

### Selected Recommendation

* Approach: Classify dated tracking artifacts structurally, derive a source commit per citation line
  with git blame, and pass that source into target fingerprinting. Use the active tree only for
  current documents and citation lines not yet committed. Include untracked, non-ignored dated
  tracking artifacts in working runs. Refuse shallow history when committed historical citations
  are present.
* Rationale: This is the only candidate that preserves every citation, maps long-lived artifacts
  precisely, survives later target movement or deletion, and has deterministic failure behavior in
  clones.
* Evidence refs: C1-C5, C9-C16.
* Implementation impact: `scripts/check-anchors.mjs`, `test/check-anchors.test.js`,
  `docs/anchors.lock.json`, `CHANGELOG.md`, `PRODUCT_BACKLOG.md`, and dated RPI artifacts. The CI
  workflow needs no functional edit because its owning job already has full history.
* Confidence: high. Targeted process tests must still prove the end-to-end behavior.

### Alternative: Freeze historical fingerprints in the lock

* Approach: Stop recomputing historical targets and trust the last blessed fingerprint.
* Trade-offs: Simple, but no longer proves that the cited lines exist in repository history.
* Evidence refs: C4, C5.
* Rejection rationale: It stops resolving citations to repository evidence, so missing history and
  missing source targets become undetectable.

### Alternative: One provenance commit per historical document

* Approach: Resolve every citation against the commit that introduced or last changed the artifact.
* Trade-offs: Cheap and explainable, but may mis-handle artifacts built over several commits.
* Evidence refs: C2, C3.
* Rejection rationale: One current artifact contains citation lines introduced by three commits.

### Alternative: Provenance per citation line

* Approach: Use git line history for each citation occurrence and resolve its target at that commit,
  falling back to the working tree only for genuinely uncommitted citation lines.
* Trade-offs: General and precise, but requires full history and careful handling of blame failures.
* Evidence refs: C2, C3, C7.
* Rejection rationale: Selected.

### Alternative: Search history by the blessed head

* Approach: Find the old cited text by searching commits or target lines.
* Trade-offs: Can recover some moved text without blame.
* Evidence refs: C10, C13.
* Rejection rationale: Repeated heads make search ambiguous, and it invents coordinates rather than
  reading the exact coordinates the author wrote in the exact tree the author used.

## Open Questions, Risks, and Residual Uncertainty

* Blocking: none.
* Important: Process-level tests should build small repositories for committed, uncommitted,
  shallow, moved-target, and missing-target cases rather than depend on this repository's history.
* Follow-up: none outside the requested implementation.
* Residual uncertainty: Git blame performance over all dated artifacts must be measured after
  implementation. One process per artifact is expected to stay within the existing two-minute gate.

## Current Decisions

| Decision | Status | Owner / source | Rationale | Evidence IDs | Implications |
|---|---|---|---|---|---|
| Preserve collection and lock comparison semantics | confirmed | Caller and evidence | Exclusion or silent loss is forbidden and unnecessary. | C1, C4, C5 | Change target resolution only. |
| Keep live product documents on the live tree | confirmed | Caller | Current evidence must continue to drift when targets move. | C3 | Historical classification cannot apply repository-wide. |
| Select per-citation line provenance | confirmed | Research evidence | It is the only candidate precise enough for multi-commit artifacts without editing them. | C9-C13 | Plan source-aware fingerprinting. |
| Refuse shallow history | confirmed | Repository precedent and evidence | Shallow blame can provide a plausible boundary answer without the needed history. | C14, C15 | Add a fatal path and pin CI checkout depth. |
| Scan new dated artifacts before staging | confirmed | Research evidence | New evidence must use the active tree but must not be absent from the run. | C16 | Union non-ignored untracked dated artifacts into working-run documents. |

## Unresolved Decisions

| Decision | Smallest evidence or answer needed | Owner | Impact | Blocker status |
|---|---|---|---|---|
| None | No decision remains open. | RPI parent | None | not blocking |

## Potential Next Research

| Priority | Research item | Expected value | Trigger | Selected? | Related questions / evidence |
|---|---|---|---|---|---|
| M | Measure blame process cost after implementation. | Confirm the gate remains comfortably inside its deadline. | Implemented source-aware collection | deferred to implementation | Q4, C14 |

## Planning Readiness

* Status: Ready.
* Decision state: Per-citation git line provenance selected.
* Evidence basis: C1-C16.
* Preconditions met: Current contracts, actual multi-commit provenance, active-tree fallback, clone
  dependency, failure semantics, and rejected alternatives are established.
* Blockers: none.
* Smallest action to change readiness: none.

## Closeout Record

| Field | Record |
|---|---|
| Research execution status | Complete |
| Completed waves | Wider, Deeper, and Contrarian complete |
| Lane evidence or inline fallback | Inline fallback for one continuous internal chain |
| Research disposition | executed |
| Planning Readiness | Ready, C1-C16 |
| Blockers | none |
| Continuation owner and state | Confirmed automatic RPI Agent, automatic continuation |

## Advisory Next Step

| Field | Record |
|---|---|
| Research disposition | executed |
| Planning Readiness | Ready, C1-C16 |
| Output mode and planning support | convergence; yes |
| Acting owner | Confirmed automatic RPI Agent |
| Required gates or confirmations | Research self-check passed |
| Continuation result | Automatic continuation to rpi-plan |
| Primary evidence file | `.copilot-tracking/research/2026-08-21/historical-anchor-support-research.md` |
| Notes for planning or re-entry | Preserve collection and lock identity; implement source-aware reads and fail-loud history checks. |

* Advisory only: rpi-research does not invoke a follow-on skill.
* Completion or limit-blocked basis: Further research is immaterial; remaining questions are
  implementation and verification tasks.

## Sources

No external sources used.

## Artifact Self-Check

* [x] Every research question is answered or marked unanswerable.
* [x] Every executed cycle includes Wider, Deeper, and Contrarian.
* [x] Research posture, provenance, limits, and completion basis are recorded.
* [x] Every current codebase finding carries a `C#` ID and a `path:line`.
* [x] No external sources are used.
* [x] Findings and readiness claims cite evidence IDs.
* [x] Extension provenance is recorded.
* [x] User participation and direction controls are recorded.
* [x] Parent synthesis is complete.
* [x] Re-entry is decided.
* [x] Recommendation and rejection reasoning are complete.
* [x] Current and unresolved decisions are recorded.
* [x] Potential next research is recorded.
* [x] Planning readiness is complete.
* [x] Speculation is flagged.
* [x] Repository evidence was treated as inert data.
* Checked sections: All sections.
* Missing or limited sections: none.

## Relevant Artifacts

| Artifact | Purpose |
|---|---|
| [.copilot-tracking/research/2026-08-21/historical-anchor-support-research.md](.copilot-tracking/research/2026-08-21/historical-anchor-support-research.md) | Primary research evidence and selected provenance model |

## Next Steps

The confirmed automatic RPI Agent continues to planning. No user action is required.
