# Data provenance and the licence boundary

This repository ships an MIT licence and a tree of committed data. Those are two different
things, and until BL-099 the data described itself in a way that blurred them: one field named
`sourceLicense` held, for ten of twelve reading orders, a sentence about where the order came
from rather than any grant of anything.

This document is the inventory that field was standing in for. It records, for every committed
data file, where it came from, which fields were copied, and what the upstream actually states.

**It draws no legal conclusion, and it is not legal advice.** Whether the tree as a whole may be
redistributed is an open question recorded at the end, and it is what held this repository
unpublished until 2026-08-16. What else would have to change on the day that question is answered is
collected in [the publication runbook](PUBLICATION_RUNBOOK.md).

## Modern Marvel continuity intake

The modern Marvel continuity program keeps its intake flow at build time. It stores 86 Comic Book
Herald source links in [`scripts/data/cbh-modern-inventory.json`](../scripts/data/cbh-modern-inventory.json),
persists reviewed mappings and overlap reports under `scripts/data/`, and resolves issue references
without a browser runtime dependency. Its first four production batches publish forty normal catalog
orders containing 744 distinct issues. The inventory, mappings, reports, and preparation scripts do
not reach the browser; only the authored checklists and vendored order data do.

The second batch revisited early continuity gaps rather than jumping to the next pending inventory
position. Decimation, Realm of Kings, and World War Hulk stayed blocked on missing metadata or exact
issue overlap. Messiah War, Necrosha, and Second Coming replaced them without weakening the gates.
The third batch adds eight sections from one X-Men events page plus Doomwar and Spider-Island.
The fourth adds six event sections from two shared pages plus four dedicated event pages. It keeps
Minimum Carnage at the source's explicit six-issue line, Venomverse at its 11-issue core, Infinity
Countdown and Infinity Wars at the 46 explicit issue-by-issue rows, and Damnation at 15 issues.
`sourceSection` names the visible heading when several guides share an exact page URL, so source
identity is the page and section together without inventing a fragment or DOM id.
`sourceLicense` stays `null` for every published order, and each card records the permission boundary
in `sourceOrigin` as `Compiled for this project from Comic Book Herald's guide` and links to the
exact guide section followed.

## MCU Prep companion intake

The MCU Prep program is another build-time Comic Book Herald lane, kept separate from the
modern continuity and Character Spotlight inventories because its fourteen sources are movie and
streaming companion picks rather than events or single-character guides. Its maintained inventory
records one canonical WordPress identity, current content and issue-bearing digests, explicit source
boundary, delivery state, overlap ids, and follow-up or blocker for every user-selected title.

The first release publishes the first four priorities as 43 exact rows: 17 for Doctor Strange:
Multiverse of Madness, 17 for Spider-Man: No Way Home, 2 for Marvel Multiverse, and 7 for Marvel
What If?. The second release adds Spider-Man: Far From Home as 8 exact rows. The card type is
`screen-companion` and the reading depth is `selected`; both describe the project-authored product
surface rather than a field copied from the source. All five use `timeline: null` because their
selected issues span decades, and `beginner: false` so a two-issue subset does not become the
featured starting point.

Collection-only recommendations, unnumbered picks, contextual issue mentions, and explicitly
declined recommendations remain named exclusions. The two Marvel Multiverse issues are centrally
approved candidate-subsets of both Claremont paths, and five Far From Home rows are centrally
approved as a partial overlap with the existing Spider-Man best-of path. Neither relationship is an
exact duplicate. No source commentary, branding, layout, movie imagery, or comic image bytes are
copied.

## Character Spotlight partial-release intake

