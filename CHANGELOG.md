# Changelog

Every notable change to Recap Page, newest first.

The version number is explained in [`src/js/lib/version.js`](src/js/lib/version.js) and is
summarised here: **MAJOR** means an older build cannot read data saved by this one, **MINOR**
adds a feature or changes the interface while leaving saved data readable by the previous
build, and **PATCH** fixes behaviour without touching either. Because reading progress lives
only in your own browser and no server can migrate it for you, export a backup before
upgrading across a MAJOR.

Releases are tagged `v<version>`. The version shown under **About this app** is the one to
quote in a bug report.

## Unreleased

### Added four more complete historical Marvel event guides

In plain English: X-Tinction Agenda, Operation: Galactic Storm, Dead Man's Hand, and Rise of the
Midnight Sons are now available as complete historical reading guides. They add 46 issues in their
source order, bringing the catalog to 125 reading lists, and nothing you have saved is changed.

The Infinity Gauntlet and Infinity War were not shortened to fit this release. Their complete 51-row
and 52-row source sequences remain preserved while one and 14 exact issues are missing from the
configured metadata. Acts of Vengeance remains separately blocked on Web of Spider-Man #62 and #63.
X-Cutioner's Song is the next historical guide in the queue.

For maintainers: four frozen packets, exact mappings, and complete relationship reports bind all 46
selected rows. The reports cover 496 current-library and selected-peer comparisons, all with no
shared issue. Two durable blocker records preserve every one of the 103 held source rows and name
each unresolved issue.

### Moved active planning out of the repository documents

In plain English: nothing in the app or anything you have saved is affected. Work still waiting to
be done now has one Issue each and a shared planning view, while the old backlog remains available
as a read-only history of what shipped, what was declined and why.

For maintainers: routine changes can use Direct or Lean workflow depth, new phase evidence stays
local, the publication gate rejects force-added session artifacts, and GitHub collapses only the
four explicitly derived output paths. The active Project carries 22 migrated work items and the
repository documents now link to it.

### Added four complete historical Marvel event guides

In plain English: The Evolutionary War, Inferno, Atlantis Attacks, and Days of Future Present are
now available as complete historical reading guides. They add 71 issues, preserve each source
sequence, and credit Comic Book Reading Orders. The catalog has since reached 125 reading lists in
this Unreleased build, and nothing you have saved is changed.

Acts of Vengeance was not shortened to fit the release. Its full 70-issue source order is preserved,
but Web of Spider-Man #62 and #63 remain missing from the configured metadata. The following
historical batch starts with X-Tinction Agenda.

For maintainers: four frozen packets, exact mappings, and complete relationship reports bind all 71
selected rows. The reports cover 480 current-library and selected-peer comparisons, all with no
shared issue. Days of Future Present now resolves its former blocker exactly as issue 12360.
### Added three exclusion-aware historical Marvel event guides

In plain English: Wraith War, Secret Wars II, and Mutant Massacre are now available as selected
historical reading guides. They add 58 issues, keep the source sequence, and clearly name the
31 nonessential tie-ins omitted because they are not discoverable through Marvel Unlimited. The
catalog now has 117 reading lists, and nothing you have saved is changed.

For maintainers: the release conserves all 89 source rows as 58 retained rows plus 31 exact,
guide-scoped exclusions. Three frozen packets, mappings, and complete relationship reports bind the
decision without inventing metadata or treating an omitted issue as unavailable.

### Added three more historical Marvel event guides

In plain English: Marvel Super Heroes Secret Wars, Fall of the Mutants, and Kraven's Last Hunt are
now available as historical reading guides. They add 48 issues from 1984 through 1992, retain the
source order, and credit Comic Book Reading Orders. The catalog now has 114 reading lists, and
nothing you have saved is changed.

Wraith War, Secret Wars II, and Mutant Massacre were not shortened to fit the release. Their missing
ROM, Micronauts, and Power Pack metadata is recorded so those guides can be researched without
guessing or silently dropping an issue.

For maintainers: the fixed batch-three release binds three current source packets, 48 exact metadata
rows, and 339 complete-library and selected-peer comparisons. Five reviewed subset or partial
relationships are explicitly approved; every other relationship remains none.

## 1.4.0

### Polished the ways to discover Reading Lists

In plain English: Home and Browse now use the shorter action headings Explore and Discover More.
The movie and streaming companion area is now named MCU Prep, and its cards stay the same height
as the other discovery choices. Nothing you have saved is changed.

### Added five more historical Marvel event guides

In plain English: Original Clone Saga, Phoenix Saga, Dark Phoenix Saga, Days of Future Past, and
Contest of Champions are now available as five more historical reading guides. They add 35 issues
from 1974 through 1982, retain the source order, and credit Comic Book Reading Orders. The catalog
now has 111 reading lists, and nothing you have saved is changed.

For maintainers: a third fixed historical release binds the shared timeline digest, five source
labels, 35 exact metadata rows, and current full-library reports. Seven reviewed overlaps are
explicitly approved for the X-Men and Marvel Multiverse guides; every other relationship remains
none. The prior historical releases were regenerated against the current catalog and retain their
separate compatibility contracts.

### Added five early historical Marvel event guides

In plain English: Timeline now begins with Reed Richards and Sue Storm's Wedding, then adds
Kree-Skrull War, Thanos War, The Night Gwen Stacy Died, and Avengers/Defenders War. Together the
five guides contain 32 issues from 1965 through 1974. Each card credits Comic Book Reading Orders
and links to the exact source page and section followed. The catalog now has 106 reading lists, and
nothing you have saved is changed.

For maintainers: the 58-entry historical inventory now records ten shipped guides, 44 ranked
candidates, two metadata blockers, one absorbed event, and one provenance blocker. Five reports
cover 101 comparisons each. Of their 505 relationships, the only non-none result is Kree-Skrull
War's centrally approved nine-issue subset of Essential Avengers. The original five-guide release
retains its defaults, IDs, evidence, and compatibility checks.


### Added MCU Prep companion guides

In plain English: Home and Browse now offer MCU Prep as a category. Opening it shows four
comic guides chosen to accompany Doctor Strange: Multiverse of Madness, Spider-Man: No Way Home,
Marvel multiverse stories, and What If?. Together they add 43 issue picks. Each guide says when the
source named only part of a broader recommendation, and nothing you have saved is changed. The
catalog now has 101 reading lists.

For maintainers: a fourteen-title inventory preserves the full user priority order while this
release advances only the first four. Four frozen packets resolve 43 exact, release-wide unique
rows. Each 100-comparison report covers the 97-list pre-publication library and the other three
release peers. Central review approves two Doctor Strange partials and the two-issue Marvel
Multiverse subsets of both Claremont paths. Exact duplicates remain unapprovable. Installed Edge
passed 184 assertions across 19 scenarios, including the populated category, child-route focus,
four-card source order, and one-column narrow layout. The README overview now avoids live catalog
counts and shows current Home and Avengers Disassembled views captured from clean current main with
cover art off.

### Gave Home a comic-book welcome

In plain English: Home now opens with a centered Electric Blue comic-style RECAP PAGE! title and the shorter invitation
"Browse. Choose. Read." The metadata credit now shares the footer line with the fan-project notice
and disclaimer link. Nothing you have saved is changed.

For maintainers: the app name is now the stable Home heading, while returning-reader content keeps
its own Continue reading heading. The combined footer wraps only when the screen is too narrow for
one line. The title has separate dark and light fills, a white ink outline in both themes, and a
system-colour fallback in forced-colour mode.

### Preserved repeated source references without repeating comics

In plain English: Reading Lists still show each comic once, even when the guide they follow names
that comic in more than one collected range. Nothing in your saved progress or any existing reading
sequence changes.

For maintainers: frozen source evidence records every later occurrence with its exact source position
and first-occurrence row. Both providers share validation and approval re-derives positions and counts.
Groot now records 84 occurrences while retaining 76 issues; its refreshed 96-comparison report adds
the factual 25-issue partial relationship with Star-Lord.

Iron Man remains deferred. Its repeated references are representable, but nine source-required
issues are absent from the configured metadata contract, so no shortened guide or replacement issue
was published.

### Added the complete Star-Lord character guide

In plain English: the Character spotlights shelf now includes a complete Star-Lord guide. It follows
all 99 source-defined issues from Marvel Preview #4 through Old Man Quill #12, including every issue
it shares with the separate Rocket Raccoon and Groot guides. The catalog now has 97 reading lists.
Nothing you have saved is changed.

For maintainers: this is the separately prioritized rank 15 release. A fresh 96-comparison report
records no exact or subset duplicate and four approved partial relationships: 25 issues each with
Rocket Raccoon and Groot, 7 with War of Kings, and 1 with Infinity Countdown and Infinity Wars. All
99 rows resolve exactly in source order and are bound to fresh source, packet, mapping, library, both
peers, report, approval, and authoring evidence.

### Added browsing by Marvel publishing age

In plain English: Home now offers Modern Age as a compact way into seven populated periods, from
Early Modern through the current era. Each period opens its own page with the
matching Reading Lists, including lists from different kinds of shelf when their dates belong
together.

Golden, Silver, Bronze and Copper have their own destinations but stay out of Home until the catalog
has matching dated content. Timeline is now named Modern Timeline, and its existing address
still works. Nothing you have saved is changed.

For maintainers: one registry defines five publishing ages and seven Modern subperiods. Half-open
year ranges give every transition year to the later period, dated stories select independently of
canonical shelves, undated stories are excluded, and empty categories remain directly routable but
hidden from gateways.

### Turned Home and navigation into reading hubs

In plain English: Home now asks how you want to read instead of placing every Reading List on one
long page. Browse offers the same category choices on its own page. Modern Timeline, Storylines and
Character spotlights are equal choices, and future categories stay hidden until content is ready.

Continue reading and Your Reading Lists still come first when you have saved progress. The featured
recommendation, catalogue filters and full card wall have left Home; those details remain on the
dedicated browse screens.

The sidebar now stays short as the library grows. It shows one active Continue reading choice plus
Library, Browse and Add. Saved lists and individual ways to browse or add are grouped on those hub
pages instead of becoming more sidebar rows. Nothing already saved is changed.

Opening an existing Reading List from Preview now closes Preview instead of leaving it over the
reading screen. Screen readers also hear when category and publishing results finish loading.

For maintainers: one renderer supplies the Home and Browse gateways, hub children keep direct
addresses, and each child selects its parent in the rail. The category registry remains independent
from the canonical three-shelf partition.
### Added the complete Groot character guide

In plain English: the Character spotlights shelf now includes a complete Groot guide. It follows all
76 source-defined issues from Tales to Astonish #13 through Groot #4, including every issue it shares
with the separate Rocket Raccoon guide. The catalog now has 96 reading lists. Nothing you have saved
is changed.

For maintainers: this is the separately prioritized rank 9 release, not an extension or reduction of
Rocket. A fresh 95-comparison report records no exact or subset duplicate and three approved partial
relationships: 4 issues with Annihilation: Conquest, 41 with Rocket Raccoon, and 7 with War of Kings.
All 76 rows resolve exactly in source order and are bound to current source, packet, mapping, library,
peer, report, approval, and authoring evidence.

### Added five historical Marvel event reading guides

In plain English: Timeline now reaches back before Maximum Security with five compact event guides:
Muir Island Saga, Midnight Massacre, Bloodties, Child's Play, and Eighth Day. Together they add 23
issues from 1991 through 1999. Each card credits Comic Book Reading Orders and opens the exact page
followed. The catalog now has 95 reading lists, and nothing you have saved is changed.

Two smaller source pages are not shortened to make the release. Days of Future Present and Countdown
remain blocked because the metadata snapshot cannot represent every issue they name.

For maintainers: a separate CBRO inventory preserves all 58 timeline entries before Maximum Security,
including blocked, absorbed, subset, alternate-universe, and deferred states. Five frozen packets bind
the exact provider, page bytes, 23 source rows, mappings, complete 90-list and four-peer reports, and
central approvals. All 470 relationships are none. Existing CBH packets retain their original defaults
and data paths.

### Added Rocket Raccoon complete character guide

In plain English: the Character spotlights shelf now includes a complete Rocket Raccoon guide. It
follows 75 issues from Tales to Astonish #13 through Guardians of the Galaxy Annual #1 in the source's
order. The catalog now has 90 reading lists. Nothing you have saved is changed.

For maintainers: the frozen 75-row source boundary resolves exactly with no unmatched or ambiguous
issues. Its report covers all 89 pre-publication readings and centrally approves three partial
relationships, sharing 10 issues with Marvel Fresh Start Avengers, 10 with Scarlet Witch Best Of, and
7 with War of Kings. Groot, Star-Lord, and Thanos remain deferred with their accepted boundaries intact.

### Added Character Spotlight guide filters

In plain English: Character spotlights can now be narrowed to Best of selections or complete guides.
All remains the default, and the grouped X-Men readings, Doom primer, and Essential Avengers remain
there without being given a label that does not fit them. Search, saved progress, and every existing
card are unchanged.

For maintainers: all twelve character readings now carry one validated editorial classification.
Five are Best of, three are complete guides, and four remain under All only across three stories.
Grouped readings must agree, generated data preserves the value, and unknown runtime values match no
subset.

### Added Phalanx and Phoenix character spotlight reading guides

In plain English: the Character spotlights shelf now includes complete guides for the Phalanx and
Phoenix. The Phalanx guide follows 28 issues from the New Mutants through Legion of X, while the
Phoenix guide collects 53 issue-specific picks through Immortal X-Men. The catalog now has 89
reading lists. Nothing you have saved is changed.

For maintainers: two frozen packets resolve 81 exact, peer-disjoint rows with no unmatched or
ambiguous issues. Each guide was compared with all 87 pre-publication lists and the other selected
guide. Phoenix has no overlap. Phalanx has two approved partial relationships, each sharing the
same eight Phalanx Covenant issues with a broader X-Men reading.

### Added the White Tiger character spotlight reading guide

In plain English: the Character spotlights shelf now includes Ava Ayala's complete White Tiger
reading guide. It follows 82 issues from Avengers Academy #21 through Marvel's Voices: Community #1,
credits the exact Comic Book Herald guide used, and keeps the source's 2021 label beside Marvel's 2022
publication record. The catalog now has 87 reading lists. Nothing you have saved is changed.

For maintainers: one frozen 82-row packet resolves with no unmatched or ambiguous issues. A complete
comparison with the 86-list pre-publication catalog records four approved partial relationships and
no exact or subset duplicate. The maintained 128-identity character inventory leaves every other
candidate deferred, excluded, or blocked.

### Added twenty more Marvel event and crossover reading orders

In plain English: the catalog now has 86 reading lists. Twenty new guides carry the event sequence
from Marvel Generations through Sins of Sinister, including Spider-Geddon, War of the Realms,
Absolute Carnage, Devil's Reign, and Judgment Day. Every card credits Comic Book Herald and opens
the exact guide followed. The Timeline gives the 2021 to 2024 stories their own named period instead
of leaving them unplaced. Nothing you have saved is changed.

One World Under Doom is not shown as a shortened or incomplete list. Its current checklist repeats
one issue and names at least ten issues the app's metadata source does not yet carry, so it remains
blocked until the full order can be represented truthfully.

For maintainers: 20 exact mappings preserve 436 ordered issue rows and add 422 issue identities not
already represented by the catalog. Three partial relationships received stronger-model approval:
Hunt for Wolverine shares one issue with Infinity Countdown and Infinity Wars, War of the Realms
shares 11 with the broader Thor best-of guide, and Judgment Day shares two with X of Swords. Secret
Empire, Empyre, and One World Under Doom retain evidence-backed terminal blockers.

### Made future Comic Book Herald additions use one frozen candidate packet

In plain English: adding another source-backed reading order no longer starts with editing the large
program that prepared every earlier batch. A maintainer can now freeze one candidate, give its issue
mapping to a bounded worker, and require a central overlap decision before anything is published.
This changes no reading list in the app, and nothing you have saved is affected.

For maintainers: canonical SHA-256 digests bind the frozen packet, resolved mapping, complete live
library, mapped peers, factual relationship report, and central approval. Exact duplicates stop;
either subset direction needs explicit central approval; partial overlap needs human or
stronger-model authority. Named preparation and authoring preserve every legacy batch, add no runtime
dependency, and are covered by nine focused semantic cases in the existing test files.

### Finished the UX simplification across browsing, search and the library

In plain English: the five ways to add issues now open as five separate screens instead of five
parts of one long page. Search issues remains the first stop and now groups the same choices the
navigation offers: browse by series, creator, character or reading guide, then paste a list or add
an issue by hand. The paste screen shows a real two-line checklist, and the optional Marvel
Unlimited address on hand entry stays out of the way until it is needed.

The first-run Home screen now opens with the shorter "Start Here" heading and no sentence explaining
the choices underneath it. The featured journey uses its right side for commitment facts and
actions instead of leaving that part of the card empty.

The navigation now treats named Reading Lists and the three views of saved progress as one My
Library group. Reading List is the product-facing name throughout headings, controls, empty states
and previews. On the front page, saved lists form compact tiles rather than page-wide bands, and
the single suggested starting point stops growing once its content has enough room. At the width
shown in the owner review, three saved orders sit in three columns instead of three full-width rows.
Continue reading now stands on its own without a sentence restating what it means, and its panel
uses the same bounded width. The three discovery groups also stand on their names without borrowing
the boxed era-break treatment or its explanatory paragraph from the dedicated browse screens.

Standing explanations have also been reduced across the rest of the app. Browse screens now stand
on their headings, Timeline keeps only its useful era context, and Add screens show one compact
destination inside the card where work happens. Progress methodology, manual-lookup privacy detail,
and name-index mechanics remain available through disclosures. Library uses compact sort labels,
Settings controls no longer repeat themselves, and the reading shelf reports only its issue count.
Safety, recovery, attribution, legal, empty-state, and destructive-action copy remains visible.

Timeline, Storylines and Character spotlights now use cover-led cards with one sentence, an issue
count and the actions needed to choose. Timeline now runs vertically through era milestones, year
groups and the cards published in each year. Empty years remain as small ticks, and the active year
stays beside its cards while scrolling. Storylines groups its cards by decade. Full descriptions,
reading choices, path details and source details remain available through compact disclosures or
Preview. Year labels no longer touch the circles beside them, and collapsing the sidebar keeps its
navigation icons visible while the destination list remains scrollable.

Home now keeps every Reading List card the same height. Path position and beginner suitability sit
as compact labels on the cover, while a story with multiple versions puts the option count in its
existing preview action. Nothing already saved is changed, and the previous combined Add address
still opens Search issues.

For maintainers: the five Add routes keep independent history and selected-navigation state, with
the legacy route canonicalised to issue search. The Timeline chronology derives 21 years from the
46 event stories and keeps 5 empty internal years visible. The three browse screens render 46, 6
and 7 safe cover-led cards; full
descriptions and variant selection remain in the existing preview dialog. Storylines derives the
2000s, 2010s and 2020s bands from its current data. The Timeline renders 4 era milestones,
16 populated year groups and 5 empty-year ticks; its year label moves above a one-column grid at
700px and below. All 59 Home cards now measure 273px at both
1280x900 and 2048x900, replacing the previous 273px to 397px range without restoring the 1,152px
of empty card space. Saved-order tiles are bounded at 384px, producing two columns at 1280px and
three at 2048px, while the first-run feature caps at 1,152px on the wide view and still fills the
available 964px at 1280px. The repaired Edge harness passes 145 assertions across 16 scenarios,
and all 36 targeted regressions are detected by the mutation proof.

Review follow-up restored a visible focus ring when navigation moves keyboard focus to a screen,
brought empty-year labels back above the text contrast threshold, and made their
screen-reader wording real text rather than a label on a generic element. Legacy Add links now
resolve before rendering, series and creator indexes warm on every route into those screens, and
the browser harness holds the Timeline reset, scroll and focus behavior.

### Said each thing once, in the words a reader already knows

In plain English: the same button had two names. Pressing it on a picture card on the front page said
"Add to library" and pressing it on a row on a browse screen said "Import", and both did exactly the
same thing, which is copy one of the bundled reading orders into your own library. Nothing is
imported from anywhere and nothing leaves your machine, so it is called "Add to library" in both
places now. The two browse screens were renamed for what is on them rather than how they were put
together: "Browse by era" is now "Timeline" and "Line-wide reading lists" is now "Storylines". Two
of the ways to add issues were renamed for the same reason, so the one that searches now says "Find
a series" and the one that takes text you paste says "Paste a reading list".

The screens themselves say a great deal less. Every row on every browse screen used to print who
put the order together, where it came from and when it was copied, in small grey text, forty-six
times over on one screen. That is now a "Source" line you can open on the one order you are
curious about, and it is still findable by searching the page. The sentence under each screen's
title repeated the description the front page already gives, so it is one short line now. The
three search buttons became a magnifying glass, since the box beside each one already says what it
searches. The strip at the very bottom of the front page offering a second way to start an empty
list is gone, because that way is permanently in the navigation strip anyway. The one thing that
got louder is the period headings on the Timeline screen: they now sit in a band of their own, so
scrolling past forty-six rows tells you when the period changed.

Two things were deliberately left as they were. The note saying that nothing is sent anywhere until
you press the button stays word for word, because it is a promise rather than a hint. And the box
for a Marvel Unlimited address stays, even though it was asked to go, because the form it sits in
exists for issues published after the built-in data ends, and for those there is no other way to
give the app a working link.

Nothing you have saved is affected, and no reading order, filter or setting was removed.

For maintainers: measured in Edge at 1280x900 against `main`, on the shipped catalogue. Visible
words fell on every screen touched: Timeline 2,833 to 2,205 with paragraphs 100 to 54, Storylines
692 to 611, character spotlights 1,128 to 1,031, the add screen 79 to 67, the landing page 3,566 to
3,548. Small-font nodes fell from 267 to 207 on Timeline. Controls reading "Import" went from 46, 6
and 7 on the three browse screens to 0; the one remaining "Import" is the paste form's own submit,
which parses text rather than adding a bundled order. The two names were one string typed twice and
are now one binding, so the row handler and the card handler cannot drift again. The three rail
subtitles were removed from the shelf table as well as from the markup, because no renderer had
drawn that field since the rail was rebuilt, so it declared copy that reached no screen. Provenance
is a `<details>` rather than the hover tooltip that was asked for: a tooltip reaches neither the
keyboard nor a touch screen, and Chromium opens a closed disclosure for find-in-page, so the words
stay findable. Each summary is named for the order it belongs to, since 46 controls named "Source"
is a list nobody can navigate. The icon buttons keep a 44px target, a `title` of "Search" and a
fuller accessible name each. Era bands went from weight 600 and no fill to weight 700 with a fill,
an outline and a 3px accent edge. Card heights are unchanged and the 125px spread across the 59
landing cards is filed as BL-194 with both attempted fixes costed and rejected there: clamping the
path sentence to one line recovered 19px and truncated nine of ten sentences mid-word, and
reserving two lines each for the title and description made the spread worse, 125px to 145px.
Details in BL-192 and BL-193, with the remaining requests filed as BL-194 through BL-197. The
browser harness was run against `origin/main` and against this branch: 109 assertions pass and 10
fail in both, the same 10 by name, so this change regressed nothing there and the standing failures
are filed as BL-198.

### Put every reading order on the front page, and gave each kind of reading its own screen

In plain English: the front page used to show twelve reading orders as picture cards and then offer
a button reading "See all 59 reading orders", which took you to a different-looking screen where the
same orders were plain rows. Asking for more of what you were looking at gave you something else,
which was the complaint. The front page now shows all fifty-nine straight away, as cards, and the
button is gone because there is nothing left behind it. The browse screens keep their list layout on
purpose: a list is how you read an index, and it is the only place that shows how deep an order goes,
who put it together, and the choice between reading it in full or in brief. Those screens are also
now three rather than one, so events, whole-line reading lists and single-character selections are no
longer shuffled together. One reading order changed shelf: the Essential Avengers selection is a
best-of the team's whole history rather than a moment in it, so it now sits with the other
character selections and no longer claims to belong to 1963. One consequence of splitting the
catalogue is that the ten stops of the bundled reading path no longer sit on one screen, so the note
telling you which order to read next is now a link on the two steps that change screen, and it
clears anything you had typed or filtered on the screen it takes you to, so the order it named is
really there when you arrive. The path's own name, printed on every step, now links back to the
first one for the same reason, on the steps that sit on a different screen from where the path
begins. Neither adds a word to the screen. Nothing you have saved is affected.

For maintainers: measured in Edge at 1280x900 with the cache disabled, the landing grid renders 59
cards where the cap allowed 12, in three groups, on a page 8,178 pixels tall. The shelf card's cover
image was the one image in the app with no `loading` attribute, so it fetched eagerly; with it added
the landing page issues 12 cover requests on first paint, against 59 measured with the attribute
taken back off. The page therefore went from 12 orders to 59 while asking the network for the same
number of covers. The catalogue is three routed screens holding 46, 6 and 7 stories, a complete
partition of the 59 held by a test that fails if any story reaches two screens or none. Era grouping,
screen membership and the modern-era boundary all come from one table, so adding an era is one row.
Eras declare closed bounds at both ends; a story matching none renders in a fallback section that
draws only when it has rows and claims no year range, and fails the build naming itself. Each era
heading prints the span its own rows cover, which is the early warning that a label has gone stale.
Row headings take their level from the screen, so the two screens without era heads no longer skip
from h1 to h3. The one bundled reading path crosses a screen at 2 of its 9 hops, so "Next" renders
as a hash link on those two and as plain text on the other seven, where the next stop is already
further down the same screen. Following one resets the destination's query and facet before the view
draws, because a screen holding a search from an earlier visit can be showing rows without showing
the one the link named: `x-men` on the era screen leaves 23 of its 46 rows and drops the first
crossing's target. A stop now carries the screen it is drawn on, resolved from the whole catalog, and
three tests hold that every stop is listed on the screen its own link names. The path name links to
the head of the path through the same function, which returns nothing when the stop is drawn on the
screen already being read, so the boundary and the arrival exist once rather than twice: 9 linked
names against 2 linked "Next"s, none on the landing page or the spotlights because both draw stop 1,
4 on the era screen and 5 on the line-wide lists. That is more link surface than the backward badge
that was costed and declined, on 9 rows against 2, and no more text, which is what was being
optimised. One row carries both, and its accessible name says where it goes without printing it.
Details in BL-189, with the deferred pre-modern screens in BL-190 and the path links in BL-191.

### Made the screens quieter and easier to scan

