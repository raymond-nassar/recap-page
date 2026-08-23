# Governance

Who decides what, and how. This project has one maintainer, so the interesting question is not who
holds the authority but whether the reasoning behind a decision can be inspected afterwards. That
is what this document is for.

## The maintainer

[@raymond-nassar](https://github.com/raymond-nassar) is the sole maintainer and the only person
with write access. Every decision below is theirs unless it says otherwise.

There is no committee, no vote and no tie to break. Writing that down plainly is more useful than
describing a process that would have one participant.

## Roadmap

Everything under consideration lives in [the product backlog](PRODUCT_BACKLOG.md), one ranked table
with a detail block behind each row. An idea is not on the roadmap until it is in that table, and
things get onto it by being proposed in an issue.

Rank is computed rather than chosen. Each item carries a value, a time criticality, a risk or
opportunity score and a size, and the ratio of the first three to the last is what orders the
table. The reasoning for that choice, including why the more common alternative degenerates for a
single-user app, is written down under "Why WSJF" in the backlog itself.

Three things follow from ranking this way, and all three are deliberate:

- **A good idea can sit for a long time.** Rank is about the ratio, not about merit, so a valuable
  item that is also large will wait behind several small ones.
- **Order is not a promise.** The numbers get revisited when what they were estimating turns out to
  be wrong, and an item can move down as easily as up.
- **A declined item stays visible.** Items are marked as dropped with the reason rather than
  deleted, so the argument survives and does not have to be had again from scratch.

Each item also records a constraint check against the standing product constraints, which are the
things this project will not trade away. Measured on 2026-08-22: of the 179 items with a detail
block, 173 carry that check, and the only six without one are the six that were dropped. They were
dropped for different reasons, one for breaching a constraint before it was ever scored, and none of
them is missing a check that somebody forgot to run. [The contributing
guide](CONTRIBUTING.md) lists the constraints in the form a contributor needs.

## What ships, and when

Work lands as one pull request per item. The gates that have to pass are listed in
[the contributing guide](CONTRIBUTING.md) and enforced by CI, and the maintainer does not merge
past a red one.

Every change of substance also gets a written record in two places: the backlog block for that item
becomes a delivery record rather than a proposal, and anything a reader or a maintainer would
notice gets an entry in [the changelog](CHANGELOG.md). A change that lands without those is a
change the documents now disagree with, which is treated as a defect in its own right.

Findings from a review are routed rather than looped: what is material to the change in hand gets
fixed, and the rest becomes a backlog entry. This stops a single item spiralling through review
rounds chasing work that belongs to a later one. It is not a licence to ship a known material
defect, and reporting a review clean while one is open would be the failure this rule exists to
avoid.

## Releases

Versions follow the rule set out in [`src/js/lib/version.js`](src/js/lib/version.js): a major bump
means a build older than this one cannot read data saved by it. That is a stronger meaning than the
usual one, and it is chosen because reading progress lives only in the reader's own browser, so
there is no server-side migration to save anybody.

The maintainer decides when to cut one. The mechanics are in
[Cutting a release](docs/MAINTAINING.md#cutting-a-release). One step is not automated on purpose:
`npm run contract` calls the live metadata API and is deliberately outside CI, because it would
fail builds for reasons unrelated to the change under test, so it is run by hand before a release
is trusted.

## Moderation

[The code of conduct](CODE_OF_CONDUCT.md) sets the standard and describes what happens when someone
falls short of it. Enforcement is the maintainer's, with one exception that matters: a concern
about the maintainer goes to GitHub rather than to them, through the route named in that document.
A person cannot judge a complaint about themselves, and a governance document that did not say so
would be worth less than the paper it is not printed on.

## Changing this

Anyone may propose a change to any of these documents in the usual way, as an issue and then a pull
request. The maintainer decides. Where a change would alter one of the standing product
constraints, the bar is deliberately much higher, because those exist precisely so that settled
arguments stay settled: expect to be asked for evidence that the reasoning behind the constraint
was wrong, rather than for an argument that the new thing would be nice to have.

## If the maintainer stops

Worth stating before it is needed rather than after. There is no succession plan, no organisation
behind this and no second person with access. If the project is abandoned, it is abandoned with the
code under a permissive licence and the reasoning for every decision written down, which is the
most a single-maintainer project can honestly offer. [The license](LICENSE) covers what this
repository authors, and [the data provenance record](docs/DATA_PROVENANCE.md) sets out what it does
not, which is what anyone picking it up would need to know first.
