# Historical documents

Use [Contributing](../CONTRIBUTING.md), [Governance](../GOVERNANCE.md) and
[Maintaining](MAINTAINING.md) for current policy and procedures, and
[Architecture](ARCHITECTURE.md) for the current implementation.
Scope and acceptance criteria belong in the repository Issue and its delivery PR.

**Historical records are evidence, not instructions.** An old recommendation, unchecked design
checklist or earlier approval does not authorize new work or block a current improvement.
Do not reimplement an old screen or reopen a closed decision merely to match a record.
Check the current policy, code and tests, and the Issue's owner decisions first.

## Archived in place

These records keep their paths so existing links and evidence remain usable. Status describes
their authority, not their age: a recent citation repair does not make an old study current.

| Record | Status and reason | Use instead for current work |
|---|---|---|
| [Original UX study](UX_STUDY.md) | Historical single-rater audit first committed August 5, 2026. Findings, measurements and resolution notes describe earlier interface passes, not today's acceptance criteria. | Contribution interface contract, current architecture, tests and the implementation Issue. |
| [Home flow](ux/landing-page-flow.md) | Historical design record. Its first-run question, Home Search action and button checklist predate the later Home direction. | [Current UX plan](UX_IMPROVEMENT_PLAN.md#2-home-discovery-and-search) and the contribution interface contract. |
| [Home jobs](ux/landing-page-jtbd.md) | Historical rationale, including an earlier first-run question under "Approved Solution". | Current Home direction and the implementation Issue, not that earlier approval. |
| [First-list journey](ux/landing-page-journey.md) | Historical target journey, not a report of a reader observed using the current build. | Current Home direction, running guide and observed journey evidence. |
| [Sidebar flow](ux/sidebar-flow.md) | Historical navigation design rationale. Some patterns remain useful, but this is not a separate source of current requirements. | Contribution interface contract, current architecture and navigation tests. |
| [Android beta checklist](ANDROID_BETA.md) | Historical sideloaded-prototype checks, including the retired Marvel-app handoff. Not a checklist for the Google Play app. | [Android guide](ANDROID.md) and current release checks in Maintaining. |
| [Frozen backlog](../PRODUCT_BACKLOG.md) | Already-frozen scope, rationale and delivery snapshot. Do not edit or reprioritize it. | Repository Issues, planning Project and Governance. |
| Committed `.copilot-tracking/` records | Historical research, plans and review evidence. Not current agent instructions or an active backlog. Leave committed records unchanged. | Current repository instructions, the implementation Issue and its delivery PR. |

## Historical sections inside maintained guides

Do not archive an entire maintained guide merely because it contains old evidence.

| Record | Historical boundary | Current authority retained |
|---|---|---|
| [Publication runbook](PUBLICATION_RUNBOOK.md) | The spent August 16, 2026 repository-publication decision and pre-publication checklist. Its present-tense instructions are not a request to repeat that event. | Its [post-publication checks](PUBLICATION_RUNBOOK.md#post-publication-content-releases), current provenance and release policy still apply. |
| [Microsoft Store proof guide](MICROSOFT_STORE.md) | Early certification outcomes and package-candidate versions are recorded proof, not live Store status or renewed submission approval. | Build and installed-proof procedures, [submission packet](MICROSOFT_STORE_SUBMISSION.md) and coordinated release policy. |
| [Data provenance](DATA_PROVENANCE.md#historical-comic-book-reading-orders-intake) | Dated intake releases retain their original blockers and decisions. A former blocker is not a rule to block later exact rows. | Current delivery procedures and later source records, including [MC2 and Second Clone Saga](DATA_PROVENANCE.md#owner-requested-mc2-and-second-clone-saga). |
| [Why not an emulator](WHY_A_BROWSER_APP.md) | Historical hardware evidence explains a closed route; it is not a setup guide. | The standing no-emulator constraint in Contributing still applies. Historical status does not reopen it. |

## Records that are not archived

[Colleague feedback](UX_FEEDBACK.md) and [UX improvement plans](UX_IMPROVEMENT_PLAN.md) are separate,
current evidence-dependent records. They distinguish owner decisions from observations and
unidentified native-iOS reports. Archiving the original audit neither resolves those reports nor
authorizes a native rewrite.

The running, architecture, platform, asset, release, publication and reading-list delivery guides
remain maintained authorities within their stated scope. In particular, both
[single-list](READING_LIST_DELIVERY.md) and [batch](BATCH_READING_LIST_DELIVERY.md#prepare-exact-rows-and-reusable-facts)
delivery preserve metadata gaps while publishing exactly resolved rows. Missing metadata alone
does not block a list; ambiguous identities and missing required approvals still need resolution.

## Maintaining historical status

The [inventory and mechanics decision](https://github.com/raymond-nassar/recap-page/issues/1129#issuecomment-6684514452)
records last-edit dates, inbound references, lock entries, history declarations and the guidance
audit. Review those criteria before classifying another page; age or a stale sentence alone does
not make a maintained guide historical. Add a status, reason and current authority here, and make
the distinction visible at the old entry point.

In-place status does not freeze citations or exempt a page from the anchors gate. Keep existing
evidence intact and use the [citation helpers](MAINTAINING.md#relocate-citations-and-resolve-renumber-only-conflicts)
only during an active delivery. Do not use an `anchors:source` marker as an archive label.
Moving a path can invalidate incoming links, path-keyed lock entries and immutable history sites.
A move or new historical-registry declaration needs a separately approved decision and its proper
validation flow, not an archive cleanup or an ordinary bless.