In plain English: the screens said too much. The settings page has been rebuilt so each choice is
one row with its control beside it and a single line of explanation; every longer explanation is
still there, one click away, and not a sentence was removed. The reading page used to tell you how
far through an order you were in five different places at once, twice of them the same number
subtracted from itself, and now says it once. The navigation strip down the left no longer pushes
settings, about and the connection status off the bottom of the screen. The three pages that can be
empty now offer the button they used to describe in words. Text sizes across the whole app come
from one small set rather than being picked one at a time, so headings and body text stop
disagreeing by a fraction of a pixel. Two smaller repairs came out of reviewing the work: the
keyboard highlight on the left-hand strip was being cut off at the edges, and the reading page's
progress circle had stopped saying that the numbers were about issues you had read, which mattered
to anyone using a screen reader. Nothing you have saved is affected.

For maintainers: 107 of 108 declared font sizes now resolve through a six step scale, taking the
landing page from 15 distinct computed sizes to 5. The settings view went from 383 words to 227
with every sentence preserved behind a disclosure. The reading view's header subtitle went from 543
characters to 19 and the order description moved to its own disclosure. The rail is now a fixed
column with a scrolling middle and a pinned foot, measured at 900px of content in a 900px viewport
where it was 991. The catalog's import buttons are outlines, taking the page from 59 filled accent
buttons to none and matching the rule the card grid already applied. The progress and library empty
states gained an action; the progress view withholds its counting methodology when it has no
figures. Structural tests for heading levels, group labels, binding ids and the privacy copy
extraction all pass unchanged, and two tests were added to hold the new empty-state action: one for
its shape, one that its destination is a view the rail can reach. Review then found three defects
and all three are fixed here: the reachability test's hand-written allow-list held three names that
are not views and omitted two that are, so it now reads the sections out of the markup; the ring's
accessible text regained the verb, since the circle is `aria-hidden` and those two spans are the
whole spoken statement; and the rail's focus ring is drawn inside the button, because the pane is a
scroll container and padding it cannot help a full-width button. That last one is not a regression,
measured as 13 of 13 controls clipped under the arrangement this replaced. Details in BL-187.

### Added ten more modern Marvel crossover reading orders

In plain English: the catalog now follows Minimum Carnage, X-Termination, The Enemy Within, Battle
of the Atom, Revolutionary War, and The Trial of Jean Grey before moving forward to Monsters
Unleashed, Venomverse, Infinity Countdown and Infinity Wars, and Marvel Damnation. Every new card
credits Comic Book Herald and opens the exact page or named section followed. Nothing you have saved
is changed.

For maintainers: the batch adds 128 distinct issues across ten exact mappings. The source evidence
keeps Minimum Carnage at six issues, Venomverse at its 11-issue core, Infinity at the 46 explicit
issue-by-issue rows, and Damnation at 15 issues. All 650 comparisons against 56 existing orders and
nine batch peers report no shared issue. The eight Monsters Unleashed tie-ins retain `1.MU` in
both their displayed titles and source numbers even though Marvel metadata represents them as `1.1`.

### Added ten more Marvel event and aftermath reading orders

In plain English: the catalog now carries the X-Men from the aftermath of Messiah Complex through
Manifest Destiny, Nation X, Curse of the Mutants, Age of X, Schism, and Regenesis. Wolverine Goes to
Hell, Doomwar, and Spider-Island fill three more gaps. Every new card credits Comic Book Herald,
opens the exact source page, and names the section when several guides share that page. Nothing you
have saved is changed.

For maintainers: the batch adds 200 distinct story issues across ten exact mappings. Manifest
Destiny's anthology material resolves to five numbered issues, Regenesis records and removes one
repeated Uncanny X-Men #3, and Spider-Island records its non-story Spotlight magazine as an excluded
source reference. All 550 comparisons against 46 existing orders and nine batch peers report no
shared issue. A source page plus its visible section is now the uniqueness key when a section is
present; ordinary pages remain unique by URL.

## 1.3.0

A flagship feature release that turns the tracker into Recap Page, expands the catalog from 26 to
46 reading orders, and redesigns every major reading workflow. This is a MINOR release because saved
data remains readable by the previous build. No migration is required: keep using the exact same
browser address, and export a backup as a routine precaution before replacing the old copy.

### A faster front door, with focused guides when you need the details

In plain English: the project page now gets a new reader from "what is this?" to a working tracker
in 118 lines instead of asking them to navigate an 849-line handbook. It keeps the product story,
privacy boundary, download, source startup, and safe upgrade path in one place.

Detailed setup, troubleshooting, maintenance, data authoring, and release procedures now live in
two focused guides. Nothing in the app or in saved reading progress is affected.

For maintainers: the release check now runs the actual v1.2.0 app, marks an issue read, and proves the
same order and nonzero progress survive the folder swap into 1.3.0.

### Added ten more early modern Marvel event reading orders

In plain English: the catalog now fills ten earlier gaps in Marvel continuity, starting with Maximum
Security and Planet Hulk, continuing through the modern cosmic events and the mutant Messiah story,
and ending with Second Coming and The Thanos Imperative. Every new card credits Comic Book Herald
and opens the exact guide section followed. Nothing you have saved is changed.

For maintainers: the batch contains 178 distinct issues across ten exact source mappings. Decimation,
Realm of Kings, and World War Hulk were blocked instead of guessed or duplicated, and Messiah War,
Necrosha, and Second Coming filled the three open slots in chronological order. All 450 comparisons
against the 36 existing orders and nine batch peers have zero shared issues.

### Dated evidence keeps the repository state it recorded

For maintainers: dated research, plans, and review records now resolve each evidence citation
against the commit that authored that line. Later code and documentation rewrites can move or
delete the original target without forcing a historical record to be rewritten or excluded from
the evidence check.

Current documents and new evidence still resolve against the tree being checked. Missing source
history, missing historical targets, and malformed ranges fail explicitly, and shallow clones are
directed to fetch full history. Nothing in the app or in saved reading progress is affected.

### One type and corner scale across the app, bigger click targets, and dialogs give focus back

In plain English: over many separate pieces of work the app had quietly collected 13 slightly
different text weights, 33 slightly different text sizes and 17 different corner roundings. Almost
nobody would name any one of them, but together they were why two buttons sitting side by side in
the same panel could have visibly different corners. Those now come from one small shared set, and
the two buttons match.

Six small controls were shorter than the 24 pixel minimum a target is meant to have, including both
of the buttons that delete things on the settings screen. All six are now tall enough to hit
reliably, which matters most if you use a touchscreen or have a less steady hand.

When you closed a confirmation box, with either the Escape key or the Cancel button, the app used to
drop you back at the top of the page. If you were working through a long list with the keyboard, or
listening to a screen reader, you lost your place every time. It now puts you back on the control
you opened the box from.

Nothing you have saved is affected, and nothing has moved on screen. Text sizes changed by at most a
sixth of a pixel, which was checked by comparing the measured position and size of every element on
every screen, before and after, rather than by eye.

### Added ten modern Marvel event reading orders

In plain English: the catalog now includes ten more event and crossover guides, from Secret War and
World War Hulk: Aftersmash through Axis, Spider-Verse, Apocalypse Wars, Clone Conspiracy, and
Inhumans vs. X-Men. Each card credits Comic Book Herald and links to the exact guide followed.
Nothing you have saved is changed.

For maintainers: the batch contains 238 distinct issues across ten exact source mappings. Twelve
earlier candidates were blocked rather than duplicated or guessed, and the final ten have zero
issue overlap with the existing catalog or one another. Vendoring produced zero unresolved rows,
placeholders, missing digital ids, missing covers, duplicate warnings, or count warnings.

### The settings screen is grouped, and each control confirms in its own place

In plain English: the screen for backing up and changing settings used to be one long stack of cards
with no grouping, so making a backup sat at the same level as a technical readout of how much space
the app was using. The screen is now sorted into four labelled groups, and backing up and restoring
comes first, because it is the thing worth finding quickly.

When you change a setting, the message confirming it now appears next to the control you used, in the
same card, instead of at the top of the screen where you might not see it. One knock-on of the old
shared message area is gone too: clearing the cache no longer wipes out a restore message you had not
finished reading.

The small status messages are now told apart by a shape as well as a colour, a tick, a triangle, a
cross or a dot, so they still read for you if your system is set to high contrast, where colour alone
is dropped.

Nothing you have saved is affected. Your reading progress is untouched, and every setting still does
what it did before; only the layout and the wording around it have changed.

### Adding issues now leads with search, and groups the other ways together

In plain English: the screen for adding issues used to show five ways to add, all folded shut and all
looking equally important, with searching for a title tucked in among them. Search is now open and
ready at the top of the screen, and the other four ways sit together lower down under a heading
"Other ways to add", each with a short line telling you what it is for before you open it.

When you search, the results now begin with a line telling you how many were found, how many are
already in your library, and which reading order they will be added to. Any issue you already have is
marked "Already in your library", so you are not left adding the same one twice. The series and
creator searches name the destination reading order now too, which they never did before.

Nothing you have saved is affected. Every way to add issues is still there and still works as before;
only their arrangement and the wording around them has changed.

### The library and progress views now show a summary before the rows

In plain English: the three screens that list what you have read now put a short summary above the
list, so you can see how much you have read without counting the rows yourself. Everything read is
now grouped by when you read it, under headings like Today and In the past week. The rows carry
small cover pictures, which makes an issue much quicker to recognise than a line of text. And all
three screens now use the full width of a wide monitor instead of staying in a narrow column.

Nothing you have saved is affected. Your reading progress is untouched. Only the way these screens
are laid out has changed.

### The reading screen tells you where you are, and fills the screen it is given

In plain English: the screen you use while working through a reading order now says how far along you
are in words. It used to draw a small ring and hide the actual figure in a tooltip, so you had to rest
the mouse on it and wait, and on a touchscreen you could not get at it at all. It now reads "0 of 8
read" with "8 to go" beneath it, in text, all the time.

The next issue to read is bigger and clearer. Its cover is about half again as large, the title is
larger, and the one button that matters, the one that opens the issue in Marvel Unlimited, is now the
biggest thing beside it. Marking it read stays where it was, and the link out to the issue's own page
is now drawn as a link rather than as a third button competing with the other two.

The strip of list housekeeping, renaming, notes, duplicating, exporting and deleting, is quieter. All
five are still there, still in the same order, and still reachable by keyboard, but they no longer look
as important as the reading buttons above them. The row of upcoming issues no longer cuts the last one
in half: it wraps onto a second line on a normal screen and stretches across a single line on a wide
one. The full order below is easier to run your eye down, with larger covers and a clear mark against
the issue you are on.

Nothing you have saved is affected, the filters, notes, availability marks and collected-edition
grouping all work exactly as before, and turning cover art off still works.

### Added the build-time Marvel continuity intake foundation

In plain English: the project now keeps a maintained inventory of 86 Comic Book Herald source records, resolves issue references deterministically, and emits overlap reports against shipped orders without adding a browser runtime dependency or shipping a new reader guide. Nothing you have saved is affected.

For maintainers: the intake foundation adds `scripts/data/cbh-modern-inventory.json`, the `cbh:resolve` and `orders:overlap` CLI commands, and focused tests that fail under the smallest protected revert before the resolver and overlap logic are accepted.

### The landing page now suggests where to start, and uses the whole desktop

In plain English: open the app for the first time and it names one reading order and offers to start
it, instead of showing nineteen and leaving the choice to you. It picks the shortest beginner-friendly
order in the catalog, tells you how many issues that is and roughly how long it takes, and offers a
look at the issue list before you commit to anything. The suggestion disappears the moment you have
answered the question yourself, whether that is by adding a reading order, by filtering, or by
searching.

The page itself now grows with the window instead of stopping at a fixed width, so a wide screen
shows four reading orders per row rather than three, and the cover art is larger. Pages that are
mostly words, such as the settings and the disclaimers, are unchanged: text that stretches across a
wide monitor is harder to read, not easier.

If you already have a reading order on the go, nothing about your home screen changes. Continue
Reading is still the first thing on it, and the suggestion is not shown to you at all. Nothing you
have saved is affected.

### The app has its own colour instead of a borrowed one

In plain English: the accent colour throughout the app is now the purple from its own icon rather
than a Marvel-like red. Red is kept for one job only, which is warning you that something is about to
be deleted or has gone wrong, so a warning now stands out instead of blending into the decoration.
Links are blue, finished and available things are teal, and cautions are amber.

All 88 colour combinations the project checks were measured against the readability standard in both
the light and the dark theme before this shipped. Nothing that used to be readable enough stopped
being so: 52 improved, 30 came down slightly, and none of them crossed the line. Five combinations
were already below the line before this change and still are, all of them shapes rather than words,
and one of those five, the tick drawn inside a ticked-off issue, is now fainter against its own
background than it was. That was already a known and recorded compromise and this change makes it a
little worse rather than introducing it. Two places outside the main stylesheet were still wearing the
old red: the small page that appears while a comic is opening, and the colour Windows paints around
the app window when it is installed. Both now match the rest. The high-contrast Windows mode and the
reduced-motion setting behave exactly as they did.

### Rebranded the app as Recap Page

In plain English: the app now has its own name and purple page icon instead of a Marvel-like red
tile. The home screen also says where its Marvel metadata actually came from.

Installed copies still look for the same Windows download, saved reading progress stays under the
same browser keys, and backups made under the old name still import. The repository moved with the
app, while old repository links continue through the host's redirects.

Microsoft Store reservation and listing work remains separate. Nothing is being submitted to the
Store as part of this change.

### Where the reading lists come from now records who has been asked, and what they said

In plain English: the project keeps a document explaining where every reading list came from. It now
also records who has been asked whether their work may be used, and what they answered. One site,
Comic Book Reading Orders, has said yes. Its condition is that each list built from it credits the
site and links back to the guide it follows, and it asked for two exceptions: its Marvel Master
Reading Order, and any reading order it keeps behind its Patreon.

Nothing has been built from that site yet, so this is permission for later work rather than a change
to anything you can open today. The same record notes that Comic Book Herald was asked the same
question a day earlier and has not replied, that the twelve lists already built from its guides were
built before the question was asked, and that the message offered to withdraw them if the answer
turns out to be no.

It also records why a third site was looked at and deliberately not written to: it publishes no terms
of use at all, its only way to reach the owner is a chat server where he does not take private
messages, and its crawler file turns away automated readers.

Nothing you have saved is affected, and no reading list changed.

For maintainers: a yes reaches only what the person saying it holds. This one covers that site's own
selection and arrangement of issues and stops there, so it closes none of the four open questions the
provenance document lists, and it says nothing about Marvel's own material.

### Recorded three naming and branding risks ahead of any app store listing

In plain English: nothing about the app itself changed, and nothing you have saved is affected. The
project's list of planned improvements gained three entries about how the app presents itself, all
written down after reading the actual rules rather than guessing at them.

The first is the app's icon, which is a red square with a white letter on it and is close enough to
Marvel's own logo to be worth redrawing. The second is the app's name, which is fine for a project
shared on a code-hosting site but sits awkwardly against both Marvel's published position on
third-party apps and the store's own rules about what a product may be called. The third is a line
on the home screen that credits Marvel using wording meant for apps that connect to Marvel's own
data service, which this app has never done.

None of the three is urgent while the app is downloaded as a zip file. All three matter before it
could ever be listed in a store, and they are recorded now so the reasoning does not have to be
worked out a second time.

### Settled on the name Recap Page, and wrote down what a rename would break

In plain English: the app will be renamed to Recap Page. Nothing about how it works changed here and
nothing you have saved is affected. The new name is not carried into the app yet, so this only
settles which name to carry.

The choice was deliberately left open before. What closed it was checking the two shortlisted names
against the United States trademark register instead of assuming. Pull List turned out to be
registered twice by Marvel, and one of those two sits in the same category a downloadable app is
listed under. Both were renewed about six weeks ago, so somebody is actively looking after them.
Recap Page returned nothing there at all, and nothing in the Windows store, the Android store or the
main code-hosting site uses it either. Registering a name is not a condition of publishing to the
Windows store, but using somebody else's registered name is grounds for being pulled from it, which
is why the check came first.

The second entry is about what a rename costs afterwards. The app asks a fixed web address once a
day whether a newer version exists. Renaming the project keeps that question answerable, because the
site forwards the old address to the new one. The download file the answer points at is named after
the project, though, and that forwarding does not reach inside it, so installed copies would be told
an update exists and then fail to fetch it. The fix is to leave that one filename alone, which is
much easier to know before the rename than after.

## 1.2.0

A feature release, and the one that makes every release after it reachable. Until now nothing in the
app ever said that a newer version existed, so a reader who downloaded it once stayed on that build
until they next happened to visit the repository. This is a MINOR because it adds features and
changes the interface while leaving saved data readable by the previous build. Upgrading needs no
backup and there is nothing to migrate. Reading progress is kept by the browser rather than inside
the app folder, so the old folder can be deleted once the new one has been opened.

### The app now tells readers when a newer release is available

In plain English: the app now checks GitHub once a day for the latest version number. If there is a
newer release, it shows a notice with a direct download link, a link to what changed, and a reminder
that reading progress is saved by the browser rather than in the app folder. Nothing you have saved
is moved or changed.

The check is on by default because otherwise the people who need the notice would never see it. It
can be turned off under Backup & settings, and the About screen still has a button for checking by
hand. The app never downloads, installs or replaces files by itself.

For maintainers: the release check is a small browser-side module with unit coverage for version
comparison, daily scheduling, failure handling and request shape. The real-browser harness now stubs
the GitHub release request, checks the notice and the explicit button, and includes aimed mutations
for the update journey.

Cutting this release also found a fault in that coverage. The comparison test named `v1.2.0` as the
newer release, so it passed only while the app had not reached 1.2.0, and the bump for this release
turned it red for a reason that had nothing to do with the comparison it guards. Both neighbours are
now derived from the shipped version, and the rewritten test was checked against a comparison made
lexical again to confirm it still fails when the behaviour breaks.

### A committed check now drives the upgrade that notice recommends

In plain English: the notice tells you that your reading progress is kept by the browser rather than
in the app folder, so replacing the folder keeps everything and the old one is safe to delete.
Nothing had ever tested that sentence, and it is the one standing between you and deleting a folder
you believe is disposable. It is now driven from end to end: one copy of the app saves a reading
order, that copy stops, a second copy takes over the same address, and the order has to still be
there and still be drawn on the screen. It is. Nothing about the app itself changed.

For maintainers: `npm run upgrade` installs two real copies of the app under the system temporary
directory, serves each with the real server on ephemeral ports, and makes ten assertions across the
swap. The last is a control that serves the same new copy at a second address and requires the
progress to be absent there. Without it the check would pass just as happily if progress were being
read out of the folder, which is the opposite of what the notice claims. `npm run upgrade:prove`
breaks four things on purpose and reports which assertion each one reddens, at four of four. Neither
is part of CI, for the same reason the browser check is not: both need Edge and a driver that is
deliberately not a dependency of this repository.

Writing it turned up a trap worth recording. Navigating to a URL that differs from the current one
only in its fragment is a same-document navigation, so the browser moves the address and re-runs
nothing. The first version of the check swapped the served directory and then navigated by fragment,
so the code still in memory was the old copy's. It reported the old version number after the upgrade
while every storage assertion passed, which reads as a serious finding about the app and was in fact
a check that had never once loaded the new copy.

### A shortcut into Marvel Unlimited was investigated and ruled out

In plain English: another fan project links its reading lists into Marvel Unlimited using a kind of
issue address this app has never used, and it was worth checking whether that address was better
than the one we already use. It is not usable here. The service this app gets its issue information
from does not supply that address, and there is no way to work one out from what it does supply, so
the app could never build such a link for an issue you are actually reading.

Nothing about the app changed. Your reading progress is untouched, and the button that opens an
issue in the reader works exactly as it did.

The reason this is written down at all is so nobody spends the afternoon on it twice. The project's
list of planned improvements now carries the question, the measurements that answered it, and two
early readings of the evidence that turned out to be wrong when the numbers were taken.

For maintainers: filed as a parked, dropped item with its measurements recorded inline rather than
by reference, because the working notes behind it are session evidence and stay on the machine that
wrote them. It carries no score; it was closed by measurement before it reached scoring.

### Record a way of counting a file's lines that quietly comes up short

In plain English: nothing about the app changes, and nothing you have saved is affected. This adds a
warning to the notes that contributors work from.

The project checks that every reference to a line of code still points at what it claims, so when
code moves, those references have to move with it. Working out how far each one shifted is sometimes
the only check available, because the report printed at the end cannot show a reference that has
slipped by a single line.

The most natural way to ask this computer how long a file is turns out to ignore every empty line in
it, so on a large file it answers a few hundred short and never suggests anything is wrong. The
notes now say so, name two ways of asking that answer correctly, and record two details found while
measuring it: a line of spaces is counted while a truly empty one is not, and the same tool is right
when handed the whole file at once rather than a line at a time.

It was caught by comparing two independent ways of measuring the same shift, which these notes
already ask for, rather than by anyone noticing that a number looked wrong.

### The message left after deleting a reading list can now be closed

In plain English: deleting a reading list puts a message at the top of every screen offering to put
it back, and until now nothing made that message go away except taking the offer. Delete something in
the morning and the banner was still there in the afternoon. There is now a "Dismiss" button next to
"Undo delete", and pressing it clears the message for good.

The offer itself still lasts as long as it did, which is the rest of the session rather than a few
seconds. That was a deliberate choice and it stands: deleting the list you were reading moves you to
another screen, and a message that vanished after ten seconds would take the only way back while you
were still working out whether you wanted it. What changed is who ends it. Pressing "Dismiss" gives
up the undo along with the message, so the app will not raise it again later.

Every message this feature produces can now be closed, not only the one with the offer in it. Two of
the four just report something that already happened, and those had no button at all.

The fourth is the one shown when putting a list back fails. Its button says "Give up" rather than
"Dismiss", because at that point the copy held in the message is the only copy of the list left, and
closing it really does throw it away. A button that reads like tidying up should not quietly discard
something.

Nothing you have saved is affected, and your reading progress was never involved either way.

For maintainers: the committed browser check gains a scenario for this journey, and two mutations
that prove it can fail. One reproduces the notice as it shipped, with no way to close it; the other
closes the message without giving up the undo, which looks correct until the next screen paints the
message again.

### The readme now shows the catalog instead of only describing it

In plain English: the project page opens with a picture of the screen you pick a reading order
from, so you can see what the app looks like before deciding whether to download it. Nothing about
the app itself changed.

The shot is the catalog with no reading lists imported yet, which is what a new arrival actually
sees. Cover art is switched off before the page is opened, so the file cannot contain any comic
artwork; the catalog draws no covers either way, so the picture matches the app as it ships.

### The catalog shelf now says which half of it you are looking at

In plain English: the list of reading orders is now split under two headings, "The shared story" and
"Character spotlights", each with a sentence saying what it is for. Nothing moved. The list was
already in that order, because the orders that follow one character carry no start year and so
always sorted to the bottom, but nothing on the page ever said so and it read as an accident. Now it
reads as a choice: read the shared story in order, or pick a character you already like and start
there. Nothing you have saved is affected.

A heading with nothing under it is dropped, so filtering or searching the shelf down to one kind of
reading still names the kind you are seeing rather than leaving a bare heading behind.

For the same reason, the shared story's heading only mentions the "Start here" badge when the order
carrying that badge is one of the ones on screen. Filter the shelf down to events, or search it, and
the heading still says what the half is for but stops pointing at a badge you would not be able to
find.

The division deliberately keeps every stop of the numbered reading path on one side. The item that
asked for this change said the path ran through character runs; measuring the shipped catalog showed
it does not, and that the one creator run on the shelf is stop 8 of the path. Splitting it off as the
original wording implied would have cut the route in half. A test now holds the path inside one
section against the real catalog, so the mistake cannot be reintroduced quietly.

### Fill in a new issue's details from the Marvel Fandom wiki

In plain English: adding an issue by hand no longer means typing a title and getting nothing else.
There is a Look up details button beside the title box, and pressing it offers you the release date,
the page count and the creator credits for that comic, ready to be saved with it. It is there
because the comics database this app reads stopped in October 2025, so for anything published since
then the app has never had any of that.

Nothing happens until you press the button, and nothing is saved until you press Add issue. The
button sends the words in the title box to the Marvel Fandom wiki, a community site Marvel does not
run, and it sends nothing else: not your lists, not your progress, not your notes. It fetches no
pictures. The wiki's search is loose, so you are shown the matches and you pick the one you meant
rather than the app guessing.

Picking a match also fills in Marvel's own number for that comic, and that is worth more than it
sounds. Until now an issue you added by hand had no link at all to its official page on marvel.com,
because the tracker had no number to build one from. Now it does, and Read opens that page. To be
clear about what this is not: it does not open the comic in Marvel Unlimited. That still needs the
reader address you paste, which is a separate thing and unchanged.

If the details you looked up would land on a comic you already track, the tracker declines to add a
second copy of it and tells you which of your lists has it. Nothing you have already saved is
overwritten.

### Read the Marvel Unlimited book id off an address you paste

In plain English: you can now open a brand new issue in Marvel Unlimited from this tracker. Before,
you could add a 2026 issue by hand and tick it off, but the Read button could not take you to it,
because the source this app gets its issue data from stopped in October 2025 and there is nothing
newer in it to look up.

The way around it turns out to be sitting on your own screen. When you are reading something in
Marvel Unlimited, the web address in your browser ends in a number, and that number is how the
reader identifies the book. Paste that address into the Add an issue by hand form and the tracker
keeps the number, so Read takes you straight there afterwards. It works for anything Marvel
Unlimited has, including issues far newer than this app's own data.

A marvel.com address still works and still does what it always did, but for a recent issue it
cannot produce a working Read link, so the form now says which address to prefer and the
confirmation tells you which of the two you gave it. One thing has not changed: the availability
badge on a hand-added issue still reads as unknown, because that is a different piece of
information and the address you paste does not carry it.

Nothing you have already saved is affected, and nothing was uploaded anywhere to make this work.
The number comes from a page you were already looking at.

One detail changed after a review. An entry added from a Marvel Unlimited address no longer also
offers an Info link, because that link announced itself as going to marvel.com and went to the
reader instead, which is the same place the Read button already goes. An entry added from a
marvel.com address still offers it, since that one really is an information page. The address box
now also points a screen reader at the paragraph explaining which of the two addresses gets you a
working Read button.

### Say which order to read after this one

In plain English: the catalog shows nineteen curated stories, and until now nothing on it
said that any one of them was read after any other. Someone who was shown the app and wanted to
start reading Marvel comics could see every option and still not know which to open first. Ten of
those stories are one continuous Avengers run stretching from 1963 to 2018, and the shelf was already
putting them in the right order without ever saying it was.

