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

Keep the implementation record on the Issue timeline and linked pull request. User-visible behavior
and release-relevant maintainer changes also need [a changelog entry](CHANGELOG.md). Internal records,
editorial-only maintenance, and agent or contributor instructions need no entry unless they change
release-relevant maintainer behavior. A missing required record is a defect.

Fix review findings that matter to the current change. File the rest as repository Issues.
Do not report a clean review while a material finding remains open.

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
