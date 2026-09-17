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
`sourceLicense` stays `null` for every published order, and the full attribution remains recorded
in `sourceOrigin` as `Compiled for this project from Comic Book Herald's guide`. Cards show the
linked website name and snapshot date without a disclosure; Preview shows the full attribution
and `sourceSection`, with the exact source URL unchanged. The persistent footer also credits
Comic Book Herald, Comic Book Reading Orders, and the upstream emreparker/marvel-comics repository.

## MCU Prep companion intake

The MCU Prep program is another build-time Comic Book Herald lane, kept separate from the
modern continuity and Character Spotlight inventories because its fourteen sources are movie and
streaming companion picks rather than events or single-character guides. Its maintained inventory
records one canonical WordPress identity, current content and issue-bearing digests, explicit source
boundary, delivery state, overlap ids, and follow-up or blocker for every user-selected title.

Six guides publish 107 exact rows: 17 for Doctor Strange: Multiverse of Madness, 17 for Spider-Man:
No Way Home, 2 for Marvel Multiverse, 7 for Marvel What If?, 8 for Spider-Man: Far From Home, and
56 for WandaVision. The card type is `screen-companion` and the reading depth is `selected`; both
describe the project-authored product surface rather than a field copied from the source. All six
use `timeline: null` because their selected issues span decades, and `beginner: false` so a small
subset does not become the featured starting point.

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
across 76 issue-bearing blocks and nine top-level headings. It publishes 734 exact issue identities,
records 182 repeated source references once at their first occurrence, preserves 16
owner-authorized unavailable source exclusions, and has no open metadata gaps. The complete-library
report compares the guide with 138 eligible reading lists: three are existing-subset relationships,
23 are partial, and 112 have no shared issues. All 26 shared identities are source-required; the
unavailable positions remain maintained evidence rather than replacements or invented issue
identities.

The complete Inhumans guide preserves all 354 positions from its frozen source snapshot. It
publishes 255 exact official issue identities, records four later references against their first
canonical rows, and keeps 95 source exclusions with no unresolved placeholders. Thirty-eight former
gaps now have verified official identities. World War Hulk #6 is excluded because the main series
ends at #5, while three unavailable `.Inh` identities remain explicit exclusions instead of being
replaced by base-numbered issues. The complete-library report compares the guide with 138 eligible
reading lists: one is an existing-subset relationship, 12 are partial, and 125 have no shared issue.