Each of those ten rows now carries a line saying which reading path it belongs to, where it sits on
it, and which order comes next. The first one says **Start here**. Every row that has a start year
now shows it, which the shelf was already sorting by but never printed.

Nothing you have saved is affected, and nothing you have already imported changes. This adds a line
to the catalog and nothing else.

The ten stops share no issues at all, which is checked by a test rather than asserted here: 99 pairs
of stories across 821 issues, nothing counted twice. The path says where it came from, on every row
that shows it, for the same reason every order in the catalog does.

### Stop collapsing the sidebar from blanking every pill in the catalog

In plain English: collapsing the sidebar to its narrow strip is supposed to shrink the two little
status labels at the bottom of it into dots. It was shrinking every small label on the page instead,
including the ones in the catalog, so folding the sidebar away made a piece of text on each reading
order vanish while still taking up its space. Only the sidebar's own labels shrink now.

This has been wrong since the collapsed sidebar shipped. It was found while checking that the new
**Start here** badge survived being collapsed, which it did not.

## 1.1.1

A correction to the download, and the reason it needed one is worth stating: the fault below was
found by starting the packaged archive rather than by reading the code, so it could not have been
caught before 1.1.0 existed to be started. This is a PATCH because it changes what the tracker says
when it cannot start, and nothing about what it stores or how it looks. Upgrading needs no backup,
and there is nothing to migrate.

The 1.1.0 download carries the old wording. Replacing the download is the whole point of this
release.

### Stop the startup failure messages naming a tool the download does not carry

In plain English: if you start the tracker while it is already running, it tells you so. It used to
finish by suggesting you start it on a different address instead, which was bad advice for two
reasons. That suggestion involved a developer tool that is not inside the download at all, so most
people could not have followed it. And anyone who did would have opened an app with nothing in it,
because your reading is saved against the address you read it at, and a different address is a
different shelf. It now says to open the tracker you already have running, tells you what to do if
something else is using the address, and says plainly why moving is not the way out.

Nothing you have saved is affected, and this text only ever appears when the tracker cannot start.

Found by starting the packaged download against an occupied address rather than by reading the
code. The launcher handled it correctly; the message underneath it did not.

The advice was written when cloning the repository was the only way to run this, and it was sound
then. The packaged archive changed who reads it: it carries a runtime, the app and the launcher and
no `package.json`, verified by extracting the built archive, 100 files with no `package.json` among
them. Advice naming a tool absent from the download cannot be followed by the reader it is shown to.

The second half matters more. Reading progress is stored by the browser against the exact origin it
was saved at, so a reader following the old advice to 8788 would have found an empty app while
their reading sat at 8787. `test/launcher.test.js:77` already forbids the launcher from setting
`MRT_PORT` for precisely this reason. The rule was enforced on the launcher and not on the message
printed beside it.

Both messages moved out of the error branch into `server.mjs:214-235` and are returned as lines
rather than printed, for the same reason `browserCommand` is a table: a branch that runs only when
a socket is taken is a branch nobody reads. `test/startup-messages.test.js` checks the words without
binding a port. Five of its seven assertions were run against the shipped strings and fail on them.
The other two are regression guards, and one of those caught the replacement copy at 88 characters,
which is wider than the console window the launcher opens.

### Correct the release procedure, which described a tag this project does not create that way

In plain English: nothing here affects the app. This is a note for whoever cuts the next release.

The written procedure said to let npm create the version tag and then push it. That is not how the
only release so far was actually made, and following it would leave the tag naming a commit that no
longer exists on the default branch, because branches here are squashed when they merge. Anyone
clicking through from the release would land on a commit they cannot check out.

The procedure now says to bump the version without a tag, merge, and then create the release from
the merged commit, which is what makes the tag. Checked against the tag that exists: `v1.1.0`
resolves to the squash commit on the default branch, not to the branch commit it was written on.

A step was also added for building and attaching the archive, and a sentence recording why it is not
optional. The download link points at the latest release rather than at a version, so the merge is
not what reaches a reader. The release is.

## 1.1.0

The first release with a download. Everything below had accumulated in the tree since 1.0.0 without
a number against it, which made the version the app reports useless in a bug report: it said 1.0.0
while running something considerably later. This entry gives that work a number, and it is a MINOR
because it adds features and leaves stored data readable by the previous build. Nothing here changes
how reading progress is saved, so upgrading needs no backup and loses nothing.

### Offer the tracker as one download that needs nothing installed

In plain English: on Windows there is now a single download that contains everything, so there is
nothing to install first. Unzip it, double-click the start file inside, and the tracker opens. The
old way still works if you prefer it, and both open the tracker at the same address, so your saved
reading progress is the same either way and nothing you have already saved is affected.

Getting the tracker running used to take three separate steps before you saw anything: install a
runtime from one website, find the project on another, then work out which item in a menu written
for programmers gives you the code. Each one of those is a place someone stops. The download removes
all three.

- **Added** `npm run pack`, which builds the Windows archive. It fetches the official Windows x64
  runtime from nodejs.org and checks it against the published checksum rather than copying the one
  on the machine doing the build. That distinction matters here: this project is developed on an
  ARM64 machine, so an archive built from the local binary would run for the author and fail for
  nearly everyone else, which is the one fault the author cannot reproduce.
- **Added** a release asset, so a single link replaces the download instructions.
- **Changed** the Windows start file to prefer a runtime sitting beside it and to fall back to the
  one on your machine, so the same file works whether you took the download or the source.
- **Changed** the message shown when no runtime is found, which now points at the download first,
  because someone who has just proved they have no runtime is the last person to send to install
  one.
- **Added** the runtime's own licence to the archive, whole. Its grant is MIT, but the file that
  travels with the distribution names 47 bundled components, so a one-word summary would
  under-attribute what is inside it.
- **Added** `test/packaging.test.js`, which holds the packaging contract: the runtime is fetched
  rather than copied, the bundled version is one the test suite actually runs on, the archive
  carries the app and the licences and none of the project's working papers, the start file prefers
  what shipped with it, the build output cannot be committed by accident, and nothing about any of
  it moves the address the tracker opens on.
- **Changed** the README to lead with the download, and to explain the first-run warning Windows
  shows for anything that arrived from the internet.

### Put a way out of the reading order grid where you actually run out of it

In plain English: the front page shows twelve reading orders and there are nineteen. It said so, and
it had a "See all" link, but that link was up beside the heading, so by the time you had scrolled
past twelve cards it was a long way above you and off the screen. All you could see at the bottom
was a sentence telling you there were more, with nothing to click. There is now a button right under
the last card. Nothing you have saved is affected.

Measured in Edge at 1280x900: the grid ends 1,392 pixels below the only control, which is more than
one and a half screens. Scrolled to the end of the grid, the button was off screen and the sentence
was not something you could press. The limit of twelve is deliberate and stays, because it keeps the
page one you can take in at a glance however many orders get added, and the catalog page already
shows all of them with filters and a search box. What was missing was the door, not the room.

- **Added** a control below the grid carrying the same action as the one in the header.
- **Changed** the wording in both places to come from one function rather than being written twice,
  because they previously decided "is there more" from two different expressions that agreed only by
  coincidence.
- **Added** `test/home-overflow.test.js`, including a check that there is something operable below
  the grid and not only above it.

### Record two ways a routine command can quietly destroy uncommitted work

In plain English: nothing about the app changes, and nothing you have saved is affected. This adds
two warnings to the notes that contributors work from.

Work on this project happens in a private copy of the project folder, one per task. Asking to switch
that copy back to the main line of work always fails, because the main line is already open
elsewhere and it cannot be in two places at once. If the refusal is hidden, which is easy to do
without meaning to, the next command carries on as though the switch had worked and rewinds the task
copy instead of the one that was intended. Anything edited and not yet saved into the project's
history is gone, and because the main line itself is untouched, nothing afterwards looks wrong.

The second warning is the reason the first is so easy to miss. The way this project's notes tell
contributors to capture the output of a command can make a successful command report itself as
failed, but only when that command put something into a second channel that runs alongside its
ordinary output. What was put there does not matter, and it does not have to be a complaint: a
routine remark is enough. Ordinary output does not do it, however much of it there is. That is why
the fault survives casual testing: the check behaves on every run that left that second channel
empty, and gives way on the runs that put anything at all into it. Both were measured rather than
recalled, and the second contradicted advice already in the notes, which has been corrected.

### Record a way the evidence gate can lose a claim without reporting anything

In plain English: nothing about the app changes, and nothing you have saved is affected. This adds a
warning to the notes that contributors work from.

The project checks that every reference to a line of code still points at what it claims. Those
references can also be marked as describing something that is deliberately missing, and that mark
was turning out to cover more of the surrounding text than intended. A reference sitting next to
such a mark was therefore being skipped entirely: not reported as wrong, not reported as missing,
just never looked at, while every check reported success.

That happened to the packaging plan filed above and survived a full round of checking before a
review caught it. The notes now describe the trap, the question that tells a correctly marked
reference from a silently skipped one, and the single number in the report that moves when it
happens. The heading above the list said two items while listing three, so it now says four and
lists four.

### A one-download version of the app for Windows, researched and filed (BL-145)

In plain English: nothing about the app changes yet, and nothing you have saved is affected. This
writes down a plan, with measurements behind it, for turning the tracker into something a person can
download once and open, rather than something they need a programmer's toolkit to start.

Getting the app running today means installing a separate piece of software from one website, then
fetching the project from another, then working out where it landed and opening a file inside it.
That is more than the person this app was built for will do. The plan is to put the app and
everything it needs into a single compressed folder, offered as one link.

The obvious alternative, one program you double-click, was built and measured before being set
aside. Both routes make Windows ask the reader to confirm, so neither escapes that, and the first
draft of this plan was wrong to say otherwise. What separates them is that packaging everything into
one program destroys the signature on the part that came from somebody else, which turns a mild
question into the harder warning that suggests not running the thing at all. The plan covers Windows
only, because the same file arriving on a Mac is refused rather than questioned, and that deserves
its own measurements rather than a guess.

### One card per story, with the choice of reading path inside it (BL-144)

In plain English: the browse page used to show the same story several times over, once for each way
of reading it. Civil War appeared three times, House of M and Secret Invasion twice each, so seven
of the twelve slots on the page were spent on three stories. Now each story gets one card, and a
story you can read more than one way says so in a small line underneath, like "3 ways to read this".
Pressing it opens the same window the "See the full list" button does, and the choice is made there,
next to the list of comics it changes.

Twelve slots now hold twelve different stories instead of eight, and the counts around the page say
nineteen stories rather than twenty-six lists, which is the number you can actually count on screen.

Nothing you have saved is affected, and nothing is taken away. Every reading path that existed still
exists and can still be added, including both a short version and a long version of the same story
at once. Lists already in your library are untouched.

The first attempt put the choice on the cards themselves and it made them cluttered, so it was
measured and moved. The cards are now within a few percent of the height and the number of things to
read that they had before any of this.

A review before this landed found four faults, and all four are fixed. The one worth naming: after
changing which version you wanted and closing the window, the keyboard could land on the button that
adds a list to your library, so a stray Enter would have added it. It now goes back to the small line
you pressed to open the window. The rest were a strip of empty space above a card that quietly
swallowed clicks meant for the card, a screen reader hearing the same name for six different choices
in the browse pane, and a card with no description showing an empty gap where the words would go.

### Work goes to features rather than to the record of it

In plain English: nothing you have saved is affected and the app itself does not change. This is a
change to how the project is worked on, not to what it does.

Several changes in a row had gone by without touching the app at all. Each existed only to correct
something the one before it had written down about its own workings: how far apart two sentences
sat, which change had left a line untidily wrapped. The instructions this project gives the people
and tools that work on it now say plainly that this class of thing is not worth a change of its own.
Fix it quietly inside work already under way for another reason, or leave it, and put the effort
into what the app can do and the information it holds.

The rule is deliberately narrow. It does not permit writing anything untrue. It asks for fewer
claims of that kind to be made in the first place.

### Twelve new reading orders (BL-142)

In plain English: there are twelve more reading lists to choose from. Five follow a single character,
covering Captain America, Doctor Doom, Spider-Man, Thor and the Scarlet Witch. The other seven run
along the Avengers story from the very first issues in 1963, through the point the team falls apart,
Civil War, the villains taking over, the recovery, and up to the most recent relaunch. That takes the
tracker from fourteen lists to twenty-six, and adds a little under twelve hundred comics.

Nothing you have saved is affected. The lists you were already reading are untouched, and everything
you have marked as read stays exactly where it was.

These follow guides published by Comic Book Herald, and each of the twelve says so on its card and
links to the guide it followed. What was taken from those guides is the choice of which stories are
worth reading and how they group together. Which exact comics that comes to, and every cover and
credit shown beside them, was worked out here against Marvel's own records, because the guides mostly
name a storyline rather than a list of issues.

A few rows in those guides could not be turned into a comic you can click. Two of them are not comics
at all but collected books, one is a series Marvel's records simply do not list, and one is a single
issue missing from an otherwise complete run. Rather than quietly leave them out, each is written
into the list's own notes saying what was wanted and why it is not there.

### Reading lists are now shelved in story order (BL-143)

In plain English: the lists on the front page used to appear in the order they happened to be added,
which meant a list starting in 1963 could sit below one starting in 2023. They are now shelved in the
order the stories happen, so reading down the page reads forward through Marvel history.

Lists that roam across the decades rather than sitting at one point in the story, such as a
best-of-all-time collection or a single character's greatest hits, are gathered at the end instead of
being forced into a slot they do not really fit. Where a list comes in two lengths, a full version
and a shorter one, the two still sit together as they always did.

Nothing you have saved is affected, and no list has been added, removed or renamed by this. Only the
order they are shown in has changed.

### You can start the tracker by double-clicking a file (BL-140)

In plain English: there is now a file in the project folder you can double-click to start the
tracker, called **Start on Windows.cmd** on Windows and **Start on macOS.command** on a Mac. Before
this you had to open a terminal, move to the right folder and type a command, which is three
instructions that can each go wrong. Now it is one double-click, and the window it opens tells you
what to do if Node.js is not installed instead of closing before you can read it.

Nothing you have saved is affected. The file starts the same app at the same address, deliberately
so: the address is what your browser files your reading progress under, and a start file that
quietly used a different one would have looked exactly like losing everything. Typing the command
still works and is unchanged, so nothing you already do stops working.

### The installed tracker opens even when the app is not running (BL-141)

In plain English: if you have installed the tracker as an app, its icon now opens whether or not
the app itself is running. Before, an icon opened with nothing running gave you your browser's
"this site cannot be reached" page, which reads as a broken app rather than as a program that has
not been started.

What you get with nothing running is the tracker exactly as you left it: everything marked read,
every list you have made. What you do not get is anything that has to be fetched while you are
there, so a cover you have never seen stays blank and looking up a comic's details will not work
until the app is running again. Nothing you have saved is affected either way, and nothing is sent
anywhere: the copy your browser keeps is on your own computer, and it deliberately holds only the
app's own files, never a comic cover or anything else from elsewhere.

While the app is running, nothing changes at all. The tracker still asks for every file fresh
before it will use the copy, so you cannot be shown a stale page by this.

One correction to the above, made after a code review of it. As first written, the copy was only
made on your *second* visit, so somebody who installed the tracker the moment their browser offered
to, and then closed it down, still got the "cannot be reached" page. That is the person this was
written for, so it now takes the copy on the first visit. It costs one extra load of the app's own
files, once, and never again after that.

### The tracker can now be installed as an app (BL-139)

In plain English: you can now give the tracker its own window and its own icon in the Start menu,
the Dock or your applications list, instead of a browser tab you have to find again. Open it as you
always have, then use your browser's install option. Nothing you have saved is affected: it is the
same app at the same address, so your reading progress is exactly where it was, and installing or
uninstalling never touches it.

On its own this did not start anything, and an installed window opened with nothing running simply
said the site could not be reached. Both halves of that are answered by the two changes above: a
file you double-click to start the app, and a copy your browser keeps so the icon opens either way.

The app icon is a red tile with the same M as the tab icon. Because browsers require a picture file
here rather than the drawn icon used for the tab, the picture is generated from a written
description of that shape and a test redraws it and compares, so nobody has to take an unreadable
image file on trust.

### Issue synopses are back, fetched when you ask for them and never saved (BL-134)

In plain English: there is a new button on a reading order that fills in the short summary for each
issue. The summaries come from the same public service this app already uses for covers and issue
links, they appear on screen, and none of them are written to your device. Close the tab and they are
gone, which is on purpose. A notice explaining where the text comes from appears every time you press
the button, and the fetch does not start until you accept it.

Until now every issue said no summary was recorded. That was the result of an earlier change that
removed a large amount of publisher-written text from this project, for good reasons that have not
changed: this project does not have the right to redistribute that text, and a copy shipped inside
the app is a copy redistributed. Showing text that was fetched at the moment you asked for it is a
different act, and it is the same one your browser performs when you visit a comics website.

The summaries fill in one issue at a time, starting with the one you are reading and the next eight
after it, so the part of the list you are actually looking at is answered first and the rest follows
behind. You can stop a run at any point. Nothing you have saved is affected, and progress, lists and
backups are untouched.

One thing to expect: the first time you open the app after this update, it will be slower than usual
for a few minutes. The store of previously fetched information is emptied once, because some of it was
saved before this change and may contain the old text. It refills as you use the app and the delay
does not come back.

If you have used an earlier version, your device may still be holding summaries it saved back then.
The next time you open the app they are removed from it, once, without you doing anything and without
touching anything else you have saved.

Four smaller things behave better than they did in the first draft of this feature. A run in which
nothing could be reached now says so, instead of reporting that everything was fetched. An issue the
service answers with no summary now says that plainly, rather than looking as though it has not been
tried. If you change the service address while a run is going, the run stops, what it collected
is cleared, and the next run asks the address you just typed in. And the number on screen while a
run is going, and the one it leaves behind if you stop it, now both count only the summaries that
actually arrived, rather than counting the ones it failed to reach as though they had arrived.

For maintainers: the committed browser check gains a sixth journey, covering that last point, and a
tenth mutation aimed at it. It runs a real browser against a service that refuses everything and
reads the number off the screen before and after a stop. Its assertions go from 28 to 35. One of
those seven was added by a later review of the journey itself: the stopped line's failure clause
turned out to be unguarded, so deleting the clause this work began by adding left every other
assertion green. That review also found the journey's mutation was caught by a starved wait rather
than by a failed claim, which records that the scenario can break without recording that anything it
claims can fail; the mutation now rewrites the running line to report attempts rather than answers,
and reddens two named assertions. The rest of this feature's browser evidence still lives outside the
tree, where a clean clone cannot rerun it, and bringing it in is now a recorded item rather than an
omission.

One correction to the paragraph above, made after a further review of it. The account of why that
mutation was replaced said the disputed figure was one no revert of the tree produced. It is not:
taking the running status line all the way back to its pre-series shape, which drops the clause naming
what could not be reached as well as the subtraction, reddens exactly three assertions and prints the
two bad lines beside each other in the same run. So the sentence under review had been reproducible
and its fault was one word, naming the subtraction for a revert of the whole line. The uncomfortable
part is that the run was not missing. Its red count was already written down a few lines above the
conclusion that denied it, and what nobody had checked was whether that same build also prints the
pair. The replacement mutation is kept, because it was justified by the evidence it adds rather than
by the disputed figure: reproducing that pair by hand means editing the app and editing it correctly,
and it is printed by a committed check now. The four measured reverts are written out in full in the
project's list of planned improvements, with what each one reddens and whether it prints the pair.

A second correction, briefly. The further correction that followed the one above, which revised the
same account in the project's list of planned improvements and changed nothing in this file,
described itself wrongly twice over: it blamed the change before it for an untidy line it had made
itself, and it put the sentence disproving a mistaken claim nearer to that claim, and in the same
paragraph, than it really sits. Neither is about the app and neither changes which conclusion is
right. A description of a change cannot be edited once the change has been accepted, so the
correction sits here instead. It is the last of its kind, for the reason given at the top of this
list.

### The project is public, and the protections it was waiting on are now switched on (BL-133)

In plain English: nothing you have saved is affected, and the app itself does not change. This
project was opened to everyone on 16 August 2026, and three protections that only become available
once a project is open were switched on. A scanner now watches for passwords or keys committed by
accident, a block refuses to let one be pushed in the first place, and there is a private way to
report a security problem instead of posting it where anyone can read it. The rules on the main line
of work now also require the automated checks to pass before anything is merged, and refuse to let
the project's history be overwritten or that line deleted.

Several documents said, in the present tense, that those things could not be turned on, and that
nobody outside could see the code or send a change. All of that was true while the project was
closed and became false the moment it opened, so ten passages across nine files were rewritten to
say what is now the case. Where a document explained a trap rather than a state, the trap was kept:
asking for the push block without the scanner is still accepted and still does nothing, which is
worth knowing to anyone who copies this project.

The older records describing those settings as refused were deliberately left alone. They say what
was true on the day that work was delivered, which is what a delivery record is for, and rewriting
them would erase the reason the boxes were left unticked at the time. Four of those boxes are now
ticked, and one of them had been open since long before publication: making the automated run
required before a merge was always a setting on the project rather than a change to the files, and
it arrived with the rest.

### The publication checklist now says what its own instructions cost (BL-132)

In plain English: nothing you have saved is affected, and nothing about the app changes. This adds a
note to the checklist that gets followed on the day this project is opened to everyone.

That checklist lists twenty-one sentences which stop being true the moment the project is opened,
and it says what each one claims so they can be rewritten. What it did not say is how much work
rewriting them sets off elsewhere. This project keeps a list of references pointing at particular
lines of particular files, and a build check that fails when a reference stops naming what it
claims. Editing those sentences moves lines, and 54 references point into the files being edited.

Most of that turns out to be avoidable, which is the part worth writing down. A reference sitting
below an edit only breaks when the replacement is a different number of lines from what it replaced,
so writing each replacement to the same length as the original cuts the work from 53 references to
14. That was tested rather than assumed. Replacing a six line paragraph with six lines broke two
references, and replacing the same paragraph with eight lines broke three, the extra one being a
reference ninety lines further down that no edit had gone near.

The note also names the one test that does defend the old wording, so whoever does the work can keep
that sentence or change the test on purpose rather than discover it. Beyond that one, a long list of
broken references on the day is the expected result of doing the work, rather than a sign that
something went wrong.

### The publisher's own blurbs are no longer stored here (BL-130, BL-131)

In plain English: nothing you have saved is affected. The one visible change is on the panel that
shows an issue's details, where the publisher's summary used to appear and now does not.

The one thing standing between this project and being opened to everyone is a question nobody here
can answer alone: whether the comic information stored in it can be published at all. That is a
legal judgement and it is still recorded as unanswered. What could be worked on in the meantime is
how big a question it is.

Nearly all of what was copied is plain fact: which issue, which series, what number, what date, a
link, who worked on it. One field was different. It held the publisher's own written blurbs,
reproduced word for word, 798 of them and about 150,000 characters. So they were removed. Nothing
had to be built to cope, because nearly half the stored issues already had no blurb and the app
already had lines for that: about six hundred of those say no synopsis is recorded, and the seventy
or so that the project holds nothing else about say the stored snapshot has no record of the issue.
The 798 now show the first of those two. A test refuses the blurbs if they ever come back, and the
source they came from is still reachable, so they can be fetched again if the answer turns out to
be yes. The record of where the data came from now also says which of its open questions could be
settled by asking the people upstream, and which could not be settled by asking anyone.

One of those questions has now been asked. The two reading lists this project copied came from a
smaller project run by one person, whose own notes say the work is freely reusable but never spell
out whether that covers the lists as well as the program that builds them. That was asked of them
directly on 2026-08-16, in the open where anyone else who copied the same lists can read the answer.
It is unanswered so far, and the record says so rather than assuming a friendly reply. It is also
worth being clear about how much an answer can settle: that person has no say over the publisher's
material, so even the most generous reply tells us nothing about the blurbs, which were the biggest
question and the reason they were removed.

The first attempt at this missed 41 more blurbs, in a file behind the design sketches of the app
that was built from one of the reading lists. The reason it was missed is worth more than the miss:
both the removal and the test guarding it worked from the project's own list of reading lists, so
neither could see a file that list does not mention. Both now look at every file in the project
instead. The record of where the data came from had never mentioned that file either, and now does.

One limit is worth stating plainly rather than leaving to be found later. Taking something out of a
project's current files does not take it out of the project's history, and anyone who copies a
public project gets its history as well. The blurbs sit in almost every past version, so they would
stay recoverable by someone who went looking. Clearing that too means rewriting the history, which
is still cheap because nobody outside holds a copy, and which stops being cheap the moment the
project is made public. What happened to that plan, and what was decided instead, is further down.

The automatic check that reads the whole history before publication used to finish by saying the
history was clean. That was true of what it looks for, which is passwords and keys and paths that
belong to one person's computer, and misleading about everything else, because the blurbs in the
history are exactly what someone running that check the night before opening the project would
think it had cleared. It now says what it looked at instead.

One obvious question was asked late and is now answered in the record rather than in passing: if
other comic sites show these same blurbs, why can this project not keep them? The publisher's own
rules for programs like this one were read back from an archived copy, the developer site itself
having closed since. They let a program show the blurbs to the person using it, and separately
forbid passing copies on to anybody else, forbid keeping them indefinitely, and say the publisher
keeps ownership throughout. The two comic sites closest to this one do show the blurbs, and both of
their own rule pages forbid anyone copying that text back out. So showing and handing on are two
different things rather than two degrees of one thing, those sites are doing the first, and this
project was until recently doing the second more freely than any of them. The record of where the
data came from now carries the wording those rules use, links to the archived pages, and the date
they were read.

The plan for getting the blurbs out of the project's saved past turned out not to work, and finding
that out was the point of trying. The intention was to rewrite the past and push it over the top,
which is the usual remedy. The problem is that the hosting service does not throw away what such a
rewrite abandons, and its own guidance lists three places the old copies survive one. The one that
bites here is that this project has 116 proposed changes recorded against it, and the service keeps
its own permanent copy of the code behind every one of them. Those copies cannot be edited or
deleted by the owner, they are not part of what you get when you download the project, and they
become readable by anyone the moment it is opened up. Counted rather than assumed: they hold exactly
the same 455 blurbs and the same 89,460 characters that the past was supposed to be hiding, so
rewriting the past would have removed none of it while looking like it had.

The clearest proof needed no rewrite at all. Four proposed changes here were abandoned rather than
accepted, their working copies deleted long ago, and the code behind them still downloads today with
between 396 and 508 blurbs in it. That is what the rewritten project would have looked like, visible
already.