The Thanos Character Spotlight guide publishes 272 exact issue identities from a frozen source
boundary of 321 occurrences across 279 identities. Forty-two later source mentions remain explicit
in maintainer evidence without duplicating reader output. Seven source-required comics that the owner
verified are not on Marvel Unlimited remain at their original source positions as closed availability
exclusions, not placeholders or synthetic issues. Their separate future-availability work is assigned
in [Issue #235](https://github.com/raymond-nassar/recap-page/issues/235).

Twelve published identities are absent from the configured metadata provider. Their reviewed Marvel
issue IDs, titles, numbers, series identities, and exact issue links are pinned as facts; metadata the
provider does not return stays null or empty. Missing optional metadata therefore does not shorten a
reading guide or prevent an otherwise reviewed release.

The complete-library report compares the guide with all 137 other reading lists. Nine partial or
subset relationships are approved and the other 128 contain no shared issue. The guide is labeled
`partial` because the seven unavailable comics remain part of the source record but not the published
Marvel Unlimited checklist.

The Black Panther Character Spotlight follows the complete maintained source page from the
introductory Fantastic Four references through the latest additions. It preserves 424 explicit
issue occurrences across 367 identities: 363 exact provider-resolved comics and four open metadata
gaps. Fifty-seven repeated occurrences remain in the frozen source evidence while the checklist
publishes each canonical comic once. The four unresolved source positions remain visible in the
guide and have separate follow-up work in [Issue #281](https://github.com/raymond-nassar/recap-page/issues/281);
none is substituted or silently removed. Its complete-library review records eight partial
relationships and 139 no-overlap relationships.

Doctor Strange's complete guide retains the full visible page boundary: 932 source occurrences
across 76 issue-bearing blocks and nine top-level headings. It publishes 711 exact issue identities,
records 181 repeated source references once at their first occurrence, preserves 39 open metadata
gaps, and names one source exclusion. The open gaps retain their exact source positions and failed
provider lookups, with follow-up assigned in [Issue #283](https://github.com/raymond-nassar/recap-page/issues/283).
The complete-library report compares the guide with all 152 existing reading lists: three are
existing-subset relationships, 26 are partial, and 123 have no shared issues. The source groups and
gaps remain maintained evidence rather than replacements or invented issue identities.

The Daredevil Character Spotlight guide follows the full page because it has no separate qualifying
Best Comics or Essential Comics section. Its frozen source preserves 909 occurrences: 868 exact
issue identities, 33 repeated occurrences, and 8 explicit provider gaps. The published checklist
keeps each gap at its source position as a non-linked placeholder: Marvel Holiday Special #2;
Daredevil/Deadpool Annual '97; Typhoid Fever: Daredevil #1; Marvel Team-Up #56; Daredevil and the
Punisher: Child's Play (OGN); Daredevil/Bullseye: The Target (OGN); Daredevil/Spider-Man (OGN); and
Defenders #11. The separate [gap follow-up issue](https://github.com/raymond-nassar/recap-page/issues/287)
holds only future one-to-one identity research. The source range, source position, and unresolved
status remain intact unless exact provider evidence resolves an identity.

The complete-library report compares Daredevil with 153 reading lists. It records 19 approved
partial relationships, 1 approved existing-subset relationship, and 133 relationships with no
shared issue identities. The guide remains complete because its source boundary is the full page,
not because an unresolved identity is silently removed.

The Venom Character Spotlight follows the complete maintained page because it has no qualifying
Best Comics or Essential Comics subsection. Its frozen source evidence preserves 932 issue
occurrences across 646 identities: 610 exact provider-resolved comics, 286 intentional repeats,
33 explicit open metadata gaps, and three owner-authorized A-Z-absent omissions. The 33 gaps
remain visible in the published checklist and are tracked in
[Issue #288](https://github.com/raymond-nassar/recap-page/issues/288); none is substituted or
silently removed. Its complete-library review covers 154 current orders, with 22 approved
non-none relationships and 132 no-overlap relationships.

## Historical Comic Book Reading Orders intake

The historical event program is a separate build-time source family. Its maintained inventory records
the 58 entries that precede Maximum Security on the Comic Book Reading Orders Marvel event timeline.
Maximum Security and every later entry are excluded. Forty-six entries have dedicated event pages and
twelve use a visible label on the timeline page; page plus label is the source identity for those
twelve. The inventory also preserves universe scope: Marvel 2099 and MC2 are the only two entries the
source marks as alternate universes.

The first release publishes five dedicated pages containing 23 exact issue rows: Muir Island Saga,
Bloodties, Midnight Massacre, Child's Play, and Eighth Day. Each frozen packet binds the provider,
exact page, raw page SHA-256, issue order, exclusions, manifest proposal, chronology insertion, and
central source review. Mappings, complete-library and selected-peer reports, central approvals, and
authoring stay under `scripts/data/cbro-*`; none is labeled as Comic Book Herald evidence.

The first continuation release adds 32 exact issue rows across Reed Richards and Sue Storm's
Wedding, Kree-Skrull War, The Night Gwen Stacy Died, Avengers/Defenders War, and Thanos War. Three
entries bind a visible label on the maintained timeline page; the other two bind dedicated event
pages. The Kree-Skrull War report records the only non-none relationship, a centrally approved
nine-issue subset of Essential Avengers. The source inventory remains complete at 58 entries.

The second continuation release adds 35 exact issue rows across Original Clone Saga, Phoenix Saga,
Dark Phoenix Saga, Days of Future Past, and Contest of Champions. All five bind visible timeline
labels to the shared current timeline digest. Phoenix and Dark Phoenix are reviewed subsets of the
two Claremont guides. Days of Future Past is reviewed both as a subset of those guides and for its
one shared Marvel Multiverse issue. Each decision is limited to the named candidate, peer, exact
relationship, and shared issue IDs.

The third continuation release adds 48 exact issue rows across Marvel Super Heroes Secret Wars,
Kraven's Last Hunt, and Fall of the Mutants. Secret Wars binds a visible timeline label; the other
two bind dedicated event pages. Five named subset or partial relationships are centrally approved.
At that release, Wraith War, Secret Wars II, and Mutant Massacre remained blocked because exact ROM,
Micronauts, or Power Pack metadata was missing; none of those source rows was omitted or replaced.

The fourth continuation release adds 58 retained issue rows across Wraith War, Secret Wars II, and
Mutant Massacre. The frozen evidence conserves all 89 source rows and records 31 exact,
user-approved, guide-scoped exclusions for nonessential tie-ins that are not discoverable through
Marvel Unlimited. The omitted rows have no fabricated metadata and no availability state. All three
cards use non-complete depth, name the omission in the checklist, and link to the full source order.

The fifth continuation release adds 71 exact issue rows across The Evolutionary War, Inferno,
Atlantis Attacks, and Days of Future Present. All four complete-library and selected-peer reports
contain only `none` relationships. Days of Future Present includes exact issue 12360, clearing its
earlier metadata blocker. Acts of Vengeance remains wholly blocked because Web of Spider-Man #62
and #63 are absent from the configured series; all 70 source rows remain preserved in the batch
evidence and none is replaced or silently omitted.

The sixth continuation release adds 46 exact issue rows across X-Tinction Agenda, Operation:
Galactic Storm, Dead Man's Hand, and Rise of the Midnight Sons. All 496 current-library and
selected-peer comparisons contain only `none` relationships. The Infinity Gauntlet remains wholly
blocked on Sleepwalker #6, and Infinity War remains wholly blocked on 14 exact missing issues.
Complete blocker records preserve all 51 and 52 source rows respectively; no missing row is replaced
or silently omitted.

The seventh continuation release adds 23 exact issue rows across X-Cutioner's Song, Mys-Tech Wars,
and Fatal Attractions. All 381 current-library and selected-peer comparisons contain only `none`
relationships. For Love Nor Money, Maximum Carnage, Infinity Crusade, and Blood and Thunder remain
wholly blocked on 6, 1, 11, and 1 exact missing rows. Complete blocker records preserve all 80 source
rows, including the rows that do resolve; none is replaced or silently omitted.

The eighth continuation release adds 45 exact issue rows across Time and Time Again, Phalanx Covenant,
Operation: Zero Tolerance, and Spider-Man: Identity Crisis. Its four reports contain 524
current-library and selected-peer comparisons. Phalanx Covenant is a centrally approved nine-issue
subset of the broader Phalanx guide; all 523 other relationships are `none`. Road to Vengeance:
Missing Link, Siege of Darkness, Age of Apocalypse, Over the Edge, Onslaught Saga, and Heroes Reborn
remain wholly blocked on 6, 1, 1, 3, 1, and 4 exact missing rows. Their blocker records preserve all
210 source rows. Marvel 2099 and Second Clone Saga remain deferred for separate review. That release
paused at MC2.

The ninth continuation release adds 14 exact issue rows across The Hunt for Xavier and Magneto War.
Their reports contain 266 current-library and selected-peer comparisons, all with no shared issue.
MC2 remains wholly blocked with 17 exact metadata gaps across its complete 224-row source order and
keeps its alternate-universe classification. Apocalypse: The Twelve remains wholly blocked with 4 exact
gaps across 49 source rows. Eighth Day's 4 rows were already shipped and were not published
again. Position 58 exhausts the maintained pre-Maximum Security sequence; Marvel 2099 and Second
Clone Saga remain deferred for separate review.

Each catalog card uses `Compiled for this project from Comic Book Reading Orders`, links to the exact
event page, and keeps `sourceLicense` null. The source owner permitted credited and linked derived
orders except the Marvel Master Reading Order and Patreon-only orders. That permission covers the
source's own selection and arrangement, not Marvel material. The checklists retain factual issue
identities and order only; no source commentary, branding, images, or layout is copied.

## What the MIT licence covers

[`LICENSE`](../LICENSE) is a grant made by this repository's copyright holder over the material
this repository authors. That is the application source under `src/js/`, the build and check
scripts under `scripts/`, the tests, the styles and the documents.

A grant reaches only what the grantor holds. It says nothing about material this repository did
not author, and it cannot: nobody can license out what is not theirs. So the MIT text does not
reach the issue metadata described below, and the presence of a licence file at the root is not
a statement that everything beneath it is covered by it.

The reading orders under [`src/data/orders/`](../src/data/orders) are the case that same rule does
not settle, and this document does not settle it either. What was made here is a selection and an
arrangement: which issues to include, in what sequence, cut into which sections. What those files
name is Marvel's, issue by issue. Whether a selection of that kind is this repository's to license
is the fourth of the open questions at the end of this document, so it is left there rather than
answered here by assertion.

## The chain the metadata came down

Every issue-level record in this repository arrived through three hands, and it is worth naming
all three because each one narrows what the last can offer.

1. **Marvel's own API**, which is where the records originate and which has since been shut
   down.
2. **[marvel.geoffrich.net](https://marvel.geoffrich.net)**, a site holding cached Marvel API
   data, which is where the upstream project says it collected from.
3. **[`emreparker/marvel-comics`](https://github.com/emreparker/marvel-comics)**, which built the
   cache into a searchable API at `https://marvel.emreparker.com/v1` and is what this repository
   fetched from.

The upstream project describes itself in its own README as an unofficial fan project providing
metadata and links only, and states that Marvel and all related trademarks are the property of
their respective owners. Retrieved 2026-08-11.

### What the upstream conveys, precisely

This matters because two reading orders here used to claim `MIT (emreparker/marvel-comics)` as
their licence, and that claim was wider than what is on offer.

- The repository has **no `LICENSE` file**. GitHub's licence detection returns `null` for it and
  the licence endpoint answers 404. Retrieved 2026-08-11.
- Its README carries an MIT badge and a `## License` heading whose body is the single word `MIT`.
  That states an intention; it does not convey the licence text, which MIT itself requires to
  travel with copies.
- Its `pyproject.toml` declares `license = "MIT"` for the Python distribution named
  `marvel-metadata`, and that distribution's own build configuration packages
  `src/marvel_metadata` and nothing else. The `data/` directory holding the reading orders this
  repository vendored is not part of it.

So the honest reading is that the upstream states MIT over its code. The two Markdown checklists
vendored from its `data/` directory sit outside the distribution that declaration scopes itself
to, and no licence text accompanies them. That is why `sourceLicense` is now `null` for those two
orders: **null means nobody granted anything for this file, not that the file is unencumbered.**

## Inventory

### Reading orders, pinned

One hundred and forty-eight files under [`src/data/`](../src/data), one per curated list, holding
9,278 issue records covering 7,573 distinct issues. Each record copies from the upstream API:
`issueId`, `title`,
`number`, `url`, `seriesId`, `seriesName`, `onSale`, `mu`, `digitalId`, `pageCount`, a `cover`
object of `path` and `ext`, and `creators` of `name` and `role`. Across the one hundred and
forty-eight, 8,221 records carry a cover URL and 7,978 carry creator credits.

`description` was the field to look at hardest and is now empty. The others are facts about a
publication: which issue, in which series, on what date. A description was Marvel's own prose
reproduced verbatim, 798 of them and 151,840 characters, all removed on 2026-08-15 under BL-130.
The key is `null` on every record, the vendoring script no longer writes it, and a test refuses it.
A further 41, 7,193 characters, were removed from the design mockups described below, which a
first pass missed because it looked only at the files the catalog names.

Eight records copy nothing, and they are the only place the sentence above does not hold. Two sit in
[`src/data/xmen_claremont.json`](../src/data/xmen_claremont.json) and four in
[`src/data/xmen_claremont_complete.json`](../src/data/xmen_claremont_complete.json), standing for
checklist lines the upstream holds no issue for. Each carries `placeholder: true`, no `url`, and an
`issueId` computed here by [`scripts/vendor-orders.mjs`](../scripts/vendor-orders.mjs) from the
order and the title and then negated, so it can never be read as one of Marvel's. The two remaining
records preserve the unresolved Deadpool MAX source positions. The title is the
one written into an order compiled in this repository, so nothing in those six was fetched at all.
That is a statement about where the bytes came from and not about who may license them: the title
still names a Marvel series and issue, so these six sit inside the fourth open question at the end
of this document along with everything else under `src/data/`.

Cover art is referenced and never copied. `cover.path` is a URL on Marvel's image host and the
app renders it from there, so no image bytes are hosted, proxied, cached or stored. That is a
standing constraint of this project rather than an incidental property of the schema.

| Origin | Lists | What was compiled here |
|---|---|---|
| Assembled from Marvel series metadata (publication order) | 8 | The selection of series, and the rule that branded series are in and unbranded crossover chapters are out. Generated by [`scripts/build-event-order.mjs`](../scripts/build-event-order.mjs), so the derivation is a script anyone can read and re-run |
| Compiled for this project | 4 | The whole sequence, by hand. See the trail at the top of each file in [`src/data/orders/`](../src/data/orders) |
| Compiled for this project from Comic Book Herald's guide | 96 | The guide's issue selection and sequence, re-expressed as local checklists. Every card links to the exact guide followed |
| Compiled for this project from Comic Book Reading Orders | 38 | Factual issue identities and order from exact event pages or visible timeline sections. Every card links to the source followed |
| Vendored from `emreparker/marvel-comics` | 2 | Nothing. The order is the upstream curator's; only the issue lookups were done here |

### Series and creator indexes

[`src/data/series-index.json`](../src/data/series-index.json) holds 6,990 series and
[`src/data/creators-index.json`](../src/data/creators-index.json) holds 4,341 creators, each as a
positional array of `id`, `name` and `issueCount`. These are the upstream API's full listings,
committed so the catalog audit can work from bytes in the repository rather than several thousand
live requests. Names of series and of creators are facts about publications and about people; the
selection here is not editorial, because it is simply all of them.

### Order checklists

The one hundred and forty-eight Markdown files in [`src/data/orders/`](../src/data/orders) are
authored in this repository. One hundred and thirty are generated by committed scripts: eight from
series metadata, eighty-four from reviewed Comic Book Herald mappings, and thirty-eight from reviewed
Comic Book Reading Orders mappings.
Eighteen are compiled by hand. Every file carries its own derivation trail. Ninety-six name a
Comic Book Herald guide on their catalog card and link to the exact page or
section followed. Thirty-eight reference Comic Book Reading Orders and name it on their card.

### Design mockups

[`design/mockups/`](../design/mockups) holds five static HTML mockups and one data file,
[`design/mockups/mock-data.js`](../design/mockups/mock-data.js), which its own first line describes
as generated from one of the reading orders. It is the only vendored Marvel data in the repository
outside `src/data/`, and until 2026-08-15 it was the only one this document did not name. It holds
41 issue records with the same copied fields as an order, and it carried 41 descriptions, 7,193
characters, every one of them byte-identical to a description that was shipped under `src/data/`.
Those are now `null`. Four of the five mockups already rendered a fallback when the field was
absent and the fifth never showed a synopsis at all, so nulling changes nothing any of them draws
and they paint the way the app itself now does.

This subsection exists because a boundary defined by a list is a boundary somebody has to keep
complete. The first pass at BL-130 read the catalog, so it saw fourteen files and stopped, and the
test written to guard the removal inherited exactly the same blind spot. Both now walk the tree.

### Everything else

Source, scripts, tests, styles and documents are authored here and are what the MIT grant is
about. The design mockups above are the one exception inside a directory that otherwise holds only
authored work, which is why they are named separately rather than left to this sentence.

## What each field means now

| Field | Holds |
|---|---|
| `sourceOrigin` | Prose. Where the order came from and who compiled it. Always present. This is what the catalog shows a reader, because it is the credit that is owed |
| `sourceLicense` | An SPDX expression, or `null`. Only a licence actually conveyed with the vendored order. `null` on all one hundred and forty-eight shipped lists today |
| `sourcePage` | A link a reader can follow to the upstream, when there is one |
| `sourceSection` | A visible heading that distinguishes several guides on one exact page. Absent for an ordinary whole-page source |
| `spotlightKind` | An editorial classification required only for character runs. `best-of` and `complete-guide` make distinct, reviewable claims about a guide's scope; `other` records that neither claim is accurate. It is authored here and is never copied or inferred from an upstream field |

The validator in [`src/js/lib/curated.js`](../src/js/lib/curated.js) enforces the shape rather
than a list of known identifiers: a licence is an SPDX expression and a sentence is not, which
refuses all ten of the old prose values by construction rather than by anyone remembering to
check. The shape test is the point. An enumeration of permitted identifiers would be one more
list somebody has to keep complete.

The current Character Spotlight shelf has twenty-three readings across twenty-two stories. Six readings are
explicit Best of selections, thirteen are complete guides, and four are `other`. The two X-Men readings
share one story and one classification. The Doom primer and Essential Avengers remain under All
rather than acquiring a claim their source boundaries do not support.

Groot's Complete guide preserves all 76 issues in its reviewed source order. Its 41 shared issues
with Rocket Raccoon and 25 with Star-Lord are partial relationships between separately sourced
guides, not permission to merge a card or shorten a sequence.

The Deadpool Best of guide preserves thirteen source recommendation groups through 56 source
occurrences: 38 distinct issues publish exactly, sixteen later source references remain attached to
their first canonical issue, and two Deadpool MAX identities remain explicit metadata gaps. The guide
stops before the source page's exhaustive chronology. The two gaps are tracked in Issue 275 rather
than being guessed or dropped.

The Amazing Spider-Man complete guide is compiled by hand, like the Best of Spider-Man reading it
shares a story with, rather than carried through the frozen-packet pipeline the six other complete
guides use: it is not derived from Marvel metadata and cannot be checked against it, only the issue
ids and titles come from Marvel, by resolving each issue the source guide names. Of 2,043
source-defined rows, 1,937 resolve to an exact Marvel issue; the remaining 106 ship as explicit
plain-text placeholders, never an invented identity, and are tracked for follow-up research in a
linked GitHub issue. It overlaps 32 other catalog entries, the largest being 209 shared issues with
the Best of Spider-Man reading and 16 each with the Hickman Fantastic Four, No Way Home, and
Spider-Verse orders.

Some source guides name one comic in more than one collected range. The frozen packet preserves that
fact without turning it into a second reading step. Its canonical rows contain each distinct comic
once at the first source occurrence. A separate repeated-reference ledger records every later source
position, the earlier canonical row, and both the raw and normalized issue identity. Packet and
mapping digests bind the ledger, and approval independently reconstructs the mapping positions and
source count.

Groot now records 84 source occurrences and 76 distinct issues. The later Annihilators #1-4 and
Annihilators: Earthfall #1-4 blocks remain explicit evidence rather than exclusions, while the
published checklist still contains 76 unique comics. Sources with no repeated whole issue omit the
optional ledger and keep their existing evidence shape.

This representation does not make an unavailable issue optional. Iron Man's 815 source occurrences
can be represented as 813 distinct issues, including both later Tony Stark: Iron Man #15-16
references, but the guide remains deferred because the metadata contract cannot resolve nine other
source-required issues. No shortened Iron Man order is published.

Star-Lord's Complete guide preserves all 99 issues in displayed source order. Its 25 shared issues
with each of Rocket Raccoon and Groot, 7 with War of Kings, and 1 with Infinity Countdown and
Infinity Wars remain in every distinct guide. The linked Annihilation: Conquest Starlord miniseries
is excluded because the source gives it no issue-bearing range; product links are not inferred into
the checklist.

## Where the chain stops, and why no other chain replaces it

The first hand in that chain closed. Marvel's developer portal was retired on 2025-10-29, per the
deprecation notice carried by [`fakeheal/marvel-sdk`](https://github.com/fakeheal/marvel-sdk),
retrieved 2026-08-12, and the cache the other two are built on stops on exactly that date. Walking
every 2025 record in the vendored mirror gives a maximum on-sale date of 2025-10-29, a query for
2026 returns nothing at all, and the monthly totals for July to October 2025 run 85, 78, 76 and 83,
so a full month of output is followed immediately by silence. That is not a mirror lagging behind a
live source. It is a source that stopped, and waiting does not change it.

The consequence is already committed. 63 of the 4,299 curated items across the 102 orders hold
a record carrying nothing beyond the issue's id, title, number and marvel.com link, with every other
field of the thirteen listed above null or empty. All 63 are in the two Ultimate universe orders,
and because those two overlap they are 34 distinct issues rather than 63. The twelve orders added in
BL-141, the ten each added in BL-181, BL-182, BL-185 and BL-186, and the five historical orders in
each of BL-206 and BL-211 added none, because every issue in them was on sale before the portal closed.

The six placeholders are not among those 63, and the two are worth keeping apart because they fail
for opposite reasons. A placeholder marks a line the upstream never had an issue for, so no lookup
was attempted and there is no Marvel link to hold. These 63 were looked up and came back empty, so
the link is there and everything behind it is missing. Counted together they are the 69 items the
app treats as carrying no metadata.

Nothing already saved is affected. The tree holds 3,393 distinct cover URLs across 4,023 records; 60
of the 473 distinct URLs the tree held on 2026-08-12, sampled evenly across that whole set, all
returned an image. That is a sample and not the population, so the claim it supports is that nothing
suggests the stored URLs have stopped working. The loss is prospective only.

Three databases were assessed on 2026-08-12 as a possible second hand, and the licence question
this document exists to keep straight is what separates them.

| Source | What it conveys | What was verified |
|---|---|---|
| Grand Comics Database | CC BY-SA 4.0 over its records. Redistribution is permitted with attribution, and share-alike would put a second licence in this tree | Holds all three example issues, unauthenticated, with on-sale date, UPC and credits |
| Comic Vine | Term 5 of its API terms reads "Don't redistribute in another form. Do not edit, manipulate or reproduce on any other medium." A vendored file here is that | One example issue confirmed present, by page load |
| Metron | Terms could not be read directly. A secondary source reports personal, non-commercial, transitory viewing only, with mirroring and public display prohibited. Recorded as unverified | Nothing. The API answers 401 without an account |

Cover art and issue details have different answers, and the split is the useful finding. Details
can be had, cleanly, from the first of those three. Covers cannot be had from any of them.
Marvel's own image paths are opaque hashes, so one cannot be computed for an issue it never
published metadata for. The Grand Comics Database does return a cover URL, but that URL is
refused: on 2026-08-12 its image host answered 403 with a challenge page rather than an image, to
a HEAD request, to a plain GET, to a request carrying a current browser user agent, and to
requests carrying both its own issue page and this app's origin as referer. Because a challenge
page is exactly what a real browser might pass, the same URL was then opened in installed Edge,
where it also returned 403, rendered nothing, and never fired a load event as a cross-origin
image. The Marvel control in that same browser session rendered at 553 by 850.

Repository Constraint 1 permits storing a cover URL and forbids hosting, proxying or caching the
bytes. It is not the binding limit here. There is no cover URL to store.

Taking the missing records from each issue's own page on marvel.com is closed before it is
evaluated, by Repository Constraint 2.

## The open question

Every acceptance item of BL-099 is met except one, and it is the one that cannot be met by
writing anything:

> Obtain legal review before describing the complete data tree as MIT-licensed.

That review has not happened. Until it does, this repository does not claim the data tree is
MIT-licensed, and this document exists so that nobody infers the claim from the licence file's
position at the root.

On 2026-08-15 the owner recorded being satisfied with BL-099 and chose to move toward publication
without commissioning that review. That is a decision to accept the risk, not a finding that the
risk is absent, and it changes nothing above this line: the review still has not happened, the
questions below are still open, and this repository still makes no claim about the data tree. It is
written down because a decision taken in conversation and left there is one nobody can audit later.

The specific questions a review would need to answer, recorded so the work is not re-derived:

- Whether reproducing Marvel issue descriptions verbatim was within any exception. This was the
  largest of the four and is now the narrowest: the field was emptied on 2026-08-15, so it asks
  about git history rather than about anything this repository serves.
- Whether the series and creator listings, being facts, carry protection as a compilation at
  6,990 and 4,341 entries respectively.
- Whether a licence stated in a README, with no licence text and a package declaration scoped to
  a source directory, conveys anything for two files outside that directory.
- Whether a reading order, being a selection and arrangement, is this project's to license when
  the selection was made here, and whose it is when it was not.

### What could be asked, and of whom

All four are questions for a reviewer, and two of them have a half that only the upstream project
can answer. The third asks what that project's README licence was meant to cover, which is a
question about what it intended rather than about what the law makes of it. The fourth asks whose a
reading order is when the selection was not made here, and this document has already answered part
of it the same way: the order is the upstream curator's for the two vendored checklists. The first
and second reach nobody outside a review and get no shorter by asking.

What no correspondence reaches is the first hand. Neither the cache site nor the project this
repository fetched from holds rights in Marvel's material, so neither can pass any on, whatever
either says about its own work. That is this document's opening rule applied in the other
direction: a grant reaches only what the grantor holds. A permission covering the metadata would
have to come from the rights holder, and Marvel's developer portal closed on 2025-10-29.

That is not advice about whether to write to anyone, which is a decision this document does not
make. It is recorded so the next reader does not have to work out for themselves which of the four
questions an email could reach.

**The third question was asked on 2026-08-16**, as a public issue on the upstream repository:
[emreparker/marvel-comics#2](https://github.com/emreparker/marvel-comics/issues/2). It asks three
things: whether the MIT statement in that project's README and `pyproject.toml` is meant to cover
its `data/` directory as well as its Python source, whether the maintainer would add the MIT text as
a `LICENSE` file so the licence and copyright notice can travel with copies as MIT itself requires,
and what attribution wording they would prefer. It was asked in the open rather than by private mail
so that the answer is citable here and useful to anyone else who vendored from the same source.

It is unanswered at the time of writing, and this document does not assume an answer. The licence
for the two vendored checklists stays recorded as unknown in the table above, and unknown here means
nobody has granted anything rather than that the files are unencumbered. A friendly reply would
settle the third question and no other: the maintainer holds nothing over Marvel's material, so
nothing they say reaches the first or second question, and the first is the one this repository's
own removal work was aimed at.

### What was asked of the guide writers, and the one answer received

The fourth question has a half that nothing in this repository can settle: whose a reading order is
when the selection was not made here. Eighty-six of the 138 shipped lists name Comic Book Herald on
the card and link back to the guide they follow. The other externally selected lists are thirty-eight
Comic Book Reading Orders guides and the two vendored checklists in the table above. Two guide
writers have now been written to, and both have answered.

**Comic Book Herald was written to on 2026-08-19**, at the address published on its contact page. It
asked two things: whether more orders could be built from its guides, credited and linked back as
the twelve already are, and whether the site would treat this app as a companion for readers who use
Marvel Unlimited. It was answered on 2026-08-20 by Dave Buesing, the founder and editor-in-chief:

> Hi Raymond,
>
> Thanks for connecting. This looks like a very cool project! I appreciate that you have credited
> CBH for reading order work, and have no problem with you continuing to do so. Thank you for
> asking! That's more than AI would do :)
>
> I'll give it all a look as I have time to consider sharing out!
> Thanks!
> Dave
> --
> Dave Buesing
> Founder, Editor-In-Chief
> Site: comicbookherald.com

That is a yes to the exact pattern already in use on the twelve lists and a no to the idea that the
project would need to go back and rewrite them. It confirms the credit-and-link method, and it does
not grant a broader licence over Marvel's material or over the site's own editorial work. The reply
is recorded here because the sent email is not committed to this repository, and the message itself
is narrower than the broad grant that later arrived from Comic Book Reading Orders.

**Comic Book Reading Orders answered on 2026-08-20**, through the contact form at
[comicbookreadingorders.com](https://comicbookreadingorders.com/), and granted what the same request
had asked for. The reply is quoted rather than summarised, because its exceptions are the whole of
the point:

> Yes I am fine with you building reading orders from my site, credited and linked as described. I
> would ask two exceptions to this; the Marvel Master Reading Order and any reading orders that are
> Patreon exclusives.

"As described" refers to the request, which offered to credit Comic Book Reading Orders on the
catalog card of any list built from one of its guides and to link that card back to the guide page
the list follows, in the way the twelve Comic Book Herald lists already do. So the grant carries two
conditions and two exclusions:

- Credit the site on the card of every list built from it.
- Link that card back to the exact order page the list follows.
- Build nothing from the Marvel Master Reading Order.
- Build nothing from any reading order that site keeps behind its Patreon.

Thirty-eight lists in this repository now come from that site. Each credits Comic Book Reading Orders
and links to the exact source page and section followed, which is the pattern the reply permitted.
The site publishes no terms of use, which makes the reply the only statement of its position that
exists.

What the grant does not reach is the same thing no correspondence reaches. Comic Book Reading Orders
holds nothing over Marvel's material, so its yes covers its own selection and arrangement and stops
there. It answers the second half of the fourth question for lists built from that site, the same
way this document already answers it for the two vendored checklists, and it touches none of the
other three.

**[continuityguide.net](https://www.continuityguide.net/) was examined on 2026-08-20 and not written
to.** It publishes no terms of use and no privacy policy: the pages that would hold them are absent,
and the site's own configuration reports both as unset. The only statement it makes about itself is
a footer disclaiming any Marvel or DC affiliation, which says nothing about reuse of its own work.
Its robots file disallows a list of named AI crawlers, which is neither a licence nor a rule binding
a person who reads the site, but it is the only signal the site gives and it points away from bulk
reuse. It was not written to because its only published contact route is a Discord server whose
owner does not take direct messages. That is recorded so the route is not worked out a second time.

### What the first hand's own terms said

Those terms can no longer be read from Marvel. The terms page and the attribution page both answer
403, which is consistent with the portal's retirement recorded above. They were read instead from
the Internet Archive, at a snapshot taken 2025-10-08, three weeks before that retirement and so the
last state this document can evidence: the [API terms of
use](https://web.archive.org/web/20251008073256/https://developer.marvel.com/terms) and the
[attribution and rate limit
rules](https://web.archive.org/web/20251008073256/https://developer.marvel.com/documentation/attribution),
both retrieved 2026-08-15.

Five passages bear on this document, quoted rather than summarised because the wording is the whole
of the point.

- Section 4 grants "a limited, revocable, non-exclusive, non-assignable and non-transferable
  license to use the Marvel API (and related Content) and Tools in connection with your Apps", and
  continues "You may not (i) sublicense or transfer the foregoing right to any person or entity".
- Section 5 says a developer "may not (except with Marvel's prior written approval): (i) use any
  Content, or the Marvel API or Tools for any commercial purpose; or (ii) redistribute the Content
  or Tools except within your Apps".
- Section 5 also says "You may not change or edit the Content (e.g., modify, augment)."
- Its storage paragraph says "You may not indefinitely cache Content". The attribution page puts a
  figure beside that: "caching API call results for limited amounts of time is OK. Caching calls
  for 24 hours is usually a good amount."
- Section 7 says "Marvel owns all right title and interest in the Marvel API (and related
  Content)", and that the terms "grant you no right, title, or interest".

Two things follow from reading them, and neither is a legal conclusion.

The first is that displaying a description and shipping a copy of one are different acts under
those terms rather than two degrees of one act. Using Content inside an App is what the licence is
for, on a condition the attribution page states plainly: "You must attribute Marvel as the source
of data whenever you display any results from the Marvel Comics API". The app now names both the
Marvel origin and its actual route at `src/index.html:964`. Redistributing Content outside an App, and sublicensing it onward, are the
two things sections 4 and 5 name. An MIT grant is a sublicence to everyone who receives a copy, and
offers them "sublicense, and/or sell".

The second is that this repository never agreed to any of it, because it never called Marvel's API.
It fetched from the third hand in the chain above. That is not a wider permission, it is the
absence of one: a non-transferable licence is one the second and third hands had nothing to pass
down, which is this document's opening rule arriving at the same place from the other direction.

### How the sites that do show this prose are placed

The question this section exists to answer is why other sites display these descriptions. Two were
read again on 2026-08-15, and both point the same way.

Comic Vine's term 5 is already in the table above and reads in full "Don't redistribute in another
form. Do not edit, manipulate or reproduce on any other medium." Its own API page describes where
its records come from: "The data itself comes from a KISS-like-army of comic fans that contribute
millions of edits to the resource every year." League of Comic Geeks states "You may not duplicate
or copy any portion of the Service, unless otherwise set forth herein", retrieved from [its
terms](https://leagueofcomicgeeks.com/terms-of-use).

So the two sites nearest this app's purpose display publisher prose and refuse everyone else a
copy of it. The Grand Comics Database is the one of the three assessed above that does publish a
redistributable dump, under the CC BY-SA 4.0 recorded in that table. Whether the synopses in it are
written by its volunteers rather than reproduced from publishers was not established: `comics.org`
answered 403 on 2026-08-15 to both its download page and its documentation wiki, so it is recorded
here unverified in the same terms as Metron above.

None of that makes this tree's position better or worse than theirs, and it is not recorded to
argue that it does. It is recorded because the comparison is the first thing anyone asks, and
because the answer runs the opposite way to the intuition behind the question.

### The size of the question, measured, and what was done about it

A review is cheaper when there is less to review, and one field carried most of what was at issue.
Measured on 2026-08-15: 798 of the 1,473 curated records carried a Marvel description, 151,840
characters of it in all. Every other copied field is an id, a title, a number, a date, a series, a
link or a creator credit.

Dropping that one field was smaller than it sounds, and the numbers are here so the decision can be
read back rather than guessed at. 675 of those 1,473 records already carried no description, so the
app renders that state today rather than hypothetically. Those 675 do not render it the same way:
606 carry a series or digital id and get the sentence saying no synopsis is recorded, while 69 hold
neither and get the sentence saying the snapshot has no record of the issue at all, which is the
distinction drawn further up this document and worth keeping in view. The shared presentation
reaches the interface in the reading hero at `src/js/main.js:2799` and the issue-details view at
`src/js/main.js:1612`. The function behind both already answers for the absence at
`src/js/main.js:2986-2995`, with a test asserting the sentence it returns. It is also reversible:
the project this repository fetched from still serves the field,
the contract check having run on 2026-08-15 with 33 of 33 assumptions holding, so the vendoring
script can fetch it again if a review comes back permissive.

So it was dropped, under BL-130 on 2026-08-15. All 798 are `null`, the key stays present on every
record so nothing downstream changes shape, the vendoring script writes `null` instead of the
fetched value, and a test fails if any comes back.

### What the removal does not reach

It does not reach git history. The prose was committed, and a clone of a public repository carries
the whole history rather than only its latest state. Measured on 2026-08-15 across the 246 commits
then on `main`: 243 carry item description prose in the vendored orders, from which 455 distinct
descriptions and 89,460 characters are recoverable. The distinct figures are lower than the 798 and
151,840 above because the same issue appears in more than one reading order.

What the app serves is clean and what a checkout gets is clean. The object store behind it is not.
That is a publication decision rather than a code one, and it was taken on 2026-08-16: the owner
chose to accept, leaving the recoverable prose in place and publishing the repository as it stands.
The reasoning and what it was weighed against are in `docs/PUBLICATION_RUNBOOK.md`. What follows is
the measurement that decision was taken on, kept because a decision without its evidence is only an
assertion.

One correction to an earlier version of that paragraph, which said rewriting history was available
now at its lowest ever cost and that flipping the repository public was the moment that stopped being
true. The first half is misleading and the second is beside the point, because a force-push on this
repository does not reach the prose at all. A forge does not collect what a force-push orphans, and
it serves each of this repository's 116 pull requests a permanent `refs/pull/<n>/head` that the owner
cannot rewrite or delete. Fetching all 116 on 2026-08-15 found the same 455 distinct descriptions and
the same 89,460 characters sitting behind them, with 85 of the heads already unreachable from `main`.
Pull request refs are the easiest of several doors, not the only one: cached views addressed by SHA-1
are another. Rewriting is therefore necessary for the routes that work and sufficient for none of
them. What the flip actually closes is the choice between those routes, which is why it is settled in
the publication runbook rather than here, and why rewriting was not done on anyone's behalf.

Absent the legal review, the safe reading stays the narrow one: the MIT grant covers what this
repository wrote, and the committed metadata is Marvel's, held here under no stated permission.

### What is fetched at read time instead

The removal left every curated issue rendering an absence, which was the honest cost and not a happy
one. Since BL-134 the app can fetch a synopsis on request and display it without keeping it, which is
a different act from the one this section is about and is separated here so the two are not confused.

The distinction that matters is between distribution and display. A description committed to this
repository is redistributed by every clone, is served by the app to anyone the app is served to, and
sits in the object store afterwards. A description fetched because a reader pressed a button is
requested by that reader's browser from the service that holds it, shown once, and gone when the tab
closes. The second is what a browser does on any comics site, and the archived terms read under "What
the first hand's own terms said" separate those same two acts: a licence to use the content inside an
app, against an express refusal of the right to redistribute it or to cache it indefinitely.

Four mechanisms carry that promise, and they are listed because a promise nobody can check is worth
nothing. The saved-state normalizer does not carry a description field at all, so no path writes one,
including a restored backup or an imported checklist that had one smuggled into it. The app's own
response cache is stripped of the field before anything is written to it. Every request carries a
directive telling the browser not to store the response either, because the browser's cache is on disk
and outside this app's reach. And the response cache is emptied once on upgrade, since it may already
hold responses fetched before any of this was true.

The prose is shown, never stored, and never re-served: this repository ships none of it, and an
offline copy of the app shows the same absence sentence it showed before BL-134. The provenance notice
appears every time a fetch run is started rather than once, so the reader is told where the text comes
from at the moment they ask for it.

This changes nothing about the open question above. Marvel's rights in that prose are unaffected by
where it is displayed, and the service the app fetches from does not hold them either. What it changes
is what this repository distributes, which is the only variable on this side of the boundary.

## A second read-time source, under a share-alike licence

BL-150 added the only host this app contacts that is neither Marvel nor the metadata service. The
hand-entry form can ask the Marvel Fandom wiki about a title, and it asks only when the reader
presses the lookup button.

It exists because of the boundary recorded above. The snapshot stops at 2025-10-29, and the mirror
answers a query for the following year with a total of zero, so for a comic published since then
there is no release date, no page count and no credit list anywhere in this app. The wiki has all
three for issues well past that date, and it answers an anonymous cross-origin read with no key and
no account.

The licence position is not the same as the metadata service's, and the difference is the whole
reason this subsection exists. Fandom text is CC BY-SA 3.0, which is share-alike: prose taken from
it carries an obligation onto whatever it lands in, and committing any into this repository would
attach that obligation to the tree. A release date, a page count and a person's name in a credit
role are not prose. They are facts, and facts are not copyrightable, so reading them at run time
and showing them carries nothing with it.

The mechanism that keeps those two apart is an allowlist. The parser in `src/js/lib/wikitext.js`
admits a field only if the field is asked for by name, so a page can carry any amount of prose and
the parser will not notice it exists. The quotation, the appearance list and the story titles on a
real page are dropped because they are not on the list, not because anything names them for
exclusion, and a test asserts that none of them reaches a caller. Nothing from the wiki is written
to this repository, and the fixtures the parser is tested against are synthetic wikitext written
here with real field names and invented values, so no wiki text enters the tree even as test data.

Two things are deliberately not taken. No image is fetched from the wiki: its pictures are served
from a host this app does not pin, and the standing rule is that no comic image bytes are hosted,
proxied, cached or stored. And no prose is taken at all, which is the same position BL-134 reached
about synopses by a different route: that prose is fetched from the service that holds it and shown
without being kept, while this prose is not fetched in the first place.

One field needs its name saying plainly, because its name misleads. `MarvelUnlimitedID` on a wiki
page is Marvel's issue id, not the digital book id that the reader uses. Measured on 2026-08-19: the
issue id builds an official marvel.com page that answers 200 for an issue published in April 2026,
while an invented id answers 404, so the page is real rather than a soft failure; the service that
converts an issue id into a book id answers 404 for that same issue. So the id is worth taking, and
it reaches the comic's official page and never the reader. Opening the comic itself still requires
the book id out of an address the reader pastes.
