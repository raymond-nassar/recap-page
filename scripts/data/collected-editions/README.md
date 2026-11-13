# Collected-edition pilot data

This folder records collected editions: which printed or digital book holds which comics. The
pilot covers five grouped reading lists; explicit selections also cover chosen Modern Timeline
lists without collection headings. The app does not load or package this folder. It loads small
generated name/policy and verified relation modules in `src/data/`. Nothing claims where a reader
can buy, borrow or read a book.

## Files

| File | What it holds | Licence |
|---|---|---|
| `pilot.json` | The curated input: five grouped lists, their chosen collection groups, edition names and formats, and the tier each edition is checked at | MIT, with the repository |
| `destinations.json` | The curated input: each provider's recorded basis, and the owner-confirmed address of a book's page on Hoopla or in Libby, with the date it was checked | MIT, with the repository |
| `gcd-check-inputs.json` | Curated input taken from the database: explicit list selections, story evidence, series names and source-series crosswalk, sequences set aside with reasons, contents stated in indexer notes, and printing links | CC BY-SA 4.0 |
| `cbh-edition-facts.json` | Generated. The collection groups already recorded in each list, with the comics in each group | MIT, with the repository |
| `editions.json` | Generated. The provider-neutral edition records and coverage for each list | MIT, with the repository |
| `gcd-editions.json` | Generated. Facts from the Grand Comics Database and the result of checking each edition against them | CC BY-SA 4.0 |
| `gcd-fixtures/<id>.json` | A minimised edition or original-comic record, as read on the date it carries | CC BY-SA 4.0 |