The rewrite was built and checked anyway, because the routes that do work both need it. It
reproduces the project exactly as it stands today, character for character, keeps every saved
version's description, author and date, and leaves no blurb anywhere in the result. It was also put
through all seven of the project's own automatic checks, exactly as a fresh copy of it would be, and
passes every one. What is left is a choice between publishing that clean copy as a brand new
project, asking the hosting service to delete the leftovers, and accepting them. Only the first is
known to work. The service's published policy is that it will not remove material that is merely
somebody else's property rather than a security risk, and doing it anyway would also destroy the
record of what changed in every past proposed change, which is most of what that route was supposed
to save.

The owner chose to accept, on 2026-08-16. The blurbs stay in the project's saved past, and it is
opened up as it stands rather than rebuilt somewhere clean. Nothing you have saved is affected and
nothing on screen changes either way: the app itself stopped showing the blurbs when they were
removed, and this decision is only about the copies left behind in the project's own history. What
tipped it was that the material is a company's marketing copy rather than anything private, and that
the one route known to remove it would have thrown away the recorded discussion of every change ever
made to this project. The rewrite is kept rather than thrown away, so that if the publisher ever
objects the project can be closed again and rebuilt clean from a tool already proven to reproduce it
exactly.

### A checklist for the day this project is opened to the public (BL-129)

In plain English: nothing you have saved is affected, and nothing on screen has changed. This is a
note left for whoever eventually makes the project's code visible to everyone.

Several places in the project say, in so many words, that outsiders cannot see it yet. The security
policy tells anyone who finds a flaw to do something awkward, because the private way of reporting
one is not offered on a hidden project. The contributing guide explains how changes would be sent
if anyone could send them. All of that is honest, all of it stops being true the moment the project
is opened up, and none of the automatic checks would notice a sentence that had quietly gone out of
date, because they check facts about the code rather than sentences about the situation.

So every statement of that kind was hunted down and written on one page, each one named on the page
rather than merely counted. With them are the three protections that cost nothing once a project is
public and cannot be switched on at all before then, which are spotting a password committed by
accident, a private channel for reporting a security flaw, and rules that stop the main copy of the
code being changed carelessly. The first of those has to be switched on before one of the others
will do anything, and asking for them in the wrong order looks like it worked. That is the sort of
thing that is easy to get wrong from memory and easy to get right from a list.

The hunt was wrong twice, and both times a review caught it. The first search looked one line at a
time for a particular word, so a sentence running over two lines slipped past. The second looked at
whole passages but only ever searched for the phrase "while this is private", never for the other
way the same fact gets written, which is a quote of the service refusing something and telling you
to make the project public. Five more turned up that way, including one in the file that says who
should review changes.

Which is why the page no longer asks to be believed. It names every sentence it holds, says plainly
what makes a sentence belong on it, and carries the search that found them so the next person can
run it again rather than trust a total. A number is something a reader has to take on faith. A list
with the search beside it is something they can check.

The page does not argue that the project should be opened up. That still waits on the unanswered
legal question about the Marvel comic information stored here, which the page names at the top as
the thing to settle before any of the rest of it matters.

### The record of where the data came from now counts its own contents correctly (BL-128)

In plain English: nothing you have saved is affected, and nothing on screen has changed. This
corrects a number in the page explaining which parts of this project are Marvel's and which are the
project's own.

That page counts the marketing blurbs copied from Marvel, because reproducing them word for word is
the part of the stored data most likely to need permission. It gave the figure three times. Two said
798 and one still said 508, which was the count before two new reading orders were added. Every other
figure on the page was recounted at the time and that one was missed. It happened to be the copy
sitting inside the list of questions a lawyer would be asked, which is the worst place for it to
hide, because someone answering that question would have been answering about the wrong amount of
material.

The same page also promised that every stored comic copies a set list of details from Marvel, and
six of them copy nothing whatsoever. Those six stand in for comics Marvel's own records have no
entry for, so instead of Marvel's reference number they carry one invented here, deliberately
negative so it can never be mistaken for the real thing. That is now written down. It is also kept
firmly apart from a separate group of sixty-three thin entries that fail for the opposite reason,
which are easy to confuse and would give the wrong total if added together by mistake.

Adding two entries to the project's list of planned work meant recounting what that list says about
itself, and three of its own figures turned out to have been wrong already: how many rows it holds,
how many jobs are still waiting to be picked up, and how far a re-sort of it would move things.
Nothing checks those three, and the passage stating them tells its reader to recount them whenever
the list changes. A fourth figure of the same kind is checked by an automatic test, and that test
failed the moment the new entries were added, which is a fair illustration of the difference.

### The check for accidentally duplicated text now reads every document, not just one (BL-118)

In plain English: nothing you have saved is affected, and nothing on screen has changed. This is a
check that runs when the project's own documents are edited.

One of those checks looks for a passage that has been pasted twice into the same document, which is
an easy mistake to make when moving a paragraph around and a hard one to spot afterwards. It only
ever read one of the project's documents. The rule it enforced had been decided by reading seven of
them, so the other seventeen were being held to a promise nobody was keeping. A duplicated paragraph
in the contributor guide, the readme or the architecture notes would simply not have been noticed.

It now reads all nineteen, and it works out which nineteen by looking at the project rather than
from a list somebody has to remember to update, so a document added next week is covered the day it
arrives. Generated files and the dated working notes are left out on purpose, for reasons written
down beside the rule. A complaint now names the document it was found in, which it could not do
before, since it only knew about one.

Read on the day it shipped: nothing is duplicated in any of the eighteen.

### An X-Men reading order, from the 1963 debut to the Mutant Massacre (BL-127)

In plain English: the catalog had twelve reading orders and none of them was about the X-Men. There
are now two more that are, and they are the same story at two lengths. The shorter one is the spine:
the X-Men from their first issue in 1963, through the 1975 relaunch that brought in Storm,
Nightcrawler and Colossus, the Phoenix and Dark Phoenix sagas, Days of Future Past, the Brood, and on
into the New Mutants, X-Factor and the Mutant Massacre. That is 318 issues. The longer one adds
another 86: the guest appearances that kept the X-Men going through the years their own title was
running nothing but reprints, and the modern series that retell those same years from the outside.

They come from a reader's outline of Comic Book Herald's guides, and the card for each says so,
because the running order is a person's judgement and there is no Marvel data that can confirm it.
Every issue in both orders has a cover and opens in the reader.

Two things are missing on purpose and both are named on the card. X-Men #67 to #93 are not there:
all 27 are reprints of issues the order already has, and Marvel keeps no record of them at all, so
they could only have appeared as rows with nothing behind them. Four issues appear as plain text
with no link, because Marvel has no record of those either, but they are real chapters of the story
rather than reprints and leaving them out would have moved the issues around them out of order.

The outline ran out partway through X-Factor's second year, so the order stops there. Fall of the
Mutants, Inferno and everything after are not in it yet. Nothing you have already saved is affected.

### The catalog now records what it was told about a missing issue, rather than guessing from silence (BL-126)

Nothing you have saved is affected, and nothing on screen looks different today. This is about how
the ready-made reading orders are built, and about the app being right for the right reason.

Some issues in those orders have no cover and no description, because Marvel's own catalogue holds
no record of them. A recent change let the app say so plainly instead of leaving them queued up
forever waiting for details that were never coming. But the way it knew was to look at an issue with
nothing on it and conclude nobody had it. That reasoning is fine right up until the moment the tool
that builds these orders loses its internet connection halfway through, at which point it produces
exactly the same empty entry and the app confidently tells you an issue does not exist when it does.

The tool now tells the four things apart: a flat "no such issue", a service too busy to answer, a
dropped connection, and a reply it could not read. Only the first is recorded on the issue as a
settled answer. If any of the other three happens, the run stops and names every issue it could not
get an answer about, rather than writing a file that looks complete. A reply that arrives carrying
nothing usable is treated the same way, using the app's own test for whether an issue has details,
so the two halves of the app cannot drift apart on what "no such issue" means. The two affected
orders were rebuilt against the live catalogue, where all thirty-four issues in question came back
as genuinely absent, so what ships is now a recorded fact rather than an inference.

For maintainers: the agent instructions gained a note about the evidence-anchor gate. A citation whose
line range is written out malformed is not reported as broken, because the gate's pattern does not
recognise it as a citation at all; it simply vanishes from the corpus. One did, during the rebase this
change went through, and only an unrelated test caught it. The instructions now say to check that a
scripted re-aim produced well-formed citations before blessing them.

### A test that guards restore speed no longer fails just because the machine is busy (BL-117)

Nothing in the app changes and nothing you have saved is affected. This is entirely about the
project's own automated checks.

Four of those checks exist to catch a specific kind of mistake: a change that makes restoring a very
large backup get slower and slower the bigger it gets, rather than slower in proportion. They caught
it by timing the work with a stopwatch and complaining if it took longer than a fixed number of
seconds. The trouble with a stopwatch is that it measures the computer as much as the code. One of
these checks takes about a second on a quiet machine, and on a busy one it once took thirteen
minutes and reported a failure, when there was nothing wrong at all.

The checks now compare how long the work takes on a large amount of data against how long it takes
on a sixteenth of it. A well-behaved routine takes about sixteen times as long; a badly behaved one
takes about two hundred and fifty times as long. That comparison barely moves when the machine is
busy, because both halves slow down together. Measured with sixteen other programs deliberately
hogging the machine, the readings shifted by less than half, where the stopwatch they replace can
shift by hundreds.

Each of the four was checked by putting the old, slow behaviour back and confirming the check went
red, so none of them is a check that has never been seen to fail. Comparing two amounts of data means
doing the work twice over, so the checks now take about a second and a half longer to finish than
they did. That is the price of a reading that does not depend on how busy the machine is.

### Restoring a backup that is too big to keep no longer risks drawing it first (BL-114)

Nothing in the app changes, nothing you have saved is affected, and nothing on screen looks
different. This is about a worry that turned out to be unfounded, and about making sure it stays
that way.

The concern was this. When you restore a backup, the app has to draw every reading list in it on the
home screen and in the side rail. A backup large enough to be refused by your browser's storage
would still, in principle, have to be drawn before the app discovered it could not keep it, so you
would sit through a long redraw and then be told the restore failed anyway.

Reading the code carefully showed that cannot happen: the app writes the backup to storage before it
draws anything, so a backup your browser refuses is never drawn at all. Measuring it in a real
browser confirmed that, and put a useful number on where the limit falls. On this machine a backup
of twelve thousand reading lists restored in about six tenths of a second; thirteen thousand was
refused outright in under a tenth, with nothing drawn and nothing saved. A backup small enough to be
kept is small enough to draw quickly, so there is no case left to guard against and no new limit
worth adding.

What did change is that three new automatic checks now hold that behaviour in place, so a future
change cannot quietly start drawing a backup the browser is about to refuse. One of them also
records something worth knowing: a restore briefly needs room for two copies of the backup, not one,
which is why the practical limit is about half of what your browser would otherwise allow.

### The build now checks any sentence that says how long a file is (BL-125)

Nothing in the app changes, and nothing you have saved is affected. This is about the project's own
written record.

Some of the documents in this repository describe the code by size, in sentences that name a file
and say it is so many thousand lines long. Those numbers are written by hand, and files grow, so
they quietly go wrong. It had already happened twice: one figure was stated in three places and was
out by a thousand lines before anyone noticed, and its replacement had gone stale again by the time
it was corrected. Nothing in the project's automatic checks could see it, because a number in an
ordinary sentence looks exactly like any other number.

There is now a check that reads those sentences, counts the file each one names, and fails the build
when the two disagree, saying which line to fix and what the number should be. A figure that is
deliberately about the past, such as a note about how large something was when it was audited, can
be marked as historical and is then left alone.

It found four wrong figures on its first run. Three were simply corrected. The fourth was a sentence
explaining a decision, written in the present tense and true on the day it was written, so it was
reworded to say what was measured at the time rather than marked historical and left standing as a
plain false statement. The check then caught a fifth that this very change had created: adding a
line to the contributor guide made a sentence elsewhere describing that guide's length wrong, and
the check said so before the change was committed.

### "Details pending" no longer means two different things (BL-109)

Some comics have no entry at all in the metadata snapshot this app reads. Ultimate Black Panther #22
to #24 are the well known ones, but there are 34 of them across the reading lists you can import.
Until now the app labelled those "details pending" and offered a button reading **Fetch details for
34 issues**, which was a promise it could not keep: every one of those lookups comes back saying no
such issue exists, so the button spent your request allowance and changed nothing.

The app now tells the two apart. An issue nothing has looked up yet still says "details pending" and
is still worth fetching. An issue the snapshot has no record of says "no details held", says why on
its own page, and is left out of both the fetch button and the **Details pending** filter, so
neither offers you work that cannot be done. The app does not quietly retry one of these on its own;
the label lifts if you later add the same issue from a search or a series that does carry details.

Nothing you have saved is affected and no re-import is needed. A tracker imported before this change
corrects itself the next time you open the app.

### The browser evidence can now be rerun by anyone (BL-093)

Quite a lot of what this project claims about how the app behaves came from driving a real browser
through it and watching. That work was real, but it was done with scripts kept outside the project,
so nobody who downloaded a copy could repeat any of it. The evidence existed and the means to check
it did not.

`npm run browser` now does it. It opens Edge, imports a reading list, moves between screens with the
address bar and the Back button, marks an issue read and reloads to see it survive, damages the
saved data on purpose to check the app offers help rather than wiping it, and clicks through to a
comic to check the reading tab opens straight away. Twenty-eight checks, about two and a half
seconds.

**It cannot touch anything you have saved.** It runs the app on a spare address rather than the
usual one, and the app keeps its data separately for each address, so everything this check saves
and then deliberately breaks belongs to a copy that is thrown away when it finishes. There is
nothing to clean up afterwards.

It is not part of the automatic checks, because those run on a machine with no browser installed,
and it needs one component that is deliberately not shipped with this project. If that component is
missing it says so and tells you how to install it, rather than pretending the app is broken.

A second command, `npm run browser:prove`, breaks the app nine different ways on purpose and checks
that each break is noticed. A check that has never been seen to fail proves nothing, and this found
four checks that were not noticing anything: one caught while writing them, and three more caught
when the finished work was reviewed. The worst of those was in the part that handles damaged saved
data. It was reporting that the app offered you a way to rescue your data, when the offer could have
been entirely unusable and it would have said the same thing. Checking that repair found it still
missed a button faded out of sight, which is how this project's own styling hides things, so that
case is now broken on purpose too.

### The little server that runs the app is now tested (BL-094)

Opening the app starts a small program on your own machine that hands the pages to your browser. It
is the one piece of this project every single use goes through, and nothing checked that it worked.
It could not be checked, either: the program started listening and opened a browser window the
instant anything looked at it, so a test could not examine it without taking over the address the app
lives at and popping open a tab.

That is now separated, so the checks can start a copy on a spare address, ask it things, and shut it
down again. Twenty-six checks cover what it serves, what it refuses, what it tells your browser about
keeping the app safe, and that it lets go of the address cleanly when you stop it.

Two things that were actually wrong turned up while writing them, both about the setting that lets
you move the app to a different address if something else is using the usual one. Typing something
that is not a number produced a page of programmer's error text rather than a sentence telling you
what to correct, and a value written in a form used by programmers would quietly start the app
somewhere other than where you asked. Since the app's saved reading progress is tied to the exact
address it runs at, being sent somewhere unexpected means finding your progress apparently gone. Both
now give a plain correction and stop.

Nothing about the app itself changes, and nothing you have saved is affected.

### Cover pictures are only ever fetched from Marvel (BL-086)

The app has always told you that cover pictures come straight from Marvel and that nothing else
about your reading leaves your browser. The first half of that was a hope rather than a rule. The
address of each cover comes from the public comics database the app asks for issue details, and
the app would have fetched a picture from wherever that address pointed. A database that had been
tampered with, or a different one you had pointed the app at, could have named a server of its own
and had your browser contact it every time a cover appeared on screen, which would have told that
server who you are and what you are reading.

Covers are now fetched from Marvel's image server and nowhere else. An address naming anything
else is refused before your browser is asked for it, and the issue shows the same plain lettered
tile it already shows for an issue that never had a cover. Nothing you have saved is affected and
no cover you can currently see will disappear: every one of the 700 covers in the reading orders
that ship with the app is already on that server, as were all 36 checked against the live
database, going back to issues published in 1963.

The reason this was left open turned out to be a mistake in the reasoning rather than an oversight.
When the browser security rules were first written, pinning them to one server was rejected because
the app lets you point it at your own copy of the comics database, and pinning would have broken
that. True of the database, but the app never asks the database for a picture, only for an address
inside its answer, so your own copy keeps working exactly as before.

One gap in this turned up in review. The app read each address properly to check it, then kept the
original text rather than the version it had just read. That let a piece of punctuation hidden
inside an otherwise genuine Marvel address smuggle a second address, on any server at all, in
behind it. The check now keeps what it read, so the punctuation is written out harmlessly. Nothing
you can see changes: every cover that ships with the app is already written exactly the way the
check writes it.

### A slow metadata service no longer repeats itself at you (BL-124)

When the service this app fetches issue details from asks it to slow down, it waits and tries
again, and it says so, because a wait you cannot see looks like an app that has frozen. It said so
far too often. Fetching details for a long reading order asks the service once per issue, and if
the service is down every one of those asks produces up to four of these messages, so a 219-issue
order could announce the same handful of sentences 876 times. Two of them in a row were usually
word for word identical.

Each different wait is now said once, and stays quiet until the service actually answers, at which
point the next stall is treated as news again. That last part is the whole of the decision: going
quiet forever would be worse than repeating, because a second problem an hour later is something
you want to hear about. So the app now waits to be told the service has replied before it will say
any of it again.

The message also had a grammar fault, reading "Waiting 1 seconds", which is fixed. Nothing you
have saved is affected, and the app waits and retries exactly as it did before. The only change is
how much it says while it does.

For maintainers: review of this change found three statements in the project documents of how
large the main view file is, all left at the size it was before. They now agree with the file,
and the list of planned improvements carries a new entry for the check that would have caught
them, since none of the existing ones can.

### Erasing everything now says what it does not reach (BL-113)

In plain English: when this app cannot read your saved data, it puts a copy of it aside rather than
losing it, and that copy is listed on the backup screen, where only you can remove it. Erasing
everything has never touched those copies, on purpose, because nothing here can know whether you
still want data it could not open itself. The dialog said it clears everything this browser has
stored, which was not true whenever one of those copies existed, and misleading exactly when it
mattered.

That sentence turned out to be wrong for everyone else too. Your settings, the theme and whether
cover art is shown and the rest, are stored apart from your lists and are not touched by erasing
either. So the dialog now says it clears every list and all reading progress, says your settings
are kept, and, when you do have copies kept aside, says how many there are and where to find them.
The erase itself still works exactly as it did.

The dialog also used to promise a Remove button beside each copy. That button is held back while
the copy is still standing in for data the app is using, which on the erase screen is the usual
case, so the dialog now only mentions it when it is really there.

One more thing was fixed alongside all of that. If another tab or program changes your saved data
while the backup screen is open, the list of copies could go stale in either direction: an erase
that is refused can set a copy aside the list does not show, and an erase that goes through can
make a copy removable while the list still says it is not. The list is now rebuilt either way.

### A screen reader is now told when detail fetching starts and finishes (BL-090)

Four parts of the app change on screen without anything moving: the note saying whether the metadata
service is reachable, the count of requests waiting, how much is cached, and the progress of a
background detail fetch. None of them were announced, so if you use a screen reader they changed
silently.

Two of the four are now announced, once each. A detail fetch says how many issues it is about to
fetch and says when it has finished, or that it stopped and your progress was kept. That first
message is new: a run that could take five minutes previously began with no sign that anything was
happening. The reachability note speaks only when it changes, so an ordinary start-up stays quiet
and only a service that has gone away, or come back, is worth interrupting you for.

The other two are deliberately left silent, and the reasons are now written down beside the code.
The queue count empties and refills between every single request, so announcing it would talk over
everything else. Cache usage only changes when you clear the cache, and that button already tells
you what it did, so announcing it again would say it twice.

A review of this change caught a fault in the new start message itself. Adding issues to a list
says how many were added and then immediately begins fetching their details, so both messages were
raised at the same instant, and the announcement area only ever kept the later one. Someone using a
screen reader would have been told the fetch had begun but never that the issues had been added, and
that confirmation has nowhere else to appear. Two messages raised together are now read out as one
sentence, so neither is lost.

Nothing you have saved is affected, and nothing looks different on screen.

### The checker that guards the project's own numbers can now count past ninety-nine (BL-090)

The list of planned improvements has a checker that reads the list and compares what it finds against
the sentences written about it, so a figure cannot quietly go stale. It writes numbers as words,
because the document does, and it deliberately refused to spell anything above ninety-nine rather
than falling back to digits: a list that outgrows the range is meant to fail loudly and have the
range extended.

Filing a new item during this change took the list to a hundred entries and did exactly that. The
range now reaches into the hundreds, spelled the way the document already spells numbers that size,
with a test pinning it there so an equally correct alternative spelling cannot be substituted and
silently break every comparison. The ceiling has moved rather than been removed, so the same loud
failure is still waiting a hundred entries from now.

A review caught that only half of this had been done. The checker writes these numbers in one place
and reads them back in three others, and all three readers had been left stopping at ninety-nine.
Two of them would have quietly given up on a sentence rather than complaining about it, which is the
worst way for a checker to fail, because it goes quiet exactly where it should be loudest. All four
now share one definition of what a number written as a word looks like, and a test holds every
number the checker can write to being one the checker can read back.

Nothing about the app itself changed.

### A note about the backlog's own ordering was counting wrong (BL-123)

The project's list of planned improvements is kept roughly in the order the scoring says to work in,
and an appendix at the end explains the places where the order and the score disagree. It said there
were four such places and that all the work involved was already finished, so the order was a record
of what had been done rather than a plan for what to do next.

Both parts had gone out of date as more items were added. Counted again from the table itself rather
than by reading the sentence, there are six, and three of the items involved have not been done yet.
More usefully, counting neighbouring rows turned out to be the wrong way to ask the question: someone
deciding what to work on next reads only the unfinished rows, so a finished row sitting between two
unfinished ones hides a disagreement. Asked that way there are two, and one of them was invisible to
the first method.

The appendix now names both, and says plainly what it does about them: the score decides, the order is
left alone. Re-sorting would move more than a third of the rows in the list, would need doing again
the next time an item was added, and would not change a single decision, because the score already
settles those.

Nothing you can see changes, and nothing you have saved is affected. This is a correction to the
project's own planning notes.

### The project's own checks now catch a citation used twice in one sentence (BL-122)

The last entry describes a sentence that named three things and gave the same address for two of them.
Nothing caught it, because every address in it pointed at real code that said what the sentence
claimed. Being two rather than three is a fact about the sentence, and nothing was reading sentences.

Something is now. The check that verifies every address in the project's documents also reads its
prose, and refuses a sentence that lists several things and answers two of them with one address. Run
against the project as it stood before that mistake was fixed, it finds exactly that mistake and
nothing else.

A rule that reads prose can also misread it, so it was pointed at twenty shapes the documents
actually contain and asked which ones it got wrong. It got three wrong, all of them by running two
correct sentences together and reporting the join as a mistake, and all three were fixed before this
shipped. Wrongly failing a build over correct writing is the one thing a check like this cannot
afford, because it teaches people to wave it through.

Nothing you can see changes, and nothing you have saved is affected. This is a check on the project's
own writing, not on the app.

### One project record pointed at the wrong line of code (BL-121)

The project keeps a written record of how each part of the app works, and every claim in it names the
exact lines of code it is about. One sentence described three different things the app does when it
throws away the offer to undo a deleted list, and gave three addresses for them, but two of the three
addresses were the same one. The line that erases everything was not named at all.

Nothing you can see was wrong, and nothing you have saved is affected. This is a mistake in the
project's own documentation, not in the app.

It went unnoticed because the automated check that keeps those addresses honest reads the code at
each address and confirms it says what the sentence claims, which both copies did. What it cannot
read is that a list of three was answered with two. All thirteen addresses in that part of the record
have now been read against the code they name; the other twelve were right. Two further problems
found along the way have been added to the project's list of planned improvements.

### Switching cover art off now stops the covers being requested (BL-108)

The cover art switch had a gap between what it said and what it did. Turning it off replaced every
cover with a plain typographic tile, which is what you can see, but the pictures behind those tiles
were still being asked for from Marvel's image servers every time. Hiding a picture is not the same
as not fetching it, and those servers could still see which issues were on your screen.

That is fixed. With cover art off, no cover is requested at all. Measured on a reading list of
twenty issues: ten requests went out with the switch on, nine with it off before this change, and
none with it off afterwards. Turning the switch back on fetches the covers that were skipped, in the
same tab, without needing a reload.

Four places in the app and the readme said, correctly at the time, that switching cover art off did
not stop the requests. They now say it does. Nothing you have saved is affected, and the switch is
in the same place it always was.

### The repository no longer publishes thirty-one branches it had finished with (BL-103)

Nothing about the app changes and nothing you have saved is affected. This is housekeeping on the
code repository itself, and it matters for the day this project becomes public.

Every branch pushed to the repository is visible to anyone who clones it, not just the main one. The
way changes are merged here leaves the branch behind afterwards, and nothing removed them, so what
had built up was a list of thirty-two branches, of which thirty were finished work that had already
been merged, one was an abandoned draft whose conclusion shipped by another route, and only the
thirty-second was the live one. A newcomer would have had to work out which.

They are gone, and the repository now offers exactly one branch. Nothing was lost with them: every
change that ever became a pull request is kept by GitHub under that pull request permanently, which
was checked rather than assumed. The repository is also now set to remove a branch automatically
when its change is merged, so the list does not fill up again.

### An import that arrives short of details now tells you how many (BL-110)

Two of the twelve bundled reading orders contain issues that Marvel's own data no longer holds
anything about: 63 of them, in the two Ultimate Universe orders. They import as normal and appear in
your list with a title, a number and a link, but no cover and nothing to open in Marvel Unlimited.
Nothing was said about that, so the list simply looked wrong.

Importing now says so. If any issues arrived that way you are told how many, and if any issues have
no Marvel Unlimited link at all you are told that as a separate number, because those two things are
not the same and only one of them means the issue cannot be opened. Nothing you have already saved
changes, and no import behaves differently: the only difference is that the gap is admitted instead
of left to be discovered.

The number used to be read from a field the reading orders carry, and that field only ever counted
the second kind. It read zero for every order this app ships, including the two that have the gap,
so the sentence never appeared. It is now counted from the issues themselves.

### Opening an issue or a change now gives you the right form to fill in (BL-098)

Nothing about the app changes and nothing you have saved is affected. What is new is what you see
when you go to report something.