The complete Punisher guide retains the visible source page through Latest Additions: 857 source
occurrences across eleven source groups. It publishes 480 exact provider-resolved comics, preserves 145
repeated source occurrences, 158 open metadata gaps, and 74 explicit non-issue exclusions. The 158
unresolved identities remain visible as placeholders, while 23 later source occurrences repeat an
earlier unresolved identity without producing a duplicate Reading List entry. Live review verified
all 480 exact IDs, series, and issue numbers, and corrected 76 current Marvel detail links. The
current-library report records ten partial relationships and 146 with no shared issues. Remaining
metadata gaps are assigned in [Issue #298](https://github.com/raymond-nassar/recap-page/issues/298);
none is substituted or silently removed.

The Daredevil Character Spotlight guide follows the full page because it has no separate qualifying
Best Comics or Essential Comics section. Its frozen source preserves 909 occurrences: 869 exact
issue identities, 34 repeated occurrences, and 6 owner-authorized source exclusions. A provider
recheck on 2026-08-30 identified the source's singular Daredevil/Spider-Man OGN reference as the
[Spider-Man/Daredevil (2002) #1](https://marvel.emreparker.com/v1/issues/18826) one-shot already
published at its first source occurrence. The owner then supplied the exact official page for
[Daredevil/Deadpool Annual (1997) #1](https://www.marvel.com/comics/issue/43192/daredevildeadpool_annual_1997_1)
and authorized final-list omission for source issues unavailable or nonexistent in Marvel
Unlimited. Marvel Holiday Special #2; Typhoid Fever: Daredevil #1; Marvel Team-Up #56; Daredevil and
the Punisher: Child's Play (OGN); Daredevil/Bullseye: The Target (OGN); and Defenders #11 remain at
their exact source positions in exclusion provenance. The published checklist has no unresolved
placeholders, and no unavailable issue is invented or substituted. The
[gap follow-up issue](https://github.com/raymond-nassar/recap-page/issues/287) records the decisions.

The complete-library report compares Daredevil with 153 reading lists. It records 19 approved
partial relationships, 1 approved existing-subset relationship, and 133 relationships with no
shared issue identities. The guide remains complete because its source boundary is the full page,
not because an unresolved identity is silently removed.

The Venom Character Spotlight follows the complete maintained page because it has no qualifying
Best Comics or Essential Comics subsection. Its frozen source evidence preserves 932 issue
occurrences across 646 identities: 610 exact provider-resolved comics, 33 exact official-link-only
comics with refused optional details, 286 intentional repeats, and three owner-authorized
A-Z-absent omissions. All 33 former gaps retain exact transition evidence and working official
Marvel issue links without invented optional metadata. Its complete-library review covers 173
other current orders, with 24 approved non-none relationships and 149 no-overlap relationships.

Magneto's published order preserves all 811 positions from its frozen source snapshot. Its 695
resolved rows and 47 deliberate repeat links were assembled only from retained provider-resolution
cache records. The 58 unresolved positions remain visible as placeholders with cached candidate and
rejection evidence, rather than guessed identities. One repeat points to an earlier unresolved gap,
so its provenance records that source position instead of inventing a canonical resolved row.
The separate [gap follow-up issue](https://github.com/raymond-nassar/recap-page/issues/306) records
future one-to-one identity research without changing a source position or selecting a guessed issue.
The complete-library report compares all 157 other guides and records 10 existing-subset, 38
partial, and 109 no-overlap relationships.

The complete Adam Warlock Character Spotlight follows the full issue-bearing source page from his
Fantastic Four origins through Thanos Annual #1. It preserves 253 source occurrences across 228
identities: 224 exact provider-resolved comics, four open metadata gaps, and 25 intentional repeats.
The unresolved positions remain visible in the guide and are tracked in
[Issue #400](https://github.com/raymond-nassar/recap-page/issues/400); none is invented, substituted,
or removed. Four Original Graphic Novel labels remain explicit exclusions because the source does
not enumerate an issue identity. The complete-library report covers all 173 prior reading lists and
records 20 approved partial relationships plus 153 with no shared issue. No exact or subset
relationship exists.

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
again. Position 58 exhausts the maintained pre-Maximum Security sequence; at that point, Marvel 2099
and Second Clone Saga remained deferred for separate review.

Second Clone Saga is blocked with 20 exact metadata gaps across its complete 161-row source order.
Its blocker record preserves every source occurrence and exact configured result without publishing a
partial reading list.

Marvel 2099 publishes a selected alternate-universe guide from its complete 271-position source
order. The packet preserves 172 distinct exact issues, one later source occurrence of the same
2099 A.D. Apocalypse issue, and 98 owner-approved positions whose exact configured Marvel Unlimited
metadata could not be confirmed. The exclusions remain machine-checked in source order and are
settled through the owner's authorization in Issue #343 rather than guessed, substituted, or
silently removed. The complete-library
report records one partial relationship: Fantastic Four 2099 #1 also appears in the broader
Fantastic Four reading order.

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

Most bundled issue metadata follows this three-stage chain. Guide-specific independent factual
supplements are documented below rather than represented as responses from this provider.

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

Two hundred and sixty-two pinned reading-order payloads sit under
[`src/data/`](../src/data): 261 visible catalog files and one noncatalog partition parent. They hold
25,572 issue records covering 17,191 distinct tracked identities. The visible files hold 25,085 of those records;
the extra 487 are the retained Marvel Knights to Planet X parent whose ordinary children partition
the same vector. Records use these fields:
`issueId`, `title`,
`number`, `url`, `seriesId`, `seriesName`, `onSale`, `mu`, `digitalId`, `pageCount`, a `cover`
object of `path` and `ext`, and `creators` of `name` and `role`. Across all 262 payloads, 20,853
records carry a cover URL and 19,533 carry creator credits.

`description` was the field to look at hardest and is now empty. The others are facts about a
publication: which issue, in which series, on what date. A description was Marvel's own prose
reproduced verbatim, 798 of them and 151,840 characters, all removed on 2026-08-15 under BL-130.
The key is `null` on every record, the vendoring script no longer writes it, and a test refuses it.
A further 41, 7,193 characters, were removed from the design mockups described below, which a
first pass missed because it looked only at the files the catalog names.

Of the visible records, 1,024 are unopenable placeholders for unresolved source positions and 197
non-placeholder records carry neither a series ID nor a digital ID after an upstream refusal. Those
1,221 gap positions affect 28 catalog entries: thirteen carry placeholders, eighteen carry empty records, and
three carry both kinds. One legacy item retains a placeholder flag alongside real identity and launch
metadata, so it belongs to neither gap category. Placeholder
IDs are computed here by [`scripts/vendor-orders.mjs`](../scripts/vendor-orders.mjs) from the order
and source identity and then negated, so none can be read as one of Marvel's. These records preserve
their exact source positions rather than guessing or silently shortening a guide.

Cover art is referenced and never copied. `cover.path` is a URL on Marvel's image host, and the app
renders it from there without hosting, proxying, or writing image bytes to localStorage, IndexedDB,
or the Cache API. The browser may manage its ordinary web cache for that direct request. Keeping
image bytes out of application-controlled storage is a standing constraint rather than an
incidental property of the schema.

| Origin | Source orders | What was compiled here |
|---|---|---|
| Assembled from Marvel series metadata (publication order) | 8 | The selection of series, and the rule that branded series are in and unbranded crossover chapters are out. Generated by [`scripts/build-event-order.mjs`](../scripts/build-event-order.mjs), so the derivation is a script anyone can read and re-run |
| Compiled for this project | 6 | The whole sequence, by hand. This includes the noncatalog Marvel Knights to Planet X partition parent. See the trail at the top of each file in [`src/data/orders/`](../src/data/orders) |
| Compiled for this project from Comic Book Herald's guide | 130 | The guide's issue selection and sequence, re-expressed as local checklists. Every visible card links to the exact guide followed |
| Compiled for this project from Comic Book Reading Orders | 39 | Factual issue identities and order from exact event pages or visible timeline sections. Every card links to the source followed |
| Vendored from `emreparker/marvel-comics` | 2 | Nothing. The order is the upstream curator's; only the issue lookups were done here |

The 185 source orders generate 262 visible Reading Lists. Marvel Knights to Planet X is the only
partition: its 99 quoted source positions and 487 metadata-complete issues remain in one hidden
parent, while a checked ledger generates 78 ungrouped child payloads. Their separate 78-stop path
preserves owner order when timeline years move backward, and their overlap matrix is regenerated
against the current visible catalog rather than copied into historical reports.

### Series and creator indexes

[`src/data/series-index.json`](../src/data/series-index.json) holds 6,990 series and
[`src/data/creators-index.json`](../src/data/creators-index.json) holds 4,341 creators, each as a
positional array of `id`, `name` and `issueCount`. These are the upstream API's full listings,
committed so the catalog audit can work from bytes in the repository rather than several thousand
live requests. Names of series and of creators are facts about publications and about people; the
selection here is not editorial, because it is simply all of them.

### Order checklists

The 182 Markdown files in [`src/data/orders/`](../src/data/orders) are local source files.
The two upstream Hickman checklists are fetched separately when vendored. 176 local files
are generated by committed scripts: eight from series
metadata, 129 from reviewed Comic Book Herald mappings, and thirty-nine from reviewed Comic Book
Reading Orders mappings. Six local sources are compiled by hand. Every file carries its own
derivation trail. The 129 Comic Book Herald sources name that guide on their catalog cards and link
to the exact page or
section followed. Thirty-nine reference Comic Book Reading Orders and name it on their card.

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
| `sourceLicense` | An SPDX expression, or `null`. Only a licence actually conveyed with the vendored order. `null` on all 260 pinned reading-order payloads today |
| `sourcePage` | A link a reader can follow to the upstream, when there is one |
| `sourceSection` | A visible heading that distinguishes several guides on one exact page. Absent for an ordinary whole-page source |
| `spotlightKind` | An editorial classification required only for character runs. `best-of` and `complete-guide` make distinct, reviewable claims about a guide's scope; `other` records that neither claim is accurate. It is authored here and is never copied or inferred from an upstream field |

The validator in [`src/js/lib/curated.js`](../src/js/lib/curated.js) enforces the shape rather
than a list of known identifiers: a licence is an SPDX expression and a sentence is not, which
refuses all ten of the old prose values by construction rather than by anyone remembering to
check. The shape test is the point. An enumeration of permitted identifiers would be one more
list somebody has to keep complete.

The current Character Spotlight shelf has forty-seven readings across forty-six stories. Six
readings are explicit Best of selections, thirty-four are complete guides, and seven are `other`.
The two X-Men readings share one story and one classification, so the `other` group has six
stories. The Doom primer and Essential Avengers remain under All rather than acquiring a claim
their source boundaries do not support.

Groot's Complete guide preserves all 76 issues in its reviewed source order. Its 41 shared issues
with Rocket Raccoon and 25 with Star-Lord are partial relationships between separately sourced
guides, not permission to merge a card or shorten a sequence.

The Deadpool Best of guide preserves thirteen source recommendation groups through 56 source
occurrences: 38 distinct issues publish exactly, sixteen later source references remain attached to
their first canonical issue, and two Deadpool MAX identities remain explicit metadata gaps. The guide
stops before the source page's exhaustive chronology. The two gaps are tracked in Issue 275 rather
than being guessed or dropped.

The Amazing Spider-Man complete guide is compiled by hand, like the Best of Spider-Man reading it
shares a story with, rather than carried through the frozen-packet pipeline used by the other
mapped complete guides: it is not derived from Marvel metadata and cannot be checked against it,
only the issue ids and titles come from Marvel, by resolving each issue the source guide names. The
settled guide publishes 2,041 checklist entries: 2,034 exact Marvel issues and seven explicit
plain-text placeholders. Its former 103-row gap ledger resolves 88 source rows to 90 atomic
identities, records three repeats and five source-semantic exclusions outside the reading sequence,
and retains six provider-unavailability rows plus the original 1989 Parallel Lives identity without
invented ids, nonexistence claims, adjacent or base-number substitutions, or a later-edition
replacement. It overlaps 32 other catalog entries, the largest being 209 shared issues with the
Best of Spider-Man reading and 16 each with the Hickman Fantastic Four, No Way Home, and
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

Iron Man preserves 815 source occurrences across 813 source identities. Two later Tony Stark:
Iron Man #15-16 references repeat earlier canonical identities, and the never-published Viva Las
Vegas #3-4 identities remain explicit source corrections, so the published guide contains 811
canonical issues. Its settled metadata ledger records the nine historical failed lookups separately
from all thirteen owner-supplied identities. Crimson Dynamo #5-6 ids 309 and 293 are verified
provenance outside the accepted source boundary and are not added to the guide.

Wolverine preserves all 1,328 frozen source occurrences as 451 exact rows, 71 later occurrences of
an earlier exact identity, 50 explicit exclusions, and 756 provider-unavailable source identities
that remain visible provenance. The 60-row owner settlement records 15 exact identities, 3
source-level repeats, 27 availability-only rows, 10 source-semantic rows, and 5 later-source rows
outside the frozen boundary. The availability result does not authorize a substitute: only the two
named Avengers vs. X-Men: Infinite issues are omitted by owner policy, and all other unavailable
in-boundary identities remain visible. Retained placeholders continue to use their original
title-derived identifiers, so deleting and importing the guide again does not disconnect progress,
notes, or availability overrides.

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

Measured on 2026-08-12, 63 of the 4,299 curated items then present across 102 orders held a record
carrying nothing beyond the issue's id, title, number and marvel.com link, with every other field of
the thirteen listed above null or empty. All 63 were in the two Ultimate universe orders, and
because those two overlap they represented 34 distinct issues rather than 63. The twelve orders
added in BL-141, the ten each added in BL-181, BL-182, BL-185 and BL-186, and the five historical
orders in each of BL-206 and BL-211 added none, because every issue in them was on sale before the
portal closed.

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

Thirty-nine lists in this repository now come from that site. Each credits Comic Book Reading Orders
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
Marvel origin and its actual route at `src/index.html:1063`. Redistributing Content outside an App, and sublicensing it onward, are the
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
reaches the interface in the reading hero at `src/js/views/reading.js:581` and the issue-details view at
`src/js/views/issue.js:95`. The function behind both already answers for the absence at
`src/js/views/reading.js:79-87`, with a test asserting the sentence it returns. It is also reversible:
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

Five mechanisms carry that promise, and they are listed because a promise nobody can check is worth
nothing. The saved-state normalizer does not carry a description field at all, including for a
restored backup or an imported checklist that had one smuggled into it. The state update and backup
export boundaries refuse the field again, so a future writer cannot bypass that normalizer silently.
The app's own response cache is stripped of the field before anything is written to it. Every request
carries a directive telling the browser not to store the response either, because the browser's cache
is on disk and outside this app's reach. And the response cache is emptied once on upgrade, since it
may already hold responses fetched before any of this was true.

Copies kept specifically for recovery are the narrow exception. A pre-restore snapshot and every
salvage copy retain the exact bytes they were given, even when those bytes came from an older build or
cannot be read by this one. Rewriting unknown recovery material could destroy the only usable copy.
The pre-restore snapshot is replaced by the next restore or removed after a successful full erase.
Salvage copies remain until the reader explicitly removes them. When either kind is promoted into live
state, restore validation and the ordinary export boundary remove legacy synopsis prose before writing
the main saved-state key.

Newly fetched prose is shown, never stored, and never re-served: this repository ships none of it, and
an offline copy of the app shows the same absence sentence it showed before BL-134. The provenance
notice appears every time a fetch run is started rather than once, so the reader is told where the
text comes from at the moment they ask for it.

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

## Reading-path provenance

The generated catalog currently publishes three independent Reading Paths with 100 stops: two
authored paths with 10 and 12 stops from the curated manifest at
`src/data/curated-lists.json:6082-6120`, plus the 78-stop Marvel Knights to Planet X path generated
from its owner chapter ledger at
`scripts/data/marvel-knights-to-planet-x-lists.json:28-40`. The generated result keeps all three at
`src/data/catalog.json:9963-10088`.

A path carries its own id, name, description, source statement and ordered Reading List ids. It
does not copy issue rows, rewrite list identities, or enter saved reader state. The runtime resolves
all paths from the parsed catalog rather than reconstructing them from only the authored manifest,
so the generated partition path and any future overlapping paths retain their own order.

## Mephisto source boundary

The [Mephisto Reading Order - Comic Book Herald](https://www.comicbookherald.com/mephisto-reading-order/)
page was retrieved on 2026-09-15. Its 57 collection blocks define 558 issue occurrences, including
the Latest Additions entry for Avengers (2018) #31-38. The published Reading List contains 551
resolved comics and five explicit gap placeholders; two later mentions remain backward references
to the first occurrence rather than duplicate checklist entries.

The factual source ledger, frozen packet, exact mapping and relationship approval live under
`scripts/data/cbh-source-ledgers`, `scripts/data/cbh-packets`, `scripts/data/cbh-mappings` and
`scripts/data/cbh-overlaps`, each named `mephisto-reading-order.json`. The ledger records source
positions and identity corrections without copying the article's commentary or artwork. The
owner's supplied series links and clarifications are recorded in
[Issue #492](https://github.com/raymond-nassar/recap-page/issues/492).

The Wolverine Goes to Hell opening uses the 2010 series, not the 1988 series from the supplied
table. All four Mephisto Vs. installments use the same 1987 series. New Mutants #42-43 use the
2009 ongoing, and Incredible Hulk #33 uses the Hulk series begun in 1999. The 1997 Silver Surfer
annual remains the source's 1997 annual from the continuous run: the provider indexes that comic
separately as issue 76626, while #1 under the supplied shared series URL identifies the 1988
annual. The two standalone Thanos graphic novels retain their exact identities despite the
provider's issue number of zero.

Marvel Treasury Edition #2, the original Doctor Strange Annual #1, Epic Illustrated #1, the
original Triumph and Torment graphic novel, and Thor Annual #15 remain open metadata gaps.
[Issue #493](https://github.com/raymond-nassar/recap-page/issues/493) records the exact source
references and failed lookups. Later collections and neighboring issue IDs were not substituted,
and the missing records are not a claim about Marvel Unlimited availability.

Metadata for 413 resolved comics is reused from pinned payloads with file hashes and explicit
field-name adaptation recorded in the ledger. The remaining 138 issue records were fetched from
the configured metadata provider. Reuse does not claim that older availability hints were refreshed.

## Miles Morales source boundary

The [Miles Morales guide](https://www.comicbookherald.com/miles-morales-spider-man-reading-order/)
was retrieved on 2026-09-15. Its 60 collection blocks name 400 comic references. The explicit
Divided We Fall instructions defer six issues from the preceding collection to the crossover
and add Ultimates #18.1. This yields 395 effective source occurrences: 385 resolved originals,
one owner-approved exclusion and nine backward repeats. The published list contains 385 entries.

The source ledger, packet, mapping and relationship report are named
`miles-morales-spider-man-reading-order.json` under the corresponding `scripts/data/cbh-*`
directories. The ledger retains every collection reference, the six deferred references and their
effective positions, and the additional explicit issue. Its source-block digest hashes the
normalized factual blocks, not raw HTML. This standalone owner request adds a new character
inventory entry rather than claiming a position in the older hub census.

Sitting in a Tree and Worlds Collide alternate their parent series exactly as directed. Elsewhere
the guide's collection order is retained, including the 2019 Champions blocks before Worlds
Collide. The three Champions runs and the 2014 and 2019 Spider-Verse series remain distinct.
The introductory Ultimate Fallout #4 reference is context rather than a collection entry.
Spider-Man (2016) #11 and Miles Morales: Spider-Man (2018) #28 are not silently added where the
source omits them, and the jump to legacy numbering does not create an invented issue range.

The supplied Amazing Spider-Man series ID 26025 returns no provider record; the requested 2015
run is series 20432, which the provider labels 2017. Ultimate Comics X-Men series 13108 is labeled
2010 by the provider, and Ultimate Spider-Man #200 is issue 50446 in series 17580, labeled 2011
despite that issue's 2014 release. The source's Amazing Spider-Man Annual #19 is the 1985 comic in
the series begun in 1964, not a substituted modern annual. Five Last Remains LR issues retain
their independently verified IDs while the provider numbers them 50.1 through 54.1.

Ultimate Prologue #1 is an owner-approved source exclusion at position 67, not a substitute comic.
The owner could not find the title in Marvel Unlimited and
[approved its omission](https://github.com/raymond-nassar/recap-page/issues/500#issuecomment-5693130623).
[Contemporary reporting](https://bleedingcool.com/comics/so-what-is-marvels-ultimate-prologue/),
retrieved on 2026-09-16, records the label's removal from an Amazon collection listing. This does
not prove nonexistence or establish an alias to Survive! The ledger retains the original gap,
failed lookups and exact source reference, while the packet records a `source-exclusion`
transition. The other 385 exact issue identities stay in the same sequence.

Secret Empire #9 and #10 retain originals 64259 and 64285 in series 23020. The
[owner's supplied metadata](https://github.com/raymond-nassar/recap-page/issues/500#issuecomment-5693240536),
Marvel Database revisions and independent catalog entries supply separately reviewed factual
fields, not successful provider responses. The owner supplied 39 and 41 pages respectively.
There are 14 published story-credit entries for #9 and 24 for #10. All 25 source entries for #10
remain in the ledger, including the deliberately omitted Ron Lim penciler entry; his inker and
colorist entries remain. This follows the owner's count decision without changing the app's cap.

The owner also supplied official issue and cover URLs. Header-only checks found matching asset
responses on the already-permitted `i.annihil.us` host, including the renderer's portrait size.
No artwork bytes were read or saved. Both records retain `detailsRefused` from the actual HTTP
404 responses; digital-reader IDs and availability dates remain null, and no synopsis is pinned.
The original 383 successful response records and two refusals remain in the historical vendor
evidence. The other 383 issue records in this payload are unchanged by the follow-up.

These two factual supplements are deliberately hand-pinned. Ordinary provider vendoring does
not apply them. Until a new provider resolution is reviewed, preserve the pinned records or
reapply the ledger's `ownerMetadataSupplements[].pinnedFields` after vendoring, then run the
Miles settlement tests and `npm run vendor -- --catalog-only`. The source-review digest binds
the complete supplement evidence, and the regression tests reject erased fields or silent
credit truncation. Never manufacture successful API cache entries from owner or wiki data.

[Issue #500](https://github.com/raymond-nassar/recap-page/issues/500) owns this follow-up and the
remaining provider limitations; [Issue #496](https://github.com/raymond-nassar/recap-page/issues/496)
owns the original guide publication. The renewed relationship approval covers all 181 other
source orders: 26 partial overlaps and no exact or subset duplicate. Five later guides retain
their original comparison sets and scopes with explicitly recorded metadata-only library
binding refreshes. New imports receive the corrected data; saved libraries are not rewritten.

### Spider-Gwen / Ghost-Spider source guide

The [Spider-Gwen guide from Comic Book Herald](https://www.comicbookherald.com/spider-gwen-reading-order/)
was retrieved on 2026-09-15. Its 19 Collects paragraphs and 14 explicit crossover bullets define
139 issue occurrences. The Reading List preserves all 127 distinct comics at their first textual
positions, with twelve later references recorded as backward repeats and no unresolved issues.
All three Latest Additions collections are included, ending with Shadow Clones.

The factual ledger, frozen packet, exact mapping and relationship approval live under
`scripts/data/cbh-source-ledgers`, `scripts/data/cbh-packets`, `scripts/data/cbh-mappings` and
`scripts/data/cbh-overlaps`, each named `spider-gwen-reading-order.json`. The ledger retains the
issue-bearing source text and positions, not the article's commentary or artwork.
[Issue #495](https://github.com/raymond-nassar/recap-page/issues/495) records the owner's supplied
series links, source direction and acceptance criteria.

The first five-issue Spider-Gwen run and the later ongoing both began in 2015, but their exact
series IDs are 19670 and 20505. The supplied Most Wanted? collection URL does not replace the
single-issue identity. Likewise, the crossover uses Silk's later 2015 run, series 20499, rather
than the earlier run supplied as a hint. The actual guide names Spider-Woman #6-7, and its explicit
list also names the standalone Spider-Women Alpha and Omega. Gwenverse is the 2022 five-issue
series, not a later year inferred from its position under Latest Additions.

The collection paragraphs precede the explicit Spider-Women and Sitting In A Tree sequences
on the page. The checklist keeps first textual occurrence order rather than reconstructing
crossover chronology. The six repeated comics in each later sequence remain in the ledger;
Alpha and Omega retain their first positions as distinct one-shots. The linked Gwenom vs Carnage
collection has no issue numbers in the guide, so it is explicitly outside the source-defined
issue boundary. Its contents and the linked King in Black guide are not expanded into invented
source positions. This is a complete guide to the declared issue boundary, not a claim to every
Spider-Gwen appearance or every issue in the recommended collections.

All 175 other source orders were compared: four partial relationships were approved, with no
exact or subset duplicate. Metadata for 60 comics is reconstructed from pinned payloads with
LF-normalized source-file hashes and explicit field adaptation; 67 missing issue records were fetched from
the configured metadata provider. Pinned availability hints are not refreshed, and neither
those hints nor the absence of metadata is a claim about Marvel Unlimited availability.

## Ultron best-of source boundary

The [Best Ultron Comics: Reading Order History of Ultron](https://www.comicbookherald.com/best-ultron-reading-order/)
page was retrieved on 2026-09-15. Its fourteen explicit Issues, Collects and OGN blocks, plus the
named Annihilation: Conquest one-shot prologue and Nova #4-7, define 91 distinct comics. The
Reading List retains that source sequence through Latest Additions, with no gaps or repeated
sequence positions. It is a `best-of` selection with `selected` depth, not an appearance chronology.

The factual ledger, frozen packet, exact mapping and approved full-library relationship report
live under `scripts/data/cbh-source-ledgers`, `scripts/data/cbh-packets`, `scripts/data/cbh-mappings`
and `scripts/data/cbh-overlaps`, each named `best-ultron-reading-order.json`. The owner's original
series hints and acceptance criteria are preserved in
[Issue #498](https://github.com/raymond-nassar/recap-page/issues/498).

Origin, Return, Bride and Trial use Avengers (1963). Ultron Unlimited uses Avengers (1998);
Secret Wars uses the original 1984 twelve-issue series. The source's Age of Ultron prologue label
says Avengers Assemble, but its exact issue link identifies Avengers (2010) #12.1, issue 39852.
The Trial range prints an equals sign between #212 and #230 while linking to #211: the checklist
normalizes the printed range and does not add the out-of-range linked comic. Rage of Ultron is
the original 2015 graphic novel, issue 50076, with provider number 0 and an unnumbered title.
Ultron Revolution #1-12 is retained as the source's animated-continuity selection, not mislabeled
as ordinary main-continuity Avengers.

Unnumbered Starlord, Wraith, Someone and Runaways recommendations, the linked Age of Ultron
event guide, and contextual Avengers Forever and Origin references remain named boundary
exclusions. No complete runs, tie-in ranges or repeated sequence positions are inferred from
those mentions. No narrative or artwork is copied.

The ledger records 83 exact metadata records reconstructed from pinned payloads with file hashes
and explicit field-name adaptation, plus eight freshly fetched Ultron Revolution records from
the configured metadata provider. The five Tony Stark: Iron Man rows also reuse exact titles and
series names from the pinned Iron Man mapping, whose hash is recorded separately; missing optional
details stay null or empty. Reconstruction is not a new HTTP response or a refresh of older
availability hints. Synopses remain null and covers remain URLs only.

## Spider-Man 2099 source boundary

The [Spider-Man 2099 Reading Order - Comic Book Herald](https://www.comicbookherald.com/spider-man-2099-reading-order/)
page was retrieved on 2026-09-15. Its 23 collection blocks and explicit Fall of the Hammer sequence
define 177 issue occurrences across 170 distinct original identities. Seven later references
point backward to the first occurrence rather than duplicating Reading List entries. All four
issue-bearing Latest Additions blocks are included, ending with Miguel O'Hara - Spider-Man:
2099 (2024) #5. Linked guides are not expanded.

The factual ledger, frozen packet, exact mapping and full-library relationship report live under
`scripts/data/cbh-source-ledgers`, `scripts/data/cbh-packets`, `scripts/data/cbh-mappings` and
`scripts/data/cbh-overlaps`, each named `spider-man-2099-reading-order.json`.
[Issue #497](https://github.com/raymond-nassar/recap-page/issues/497) records owner direction and
the supplied series hints. The new character guide is distinct from the broader Marvel 2099
event order, whose source scope and historical omissions remain unchanged.

The annual in the second original collection is Spider-Man 2099 Annual (1994) #1, not a
1993 annual. Fall of the Hammer and Spider-Man 2099 vs. Venom 2099 remain source arc labels,
not invented series: their actual original issues, the Special, and the Meets Spider-Man
one-shot retain separate identities. The latter uses verified issue 65143 in current provider
series 44665 rather than the supplied series 23705. The original 1992, 2014 and 2015
Spider-Man 2099 runs remain distinct. Timestorm's two named one-shots and Exodus Alpha/Omega
are separate original comics, not replacements with neighboring numbered issues.

Source positions 59-66 preserve 2099: World of Tomorrow (1996) #1-8. The owner's inability
to find a dedicated Marvel series page is recorded as research, never as proof of Marvel
Unlimited unavailability. Original gaps cannot be filled with collections or unrelated titles.
Only factual issue references are retained; no source narrative or comic artwork is copied.

The published list contains 155 exact comics and 15 visible metadata-gap placeholders.
The seven source-defined 2099 Unlimited issues and eight World of Tomorrow issues are tracked
in [Issue #501](https://github.com/raymond-nassar/recap-page/issues/501), with exact source positions
and failed lookups. The supplied 2099 Unlimited series endpoint returned 404; successful
broad-title searches returned no items for either title. Neither outcome establishes availability.
The full source-library review covers 178 other orders: five partial relationships and 173
with no shared issue identities.

Metadata for 57 comics is reused from pinned payloads with file hashes and explicit field
adaptation. The remaining 98 issue records were fetched through the configured rate-limited
provider. The ledger distinguishes reuse from fresh HTTP responses; optional missing fields
remain null or empty, synopsis text is not shipped, and covers remain URLs only.

## Bucky Barnes / Winter Soldier source boundary

The [Winter Soldier (Bucky Barnes) reading order](https://www.comicbookherald.com/winter-soldier-bucky-barnes-reading-order/)
was retrieved on 2026-09-15. Its 63 issue-bearing collection blocks and two linked one-shots
define 485 source occurrences through Thunderbolts (2023) #4 under Latest Additions. The published
Reading List contains 480 exact comics and four gap placeholders. The second What If? (1977) #4
reference points backward to its first occurrence instead of creating a duplicate checklist row.

The source ledger, packet, mapping and complete-library approval share the
`winter-soldier-bucky-barnes-reading-order.json` name under their maintained `scripts/data/cbh-*`
directories. [Issue #499](https://github.com/raymond-nassar/recap-page/issues/499) preserves the
owner's series hints and scope decisions. Secret Empire and War of the Realms are pointer-only
links, not issue ranges to expand. Black Widow (2020) is an unnumbered ongoing recommendation.
All three remain explicit exclusions; source-defined Standoff tie-ins retain their actual series.

The tentative Marvel Universe series hint was verified against seven original 1998 issue records,
each with a contemporary publication date and Roger Stern writer credit. No handbook or collection
replaces those originals. Captain America and Bucky retains its legacy numbers in the 2011 series;
the Bendis and Al Ewing New Avengers runs stay distinct. The source's 2018 FCBD Captain America
story uses its exact Avengers issue container rather than an invented separate issue.

Invaders (1975) #24, Secret Wars (2015) #0, Runaways (2015) #1 and The Punisher (2016) #229 remain
open metadata gaps at source positions 113, 395, 405 and 446.
[Issue #504](https://github.com/raymond-nassar/recap-page/issues/504) records the exact originals,
successful series lookups and failed search matches. Missing metadata is not an availability claim.

Metadata hydration reuses 247 pinned payload records and 14 mapping-only identities, with file
hashes and reconstruction provenance. It fetches the remaining 219 issue-detail records through
the shared build-time limiter. Mapping-only reconstruction leaves unavailable optional fields empty;
reuse is not a fresh HTTP response. The complete-library review covers 179 other source orders:
31 partial relationships, four existing-subset relationships and 144 with no shared issue.
No source commentary, artwork bytes or runtime dependency is added.

## Donny Cates creator guide

The [Donny Cates Marvel Universe reading order](https://www.comicbookherald.com/donny-cates-marvel-universe-reading-order-2017/)
was retrieved on 2026-09-15. Its six sequence sections define 88 original issues, normalized into
35 ordered range blocks, from Doctor Strange #381 through Thor (2020) #5. The list uses
`creator-run` and `selected`, appears on the line-wide shelf, and does not claim to collect every
comic written by Cates. The existing intake identity and position are retained; the build-time
guide-type enum now accepts the same creator classification already supported by the app.

The source ledger, packet, mapping and relationship report use
`donny-cates-marvel-universe-reading-order-2017.json` in their maintained `scripts/data/cbh-*`
directories. [Issue #514](https://github.com/raymond-nassar/recap-page/issues/514) preserves the
owner's original series hints, including malformed URL slugs, and approved scope decisions.
Exact provider issue links identify originals; publisher pages were not scraped to repair hints.

The Doctor Strange collection summary is reconciled to the source's explicit Damnation
interleaving, not read as a second pass. The source recommends the entire five-issue Death of the
Inhumans limited series without a numbered collection line; its count and collection link are
retained beside the five verified originals. Thanos Wins uses Thanos (2016) #13-18 and its annual.
Venom: War of the Realms uses Venom (2018) #13-16 in the same series, not a separate title.
The Absolute Carnage pointer remains separate from the existing 31-row event checklist.
Neither that pointer nor the contextual War of the Realms core-event mention is expanded.

All 88 identities resolve without gaps or repeated checklist rows. Metadata hydration reuses
76 exact pinned payloads with file hashes and explicit field adaptations, then fetches 12 missing
issue-detail records through the shared limiter. Reconstructed payloads are not represented as
fresh HTTP responses. The complete-library review covers 181 other source orders: 16 partial
relationships and 165 with no shared issues. No source narrative, artwork bytes or runtime
dependency is added, and missing optional metadata remains empty rather than an availability claim.

## Falcon / Sam Wilson / Captain America source boundary

The [Falcon / Sam Wilson / Captain America guide](https://www.comicbookherald.com/falcon-sam-wilson-captain-america-reading-order/)
was retrieved on 2026-09-15. Its 67 issue-bearing blocks define 540 source occurrences from
Tales of Suspense (1959) #97 through Captain America: Symbol of Truth (2022) #11. The Reading List
publishes 494 canonical originals and preserves 46 later references as backward links to their
first occurrence. This includes both overlapping Sam Wilson Complete Collections and the repeated
Symbol of Truth #6 in Latest Additions. Seven pointer-only event recommendations remain explicit
exclusions rather than expanding into unrelated event checklists.

The source ledger, frozen packet, exact mapping and current-library approval use the
`falcon-sam-wilson-captain-america-reading-order.json` name under their maintained
`scripts/data/cbh-*` directories. [Issue #513](https://github.com/raymond-nassar/recap-page/issues/513)
preserves the owner's source notes and complete series-hint table. The guide is classified
`complete-guide` because every explicit source identity is retained, not because missing provider
details are treated as available.

Falcon (1983) #1-4 and Falcon (2017) #1-5 remain separate original series. All-New Avengers and
All-New, All-Different Avengers resolve to the same 2015 series. Fear Him keeps the four requested
2014 Infinite issues, not the 2015 collected edition or the two extra Infinite issues the source
does not request. Villains for Hire #0.1 and the named Standoff Alpha and Omega one-shots remain
individual comics.

Independent issue records identify Avengers Assemble #15AU as exact issue 45879, which the provider
numbers #15; Captain America (2017) #25 as exact issue 64178 under its Steve Rogers series; and the
2022 Captain America #0 as exact issue 98662 under its 2018 series. Each identity bridge retains
the source wording, secondary evidence URL, provider response and matching publication date.
No suffix, year or issue number was stripped merely to force a match.

Twelve original Captain America: Sentinel of Liberty (1998) issues are absent from the provider's
series listing. Each secondary issue page independently supplies its exact Marvel issue ID,
62354 through 62365; these were read individually rather than extrapolated. The owner-supplied
series identity is retained, and canonical official issue routes use those IDs without invented
slugs. The evidence is explicitly secondary, not a successful provider response or a live publisher
page check. Optional dates, covers, reader IDs, creators and page counts remain unknown. These are
known original identities, not unresolved placeholders or claims of Marvel Unlimited availability.

All 180 other source orders were compared: 34 partial and three existing-subset relationships
retain their shared issues, while 143 have no overlap. No exact duplicate exists. Pinned metadata
reuse covers 235 issues with file hashes and reconstruction provenance; 247 newly fetched detail
responses use the shared build-time limiter. The other twelve identities use the secondary evidence
described above. Synopsis fields stay null, only cover URLs are retained, and no runtime
dependency or saved-state format changes.

## Vision source boundary

The [Vision guide](https://www.comicbookherald.com/the-vision-reading-order/) was retrieved on
2026-09-16. Its 47 issue-bearing blocks define 531 whole-issue occurrences through Avengers Inc.
(2023) #5: 493 exact originals, four open metadata gaps and 34 backward repeats. The Reading List
contains 497 canonical entries. Twelve explicit Material From references remain fragment
exclusions rather than additional whole-comic recommendations. The source ledger, frozen packet,
mapping and relationship report use `the-vision-reading-order.json` under their maintained
`scripts/data/cbh-*` directories.

[Issue #521](https://github.com/raymond-nassar/recap-page/issues/521) preserves the owner's source
notes and series-hint table. Both Avengers Origins: Vision references resolve to the same 2011
one-shot, despite the later source heading and provider title saying 2013. Vision (2002) and
Avengers Icons: The Vision are the same four-issue series; their later appearances and the
repeated 1994 mini remain backward references. The titled What If? stories are the 1989
originals, not the supplied 1977-volume hint. No Surrender remains Avengers (2016) #675-690.
Annual placements and the alternating Worlds Collide chapters follow the source's instructions;
event pointers do not expand the named core ranges.

[Issue #522](https://github.com/raymond-nassar/recap-page/issues/522) tracks West Coast Avengers
Annual (1986) #1, Avengers Spotlight (1989) #23, and Avengers (1998) #1 Rough Cut and #1 1/2.
They remain visible negative-ID placeholders at their canonical positions. Failed fractional
searches are recorded as service errors, not proof of comic absence or Marvel Unlimited
unavailability. The guide is classified `partial` and `other`.

The full source-library review covers 182 other orders: 41 partial relationships, two existing
subsets and 139 with no shared issue. All source-required shared comics remain included.
Metadata hydration reuses 394 pinned payload records, reconstructs six exact mapping-only
identities with unknown optional fields, and adds 93 fresh provider responses. Every reused file
is hashed and field adaptations are explicit; reconstruction is not a fresh HTTP response.
Cover reconstruction uses the provider's `cover` object, retaining pinned URLs rather than
discarding them under an unsupported field name. All synopsis fields remain absent or null,
including nested candidates. No artwork bytes, runtime dependencies or saved-state changes are added.

## Emma Frost source boundary

The [Emma Frost guide](https://www.comicbookherald.com/emma-frost-reading-order/) was retrieved on
2026-09-16 through the final X-Men (2021) #26 in Latest Additions. Its factual ledger preserves
300 source blocks. The selected reading follows 116 Emma Frost cuts instead of their associated
118 collection-content blocks, with 47 collection fallbacks and three standalone issue blocks.
The first cut explicitly identifies Emma's appearances; the broader collection contents remain
evidence rather than a second reading sequence.

The selected sequence preserves 802 whole-issue occurrences: 791 exact originals, two open
metadata gaps and nine backward repeats. Its 793 canonical entries honor eleven explicit
before, after, between or deferred-reading placements. The named original one-shots resolve
from exact original-issue evidence, not a series-wide expansion. Generation X Ashcan Edition
remains an unnumbered exclusion, and material from Generation X Collector's Preview is not
promoted to a whole comic. X-Men #25 is not named by the final source and is not inserted.

[Issue #528](https://github.com/raymond-nassar/recap-page/issues/528) retains the owner's complete
219-line series-hint attachment as unverified research context. The metadata provider separates
New X-Men (2001), X-Men (1991), X-Men (2004) and Academy X; the attachment's shared-series
assumption is not used. Annual years resolve to separate original volumes. E Is for Extinction
uses original issues rather than the supplied collection link. The Secret Empire Captain America
#25 resolves to the independently pinned Steve Rogers original. The reviewed Inhumans evidence
pins Uncanny X-Men 15.Inh to issue 48673, whose metadata number is 15; no generic suffix removal
is performed. Source labels and every correction remain in the ledger.

[Issue #529](https://github.com/raymond-nassar/recap-page/issues/529) tracks Generation X Annual
(1998) #1 and the ambiguous X-Men: Hellfire Gala (2023) #1 identity. The annual is absent from
successful exact-year and broad-title searches; the Gala has two same-title, same-number
provider candidates, and the source's Amazon link does not distinguish them. Neither is replaced
by a neighboring year, a lower ID, or an availability
assumption. Both remain visible negative-ID placeholders, and the guide is labeled `partial`
and `other`.

The full source-library report covers 183 other orders: 69 partial relationships, two existing
subsets and 112 without shared issues. All source-required shared comics remain. Metadata
hydration reconstructs 417 pinned payloads and uses 374 fresh provider issue responses. Fifteen
sparse pinned records regain titles and series names from separately pinned exact mapping
facts, and one regains its issue-zero number. Reused files and supplemental fields have explicit
hash provenance; reconstructed records are not fresh HTTP responses. No synopsis prose,
artwork bytes, runtime dependency, origin or saved-state change is introduced.

Emma's source-file fingerprints normalize CRLF to LF before hashing UTF-8 text so Windows
and Linux verify the same committed content. The originally observed checkout-byte hashes
remain alongside them. Provider-body and source-page hashes are not normalized.

## Doctor Octopus / Otto Octavius source boundary

The [Doctor Octopus guide](https://www.comicbookherald.com/doctor-octopus-otto-octavius-reading-order/)
was retrieved on 2026-09-17. Its full issue-bearing boundary runs from Amazing Fantasy #15
through Amazing Spider-Man (2018) #64. The page has no labeled character cuts or Latest Additions
section: all explicit collection contents and standalone numbered references are retained.
Unnumbered event and guide pointers remain named exclusions rather than inferred miniseries.

The factual ledger preserves 62 blocks and 499 source occurrences: 482 exact original issues,
ten open metadata gaps and seven backward repeats. The checklist publishes 492 canonical entries,
including a visible placeholder for each gap. [Issue #531](https://github.com/raymond-nassar/recap-page/issues/531)
records scope and supplied identity hints; [Issue #532](https://github.com/raymond-nassar/recap-page/issues/532)
tracks the unresolved originals and failed lookups. Series-page existence is not proof of an
individual issue record or Marvel Unlimited availability. The card is `partial` and `other`.

Original publication identities override collection grouping. Rescue is the 2010 one-shot;
the three Arms of the Octopus specials and Wolverine: In The Flesh are all 2013 originals.
The provider gives the All-New X-Men and Superior Spider-Man Team-Up specials Campbell
Interlocking Variant labels within the supplied original-year series. Successful broad searches
return those same single records. Their exact labels and links remain intact rather than inventing
unlabeled IDs or later replacements.

Amazing Spider-Man's 2014 Spider-Verse issues share one ongoing volume. The subsequent
Worldwide collections instead belong to the 2015-launched volume, which the provider labels
2017 despite its first issue's 2015 on-sale date. The source and metadata years remain separately
documented, as do its later legacy numbers. The 1999 relaunch owns the earlier legacy issues,
and the final #64 belongs to the 2018 series. Superior Spider-Man's 2013 and 2018 volumes remain
distinct. Silk #14-17 uses its 2015 ongoing; Prowler retains only the source's #1-5, not an
inferred six-issue run. Spider-Geddon likewise retains the source's #0-4 without adding #5.

The full source-library report compares all 184 prior orders: 27 partial relationships,
two existing subsets and 155 with no shared issues. Every source-required shared comic remains.
Hydration reconstructs 430 exact pinned payloads with explicit field adaptation and portable
LF-normalized source-file hashes, retaining observed raw hashes alongside them. The remaining
52 issue-detail bodies use the shared metadata limiter. Reconstructed records are not fresh
HTTP responses. All new evidence recursively excludes synopsis prose, including nested lookup
candidates. No artwork bytes, runtime dependency, origin or saved-state behavior changes.