`gcd-check-inputs.json`, `gcd-editions.json` and every file in `gcd-fixtures/` contain data from the
[Grand Comics Database](https://www.comics.org/), used under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). They are minimised and reorganised
for this project, and cover images are never recorded. Anything derived from them stays under that
licence and keeps this credit. The three MIT files hold no database facts: an edition in
`editions.json` names its database record by id only, and the check fails if a database-only field,
a contents range asserted by the indexer notes, a series named in the database's own form, or wording
matching `printing` or `printings` as whole words, or containing `second edition` or `variant of`,
appears in any of them. The wording check is case-insensitive and treats hyphens as spaces.

## Model

An edition has an id, a title, a format, a `medium` of `print` or `digital`, identifiers, and
`contents`. Each contents entry names a series and an issue range, and says who asserted it:

- `cbh-heading`: a collection heading in the Comic Book Herald guide names the book.
- `cbh-ledger`: the list's source ledger records the book.
- `gcd-notes`: the database's indexer notes say what the book collects.
- `gcd-stories`: the database's indexed stories and their original or numbered comparison
  records establish the contents.
- `owner-curated`: chosen for this pilot and recorded here.

An entry marked `portion: "partial"` holds only part of an issue. `printingOf` links a later printing
to the edition it reprints; it comes from the database, so it lives in `gcd-check-inputs.json` and
appears only in `gcd-editions.json`. Contents asserted by `gcd-notes` live there too.

Each edition is checked against its database record at one of seven tiers. For `gcd-notes`, the
notes must state the series and the exact issue span,
so `#1-5` never matches `#1-50`. A series must follow the start of the notes, "Collects", or a
separator after a previous issue range; ambiguous wording is a conflict, not a verification.
`gcd-count-only` can show a book is consistent, never which comics it holds, and `gcd-unindexed`
records that the database has not indexed the contents. Every
database sequence left out of a count is listed in `check.excludedSequences` with its reason; a
count that differs is consistent only when recorded exclusions explain the whole difference. A
disagreement is recorded as a conflict with its evidence and left for a person to settle.

The other verifying tiers retain the evidence they compare. `gcd-numbered-covers` requires each
numbered interior-cover record immediately before one story, matching creator credits, and an
original-series index of the same name, year, publisher, country and language. This is textual
index metadata, not an image. `gcd-original-stories` matches each book story to an original issue
by exact series, issue number, title, pages and writer and penciller credits.
`gcd-numbered-comparison` compares a book's stories with those following another edition's
numbered interior-cover records. A differing page count needs the matching original issue; a
missing, stale or mismatched resolution fails closed. These checks normalize the database's
editorial "(credited)" annotations, not the names. The comparison does not verify the other
edition as a whole.

The source-series crosswalk records explicit app series and issue ranges for cases where the
database splits or renames a series. Each entry names and links the database series and refers to
one or more original-comic fixtures. A mapped check requires one entry to cover the whole claimed
range, the named series to match, and every referenced original-comic fixture to identify the
entry's exact database series URL, issue and linked issue page. Original issue numbers must match
the app's numbers; an evidenced unnumbered annual may map to app issue 1. Overlapping entries,
incomplete coverage of a mapped app series, missing fixtures and mismatches fail closed. Unlisted
app series retain the existing series-year check on indexer notes. The expected entry count in the
licensed input also prevents an entry from being silently removed. The edition fixture's own series
is the collection, not the source comic.
The crosswalk establishes series identity only: it does not prove a book's contents or settle an
ambiguous annual.

An edition's status is `verified` only when every comic it claims is verified and nothing conflicts,
`partly-verified` when only some are verified and nothing conflicts, `verified-with-conflicts` when
some comics are verified but a conflict is recorded, `consistent` when
nothing is verified and nothing conflicts, and `conflict` otherwise.

Coverage in `editions.json` counts only the curated facts: grouped rows, the rows some edition claims
(split by who claimed them), and partial rows. Full coverage, with the rows verified by a book with
no conflict and the rows confirmed only by a book that carries one, is in `gcd-editions.json`
because it rests on database facts. Findings name the hard cases: a group that
spans several books, a book that holds more than the list takes, two books that overlap, and a heading
that is a reading block rather than a book. Only `gcd-editions.json` can name a later printing, because
that link comes from the database. A book with no curated contents raises no finding about how it
pairs with another, since nothing is known to compare.

## Running it

The same build projects curated MIT names into `src/data/collectedEditionCatalog.js` and GCD-derived
relations into `src/data/collectedEditionEvidence.js` under CC BY-SA 4.0. Only full, verified,
conflict-free relations are displayed. The latter retains credit, sources, checked dates and a
modification notice; both Preview and saved lists show a shared credit and licence link.
The grouped pilot retains its heading-based selection. For a heading-free list, the licensed
`listSelections` entry names its exact catalog list and selected books; the projection intersects
that list's issue identities with each book's verified comics. Unknown or repeated selections are
errors. Neither the reading order nor its headings are changed.
Links to a book's page on Hoopla or in Libby come from `destinations.json`. Each provider records its
basis, the owner's approval on Issue #1203, with the comment that holds it, and says that the provider
itself gave no permission. Each address must be confirmed by the owner, carry the date it was
checked, and match its provider's one accepted form: `https://www.hoopladigital.com/title/<id>` (or
`/comic/<slug>/<id>`) and `https://share.libbyapp.com/title/<id>`. The build refuses anything the
app's own gate in `src/js/lib/editionDestinations.js` would drop, and bundles the address alone: no
description, cover, availability or live lookup. A link says where to look for a book, never that it
can be borrowed.

```
npm run editions:pilot             # check that the generated files are current and valid
npm run editions:pilot -- --write  # regenerate them from the curated inputs, the lists and the fixtures
npm run editions:pilot -- --live <id>
```

The build reads only the repository and the fixtures, so it is deterministic and never touches the
network. `--live` reads one record from the database's public API and writes it into
`gcd-fixtures/` with cover data dropped. It
allows at most 25 calls in any rolling hour, honours `Retry-After`, keeps its ledger in the system
temporary folder, and is never run by the tests.

## Limits

- Digital editions are a gap. The database indexes print books, so a digital edition can be
  recorded but not checked here.
- Comic Book Herald's affiliate and store links are never recorded. The validator rejects store
  hosts, affiliate parameters and any `cover` field.
- The database's bulk download needs a signed-in account, and its API allows more calls to an
  account. This pilot needed neither.