Reporting a fault, asking for a feature and pointing out a wrong reading order need different things
from you, and asking for all of them in one empty box gets none of them. There are now three forms
that ask for what each actually needs, and a set of links beside them for the questions that have an
answer somewhere else: the security policy, the reasons this is a companion rather than a reader,
where to ask for help, and the list of what is already planned, which may well include your idea.

You can still open a completely blank issue, and that is deliberate rather than left alone. The
security policy tells anyone who cannot report a vulnerability privately to open an issue saying
only that they have one and asking how to send it. Every form here asks for detail and tells you not
to paste anything private, so removing the blank option would leave that instruction nowhere to go.
A check now holds those two documents together.

Opening a change now brings up a form as well, asking for the plain summary first and then the
evidence and the numbers. That is the standard this project already held itself to privately; it is
now visible to anyone who has never read the internal notes.

### There are now written answers to how to help, where to ask, and who decides (BL-097)

Nothing about the app changes and nothing you have saved is affected. What is new is four documents
for anyone who wants to do more than read comics with it.

Until now the only guidance was buried in a long section of the front page written for people who
already knew the project, plus a security policy. There was nothing saying what kinds of change this
project will turn down whatever their merits, nothing setting a standard for how people treat each
other, nothing telling you where a question belongs when the answer is that it belongs with Marvel
or with the outside comic database rather than here, and nothing explaining how anything gets
decided or in what order.

So: a guide for people making changes, which is blunt about what will be declined and warns twice
about a page in the app whose buttons destroy your saved reading on purpose, since it exists to test
that the app can put it back. A short code of conduct, which names a way to raise a concern about
the maintainer that does not go through the maintainer. A guide to getting help, which separates a
problem with this app from a problem with Marvel's own service or with the outside database it reads
from. And a record of who decides what, including the honest note that there is one person, no
succession plan, and a written reason behind every decision instead.

Writing them turned up a real error. The front page told anyone changing the app to run four checks
before opening a request, and said those four were what runs automatically. Six run automatically.
Someone following the instructions exactly would have seen everything pass on their own machine and
then failed on two checks they had never been told about. Both are now listed, and a test recounts
them from the automation itself in both places that state the number, so it cannot drift again.

### The release check now asks what the comic database holds, not just whether it answers (BL-111)

Nothing about the app changes and nothing you have saved is affected. Before a release, a check runs
against the outside comic database this project takes its issue details from. It confirmed that the
database was answering and that its replies had the shape the app expects, and it never asked how
much the database actually contains.

That matters because the database has stopped growing. The publisher's own data service shut down at
the end of October 2025, and the copy this project reads from ends on exactly that day. That belief
is written down in several places here, and until now nothing in the project would have told anyone
if it turned out to be wrong.

The check now measures three things on every run: how many issues the database holds altogether, how
many it holds for Ultimate Black Panther, whose reading order here runs three issues past the end of
it, and whether those unfillable issues still add up against what the database says it has. All
three are recorded as counts taken on a named day rather than as targets to grow towards, so a
number that moves in either direction is reported as news about the source rather than as progress.

### Notes that chose the repeat checker now say when they were measured (BL-107)

Nothing about the app changes and nothing you have saved is affected. One of the checks on this
project's own writing looks for paragraphs that have been pasted twice. It ignores anything shorter
than three lines, and the note explaining why three counted every repeated passage across the
project's written documents to arrive at that number.

The note was written in the present tense, so it read as a description of the documents as they are
rather than as a count taken on a particular day, and the documents have grown a good deal since.
Re-taking the count went wrong twice over. The note said six documents without saying which six, so
a first attempt counted the wrong six, came out at 113 against the 124 claimed, and concluded the
original number had been invented. A review re-derived it a second way and found the opposite: with
the right set of documents every one of the five numbers reproduces exactly.

So the note's real fault was never a wrong number. It was that it described what it had counted
instead of saying it, which left a correct measurement looking made up. Every number now carries
the day it was taken and a rule for working out which documents were read, in both places the note
appears, and the same was done for a second pair of figures beside it that had genuinely drifted.
The wrong turn is written down too, since it is the evidence for why saying which documents matters.

The decision itself survives untouched, and re-taking the count is what shows why: the reason for
choosing three has held in every version of the documents since, while the corpus it was read from
grew by about a third.

A gap this turned up is written down for later rather than fixed here: the note promises that a
genuine three-line repeat would be raised and explained, but only one of the documents is actually
scanned, so everywhere else that promise waits on somebody noticing.

### The count checker now reads the roadmap's second summary too (BL-105)

Nothing about the app changes and nothing you have saved is affected. The project's list of planned
improvements opens with two summary paragraphs: one about everything in the list, and one about the
eighteen items that came out of a single review. Both say how many are still waiting and which have
been finished.

Only the first was checked against the list underneath it. The second was ordinary prose, so when
items in it were finished nothing noticed. Twice it went wrong, both times on the same day, saying
nine were waiting when eight were and leaving a finished item out of its roll call. It stayed wrong
across two rounds of work and every automatic check passed the whole time, until somebody happened
to spot it by eye.

The checker now looks for the shape of those sentences instead of one particular sentence, so both
paragraphs are checked by the same handful of lines and a third would be checked for free. It also
works out which sentences are describing the check rather than making a claim, which matters because
the written record of this change quotes both shapes. A review of the change found one way the new
checker could fall silent instead of complaining, and it now says so out loud rather than passing.

### The citation checker now sees claims about files with no extension (BL-104)

Nothing about the app changes and nothing you have saved is affected. This is one of the checks that
runs before any change is accepted, watching the notes scattered through the project that point at a
particular line of a particular file, so that those notes cannot quietly go stale when the lines
move underneath them.

The check recognised a file only when its name ended in one of seven familiar suffixes. Two notes
pointing at the file that decides what this project keeps out of version control were therefore
never watched at all, and both happened still to be right, which is luck rather than a check. A file
is now recognised by being a file in the project rather than by how its name ends, so those two are
watched like every other note, and a note pointing at a dot-named file that does not exist is called
out instead of passing in silence.

### Two tabs no longer overwrite each other's progress (BL-084)

If you had the app open in more than one tab, whichever tab you clicked in second would quietly wipe
out everything the other one had marked since you opened it. Nothing warned you, and the lost
progress was not recoverable. This was reproduced with two real tabs: one issue was marked read in
each, and only one of them survived.

Two tabs now stay in step. Marking something read in one tab updates the other straight away,
without a reload, so the two agree and both tabs' work is kept. If a tab somehow falls behind
anyway, its next change is refused rather than applied, and it tells you plainly that another tab
saved something newer and asks you to make the change again, which now works.

Nothing you have already saved is affected, and backup files you download are unchanged, so a backup
taken before this update still restores exactly as it did.

One more fix came out of reviewing the above. If the app cannot read your saved data it shows a
recovery notice offering to set that data aside and start you off empty. In a second tab, that
offer could get stuck: the button did nothing, however many times it was pressed, and the notice
went on pointing at it. It could also hand back the wrong copy of your data if you asked to download
one. The offer is now withdrawn as soon as it stops making sense, and it says why, instead of
failing silently.

### Extended the number-spelling range a build check had run out of (BL-116)

Nothing about the app changes and nothing you have saved is affected. One of the checks that runs
before any change is accepted compares numbers written out as words in the project's planning
documents against the real totals, and it only knew how to spell numbers up to sixty-nine. Finishing
the seventieth job took it past that.

It was built to stop rather than guess, which is what happened, so the failure was loud instead of
silent. It can now spell up to ninety-nine, and a new check makes sure it can always spell the
largest number those documents actually use, so the next time the range runs out it will say so
directly instead of surfacing as several unrelated failures.

### Updated the linter to ESLint 10 (BL-115)

Nothing about the app changes and nothing you have saved is affected. This is the tool that checks
the project's own code for mistakes, and it had been stuck on an old version because the update
arrived broken.

The new version stopped including a piece it used to come with, so the update could not even start
until that piece was asked for by name. Once it ran it pointed out four things in the code: three
variables given a starting value that nothing could ever read, and one place where an error was
reported onward with its explanation but without the original error attached, which is the sort of
thing that makes a failure harder to diagnose later. All four were fixed rather than silenced.

Fixing it also caught the security notes describing the project's tooling by a count that the update
had made wrong, and that sentence was corrected at the same time.

### Bounded what a restored backup may contain (BL-085)

A backup file is now refused before it is read if it is larger than 8 MiB. The largest backup this
app can write is 1,560,536 characters, measured with all twelve shipped orders imported, every issue
read and every issue annotated to the note cap, so the limit sits far above anything honest while a
file picked by mistake costs nothing to reject.

Restoring a hand-edited backup now applies the same limits as creating a list by hand. A list name is
capped at 200 characters and its description at 2,000, matching ordinary creation, and issue title,
series name, description, creator names and every date, id and short code an issue carries are
capped alongside them. Previously all of these came through at whatever length the file declared,
and a single issue could build a seven-million-character tracker on its own.

A backup may also declare at most 250,000 issues and 250,000 lists, refused before the state is
built rather than after. That ceiling is set above anything you could reach rather than as a size
limit: it is around six times the issues and three times the lists that browser storage holds, so it
cannot refuse a tracker you built yourself, and it cannot refuse the copy the app keeps so that you
can undo a restore. A tracker too large for your browser is still refused by the save itself, with
the message it always gave. Backups written by the very first version of this app are counted too.
They keep their issues inside their lists rather than in a list of their own, and until now that
meant they were not counted at all: a 1.5 MiB file of that shape passed every check and built 50,000
issues.

That ceiling reached further than it was measured for. It also counted your read markers, your
availability overrides and your notes, and those are far smaller than an issue, so browser storage
holds several times more of them than the ceiling allowed. A reader who had annotated more than
250,000 issues would have been told their own saved data was too large to give back: the app would
save it happily, and then refuse it when they pressed **Undo last restore**. Those three now have a
ceiling of their own, set above what a browser can hold, so the app can never refuse you a copy of
your own tracker. Nothing you have saved is affected, and no ordinary tracker comes near either
number.

A backup naming the same list over and over in its running order used to be carried through entry by
entry. 300,000 repetitions of a single list fitted comfortably inside every other limit, survived a
reload, and made the app add 300,000 tabs to the rail on every update. Repeats are collapsed now,
including the ones written in a form that is not quite a name: a first attempt at this collapsed only
the plainest of them, and a file naming the same list 300,000 times in a slightly different way went
through it untouched.

Restoring a backup with a great many lists in it is no longer slow out of all proportion to its size.
The step that puts each list into the running order compared it against every list already there, so
the work grew with the square of the count: a 5.4 MiB file of 250,000 lists took 26.6 seconds, during
which the tab did nothing at all. It now takes a tenth of a second.

Restoring a backup written by the very first version of this app is no longer slow in the same way.
Those backups keep their issues inside their lists, and every issue was being added in a way that
recopied the whole collection, so the work again grew with the square of the count: a 6.1 MiB file of
250,000 issues took 96 seconds and then gave up with an error no reader could act on. It now takes a
tenth of a second and finishes.

The same was true twice more in the same step, for the two things one of those old backups is mostly
made of, and the first attempt at the paragraph above did not cover them. Every reading order added
recopied all the orders already added, and every issue marked as read recopied every issue marked as
read so far. Both grew with the square of the count again, and the orders were much the worse of the
two: a file of 5,000 empty orders is a sixth of a mebibyte, small enough that nothing about it looks
demanding, and it froze the tab for nearly 17 seconds. A file with 80,000 issues marked as read took
over 9. Restoring either now takes a few hundredths of a second, and the largest files these limits
allow finish in well under a second.

An over-long issue link or cover URL is dropped rather than shortened, because a shortened link is a
link to the wrong page.

### Fixed

- **Erasing all your data now takes the leftover restore copy with it.** The confirmation says it
  clears everything this browser has stored and that it cannot be undone. It did not: if you had
  restored a backup at any point, a whole second copy of your tracker stayed behind, the **Undo
  last restore** button stayed on screen, and pressing it genuinely brought the erased lists back.
  That copy is now removed, and only once the erase itself has been written, so a browser that
  refuses the write leaves both your data and the working undo exactly where they were. If a
  browser refuses to remove the copy, the page says so and names the button that still holds it.
  Starting fresh from the unreadable-data screen deliberately keeps its copy: that route promises
  only to replace saved data it could not read, and the undo it offers still gets your lists back.
  A second leftover goes with it: if a past restore failed to tidy up after itself, the app could be
  holding a spare copy of your tracker that nothing ever showed you, and erasing now clears that too.
  One thing erasing still does not reach is a rescue copy the app took of saved data it could not
  read. Those stay listed on the same screen with their own remove buttons, so you can see what is
  left and clear each one yourself.
- **A note for maintainers: the map of what the app stores was wrong about one of its own names.**
  The table listing every name the app writes to browser storage said the copy behind the undo button
  was removed by nothing and was deliberately never removed. That was not true: when a restore fails
  and there is no earlier undo to put back, the app clears that slot rather than leave a button
  offering to swap in data that is already on screen. Nothing you have saved is affected. This change
  does not alter that behaviour, and only the written description of it was wrong.
- **Buttons now answer to the words printed on them, so voice control can reach them.** Someone
  who drives a computer by speaking says what they can see: "click add to library". A button here
  showed "+ Add to library" but was described to the software as "Add House of M to library", with
  the order's name pushed into the middle of the phrase, so the spoken words did not match and the
  click never happened. That was true of every button of its kind in the app. Counted in a real
  browser with an order open, 124 of the 303 buttons and links on screen could not be activated
  this way. All 124 now can, and they still say which order or issue they act on, which is what a
  screen reader needs. Nothing on screen moves and nothing you have saved is affected. The one thing
  you may notice is the tooltip that appears when you rest the pointer on a cover in the "Coming up"
  strip: it now reads the same words as the caption underneath it rather than a differently worded
  sentence.

  A related worry turned out to be groundless and was dropped rather than fixed. The project's list
  of planned improvements said the two-line description on each catalog card would lose text when a
  reader turns up the spacing between lines and letters, which some people need in order to read at
  all. Measured with those settings on, the box gets taller rather than shorter and still shows two
  lines, and the full text was already one click away in the card's preview. The measurement is
  written down so the next person does not repeat it.

### Changed

- **Twelve reading orders quietly contain 63 entries the app knows almost nothing about, and the project's
  record of where its data comes from now explains why.** Marvel shut its metadata service down on
  2025-10-29. Everything published after that date is missing, and the two Ultimate universe orders
  are where it shows: 34 entries in one and 29 in the other arrive carrying nothing but the issue's
  name, its number and a link to it. No date, no cover, no credits. Those two sets overlap, so what
  is missing is 34 issues rather than 63. Nothing you have saved is affected, and 60 covers sampled
  from across the ones already stored all still load, so this is about issues added from here on
  rather than anything already on your screen.

  Three other comic databases were checked to see whether they could fill the hole. One of them,
  run by a long-established non-profit, has the three that were checked and does permit its records
  to be reused. None of the three can supply cover pictures. The most promising one hands out a
  picture address that its own servers then refuse to serve, which was confirmed by opening that
  address in a real browser rather than by reading anyone's documentation. So the honest answer is
  that the written details are recoverable and the artwork is not, and that split is now written
  down where the rest of the data's history is kept.

  Three separate faults were found while establishing this, and all three are about the app being
  misleading rather than broken. It marks those 63 entries as fully described when they are all but
  empty, it never mentions that an order arrived incomplete, and the check that watches the comics
  database only asks whether it answers, not whether it still covers anything. All three are now on
  the project's list of planned improvements. Reading the list back also turned up two counts in it
  that had been left behind by earlier work, and those are corrected.

### Added

- **The app now says exactly what leaves your computer, instead of saying nothing does.** Two
  screens told you nothing is uploaded. That was the wrong kind of reassurance: it is easy to write,
  hard to keep true, and it disagreed with the read-me, which described the two downloads correctly
  on the same subject. What is on screen now is the accurate version. Your reading progress and
  your notes are saved by your own browser and are never sent anywhere; there is no account, no
  analytics and no tracking. Starting the app asks the comics database whether it is reachable,
  which is what the status light reports. Searching for issues sends what you typed, and so does
  asking an imported line to find its own match; searching the catalogue, series or creators is
  answered from files already on your machine, but adding a whole series or a creator's issues then
  asks the database for every issue it lists, which is the longest run of requests the app makes.
  Filling in
  missing details sends every issue number still missing them, across every list you keep. Cover
  pictures are fetched from Marvel's own image servers as they appear, and turning cover art off
  hides them without stopping them being fetched. Opening an issue asks the comics database for the
  reader link when this copy does not already have it, then hands that one issue to Marvel's reader,
  or to marvel.com whenever no reader link can be found, including when the database cannot be
  reached.

  The read-me was the precise one and was still wrong in one clause, in the opposite direction. It
  promised your lists are never sent, and the issue numbers in a list are exactly what a request for
  that issue's cover or details carries. So one document undersold what leaves by naming nothing and
  the other oversold what stays by naming something the requests give away, which is the same
  mistake twice.

  A check now holds all six places to one claim, and it is deliberately hard to satisfy by
  deleting a promise rather than by qualifying it. Writing it turned up that its first version
  defended only half of what it appeared to: reverting the read-me on its own left it green. A
  review then found the same hole a second time. The check covered the two long statements and not
  the one-line summary that started all this, so that line could be put back word for word and
  everything stayed green. Later reviews found three more places making the same claim, the security
  policy, the cover art card and a card four above it on the same screen, and all three are covered
  now too.

  The same review found this entry had itself gone one better than the truth in two places, which
  is the habit the whole change is about. It said turning cover art off stops the cover requests.
  It does not: the setting hides the pictures, and it never stops them being asked for, before or
  after. Measured in a real browser with the setting off from the very first paint, the same eight
  requests go out either way. And it promised your lists are never sent, in the paragraph above the
  one explaining that the read-me was wrong to promise exactly that.

  A third review found two more. Saying "looking something up sends what you typed" was true of one
  of the four search boxes: only the issue search leaves your machine, and the catalogue, series and
  creator searches are answered from files already on it. And the first correction to the cover art
  sentence was true about the past and silent about the future, which is the half a reader standing
  at that switch actually needs.

  A fourth review found the same claim in one more place, and it is the one that says most about how
  hard this is. Four cards above the corrected one, on the same screen, a line said cover pictures
  "load directly from Marvel's own servers and can be switched off". Nothing there is false, and the
  two halves share a subject whose first verb is about loading, so it reads as though the loading is
  what stops. That is the same misreading the change had already been rewritten three times to
  prevent, sitting untouched in the one place nothing had looked. It now says the pictures can be
  hidden but are still requested, which is the word that names the thing that actually happens: the
  page loads either way, and it is the request to Marvel that a reader is being told about.

  The same review found the security policy still carrying the sentence this whole change removed,
  in a wider form: nothing you create is uploaded anywhere. Your lists are something you create, and
  the issue numbers in one are exactly what the app asks about. It now says what is true instead,
  that there are no accounts, no cloud services, no analytics and no telemetry, and lets the
  sentences after it describe what is asked for.

  A fifth review found no new wrong sentence, and found instead that the check guarding them was
  wrong in both directions. It had been written to spot the false claim, and every way of spotting a
  false claim also catches the true one, because "no cover is requested" and "there is no reduction
  in requests" are built from the same words and mean opposite things. Seven true sentences were
  being reported as lies, including "switching cover art off cannot stop the requests", while four
  false ones went through simply by saying "hide" or "unchecked" instead of "off". A check whose
  easiest repair is to make the writing less honest is worse than no check.

  So it no longer looks for the false claim at all. Any sentence that mentions the cover art switch,
  in the words the check knows for it, has to say that the pictures are still asked for, in words the
  check knows for that, and the cheapest repair is to add the truth rather than remove it. Both of
  those lists are enumerations and neither is complete. A sixth review got past the first four times
  by writing "without cover art" and "disable the images", and a seventh got past it twice more. Both
  rounds of gaps are closed and it remains a list.

  The harder problem took four rounds and three wrong answers. A true clause about something else
  will pardon a false one sitting beside it: "no cover is requested, your notes are unchanged" says
  one true thing and one false thing, and the check was reading the true half. The first two attempts
  reached for the punctuation, refusing an acknowledgement separated from its request by a comma and
  then one separated by a conjunction. Both were rejected as written, because at that width they are
  the wrong instrument: run against the 55 true sentences the check is now proved against, and against
  the coordinator list as the fourteenth round leaves it, the first refuses 6 of them and the second 9.
  Both together refuse 10. That cost is real, and so is what it buys, which earlier drafts left out:
  the first closes 7 of the 18 recorded escapes, the second 4, and both together 8. The case for
  applying them per branch is that doing so closes the same escapes for none of the cost. What separates the two
  cases is not the punctuation but the subject: "your notes" is a different subject, and "regardless"
  is not a subject at all. So the acknowledgement now has to be about the covers, by name or by
  pronoun, in whichever clause is making the assertion. A thirteenth round then found both marks are
  right after all for the branches that carry their own subject, and they are applied there.

  The third wrong answer was deciding which clause that is. A trailing clause was treated as making
  its own assertion when it carried a verb from a list of thirty, and as leaning on the clause before
  it otherwise. That is the wrong way round, and an eighth review demonstrated why with four
  sentences whose verbs were "loads", "look", "survive" and "behaves". A verb missing from the list
  made a false clause look like it was leaning on its neighbour, so it borrowed a subject about the
  covers and passed, and nothing was refused to signal it. All four had been caught two rounds
  earlier. The test is now inverted: a trailing clause asserts unless it is one of a listed set of
  subjectless fragments, so a gap in the list refuses a true sentence instead, which is loud and
  repairable. The same review found "one" and "each" being read as covers pronouns, which pardoned
  "no cover is requested, and each of your lists is unchanged". They are gone.

  Together those close five of the six passages the seventh review got past, four of them by the tie
  to the subject, and one of the three recorded a round earlier as unclosable. That third one was
  recorded as unclosable on the reasoning that binding the acknowledgement to the covers would
  convict three of the four acknowledgements the app actually ships, because they say "them" and
  "they". The first half of that was true and the second was not. Three of them do contain a pronoun,
  but only one rests on it: two name the covers by noun in the same breath and a third names the
  image, so a noun-only tie would convict one sentence, not three. Counting the sentences that
  contain a pronoun and publishing that number as the sentences that need one is how the figure was
  reached.

  A ninth review then found the covers tie making the same mistake as the finite-verb list, from the
  other side. It asked whether the asserting clause contained a covers word, and "them", "they",
  "these" and "those" were on that list wherever they appeared. Containing is not being about: "the
  details for them are still fetched" is a clause about the metadata, and dropping it onto the end of
  a lie turned the lie into a pass. Seven shapes of that insertion are now held as false sentences,
  two of them the very entries this file had listed as evasions kept shut. The tie now asks what the
  clause is about. Of the pronouns only "they" counts, and only
  at the head, because "them" is never a subject and "these" and "those" are determiners as often as
  pronouns. The noun was left readable anywhere. Against the corpus as it then stood it cost nothing
  at all, and every shipped sentence
  still passes. It does have one cost, and finding it needed the other half of the proof: rewriting
  the shipped card into another true phrasing produced "they can be hidden, and hiding them changes
  nothing about what is requested", which the tie refuses, because what is hidden sits in the object
  of "hiding" rather than in the subject. It is repaired by naming the covers, and it is now recorded
  as the twelfth refusal rather than argued away, since it is close to wording the card could
  plausibly have shipped.

  A tenth review found the same mistake once more, in the half left alone. Writing the antecedent out
  where the pronoun had been refused restored every pardon: "the details for the covers are still
  fetched" is a clause about the details, and a rule that only asks whether the word is present cannot
  tell it from "the requests for the covers are unchanged". It reached both of the cards on the
  settings page, which the pronoun version had not. The noun is now read the way the pronoun is. It
  counted unless every occurrence of it hung off some other noun through "for", "of" or "about", and a
  word about requesting is the one thing it can hang off and still be about the covers, because the
  shipped copy writes it that way: "the app still asks for the image". The same review found a
  clause-initial "they" being taken as a reference to the covers whatever it actually referred to, so
  the antecedent is now resolved by walking back to the nearest preceding clause and on through any
  further "they", which is the chain the metadata card itself uses. Eight of the nine sentences the
  review wrote to break it are caught and are held as false sentences. The ninth is recorded as a
  third escape: a covers noun buried in a reduced relative clause, "the details the covers carry are
  still fetched", which nothing short of parsing separates from "hides the covers but does not stop
  them".

  An eleventh review found the enumeration back again, for the sixth review running, this time in the
  gap the noun rule allowed between the preposition and the covers word. That gap was a list of
  eighteen determiners, so "the details for the hidden covers are still fetched" stepped straight over
  it, and seven sentences of that shape all pardoned. The fix is not another list but one that cannot
  be incomplete: prepositions are a closed class in English, so all fifty-three are written out and the
  gap becomes any run of words at all. Each of the fifty new ones was measured on its own and then all
  together, and none of them refuses a true sentence, pardons a false one, closes an escape, accepts a
  refusal, breaks a repair or fails a shipped surface. What pays for that is reading the nearest
  attachment rather than the first, and doing so also earned the word "number" out of the request
  words, where it had only ever been papering over the first-match reading, closing "the number of
  covers is unchanged" as it went. The two halves of the check had grown a determiner list each, doing
  the same job twice; the antecedent half now calls the asserting half, so one rule decides both.

  Two candidate rules scored better against the twenty-three sentences written to break the check, and
  neither shipped, which is worth recording precisely because the numbers favoured them. Both decide by
  a word list, so a determiner they have not heard of makes them pardon in silence, while the rule that
  shipped fails by refusing, which is loud and repairable. It bought exactly one such refusal, "Even
  with cover art off there is no reduction in requests", now the thirteenth entry on that list with its
  repair beside it. Four of the twenty-three still pardon, all four the same shape, and they join the
  recorded escapes rather than being quietly left out.

  A twelfth review took the noun rule's two halves separately and got through both. The word the
  covers hang off was read from the same list the acknowledgement itself is built from, and that list
  holds the participles, because "still requested" is how the copy says it. A participle is also the
  one form of a verb that can attach to the noun in front of it, so "the details requested for the
  covers are still fetched" gives the covers a request word to hang off and hands back every pardon
  the round before had closed. Reading only the forms that cannot be a participle fixes it, and still
  accepts both ways the shipped copy writes the word, "the requests for the covers" and "the app still
  asks for the image". Seven sentences of that shape are held as false now, and all seven are caught.

  The other half failed more quietly. That gap was written as word characters, so a character outside
  that class made the whole attachment pattern find nothing, and finding nothing was read as attaching
  to nothing, which is the answer that lets a sentence through. The one gap the rule could not read
  was the one gap it excused. A bracket did it, a quotation mark did it, a hyphen inside the noun did
  it, and so did bold text, a code span and a link, which matters because two of the six surfaces
  checked are read as raw markdown. The gap is now anything at all short of a clause end, which is
  what this entry had already claimed it was. Both fixes were measured apart and together, and neither
  refuses a true sentence, pardons a false one, closes an escape, accepts a refusal, breaks a repair
  or fails a surface.

  Three numbers this entry stated were wrong and are corrected rather than repeated. The determiner
  list replaced last round held eighteen, not nineteen. Walking left accepts most of the recorded
  refusals rather than all of them. And the cost of reading every preposition was described as a
  clause-opening preposition capturing the covers word beside it, when it captures every covers word
  in the clause: "Even without cover art the app still requests every cover" has two and loses both,
  and is recorded as the fourteenth refusal, repaired by deleting a word.

  Two limits are recorded rather than closed, because closing either costs more true English than it
  buys. A trailing fragment with no content of its own is handed back to the clause in front of it,
  which is right when that clause is the true half and wrong when it is the lie, and "no cover is
  requested, regardless" is built out of a covers word and a request word so it reads as its own
  acknowledgement. Removing the six words that do this refuses six true sentences and does not close
  the shape, since dropping the comma evades it again. And the rule that stops "a backup covers every
  list you keep" being read as a claim about pictures also decides whether a passage is examined at
  all, where it works the other way round: "hide the covers you have not read and Marvel is never
  asked for them" is never looked at. Reading the word a second way there catches it and refuses four
  ordinary sentences. Nine escapes are recorded across the two, so closing either later turns the
  suite red.

  The price is now in the repository rather than in this paragraph. Both documents used to say that a
  proof would disagree with anyone who quietly closed one of these limits, and no such proof was in
  the repository: it was a scratch file on one machine. The whole corpus is now a test. It holds 55
  sentences written to be true, 121 written to be false, the 18 passages that still pardon themselves,
  and 25 true sentences the check refuses, each stored beside a repair that is itself asserted to
  pass. Closing an escape or accepting a refusal turns the suite red rather than passing silently,
  which is what those sentences claimed all along.

  Those 25 are a regression list, not a bill. Calling them the cost of the check, which this entry
  did, reads as though they were every true sentence it refuses, and they are nowhere near it:
  twenty-eight more were written in the words a maintainer would actually use and fourteen of them
  were refused. What the list buys is that a refusal already known cannot start being accepted
  without the suite saying so.

  Six of the 25 do not name the covers in the clause that asserts: four say "the requests" without
  saying which, and two lean on "one" or "each" as a word for the covers, which the check stopped
  accepting in the ninth round because "each of your lists is unchanged" pardoned a lie with it. Five
  of those six are repaired by naming the covers; the sixth needs the parenthetical moved as well. The
  next five do name them in the sentence but not in the
  asserting clause, because a parenthetical sits between the subject and its verb, and all five
  repair by moving that parenthetical rather than by adding anything, four of them to the end of the
  sentence and one to the front. So the claim that every repair adds truth rather than removing it,
  which this entry made for three rounds, was not quite right either. The twelfth is the
  object-pronoun sentence described above, the next two are the clause-opening preposition, the
  next six are the thirteenth round's, described below, and the last five are the fourteenth's.
  Walking left to find the subject would accept the middle
  five, and it was measured: it also pardons fifty-seven of the hundred and twenty-one
  false sentences. A passage that says two things and means one of them still needs a reader.

  A thirteenth review got through the rule that decides which clause is doing the asserting, twice. A
  sentence with no full stop, semicolon or comma in it is a single clause, so the clause being checked
  was the whole sentence, and the words that switch the covers off supplied the mention of covers the
  check was looking for. Anything resembling an acknowledgement anywhere in the sentence then excused
  the lie beside it. The mirror of that was the distance allowed between an acknowledgement's two
  halves, which could cross a comma while the clause reader treated a comma as a clause end, so the
  two halves were checked against clauses neither of them was in. Twelve sentences of those two shapes
  are held as false now and all twelve are caught. The fix is the punctuation rule this entry rejected
  three rounds ago, applied to the branches that carry their own subject and to none of the others,
  which is the distinction the earlier measurement had missed: applied to all of them it refuses ten
  true sentences, though it also closes eight of the recorded escapes, which earlier drafts of this
  paragraph left out and which is why the per-branch form is the better answer rather than the only
  one. It costs two true
  sentences, both of which have a comma form this check refused before the change and refuses after
  it, so the rule is more consistent rather than stricter. The round before was also found too strict
  in the opposite direction, refusing "a request is still sent for each cover" along with the evasion
  it was aimed at; a participle counts again when a form of "be" or a request noun stands in front of
  it, which recovers three true sentences and reopens none of the seven evasions. Four true sentences
  of the same shape are still refused and are recorded with repairs.

  A fourteenth review found that whole rule resting on a list of seven words, and re-joined the lies
  it had just closed with a conjunction outside the list: "because", "when", "if", "since", "then",
  "after", "but" and "yet". All forty variants passed again. That is the same failure this item has
  paid for five times: a rule written as a list somebody wrote out by hand, where the missing word is
  the way through. The list holds twenty words now, and widening it was measured as costing nothing at
  all, refusing no true sentence, pardoning no false one and breaking no repair, while catching
  twenty-six of the forty. Six of the rest are the price of leaving "but" and "yet" out, which the
  About view's own sentence needs, and eight the price of letting a trailing fragment keep its wider
  reach. One of each is recorded as an escape rather than all fourteen, because both families run to
  as many sentences as there are conjunctions, and a list of them would be the same mistake again.

  Widening the list costs five true sentences, every one of them two things said about one subject:
  "the covers are hidden and still requested" cuts at the "and" and leaves the second half with no
  subject in it. Not cutting when the following words have no subject of their own would accept all
  five, and it is written down as rejected rather than passed over, because every way of testing for
  that is another hand-written list. One of the five is the About view's shipped sentence with "and"
  in place of its "but", which says what the class costs better than any argument: the rule does not
  care which word joins two predicates, and the copy does. All five are recorded with repairs.

  Thirty-seven deliberately broken versions of the shipped sentences are tried against the real files
  and all thirty-seven are refused. Fifteen true rewrites in different true words are tried as well,
  and thirteen are accepted. Exactly two are not: the sentence the subject tie costs, and the one the
  thirteenth round costs, "the image is requested and unchanged", which that round already
  records as a refusal with its repair, so the file-level harness and the corpus in the tree name the
  same sentence independently. A third rewrite stopped passing in the eighth round and was then
  repaired in the list itself, so what the fifteen hold is its repaired form and it passes; naming it
  alongside the other two, as this entry did, made three failures out of a list that has two. It found a
  third in the tenth round, "the app still asks for the image", and that one was repaired in the
  instrument rather than in the corpus, because the copy's own verb is a fair way to write it. Eight
  ways of undoing the eighth round's repairs were each applied on
  their own, three more undo the ninth round's, five more undo the tenth round's, six more undo the
  eleventh round's, five more undo the twelfth round's, six more undo the thirteenth round's and six
  more undo the fourteenth round's; every
  one turns the suite red, naming which
  test or which sentence defends it. Two
  of the eleventh round's six first reported caught while proving nothing, because the replacement text
  used to
  build the broken version carried a dollar sign before a backtick, which JavaScript reads as a
  reference back into the match, so the broken version would not parse. A version that will not parse
  fails every check in the file and defends none of them, and both were rebuilt until they failed on
  the sentence they are there to defend. The count of distinct repairs needed no broken version to
  prove it can fail: adding the fourteenth refusal turned it red by itself. Two of the fourteenth
  round's six needed correcting before they proved anything: one replaced a word everywhere in the
  file and hit an earlier occurrence than the rule, and one was aimed at a sentence that turned out to
  be caught for an unrelated reason, so removing the word it was meant to defend changed nothing. Both
  showed up as a broken version reporting no failure, which is the only signal that catches this.

  A fifteenth review found the last count in the guard that nothing checked, and it had gone stale
  exactly as the case for checking counts predicts. The note above the true sentences says how many
  of them are repaired forms of refused ones; it said nineteen and there are twenty-four, because the
  round before added five and updated every count except the one no test read. It is checked now, and
  it counts the entries rather than the distinct forms, which is what lets it fail on its own: every
  repair is already required to be held as a true sentence, one requirement per refusal, so the only
  way the two numbers can disagree is the same repaired sentence written into the list twice. Writing
  one in twice turns that check red and nothing else.

  The same review found something the guard cannot reach at all, and it is this item's original fault
  surviving where the rule does not look. All three places that set out what leaves your machine
  listed the reachability check, the issue search, the detail fetch, the cover fetch and the reader
  link, and left out the largest request the app makes: adding a whole series, or everything a
  creator worked on, asks the comics database for every issue it lists and keeps asking until it has
  them all. Two of the three then said in the same breath that searching for a series or a creator is
  answered from files already on the machine, which is true of the search and not of the add that
  follows it, so the sentence pointed away from what was missing. The guard works by taking any
  sentence about the covers switch and requiring it to admit the covers are still fetched; a sentence
  nobody wrote is outside it by construction. All three now name the series and creator fetch,
  asking an imported line to find its own match is named beside the search it resembles, and the
  clause is held by a rule rather than left as prose that could be dropped without anything noticing.
  Deleting it from any one of the three turns the suite red naming that one.

  The harness that proves these checks can fail needed a fix before it proved anything, and it is a
  version of the same lesson: launching the test runner one particular way on this machine exits with
  no status and no output, which the harness read as a failing baseline, so it stopped and reported
  nothing. Running the tests the way the project itself does restored a real baseline, and all four
  new broken versions then failed on the check they are there to defend.

