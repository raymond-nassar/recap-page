# Governance

How this project plans work, makes decisions, and ships releases.

## The maintainer

[@raymond-nassar](https://github.com/raymond-nassar) is the sole maintainer and the only person
with write access. Every decision below is theirs unless it says otherwise.

There is no committee or voting process.

## Roadmap

Proposed work belongs in a repository Issue and the
[planning Project](https://github.com/users/raymond-nassar/projects/1). The Issue records scope,
acceptance criteria, dependencies and discussion. Its open or closed state shows whether work is
active or completed. The Project tracks readiness, priority, work type, epic and scoring fields.
Its built-in status is a planning view, not a second completion record.

Rank uses WSJF: value, time criticality, and risk or opportunity scores, summed and divided by size.
The frozen [historical backlog](PRODUCT_BACKLOG.md) preserves the original rationale, delivered
items, and declined ideas. It is not an active work list.

- **Large ideas may wait.** Smaller items can rank higher even when the larger work is valuable.
- **Order can change.** Scores are revised as estimates improve.
- **Declined ideas stay visible.** Close the Issue with a reason rather than deleting it.

Each Issue records a check against the standing product constraints in
the [contributing guide](CONTRIBUTING.md).

## What ships, and when

Use one pull request per item unless the maintainer explicitly combines a delivery. On 2026-08-22,
the maintainer combined the remaining UX simplification work (BL-193 through BL-198 and BL-202) with the
owner-directed My Library and Search grouping in one delivery. That exception does not change the
default. All gates in [the contributing guide](CONTRIBUTING.md) must pass before merging.

Keep the implementation record on the Issue timeline and linked pull request. Follow
[release bookkeeping](#release-bookkeeping) for release-note records and final version changes.
A missing required record is a defect.

Fix review findings that matter to the current change. File the rest as repository Issues.
Do not report a clean review while a material finding remains open.

## Release bookkeeping

To avoid conflicts between independent changes, final version release PRs own `CHANGELOG.md`,
coordinated application version bumps, release summaries and optional project-wide prose or count
rollups. Feature PRs do not edit the changelog, create release summaries or bump the application
version.

User-visible behavior and release-relevant maintainer changes still need a complete proposed
user-facing release note and saved-data compatibility information in the feature PR description.
Keep that record in the linked Issue too, or link the PR's record from the Issue. State whether
saved data is unchanged, any effects on older builds or backups, and any required migration or
backup steps. Internal records, editorial-only maintenance, and agent or contributor instructions
need no release note unless they change release-relevant maintainer behavior. Do not create a
shared pending-notes file.

A final version release PR assembles and verifies the release-note and compatibility records of
merged changes. Combine them with already-existing `Unreleased` notes without dropping or
duplicating either source, preserve released history, and write the final version record once.
Resolve missing or conflicting records before finalizing; do not reconstruct approved wording
from memory or treat an unmerged proposal as delivered.

Required shared edits stay in the feature PR: runtime catalog or manifest registration, needed
generated indexes, source and provenance records, safety documentation, tests and evidence-anchor
or re-aim repairs. Documentation about actual behavior or sources stays timely. Counts and summaries
that an existing gate requires to be accurate must be corrected before the feature merges; they
are not optional rollups. Do not weaken gates or defer functional integration to reduce conflicts.
Dependency manifest and lockfile changes needed by a feature are allowed; the version-bump rule
covers coordinated application release versions, not dependency updates.

This boundary does not refactor catalog architecture or change platform release, signing, Android
code reservation or publication approval requirements in
[the coordinated release policy](docs/RELEASING.md).

## Releases

Follow [`src/js/lib/version.js`](src/js/lib/version.js). A major version marks a substantial new
product generation, not a collection of unrelated additions. It is also required when saved data
changes in a way an older build cannot read.

The maintainer chooses when to release; see
[Cutting a release](docs/MAINTAINING.md#cutting-a-release). CI runs the deterministic repository
gates. Release checks separately cover live metadata, installed-browser journeys, upgrade
compatibility, Windows packages, and remote publication. They need a network, installed software,
local Git history, or the remote repository and are not ordinary CI coverage.

[Coordinated versions and independent releases](docs/RELEASING.md) defines platform build identity,
Android code reservations, source-pinned artifact records and the delivered release matrix.
A shared product version never authorizes either Store: each platform needs its own explicit
approval and may publish on a different date.

## Moderation

The maintainer enforces [the code of conduct](CODE_OF_CONDUCT.md). Concerns about the maintainer
go to GitHub through the route in that document: a person cannot judge a complaint about themselves.

## Changing this

Anyone may propose a change through an issue and pull request. The maintainer decides.
Changing a standing product constraint requires evidence that its reasoning is wrong, not just
that a new feature would be useful.

## If the maintainer stops

There is no succession plan, backing organisation, or second maintainer. If work stops, the code
and decision records remain available. Anyone taking it on should read
[the license](LICENSE) and [data provenance](docs/DATA_PROVENANCE.md) to understand what can be reused.