- **The read-me now credits Comic Book Herald, which is one of the reasons this project exists.**
  Nothing in the app changes and nothing you have saved is affected. It sits alongside the two
  companion sites already listed there, and it earns the place twice over: it publishes the
  editorial guides that explain what is worth reading and why, rather than only what order to read
  it in, and one of the reading lists that ships with this app was put together here but takes its
  division into volumes from that site's guide to the collected editions. That second fact was
  already recorded in the provenance notes and in the list itself, in those same terms, so the only
  thing missing was the credit where a new reader would look for it.

  The project's ranked list of planned improvements records this change too, which it nearly did
  not. The argument for skipping the record was that neither companion site already listed in the
  read-me was added under one, and that turned out not to be a precedent: both were added before the
  list and its rules existed. Writing the record moved two entries into the ranking, and eleven lines
  elsewhere in that document state a figure derived from that table. All eleven had to change. The
  check that guards those figures sees seven of them and is blind to four, and a review caught three
  of those four, which is the same fault the document files jobs about. It also turned up a figure
  that was true when it was written and has drifted a long way since, which is now filed as its own
  job rather than fixed here.

- **The project now says plainly where its comic data came from, and no longer claims a licence
  over parts of it that were never the project's to license.** Nothing you have saved is affected,
  and on screen only four sentences change. Three were saying the wrong thing, two of those on the
  About page and one on the Backup and settings screen, and one of the three told you the bundled
  reading lists were not put together here when most of them are. The fourth was reworded to match
  and says the same thing it did. The comic details shown in the app were never written here:
  they came from Marvel, passed through two other people's projects, and arrived with terms nobody
  had written down. A new page in the documentation traces that path hand by hand, lists exactly
  what was copied and how much of it, and states what the project's own licence does and does not
  cover. It deliberately stops short of saying whether any of it can be republished, because that is
  a question for a lawyer and not for a document, and it is now recorded as an open question rather
  than quietly assumed to be settled.

  One check turned an assumption into a correction. The project the data was taken from was believed
  to be MIT-licensed, and it does say so on its front page. Looking properly found it has no licence
  file at all, and that the one place it does declare MIT names its program code and says nothing at
  all about the folder this data came from. So the honest answer is that permission was given for the
  code and never mentioned for the data, and that is now what the project says rather than the more
  comfortable version.

  Alongside that, each reading list used to describe where it came from in the same field meant for
  its licence, so a reader could not tell which of the two they were being told. Those are now
  separate, the licence field will only accept something written in the standard shape a licence name
  takes or an explicit "not established", and every list the project compiles itself has to record
  how it was put together. That last rule is written so that a new list added later is covered
  automatically, rather than only the ones anybody thought to name.

- **The automated checks now run a fixed, reviewed version of the third-party tools they borrow,
  rather than whatever the latest version happens to be that day.** Nothing about the app changes
  and nothing you have saved is affected. Those tools are maintained by other people, and asking
  for the newest one meant agreeing in advance to run whatever they published next. The project now
  names an exact version it has looked at, and an automatic weekly proposal offers newer ones for
  review instead. The checks also stop handing those tools a key they never needed, and stop letting
  a change to the project's own dependency list run code of its own during setup. Tests hold all
  four of those properties so a later edit cannot quietly drop one, and they read every automated
  check the project has rather than the one they were written against.

- **Automated checks now have a time limit, so a stuck one gives up in minutes rather than in
  hours.** Nothing about the app changes and nothing you have saved is affected. Before this, a
  check that hung had six hours to do it, which was never a deliberate figure: it was simply what
  happens when nobody sets one. Measured over 241 runs, no check has ever taken longer than half a
  minute, so the limits now sit at several minutes each, generous enough that a slow day stays green
  and only a genuine hang goes red.

  Which check the limit sits on turned out to matter more than the number, and it needed testing
  rather than looking up. Putting the limit on the whole batch reports the result using the same
  word this project uses for the harmless, everyday case of a newer change replacing an older one
  mid-run, which everyone here has been taught to read as "nothing is wrong". A real problem
  reported in those words would have been ignored by design. Putting the limit on each individual
  check instead reports it as a plain failure and names the check that overran. So each check now
  carries its own limit, the batch keeps a wider one behind them purely as a backstop, and a further
  check makes sure that ordering cannot quietly drift apart later. The notes that teach contributors
  how to read a failed run now carry that exception, since they are where the misleading word was
  being taught.

- **The project now checks, before anyone could ever make it public, that nothing private has been
  written into its history.** Nothing about the app changes and nothing you have saved is affected.
  Two separate things are checked on every change. The first is that the working notes each writing
  session leaves behind stay on the machine that wrote them, which is now enforced by a rule rather
  than by anyone remembering; the six notes that were deliberately published as the project's design
  rationale are untouched. The second is that nothing looking like a password, a key or one
  machine's private folder path has ever been committed, anywhere in the record, not merely in the
  current version of the files. The answer today is that there is nothing to clean up, and that
  answer is now re-checked automatically instead of being a thing somebody once looked into.

  Getting the second check right meant discarding the first attempt at it, twice. Asking this
  machine for everything it holds turns up hundreds of internal working markers that no copy of the
  project ever receives, so a check built that way would have complained forever about things nobody
  could remove. What it looks at now is what a copy of the project would actually contain. Then a
  review found that the check was quietly reporting success over things it had never looked at: two
  files it had been told to skip entirely, anything too large, anything it mistook for a picture, and
  on an abbreviated copy of the project, essentially everything. It now says out loud what it left
  out, skips one known example at a time rather than a whole file, reads the text format this
  project's own tools write by default instead of discarding it, asks the service what copies exist
  rather than trusting what it last heard, and refuses to answer at all when it has been handed too
  little to answer from. It also now recognises a folder path from this machine in the four further
  shapes a program writes one in, having previously only recognised the one a person would spot.

- **The project now watches its own development tooling for known security problems, and says how
  fast each one has to be dealt with.** Nothing about the app changes and nothing you have saved is
  affected, because none of the packages involved reaches your browser: they are the tools used to
  check the code before it ships. Automatic alerts and automatic repair proposals are now switched
  on. Routine updates are collected into one weekly review rather than arriving as a stream of
  separate ones, and a repair for a genuine security problem arrives as soon as the problem is
  known rather than waiting for that weekly slot, with everything it touches gathered into a single
  review. The rule for how urgently to act is now written down beside the settings that act on it,
  rather than being decided afresh each time. One protection could not be turned on: the service
  does not offer secret scanning while a project is private, which this one still is, and a request
  to enable the related push protection is accepted and then quietly does nothing, so that is
  written down too rather than left to look like cover the project does not have.

- **The project now has a published security policy, which names a private route for reporting a
  vulnerability rather than an issue anyone can read.** Nothing about the app changes and nothing
  you have saved is affected. The policy says plainly what a vulnerability can even be in an app
  with no server, no accounts and nothing you create uploaded anywhere: the most serious thing that
  can go wrong here is something that silently loses or corrupts the reading progress you have built
  up, and that is now treated as a security issue rather than an ordinary bug. It also says what is
  not in scope, including Marvel's own services, the outside metadata service the app reads from,
  and the deliberately destructive testing page that warns you before every button. The private
  channel itself is not switched on yet, because the service only offers it once a project is
  visible to the public and this one is not. The policy says so rather than promising a mailbox
  nobody is reading, and tells you how to ask for a channel without putting any detail in the open.

- **The roadmap now records what must be fixed before the repository is opened to outside
  contributors.** Nothing about the app changes and nothing you have saved is affected. A new
  current-state study checked security, privacy, data recovery, accessibility, Responsible AI,
  testing, operations, licensing and contribution safety against the code that ships now, rather
  than repeating the historical audit. It found eighteen pieces of work and gave each one an
  evidence-backed backlog entry. The most urgent are a restore path that can report failure after
  changing saved data, a missing private route for vulnerability reports, and a publication gate
  for secrets, history and content that was meant to stay local. Fork pull requests already run
  without repository secrets and with read-only access, the current dependency audit is clean, and
  the product has no AI feature, so none of those was presented as a failure it does not have.

- **You can now see the copies the app keeps when it cannot read your saved data, and remove the
  ones you no longer want.** When a save turns out to be unreadable, the app puts a copy of it
  safely aside before it does anything else, so nothing is ever thrown away on your behalf. Until
  now those copies were invisible and permanent: nothing ever removed one, not starting fresh, not
  restoring a backup, and there was no screen that admitted they existed. Someone who had hit the
  problem two or three times over a few years was carrying two or three whole copies of everything
  they had, and the first they would hear about it was a save failing for lack of room.
  **Backup & settings** now lists them, with the date each was taken and roughly how much room it
  takes, and a button to download or remove each one. Nothing expires on its own and nothing is
  removed without you asking, because no rule the app could apply would know whether you still want
  data it could not read itself. The one copy it will not let you remove is the one belonging to a
  problem that is currently stopping saves, because the message on screen is at that moment offering
  to download it or start fresh and both need it; that copy becomes removable as soon as you have
  dealt with the problem. That protection now holds even if you have the app open in a second tab
  that was already running before the problem appeared, which a review found it did not: that tab had
  no way of knowing anything had gone wrong and would have let you remove the copy. Each copy is
  listed with the time it was taken as well as the date, so two taken on the same day can be told
  apart. If your browser will not list what it is storing, the screen says so rather than claiming
  you have nothing.

- **The check that catches a paragraph written twice now looks at the whole document, not just the
  next few lines.** Nothing about the app changes and nothing you have saved is affected. Until now
  the check only noticed a repeated block when the copy sat immediately after the original, so a
  paragraph pasted further down went unreported. That happened in a real draft, where a copy sitting
  45 lines below its original put stale framing after the numbers that closed a section, and the
  check said nothing was repeated. It now compares every block against every earlier one in the same
  document. The smallest repeat it reports is three lines, which was measured rather than picked:
  across the project's six written documents there are 128 shorter repeats and every one of them is
  deliberate, while there are none at three lines or longer.

- **The check that keeps the project's written claims honest can now tell a renamed claim from a lost
  one.** Nothing about the app changes and nothing you have saved is affected. Every claim in the
  project's documents is recorded against the exact wording of the lines it points at, and also
  against the name of the section it sits in. Renaming a section therefore made the check announce
  that a claim had vanished and an unrelated new one had appeared, when in truth nothing had moved at
  all. Two people worked that out by hand within an hour of each other, which is what prompted this.
  The check now says plainly when a claim's section was merely renamed, while still stopping, so that
  a claim which really did go missing cannot hide behind one that did not. Run over every recorded
  version of the project's history before this change, it recognises twenty-four such renames across
  twelve rounds of changes, which is exactly the set that prompted it.

- **The contributor guide gained a caution about counting how far a line has moved.** Nothing about
  the app changes and nothing you have saved is affected. When a change adds lines without removing
  any, the record of that change describes where they went in a way that is easy to read as covering
  one line more than it does. Read that way, it put a pointer nine lines past what it was meant to
  name. The guide now says how to read it, and notes that this was caught only because the same
  distance was worked out twice by two different methods and the two answers disagreed.

- **Two things this pass learned the hard way are now written down instead of remembered.** Nothing
  about the app changes and nothing you have saved is affected. Both concern the check that keeps the
  project's written claims honest, and both cost time twice before being recorded. The first is that
  when two people are working on branches that have to be merged into each other, choosing one side
  of a clash silently invalidates work already done to re-point a claim at its new location: the
  pointer still looks right and still points at real text, so nothing complains. The contributor
  guide now says so. The second is a job filed for later, to have the check
  recognise that a claim has simply been renamed rather than lost, which two people worked out by
  hand within two days of each other.

- **The advice that pass wrote down turned out to be half wrong, and is now corrected.** Nothing
  about the app changes and nothing you have saved is affected. It said to re-point a claim by
  searching for the text the claim was recorded against, rather than by counting how far the lines
  had moved. Searching is the safer method when somebody else edits the file underneath you, but it
  fails badly when the recorded text is a line that appears more than once, which is common: one
  line of the app's main file that a claim had been recorded against appears seven times in it. The
  search silently picked the wrong copy and left a claim pointing eight lines away from the passage
  it described, where nothing could detect it, because a brand new claim has no earlier record to be
  compared with. Counting the lines found that one error among a hundred and ten moved claims and
  found nothing else. The guide now says to do both and compare the answers. It also records that
  re-pointing claims is not safe to run twice, because the second run moves claims that had already
  been fixed, and that undoing a deliberately broken copy of the code with a checkout rather than a
  stash throws away work you had staged but not yet committed, which happened here and cost two
  finished fixes.

- **The check that keeps the project's written claims honest now understands comments in every kind
  of file it reads, not just in program code.** Nothing about the app changes and nothing you have
  saved is affected. The check reads every file in the project, but it only ever recognised a comment
  the way one programming language writes them. A note in the build configuration, in a web page or in
  the ignore list was read as machinery rather than as a sentence, so a pointer written into one was
  never examined and the rule that catches badly written pointers could not fire there at all. The
  irony was in the project's own advice, which tells a writer to describe a wrong line in words and
  uses a line of the build configuration as its example, in exactly the file where the rule was blind.

  This changes nothing visible today, and that is worth saying plainly rather than dressing up. Every
  pointer outside the written documents was compared before and after: twenty before, twenty after,
  and not one description of a claim came out different. The lines newly recognised as comments hold
  no pointers at all. The hole is closed before anyone falls into it, so the tests are the only
  evidence there is, and eleven deliberately broken versions of the check were watched failing to earn
  them. Three of those eleven exist because review found rules that looked tested and were not, and
  each of the three now has a case that fails without it.

- **The check that keeps the project's written claims honest now says which of its pointers have
  never been checked before.** Nothing about the app changes and nothing you have saved is affected.
  When a pointer to a line of code is recorded for the very first time, there is nothing to compare
  it against, so the check accepts whatever it happens to name and reports that all is well. That is
  true and useless: a pointer aimed at the wrong place on the day it was written stays wrong forever,
  and the last batch of these produced five wrong ones, three of them naming a completely different
  part of the file. Those pointers are now marked as new when they are recorded, so the person
  approving them knows which ones only they can check.

  The check also now refuses a pointer to a span of lines that starts or finishes on an empty one.
  A span written one line too wide still displays correctly, because the display skips empty lines,
  so it reads perfectly while covering a line the sentence was never about. A span can also acquire
  the fault without anyone touching it: moving a paragraph break in the code slides the empty line
  to the edge of a span already recorded, and nothing the check compares changes, so it used to stay
  silent. It is therefore looked for on every run and not only when new pointers are approved. Every
  one of the 492 existing pointers was measured first and none had this fault, so the rule was
  adopted with no backlog of exceptions to grant. It then caught one straight away, and the one it
  caught belonged to this change.

- **The check that keeps the project's written claims honest can now see a shorthand it used to
  miss.** Nothing about the app changes and nothing you have saved is affected. The project's
  documents point at exact lines of code, and an automated check makes sure those pointers still
  say what they claimed when the code moves. Two of them had been written in a shorthand that named
  a line without naming which file it was in, leaning on a pointer earlier in the same sentence.
  The check begins looking at a filename, so it never noticed those two existed, and one of them
  had already come to point at the wrong thing while every check reported everything fine.

  The shorthand is now refused outright rather than made to work, because a line number with no
  file in front of it is unreadable to a person too: found in a search result, or in a list of
  changes, it names nothing at all. Teaching the check to guess the file would have helped the
  check and not the reader. Writing the file name out costs one repetition and it is now required.

  The rule caught its own author three times while being written, twice inside the very comment
  explaining it, which is the shortest gap between a rule and someone breaking it in this project
  so far.

  Checking the pointers this change touched turned up a separate weakness worth writing down. When a
  pointer is written for the very first time there is nothing to compare it against, so the check
  records wherever it happens to land and reports that all is well. Five pointers written for this
  change were wrong, three of them aimed at an entirely different passage than the sentence claimed,
  and all five were found only by opening the file and reading. Making the check print those for a
  person to read is now on the project's list of planned improvements rather than done here, so that
  this change stays about the one thing it set out to fix.

  A review of the change then found that refusing the shorthand had broken a second, quieter use of
  the check. As well as checking the project as it stands, it can be pointed at an older version to
  ask whether it would have caught a problem at the time. Because older versions contain the very
  shorthand now banned, the check refused to run against any of them, which took away the only thing
  that mode is for. A version that has already been published cannot be rewritten to satisfy a rule
  invented afterwards, so the shorthand is now refused only in the version being written, and merely
  pointed out in an older one. A third weakness the review found, that the check only recognises
  comments written the way JavaScript writes them and so overlooks several other kinds of file it
  already reads, is filed as a separate planned improvement rather than fixed here.

- **The project now has diagrams of how the app fits together, which it never had before.** Nothing
  about the app changes and nothing you have saved is affected. The repository explains itself at
  length in words, but until now there was no picture anywhere in it, so anyone wanting to describe
  how the parts connect had to read the code first. There are now three, in a new document for
  people looking at the code: which parts of the app own which, what happens step by step between
  pressing a tick and the screen changing, and where your reading progress is actually kept. They
  are written as plain text that the code host draws for you, so nothing new was added to the
  project to make them work.

  The third one turned out to be the useful one. Setting out to name every place the app writes to
  found seven rather than the four the plan expected, because two of them are written elsewhere in
  the app and one is a family of spare copies named after the moment they were taken. Drawing that
  also turned up a real fault, which is fixed further down these same notes: if the app cannot read
  your saved data for a second time, months after a first time, reloading the page while it is stuck
  kept taking another spare copy of the same thing, every reload, at exactly the moment your browser
  storage is most likely to be full. It was harmless the first time this ever happens to you, and the
  repeat was the part nothing was checking for.

- **The filter you have chosen is now part of the link, so you can share or bookmark a filtered
  view.** Pick Unread on a reading order and the address in the bar becomes something like
  `#/read/list-abc?filter=unread`. Send that to someone, or bookmark it, and it opens showing the
  same thing. Your browser's Back button now steps back through filter changes too, so switching to
  Read and changing your mind is one press away, and the rows move back with it. Two things are
  deliberately left alone: an ordinary unfiltered view has exactly the address it has always had, so
  every bookmark you already made still works, and choosing a filter no longer moves your keyboard
  off the button you just pressed. Nothing is sent anywhere; the filter lives in the part of the
  address that never leaves your browser.

  Two things a review caught before this shipped. If you move through the filters with the arrow
  keys, the whole sweep now counts as one decision, so one press of Back returns you to the filter
  you started from rather than walking you through every filter you passed over on the way. And a
  link naming a reading order that does not exist is now refused in every case; a handful of
  made-up names used to get past the check, leave the app on a blank screen, and still be there the
  next time you opened it.

  A second review round caught one more, in the arrow-key fix itself. If you arrowed away from a
  filter and then arrowed straight back to it, Back afterwards did nothing at all: the press
  registered, but the page did not move. The sweep is now recorded only once you have finished it,
  which means arrowing back to where you started leaves no trace to press Back through, and the
  address you arrived on is still the one waiting underneath.

- **You can now keep notes on a reading order and on any issue in it.** Every row in a reading
  order has an "Add a note" control, and each order has a Note button in its toolbar, next to
  Rename. Notes are yours alone: they are saved on your own device, they show up in your backup
  file so they survive a move to another computer, and they appear in a Markdown export under
  whatever they belong to. A note is limited to 2,000 characters. Clearing the box and saving
  deletes the note, while cancelling leaves it exactly as it was, so you can open one to reread it
  without risk. A screen reader hears the note itself, not merely that one exists. Nothing about
  your existing data changes: orders and progress saved before this release load exactly as
  before, simply with no notes on them yet.

- **A reading order grouped by the trade paperbacks it is collected in.** A lot of people buy Marvel
  in collected editions rather than single issues, and the reading guides written for them are built
  around the volumes. Until now the catalog could only offer a flat run of issues, so a guide like
  that lost its volume boundaries on the way in. The New Ultimate Universe is now offered a second
  way, beside the existing issue-by-issue version: 132 issues under the 23 collected editions that
  collect them, from Ultimate Invasion through Ultimate Endgame. Each volume is a heading with its
  own progress, so you can see that you have finished one book and started the next, and the catalog
  says how many books an order contains before you import it. There is a new filter for finding
  orders of this kind.
  Reading is shared between the two versions, which is the point of doing it this way rather than
  listing the volumes as if they were issues. Tick an issue in one and it is ticked in the other,
  every issue keeps its real cover and its Marvel Unlimited link, and exporting a grouped order
  writes the volumes into the file so re-importing it gets them back.
  Two things are stated plainly rather than glossed over. The volume line-up follows Comic Book
  Herald's guide and could not be checked against Marvel's own data, because Marvel publishes no
  collection records at all for this period. And six issues that Marvel has not collected are left
  out of the grouped version, so it is 132 issues where the issue-by-issue version is 138. Both are
  written on the card before you import.
  Nothing about the lists you have already imported changes.

- **The address bar now knows where you are.** Until now the app lived at one address no matter
  what you were looking at, so the browser's Back button dropped you out of the app entirely, a
  reload always dumped you back on the reading view, and there was no way to bookmark a particular
  order. All three now work the way you would expect from any other site. Move between views and
  the address updates; press Back and you return to the view you came from; reload and you land
  exactly where you were, on the same reading order. You can bookmark a specific order, keep two
  open in two tabs, and send yourself a link that opens straight to the one you meant.
  If you follow an old link to a list you have since deleted, the app quietly puts you somewhere
  real and tidies the address rather than showing you an empty page.

- **A light theme, and a Theme setting under Data.** The app has only ever had one look, a dark
  one. There are now three choices: follow whatever your computer is set to, always dark, or
  always light. The default follows your computer, so if your machine switches to light in the
  morning the tracker does too, without you touching anything, and switches back at night. Pick
  dark or light explicitly and that choice sticks and overrides your computer's. It is remembered
  in this browser alongside your other settings and, like everything else here, is never sent
  anywhere.
  Two things worth knowing. The dark theme has not changed at all. Every colour in it was compared
  before and after this work, all 194 of them, and none moved, so if you never touch the setting
  you will not notice a thing. And the app now checks its own colours: every text-and-background
  combination in both themes is measured against the accepted readability standard each time the
  project builds, rather than being claimed in a comment nobody re-checks.
  That check found three things that were already too faint before this change, in the dark theme
  you have been using since the first release: the outlines of bordered buttons and text fields,
  the outline of an unticked checkbox, and the empty part of a progress bar. They are not made
  worse by this change and the light theme has the same three. They are recorded and scheduled to
  be fixed together rather than quietly patched here, because darkening them changes how every
  button and checkbox in the app looks, which is a bigger decision than adding a theme.

- **A short version of three event reading orders.** The catalog could already show two versions of
  one story side by side, and the Hickman run used it, but every event was offered only in full:
  House of M at 20 issues, Civil War at 31, Secret Invasion at 36. Each of those three now has a
  second, shorter option beside it, containing only the main series: 8, 7 and 8 issues. They appear
  together under one heading, so you pick how much you want to read rather than choosing between
  what look like two unrelated lists.
  Annihilation and King in Black deliberately do not get one, and this is the part worth knowing.
  For both of them the main series is not where the story starts. Annihilation opens with a prologue
  and four mini-series, seventeen issues before the main series begins, and King in Black opens with
  a Symbiote Spider-Man issue. A main-series-only list for either would start you in the middle
  while calling itself the essential path, so the build refuses to make one and says why.
  Nothing about the lists you have already imported changes.

- **Two new Library pages: Everything read, and Added by hand.** The rail's Library section had one
  entry, Progress by series, where the adopted design showed three. The two missing ones are now
  there. Everything read lists every issue you have ticked off, newest first, and Added by hand
  lists every issue you typed in yourself. Each row says which of your lists it belongs to, and
  each page tells you how many issues it is showing.
  The interesting part is what Everything read can show that nothing else could. Deleting a reading
  list has always been careful not to throw away your progress, because the same issue may be in
  another list too. The side effect was that an issue you read inside a list you later deleted
  vanished from the app entirely: it was still recorded, but there was no page it appeared on.
  It appears here, and says "In no list" rather than leaving the space blank, so it reads as a fact
  about your library rather than as something that failed to load. Neither page changes anything;
  they only show you what is already saved.

### Fixed

- **Restoring a backup no longer tells you nothing was changed when your saved data has already been
  replaced.** Restoring is done in stages: the app puts the new data aside, takes a snapshot of what
  is there now so the restore can be undone, swaps the new data in, and then tidies up. Five things
  can go wrong across those stages, and until now all five produced the same message, "nothing was
  changed". For the last two that was untrue. If the tidying-up step failed, your saved data already
  held the restored backup while the screen still showed the data it had replaced, and the app told
  you the restore had not happened. Carrying on from there was the real damage: the next ordinary
  edit you made, marking one issue read, saved the screen you were looking at over the backup you
  had just successfully restored.

  The app now asks your browser what it is actually holding before it says anything. If your backup
  is there, the restore is reported as the success it is and the screen is brought into line with
  it. If it is not there, nothing was changed and that is what you are told. In the rare case where
  the browser stops answering part way through, the app says plainly that it cannot tell what your
  saved data now holds and asks you to reload, and it pauses saving until you have decided what to
  do, which is the same protection it already applies to data it cannot read.

  Two smaller problems came out of the same work. A restore that failed used to spend the undo an
  earlier restore had earned: the snapshot it takes before the swap had already overwritten the
  older one, so the **Undo restore** button would have handed you back the data you were already
  looking at. That snapshot is now put back as it was found when the restore turns out not to have
  happened. And a restore that never took place no longer leaves an **Undo restore** button offering
  to undo it.

  A review of that repair found four more problems, three of them in the repair itself, and they are
  fixed here too. A browser that stopped answering part way through a restore could leave the app
  unable to finish drawing the page, so the message explaining what had happened never appeared and
  the file you had chosen stayed stuck in the box, unable to be chosen again. Putting the undo
  snapshot back could itself fail silently, which left your live data sitting in the undo slot and
  **Undo restore** claiming to have worked when it had done nothing; the app now checks that repair
  landed and withdraws the offer when it did not, and refuses an undo that would change nothing. The
  successful restore was still being reported from the fact that the browser did not complain, rather
  than from asking it what it now holds, which is the exact assumption this whole change exists to
  remove. And restoring a backup into a tracker that was empty offered an **Undo restore** button
  that then had nothing to go back to.

- **Reloading a page that cannot read your saved data no longer keeps taking a fresh spare copy of
  it, and no longer makes the app wrongly refuse to start you over.** This only reaches you the
  second time the app has ever failed to read your data, so most people will never see it, and
  nothing you have saved is affected either way. When a load fails, the app sets your unreadable
  data aside so you can download it, and if it is already holding an older set from a previous
  occasion it files the new one under its own name rather than writing over what it has. That part
  was right. What was wrong is that it worked out what to do again from scratch every time the page
  loaded, so each reload of a page that was still stuck put aside another copy of exactly the same
  thing. Three reloads left three copies of one identical set.

  The cost is not the wasted room on its own, it is what the wasted room then does. All of this
  happens when your browser storage is close to full, which is the usual reason a load fails in the
  first place, so the copies eat the very space they need. On a later reload there was no room left,
  the app took that to mean nothing had been set aside at all, and the button offering to start you
  over with a clean slate then refused, telling you your unreadable data could not be kept safe while
  a copy of it was sitting there untouched. Nobody was permanently stuck, since downloading a copy
  freed the button again, but you were pushed through a step you did not need by a message that was
  not true.

  The app now recognises when it is already holding exactly the data it is about to set aside and
  keeps the copy it has instead of making another. It compares the data itself rather than going by
  the time, which is what lets it tell "this is the same trouble I was already in" from "this is
  something new" across a reload. It never removes anything, and it only ever sets aside fewer copies
  than before, never more, so nothing that was being kept for you stops being kept. Where a browser
  will not let the app look at what it is already holding, it sets a copy aside exactly as it always
  did, so this can never become the reason a recovery is turned down. Eleven automated checks were
  added, four of which were watched failing against the old behaviour first, and the remaining seven
  each watched failing under a change that removes the single protection it exists to describe. Four
  of those seven were written only because that exercise found the "will not let the app look" case
  above to be untested, and review then found it to be untrue as well: the app had stopped asking the
  one place it can always look, so where it could not look around it set aside a second copy of what
  it was already holding. That is the very thing being fixed, and near a full storage it is the
  refusal itself. It now asks that one place directly before looking anywhere else.

  One more fault came out of testing that claim rather than trusting it, and it was the serious one.
  Copies kept from an earlier occasion are named after the moment they were taken, and two taken in
  the same thousandth of a second got the same name, so the second quietly replaced the first. That
  was thought to be impossible, on the grounds that a page cannot load twice that fast. It does not
  need to: choosing to start over also sets a copy aside, so a single page load already does it
  twice, and if you have the app open in another window that changes your data in between, the two
  copies differ and both are kept. The app now picks a name nothing is using rather than assuming the
  clock will not repeat. Losing one of those copies would have meant losing the only remaining record
  of that data, which is the one thing this whole feature exists to prevent.

- **When the app cannot read your saved data, it now keeps telling you why.** The message that
  explains what went wrong sits at the top of the recovery screen, and it used to be replaced by
  whatever happened next. Since saving is paused while you are on that screen, the very next thing
  you tried to do would refuse to save, and that refusal took the explanation's place. Both the
  banner and the notice above it lost it in the same moment, so the one thing on that screen that
  nothing else could tell you, the actual reason your data could not be read, was gone within
  seconds of arriving, and reloading the page was the only way to see it again.

  The explanation is now kept apart from passing notices, so it stays put for as long as saving is
  paused, and anything that fails in the meantime is reported above it rather than over it. It is
  also shown once on the first screen instead of in two places at once. When you resolve the
  situation, by starting fresh or by restoring a backup, the explanation and the notices about it
  are cleared along with the banner, so nothing is left pointing at a screen that has gone. Nothing
  you have saved is affected, and the advice about downloading a copy before starting fresh is
  unchanged.

  One more instance of the same fault was found while reviewing this, and fixed with it. If your
  browser is too full for the app to start fresh, that refusal was announced twice in a row rather
  than once. Screen readers interrupt for this particular notice, because a failure to save must not
  be missed, so hearing it twice was worse than merely untidy.

- **A restored backup could silently lose a reading list.** This only affected a state file or
  backup that had been hand-edited, so it is very unlikely to have happened to you, but it was
  possible and the way it failed was the worst kind: quietly. If a list was stored under one of a
  handful of reserved names that JavaScript gives every object for free, the app would file it in a
  place that is real when you ask for it directly but invisible to anything counting through the
  lists. The list would open and track progress perfectly well, so nothing looked wrong, and then the
  next backup you exported would be written with no lists in it at all while still naming that list
  as the one you were reading. Restoring that backup lost it for good. A related version of the same
  fault let the app start up pointing at a list that was never there, which threw an error during
  boot and left the address bar dead until the stored file was cleared by hand.

  The app now keeps its lists in a container that has none of those reserved names to begin with, so
  there is nothing left to collide with. Nothing about your existing lists, progress or backups
  changes, and no file needs converting. Alongside it, six new automated checks were added, and to
  make sure they were worth having, each one was first run against the old code to watch it fail.

- **A note for maintainers.** The check that keeps this file's evidence links honest was found to
  have a blind spot while this change was being made, and it has been closed. Two separate claims
  were accidentally pointed at the same line of code, one of them wrongly, and the step that exists
  to catch exactly that showed the line only once, so it read correctly and the wrong one was
  approved. The written procedure now says to read one line per claim rather than one per location.

- **The cover-art switch was almost invisible when it was off.** Turn cover art off and the little
  switch beside the label went pale, to the point where it read as a smudge rather than a control:
  in the light theme both the track and the white dot on it were about as distinct from their
  surroundings as pale grey on white, and in the dark theme the track nearly disappeared into the
  page. The words beside it always said "Cover art on" or "Cover art off", so nothing was ever
  genuinely unreadable, but you had to read the words rather than glance at the switch. The
  off-state colour is now noticeably darker in both themes, so the switch, the dot inside it, and
  which way it is pointing are all plain at a glance. Nothing moved or changed size, and the on
  state is exactly the red it always was.

  The check that keeps the app's colours honest now also watches this switch and the red buttons,
  which it had never looked at before, so neither can quietly fade again in a future change. While
  adding those checks it found one more: the white tick inside a checked read checkbox is faint
  against the green in the dark theme. Nothing changed there yet, because the green fill behind it
  already makes a checked box unmistakable and the tick is only a reinforcement, but the number is
  now recorded and printed on every build rather than going unnoticed. That printing had to be built:
  the check used to report only how many faint spots it was carrying, never how faint each one was, so
  a colour could drift further without anything saying so. It now prints the measurement itself.

- **The outline around every button, checkbox and text box was too faint to see reliably.** Buttons
  like Rename, Note, Duplicate and Delete list, the row actions on each issue, the reading filters,
  the cover-art switch, the line marking an issue you have written a note on, and every saved list in
  the Library were all drawn with a border so close in colour to the page behind it that it barely
  registered, especially on a phone in daylight or on a screen where the brightness has been turned
  down. The accessibility standard asks for a boundary three times as distinct from its surroundings
  as those were, and they measured at about a third of what was needed. All of them are now clearly
  outlined, in both the dark and the light theme.
  Nothing changed shape, moved, or changed size, and nothing that is not a button or a box changed
  at all: the fine lines around cards, covers and panels are exactly as they were, because those are
  decoration rather than something you click.

- **The progress bar's empty part is now distinct enough from its filled part to read at a glance.**
  It was possible to raise the contrast between the bar and the page behind it instead, which is what
  the original plan said to do, but every colour that does so in the dark theme is far brighter than
  the red fill, which would have made a bar that is a quarter full look three-quarters full. That is
  a worse outcome than the one being fixed, so the empty part was darkened instead, which is the
  measurement that actually tells you how far through an order you are. Both bars still state the
  same numbers as text beside them, so the bar is never the only way to read your progress.

- **Restoring a backup made by a much older build could show "Invalid Date" as a reading date.**
  Only backups written by the earliest data format were affected, and only if one of them held
  something other than a number where the reading date belonged. Restoring such a backup put the
  words "Invalid Date" on screen wherever that issue's date was shown, and sorted it to an
  arbitrary place. Nothing was lost and nothing else misbehaved, but it looked like a fault
  because it was one. Reading dates are now cleaned up wherever they are recorded rather than on
  one of the two restore paths, so a date the app cannot make sense of becomes the time of the
  restore instead of appearing as broken text.

- **The no-em-dash rule now covers the page and its styling, not only the JavaScript.** When that
  rule was first automated it was written as a lint rule, and lint reads JavaScript. Every word the
  app puts on screen from the page files or the stylesheets was outside it, so the check reported
  green over ground it never looked at. A test now sweeps everything served, found by walking the
  folder rather than by a list of the six files that exist today, so a seventh added later is covered
  without anyone remembering to add it. Comments are skipped, which is not a shortcut: the JavaScript
  rule already ignores comments, measured by running a dash through one, so catching them here would
  hold the page to a stricter standard than the code. Styling can also put a character on screen with
  no words behind it, and the app already does this for the little arrow on a collapsible card, so
  that counts as on-screen wording too and is covered. Nothing in the app breaks the rule today; this
  is about the next thing written, not this one.

- **The backlog checker now refuses a passage that is written twice.** A detail block in the backlog
  stated the same four lines over again, word for word, and it was the paragraph warning a reader
  against a specific misreading, so the stutter landed where it could do most harm. Nothing could
  have caught it: the citation checker only fingerprints lines something quotes, and these were not
  quoted, while the count checker looks at numbers. The checker already refused a whole entry that
  appeared twice, which is the same copy-and-paste slip one size larger, so this is the finer version
  of a rule that was already there. It deliberately looks at the whole document rather than at the
  entries alone, because copying and pasting does not respect a section boundary, and it needs no
  list of exceptions to stay quiet: run over every file in the project before it was written, it
  found exactly one repeat, which was the defect. Four tests cover it and every one of them was
  watched failing first.

- **The rule against em dashes in on-screen wording is now enforced by the toolchain.** The
  repository has a standing rule that the words the app shows you contain no em dash, but nothing
  ever checked it, so two had been sitting in shipped wording for months and were found only when
  somebody read the source line by line. Worse, the hand-written scan that was meant to catch them
  was proved unable to fail at all. Two checks now do the job properly. The linter refuses a dash
  inside any piece of text the app's own code can display, and it works on the parsed structure of
  the code rather than on its raw text, so it can tell an on-screen word from a note left for a
  future developer and never complains about the latter. Its reach stops at JavaScript, so wording
  written directly into the page's HTML or its styling is not covered; that wording was checked by
  hand and contains none today, and closing the gap properly is filed as its own item. A test refuses
  one in the title line of the reading checklists, five of which this repository generates and one of
  which is written by hand. Both were deliberately run against the unfixed code first, and both
  failed there, which is the only way to know a check can fail at all.

- **A count stated in the backlog's prose is now checked against the table it is derived from.**
  The evidence anchors gate fingerprints the lines a citation names, so it reports a sentence as
  sound however wrong the numbers inside it have become. That is how one figure here stayed wrong
  across twelve consecutive shipped items with every check green, and how a pass that went looking
  for stale figures still missed one it was explicitly hunting. `npm run counts` recomputes the
  ranked table's row count, each item's rank, the status tally and the list of delivered items, then
  fails with the derived value when the prose disagrees. It also enumerates rows against detail
  blocks in both directions, which is the check that would have found the one row that had no block.
  It runs in continuous integration beside the anchors gate, so there are now four checks rather
  than three. Scope is deliberately the part a machine can settle: figures derived from the table in
  the same file. A figure that needs the working tree, such as how many lines a source file has, is
  out of reach by design, because deciding which number in an arbitrary sentence is derived and from
  what is not a tractable problem. A claim about a past state is exempted by a marker written into
  the source, which is invisible when the document is rendered, so satisfying the checker never
  changes what a reader sees. Pointed at the tree as it stood a few commits ago, it reports fifteen
  findings, every one of them a real defect that was found by hand at the cost of a research cycle.

- **Progress by series** now counts the list you are reading, not everything you have ever
  imported. Import a second order and the totals used to grow even though nothing about the
  crossover in front of you had changed, which made the one number a reader most wants to act on
  the one number they could not trust. A new choice above the results switches between **This
  list** and **All lists**, and the subtitle says which of the two it is showing rather than always
  claiming it counts every list. The cross-list total is still one click away, because sharing read
  state between lists is deliberate: an issue in two orders is read in both. The choice is not
  saved between visits, unlike the reading filter, because the useful answer is almost always about
  the list you are reading now.

- **About this app** now lists the keyboard shortcuts. Enter and D were only ever advertised on the
  hero button in the reading view, so once you had scrolled past it there was nothing in the
  interface to remind you what was available, and the sidebar binding was only ever in the toggle
  button's tooltip, which a touch screen never shows at all. The reference is in one place and the
  hero keeps its own hint, so the shortcut is still shown at the point of use.

- The filter above the full reading order is remembered. Choosing Unread, Read, In Unlimited or
  Details pending used to last only until the page was reloaded, at which point you were silently
  shown everything again. It is now saved with your other settings and restored on start, so a long
  order you are working through the Unread way stays that way. There is one filter, shared by every
  reading order, which is how it already behaved while the app was open. Anything unrecognised in
  storage falls back to All.

### Changed

- **A set of internal checks stopped needing to be hand-edited every time a job is added to the
  project's list of planned work.** Nothing about the app changes and nothing you have saved is
  affected. Those checks work by deliberately spoiling a copy of the planning document and
  confirming the automatic proofreader notices, and three of them named a job's position in the
  ranked list as a fixed number. Filing anything above that job moved it, and the checks then failed
  for a reason that had nothing to do with what they were meant to test. They now work the position
  out from the list itself, which is what the surrounding note already said should be done and what
  the rest of the same file already did.

- **The largest file in the project can now be tested directly, which it never could before.**
  Nothing about the app changes and nothing you have saved is affected. Most of the code here is
  checked by tests that run it, but the file that draws every screen could not be loaded by a test
  at all: loading it was the same act as starting the whole app, and outside a browser it stopped
  with an error before any test could begin. So the parts of it that decide when a row on screen
  needs redrawing were checked by reading the code as text and looking for the right words, which
  passes just as happily if the words are right and the behaviour is wrong. The starting-up part is
  now separate from the rest, so a test can load the file without launching anything, and those two
  decisions are now checked by running them. Ten new checks, and each was first shown to fail
  against a deliberately broken copy so that none of them is a check that cannot fail. One of them
  catches a fault that had already happened once and cost a real slowdown, where redrawing one row
  quietly moved every row below it; that check counts the work done rather than the result, because
  the broken version still produced the right screen. The app itself was then opened in a browser
  and put through eight checks to confirm it still starts, still moves between screens, and still
  speaks to screen readers.

- **The "we could not read your saved data" warning no longer tells you the same thing twice.** It
  used to give you the reason and the advice, then repeat the advice underneath in slightly
  different words, and both of those also appeared in the red strip along the top, so every
  sentence was on screen three times over. The one thing worth reading, which is why your data
  could not be read, was buried in the middle of wording you had already been told to skip. The
  reason now stands on its own and the advice is said once, directly under it. None of the
  reassurance is gone: your data has still not been changed or deleted, saving is still paused so
  nothing can overwrite it, and downloading a copy before starting fresh is still what the warning
  asks you to do.

  The same thing happened if you tried to add a reading order while that warning was up. The
  message saying the change had not been saved repeated the advice a second time, right above the
  paragraph that already said it. It now tells you only what you could not otherwise know: that the
  change was not saved, and that saving starts again once you have decided what to do. One message
  still repeats itself on purpose, the one that appears if starting fresh cannot go ahead because
  your browser has no room to set a copy aside, because that one is sending you back to download
  the copy by hand rather than restating advice.

- **The safety check that guards written claims about the code now guards the ones written in the
  code as well.** Nothing about the app changes and nothing you have saved is affected. The project
  keeps hundreds of claims of the form "this behaviour lives in this exact place in the code", and a
  check shouts when the code moves out from under one. It only ever read the project's documents,
  so the same kind of claim written as a note beside the code itself was unguarded, and an earlier
  round of work had already found four of those quietly pointing at the wrong lines. The check now
  reads every tracked file. Turning it on found two more wrong on the first run: one said a button's
  outline was set at a line that is only a written note eight lines above the rule that really sets
  it, and one said a placeholder's colour came from a comic's series number when it comes from the
  series name. Both are corrected. The check skips its own record of accepted positions, and works
  that out from where it writes that record rather than from a list of names to keep up to date, so
  there is nothing to forget. It also skips pictures. The note it prints beside each claim, so a
  person can read the claim against the line, had to be taught to read notes written in code: it was
  splicing comment marks into the middle of a sentence and, where a claim opened a note rather than
  closed one, printing nothing at all.

- **A safety check the project uses on itself now does a job that used to be left to whoever was
  paying attention.** Nothing about the app changes and nothing you have saved is affected. The
  project keeps a large number of written claims of the form "this behaviour lives in this exact
  place in the code", and a check exists to shout when the code moves out from under one. Accepting
  the new positions was the risky moment: the tool took whatever it was given, so anyone approving a
  batch of them had to look up each claim by hand and read it against the line it now points at.
  Once, two separate claims were accidentally pointed at the very same line, the hand-rolled listing
  showed that line once, it read perfectly well for the claim that genuinely belonged there, and a
  false claim was locked in and reported as correct from then on. The tool now prints the pairing
  itself, one entry for every claim rather than one for every line, so two claims sharing a line can
  no longer hide behind each other, and it prints the last line of a range as well as the first. It
  also raises a notice when two claims in the same section come to point at the same lines while
  saying different things, and stays quiet about the ones that have always done so. Fourteen new
  checks hold that behaviour, built from the real mix-up rather than an invented one; reinstating the
  old listing turns them red.

- **The project's list of planned improvements now includes drawing diagrams of how the app fits
  together.** Nothing about the app itself changes, and nothing you have saved is affected. The
  repository explains a great deal in words but contains no picture of any kind, so anyone trying to
  describe how the pieces connect has to read the code first. Three diagrams are now planned: which
  parts of the app depend on which, what happens step by step when you mark an issue read, and where
  your reading progress is actually stored, including the spare copies the app keeps so it can put
  your data back: one for when it cannot read what it saved, and two more for undoing a backup you
  restored by mistake. They will be written as plain text that the code
  host draws for you, so no new software is added to the project to make them work.

- **The two buttons in the "we could not read your saved data" warning no longer look equally
  important.** That warning tells you to download a copy first and only then start fresh, but both
  buttons were the same loud red, so nothing on screen backed up what the words were saying. Now
  Download a copy is the red one and Start fresh is the quieter outlined one, which is the same
  pattern the app already uses everywhere else: the thing being suggested is filled in, and the way
  out sits beside it in outline. Starting fresh deletes the saved data it cannot read, so it is the
  one worth pausing over. Nothing about what either button does has changed, and both are still
  perfectly readable in light and dark. The quieter button's outline was measured in both themes
  before it was chosen, and a first attempt was thrown out because the outline was too faint to
  stand out reliably.

- **The automatic contrast check now covers three more places, including two it previously could not
  work out at all.** Nothing on screen changes. The app has a check that runs on every build and
  measures how well each colour stands out against whatever is behind it, and three red things were
  not being measured: the red square beside "Reading Tracker" at the top of the sidebar, the red bar
  that marks which sidebar item you are on, and the two buttons in the warning that appears if your
  saved data cannot be read. All three are comfortably readable today. The reason for adding them is
  that a colour nobody measures is a colour that can quietly get worse, which is the whole point of
  having the check.

  Two of the three sit on backgrounds the check could not previously calculate, because they are not
  a plain colour written down anywhere; they are one colour blended into another, and only the
  browser worked out the result. The check now does that arithmetic itself, and its answers were
  compared against a real browser before they were trusted. They agree exactly. That also caught a
  mistake in the obvious shortcut: the bar marking the selected sidebar item is not sitting on the
  sidebar, it is sitting on the slightly lighter panel behind the selected item, and measuring it
  against the sidebar would have overstated how well it stands out.

  One thing was deliberately left as it is. The white tick inside a checked "read" box stands out
  less against its green than the guideline asks for. Every green that would fix it makes the green
  itself worse against the page, by a wide margin, and the green fill is what actually tells you the
  box is checked, along with the button's own label which reads "Mark X as unread" whenever it is
  ticked. Trading something you read for something you do not is the wrong way round, so the number
  is recorded as a deliberate decision rather than left looking like an oversight.

- **Marking an issue read is now about seven times faster on a long reading order, in the state you
  meet it in.** Ticking one issue in a 219 issue order used to rebuild all 219 rows to record the
  one that changed, which took most of a frame and could feel like a stutter on a slower machine. It
  now rebuilds two rows: the one you ticked, and the one that becomes "read this next". Measured in
  Microsoft Edge on the Hickman to Secret Wars order, the work behind a tick went from 14.8 to 2.8
  milliseconds with the full order open, which is a bit over five times.

  There is a larger saving underneath that one. The full order is the collapsed section headed "Show
  the full order", and it starts closed, so until now the app was building all 219 of those rows for
  a panel you had not opened. It waits until you open it. With the order closed, which is how you
  find it, a tick went from 12.7 to 1.7 milliseconds, which is the seven times in the heading. The
  unread count beside the heading still updates immediately, because it is on screen whether the
  order below it is or not.

  Nothing looks or behaves differently, and that was checked rather than assumed: after ten changes
  of the kind you would actually make, marking issues read and unread, reordering them, flagging
  availability and switching filters, the list on screen was compared character for character
  against the same reading order loaded fresh from scratch, and the two were identical.

  One thing did behave differently, and it was caught in review before this shipped. An issue whose
  Unlimited date is tomorrow shows "soon" rather than "MU", and reusing a row meant a tab left open
  overnight kept showing "soon" the morning after, permanently. Rows now take the date into account
  when deciding whether they can be reused.

- **Three parts of the app that talk to the browser now have tests, where before they had none.**
  These are the piece that remembers downloaded issue details so the app does not fetch them twice,
  the piece that fills in issue details in the background while you read, and the piece that puts
  the app's own question boxes on screen in place of the browser's. All three were untested because
  testing them normally means a real browser; they are covered now by standing in fakes for the two
  browser features they use, so they run in the ordinary test run with nothing new installed. Forty
  tests were added, taking the suite from 334 to 374.

  Every one of the forty was then checked by deliberately breaking the app in twenty-two different
  ways, one at a time, and confirming the tests noticed. That found four problems, and all four
  were in the new tests rather than in the app. Two tests had been quietly covering the same thing
  twice while leaving a real safeguard unchecked, so a genuine bug slipped past them. Three of the
  deliberate breakages made the test run hang forever instead of failing, which on the build server
  would have meant hours of waiting and no explanation; the tests now give up after two seconds and
  report the failure. One test only looked like it was working: it checked the app's saved data
  was unchanged, but the fault it was aimed at leaves the data alone and instead saves it again for
  no reason, so it now counts the saves. And the stand-in for the browser's storage was handing back
  the stored item itself where the real one hands back a copy, which made a test of "reading an item
  marks it as recently used" pass even with that step deleted; since the app uses recency to decide
  what to discard when the store is full, nothing was actually holding that up. The stand-in now
  copies, like the real thing. Each was fixed and re-checked before this was called done.

  The fourth part of the app named in this work, the large file that draws the screen, is not covered
  and could not be. It cannot even be loaded outside a browser, so there is nothing for a test to
  take hold of. That is recorded as its own piece of work rather than quietly dropped.

- **Two small pieces of on-screen wording were rewritten.** Hovering a list in the sidebar used to
  show its name and progress joined by a long dash; a colon now does that job, which reads as the
  label and value it always was. The button under each catalog list used to repeat the issue count
  before inviting you to open it, and now simply reads "See the full list", because the count is
  already printed on the same card directly above the button. Dropping it also quietly retired a
  wording bug that would have said "1 issues" for a single-issue list, which no list in the catalog
  is small enough to have triggered. The titles of the six reading checklists changed the same way,
  from a long dash to a colon, which matters because importing one of them takes the list's displayed
  name straight from that title.

- **A changelog entry no longer needs editing every time an unrelated change lands.** The entry
  below that explains how two audited figures went stale had been quoting what those figures were
  today, so it went stale itself twice in two shipped items, both times only because a source file
  grew and a test was added. The rule now applied is that a figure belongs in a release record when
  it is a property of the change and does not when it is a property of the tree, because only the
  second kind moves without anyone editing the record. The audited values stay, since they are the
  measurement being described. The current values are gone, and the entry points at
  [`PRODUCT_BACKLOG.md`](PRODUCT_BACKLOG.md) instead, which already carries both live and is marked
  as needing re-derivation. A third figure of the same kind was found in the same entry and dropped:
  it put a modularity gap at a thousand lines, which the planned split of that file would have
  inverted outright. Three more elsewhere in this file are now tied to the moment of the change they
  describe rather than left in the present tense, one of which was about to be falsified by a fourth
  continuous integration check.

- Committing the prompt behind the eleven Repository Constraints is no longer planned, and
  [`.github/copilot-instructions.md`](.github/copilot-instructions.md) now says so where it used to
  promise the opposite. The prompt drove a single session's backlog and study pass, and a spent
  instruction to an agent is not an artifact the repository owes anybody. What mattered was the
  eleven constraints themselves, and those were already recovered into that file word for word. The
  practical consequence is worth stating plainly, because the file previously described its table as
  a copy held until the source landed: that table is now the only copy of the eleven that will exist
  here, so it is the source rather than a convenience duplicate of one. Parking it also retires the
  unbuilt "historical document" exemption the anchors gate would have needed, which now has no caller.

- Pull request bodies now open with a plain English summary, and
  [`.github/copilot-instructions.md`](.github/copilot-instructions.md) says what that means. The
  request came from the person reviewing them: the technical sections were written for a reader who
  already knows the codebase, and they were making a review harder rather than easier. Most work
  here changes documents rather than screens, so the sentence most worth writing is often the one
  saying that nothing a reader has saved is affected, and that sentence was never being written. The
  rule names no file, no identifier and no backlog id inside the summary, gives the reason before
  the mechanism, and caps it at four short paragraphs. The technical sections are unchanged and sit
  underneath, because the two halves serve different readers and the record needs both.

- The reading filters are defined once. The five choices above the full order used to exist twice
  over, as radio buttons in the page and as a chain of comparisons in the code, and the two had to
  agree without anything checking that they did. Adding a filter to the page and forgetting the
  comparison gave you a filter you could select, that was saved, and that filtered nothing: the list
  in front of you stayed exactly as it was, with nothing to say the choice had been ignored. Each
  filter is now one entry carrying its label and the rule it applies, the buttons are built from
  those entries, and a filter that is named without a rule stops the app on start with a message
  naming the file to fix. Nothing about the five filters themselves changed, and the same eight
  issues sort into the same five counts as before.

### Fixed

- **A stale test count and an over-broad claim, both found by review rather than by any gate.** The
  quality appendix still said 294 tests passed when 311 do, a figure of the kind no automated check
  reads. And the note recording that this project generates its six reading checklists was wrong
  about one of them: five are generated and the sixth is written by hand, which matters only because
  a claim that all six stay identical to a regeneration would have been quietly false for one file
  forever. The hand-written one was edited to match the other five anyway, and that edit is durable,
  because nothing regenerates or overwrites it.

- **The evidence-anchor gate now has the backlog entry it shipped without.** `BL-050` built the
  check that fails the build when a `path:line` citation stops naming the code it claims, and it was
  the only row in `PRODUCT_BACKLOG.md` with no detail block of its own. Two sentences at the top of
  that document promised a block for every delivered item, so both had been given an exception clause
  naming the gap. The research found the account was not missing but misfiled: it had been written as
  a continuation of the block above it, because the gate grew out of that item's digression about
  stale anchors and each of the five commits that extended it appended to the same run of prose. It
  now has a heading, a task list reconstructed from those commits, and a note saying the list is
  reconstructed. Both exception clauses are gone. Nothing in the app changed.

- **The eleven standing product constraints are now the original text rather than a
  reconstruction.** `.github/copilot-instructions.md` shipped with nine of them rebuilt from how
  they were cited and two marked unrecoverable, because the list had never been committed to this
  repository. The original was found in the prompt that drove the backlog and UX study pass, which
  is still untracked in the working tree. Constraints 8 and 9 are therefore recorded for the first
  time, and six of the nine reconstructions turned out to have drifted from the wording the backlog
  gate lines were actually checked against. Committing the source file was filed as BL-060 and parked
  on 2026-08-07, so the table in that file is not a copy of a source held elsewhere but the source
  itself. Nothing in the app changed.

- **Marking an issue read no longer throws away where you were.** The shelf and the full reading
  order are rebuilt from scratch on every change, and the control you had just used was destroyed
  along with everything else, so the keyboard was handed back to the page body with nothing said and
  nothing highlighted. Working down a long order by keyboard meant tabbing in from the top again
  after every single tick, and the same happened on reorder, on the availability flag and on remove.
  Focus now follows the issue rather than the button: the tracker remembers which issue you were
  acting on and what you were doing to it, and finds that control again after the rebuild. If the
  issue disappears from view, because the Unread filter no longer matches the issue you just ticked,
  focus moves to the issue that took its place, landing on its checkbox rather than on the button
  under your finger, so a held Enter can never repeat into a removal. If nothing is left at all, you
  land on the filter you chose, which is what put you there and what will undo it. The page does not
  scroll when it puts you back somewhere you were already looking.

- **Adding a reading order, and marking one read, no longer drop the keyboard on the floor.** The
  landing page is the one screen built to keep you where you are while you add a second or a third
  order, and it was the screen that moved you most: pressing **+ Add to library** by keyboard handed
  focus straight back to the page body, and it was still there a second and a half later once the
  card had settled into **Open**. Getting to the next order meant tabbing in from the top of the
  page again. The same thing happened in the sidebar list of your orders, which is rebuilt every
  time anything changes: with one of its buttons focused, pressing D to mark an issue read left you
  nowhere, on a screen that otherwise had not moved at all. Focus now follows the card, and the
  sidebar button follows the order it belongs to, so adding an order leaves you on that card as its
  button turns into **Open**, and marking an issue read leaves you on the same order in the sidebar.
  If you move somewhere else while the order is being added, you are left alone: you are only put
  back when nothing else has taken the keyboard in the meantime.

- The check that keeps em dashes out of what you read on screen was reporting every change as clean.
  One of the eleven standing constraints is that shipped wording contains no em dashes, and
  [`.github/copilot-instructions.md`](.github/copilot-instructions.md) carried a command for finding
  any that a change had introduced. The command sent the change through a pipe on the way to the
  scanner, and Windows PowerShell rewrites text crossing a pipe into a character set that has no
  dash in it, so the scanner was reading question marks and finding nothing. Run against the change
  above, the old command found none and the corrected one found eight. A check that cannot fail is
  worse than no check, because it is trusted. The command now writes the change to a file and reads
  it back, and the file records why so it is not shortened again.

- The backlog no longer says twice over which of BL-054's browser checks passed before the fix. Four
  lines of that record were pasted in a second time, and the sentence they duplicate is the one
  warning a reader against a specific misreading of the numbers, so the stutter landed where it was
  least affordable. Filed as BL-062 rather than fixed here, because the duplication predates this
  change and correcting it would have widened a focus fix into a documentation pass. No gate could
  have caught it: the anchors gate only fingerprints lines a document cites, and the counts gate only
  checks figures derived from the ranked table.

- The D and Enter shortcuts no longer stop working after you click a button in the reading view.
  The handler stood down whenever anything interactive held focus, and the hero's own "Done, next"
  button is interactive, so clicking it left focus there and the very next press of D did nothing at
  all, with nothing on screen to say why. Recovering meant pressing Tab or clicking elsewhere, which
  is not something you would guess. The handler now asks two narrower questions instead of one broad
  one: whether the control consumes the characters you type, which stands every shortcut down, and
  whether the browser would itself act on the key, which stands Enter down on its own. Typing in a
  search or rename box is unaffected, Enter still submits a form and still follows a link, and D now
  survives a click. Marking the last issue read hides the hero and used to drop focus on the page
  body without a word; focus now moves to the "That is the whole order, read" heading, so the
  keyboard stays where you were working and a screen reader announces where it landed. The shortcuts
  also stand down entirely while a dialog is open, so pressing D behind the "Delete list?" prompt no
  longer quietly marks an issue read underneath it.

- **Restoring a backup with a great many reading lists no longer loses one of them.** Every list
  gets an identifier made from the current time and six random characters. That was safe while
  restoring was slow, because no two lists were ever made in the same instant. Making the restore
  fast, which is the other half of this release, put about two thousand of them into every
  thousandth of a second, and two lists occasionally drew the same six characters. When that
  happened one list quietly replaced the other and the reader was simply short a list, with nothing
  on screen to say so. Measured over sixty restores of a file holding the largest number of lists
  the app accepts, four lost a list. Identifiers now count upwards from a random starting point
  instead of being drawn fresh each time, so two can no longer coincide, and the same sixty restores
  lose nothing. Restoring is also slightly faster than before, since counting is cheaper than
  drawing. Nothing you have already saved is affected, and no identifier already stored changes.

- **The audited figures in `PRODUCT_BACKLOG.md` no longer go stale in silence.** The
  reconciliation record measured `src/js/main.js` at 1,566 lines and the test suite at 224 tests.
  Both were true when audited and neither is true now. The line count had no drift clause at all,
  and the test count's clause had itself gone stale, written as 235 when nine items had shipped and
  still reading 235 after twelve more had. The audited figures are preserved, because a record of an
  audit that is edited to match today's tree stops being a record of that audit; what changes is the
  clause beside each of them, which now names the current value. That is the convention the
  reconciliation list's own third bullet already established. Neither current value is repeated
  here, deliberately: a release record that has to be revised every time unrelated work adds a line
  or a test is not recording a release. The clause in the backlog is the one place either figure is
  stated live, and it is where to read it. The same treatment is applied to the modularity gap in
  Appendix A, where the size of the file is the argument for the gap and the audited figure
  understates it. Appendix B's ranks, its two row counts and the counts of items above BL-026 and
  BL-007 are recomputed, because that section states in its own words that its ranks are positions
  in the table "as it stands"; the two headings that describe a past ranking pass are left alone,
  since they say so themselves.

- The vendoring scripts no longer hang when the metadata API rate-limits them. Their retry called
  itself from inside the rate limiter's own queue, so a request that was waiting to try again held
  one of the two concurrency slots while queueing the work that would have released it. Two retries
  of a single request, or one retry each of two requests, filled both slots with jobs waiting on
  jobs that could not start. Nothing timed out, so the script simply stopped with no error and no
  output. This is reachable in an ordinary run, because 429 responses are what rate limiting
  produces and they arrive together. Retries are now queued one attempt at a time, which also means
  the wait between attempts is paced by the limiter rather than spent holding a slot. The number of
  attempts, the backoff, the pause applied to other requests and the error messages are all
  unchanged.

- A saved API address that is not usable no longer reaches the network layer. The check for it ran
  only when you typed one into the settings form, but the address is read back out of your browser's
  storage on every start, where a value written by an older build or edited by hand had never been
  checked by anything. It is now enforced by the client that does the fetching, so an unusable
  address cannot get that far from any route. When one is found at startup the app keeps working on
  the default address and says so, naming both addresses, and it leaves the saved value alone rather
  than overwriting it, including when you change an unrelated setting such as cover art. The message
  also warns that issues without a stored Marvel Unlimited link will open on marvel.com rather than
  in the reader while the saved address is unusable, because the launch page reads the same setting
  and has no way to explain itself. The message goes away as soon as you save a usable address.
  Nothing changes for an address that was already usable, including a self-hosted mirror on
  localhost.

### Changed

- The contributor half of the README has been rewritten for length and vocabulary. It was measured
  before it was edited, which corrected the finding that prompted the work: no sentence there ran to
  over a hundred words, as had been recorded. The longest was 48 and only four passed 40. What did
  pass a hundred was a single 138-word paragraph explaining why the series audit reads its index out
  of committed history. That paragraph is now three, one per argument, and the longest sentence in
  the section came down to 36 words. Five terms a new contributor would not know are handled, the four the
  task named and one it had not spotted: to vendor a list, `depth`, placeholder and snapshot are
  all defined where they are used, the earlier undefined use of "snapshot" is gone, and the
  phrase "pinned JSON" is now "the JSON already committed". Three em dashes are gone. No command,
  path, field name or claim about behaviour changed, so nothing here alters what the scripts do or
  how to run them.

- The three build scripts that page the metadata API now share one rate-limited fetch instead of
  keeping a byte-identical copy each. `scripts/vendor-index.mjs`, `scripts/vendor-orders.mjs` and
  `scripts/build-event-order.mjs` call a new `scripts/lib/fetch-json.mjs`, so a change to how the
  scripts handle a rate limit is made once rather than three times and cannot be applied to two of
  them by accident. It shipped with nine tests, which is nine more than the copies had. Nothing
  the scripts write changes.

- The `.row` class no longer means two different things. A reading row and a form row shared it, and
  the page only rendered correctly because the form rule was scoped to `.stack` and `.card` and so
  out-ran the reading-row grid on specificity. That held by luck of placement rather than by design:
  the full order sits inside neither container today, and putting a reading list inside a card would
  have silently restyled every row in it. Form rows are now `.field-row`, the reading row keeps
  `.row`, and the leftover empty rule between them is gone. Nothing changes on screen.

- The README now assumes no prior experience. It was reviewed against a twenty-point readability
  rubric by following it literally in a fresh clone, and thirteen of the twenty criteria failed.
  Four of those failures stopped a non-engineer reaching a running app at all: the document named
  no address to open, named no prerequisite, had no troubleshooting section, and put the run
  instructions seventh of ten headings behind vendoring and search-index material. It now opens
  with what the app is and who it is for, then a numbered path from installing Node.js to looking
  at a working screen, each command saying what you should see when it worked. The address is
  written out in full, and there is a section on why it must not change: reading progress is filed
  by your browser under the exact address, so a different port, or `localhost` in place of
  `127.0.0.1`, shows an empty app while the real progress sits untouched at the old one. Both
  halves of that were confirmed in a browser rather than reasoned about. Contributor material is
  unchanged in substance but now grouped under one heading, out of a first-time reader's way.

- The BlueStacks section has moved out of the README to
  [`docs/WHY_A_BROWSER_APP.md`](docs/WHY_A_BROWSER_APP.md), with its wording unchanged. It records
  why this is a browser companion rather than a way to run Marvel's Android app on a PC, which is
  worth keeping so nobody retries the emulator route, but it answered a question nobody trying to
  run the app is asking and it sat second of the README's headings. A reader met a page of ARM64
  driver architecture before anything about starting the app. The README links to it from the
  contributor section.

- Two README statements were corrected. It said the tests and linter run "on every push"; the
  workflow scopes its push trigger to `main`, so a feature branch with no open pull request
  correctly produces no run, and it named two checks when the workflow ran three, since the evidence
  anchors gate runs alongside them. And the privacy line said your progress "is not uploaded anywhere",
  which is true but sat alone: the app does download comic details from the metadata API and cover
  images from Marvel's servers on an ordinary page load. Both are now stated together, because the
  promise worth making is the one a reader can check.

- Phone and tablet layout is out of scope. Marvel Unlimited ships iOS and Android apps that already
  carry reading lists, so the small-screen job is served first-party and building a second, worse
  one here would not help anyone. The tracker's posture is now stated rather than implied: it is a
  desktop companion to the Marvel Unlimited **web** reader, which is the platform where no list
  feature exists. BL-028 moves to the parked table in `PRODUCT_BACKLOG.md` with its score left in
  place as the record of what was given up, and the four UX findings behind it are marked accepted
  rather than open. No interface or behaviour changed, so nothing you have saved is affected. This
  is the largest Cost of Delay in the backlog being retired by a scope decision rather than by
  work, which is why it is written down at this length.

### Added

- Contributor instructions at `.github/copilot-instructions.md`, loaded automatically by GitHub
  Copilot in this repository. It records the gates and how to run them, the traps in the evidence
  anchors check, the workflow the project was originally built with and where its committed
  artifacts live, and the eleven standing product constraints. Two of those constraints could not
  be recovered from the tree and are marked as such rather than guessed at.

- Deleting a list can now be undone. The confirmation says so, and afterwards a notice above every
  view offers "Undo delete" for the rest of the session rather than for a few seconds, because
  deleting the list you were reading moves you elsewhere and a timer would take the only way back
  while you were still deciding. The list returns to the position it held in the sidebar, and
  reading progress was never affected either way, since it is global and kept per issue. Erasing
  everything or restoring a backup drops the offer, because it would otherwise point at data that
  is no longer there.

### Changed

- CI can now be started by hand on any branch or tag, from the Actions tab or with
  `gh workflow run CI --ref <branch>`. It previously ran only in response to a push or a pull
  request, so a commit could only ever be tested at the moment it arrived. During a GitHub
  Actions incident on 2026-08-06 run creation stalled for hours and three merges reached the
  default branch with no run recorded against them, which left nothing to retry: a commit that
  never got a run has no run to re-run. The manual trigger is the way back from that.

- Naming a list and confirming a destructive action now happen in the page instead of in a
  browser dialog. The old `prompt()` and `confirm()` could not be styled or announced through
  the app's own live region, blocked the page, and on a browser told to suppress them a rename
  silently did nothing while a deletion was answered for you. Curated import failures are
  reported next to the catalog rather than in an `alert()`, so the reason and the thing it is
  about can be read together, and the notice appears wherever the reader is rather than in a
  view they may have already left.

### Fixed

- Screen readers no longer say every change twice. Six result panes were live regions that also
  copied their summary to the announcer, so both were read; now each message goes down exactly
  one channel. Three headings that were empty until something rendered into them carry text from
  the start, one of which also names its section. The availability wording moved out of a `title`
  attribute, which touch users cannot reach and several screen readers skip, into text inside the
  badge.

## 1.0.0

The first tracked release. Everything before this point is in the git history but was never
given a number, so this entry records the state the project is being pinned at rather than
pretending to reconstruct forty-four commits of changes.

The app at 1.0.0 tracks reading progress through curated Marvel reading orders, entirely in
the browser. It reads issue, series, and creator metadata from the community
`marvel.emreparker.com` API, stores no comic content, and links out to Marvel's own reader.
Data format version 2.

### Added

- Continuous integration on every push and pull request, running the test suite on Node 20
  and Node 24 and running the linter. Previously nothing ran automatically, so a broken test
  could reach the default branch unnoticed.
- ESLint with a flat config derived from a measured survey of the code already in the repo,
  rather than an off-the-shelf style that would have reflowed working code.
- A content security policy and `X-Frame-Options: DENY` from the dev server, with every
  inline script and style moved into its own file so the policy could be strict rather than
  nominal.
- The version and data format number under **About this app**, so a bug report can name the
  build it is about.
- This changelog.

### Fixed

- `npm test` found no tests at all on Node 20, the version the project declares as its
  floor. The script passed a glob to `node --test`, which only started expanding globs after
  Node 20. Anyone honouring the declared engines range saw a green run over zero tests.
- Read rows were dimmed with `opacity: .48`, which pushed their text below the contrast
  minimum. They now use colours chosen to stay legible, with the strikethrough left to carry
  the "already read" meaning.
- The accent red failed contrast in both of the jobs it was doing at once. It is now two
  values: one for filled surfaces behind white text, one for red text on the dark
  background.
- Text over the hero image could fail contrast depending on which cover art the user had
  imported, because the image bled through a translucent gradient. The gradient is now
  opaque enough that the text passes against any possible cover, not just the sampled ones.
- The comment describing issue availability said there were four states when the code has
  five.

[1.0.0]: https://github.com/raymond-nassar/recap-page/releases/tag/v1.0.0
