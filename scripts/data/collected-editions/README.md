# Collected-edition pilot data

This folder is a pilot of a provider-neutral record of collected editions: which printed or
digital book holds which comics. It covers five Comic Book Herald reading lists and nothing else.
The app does not load or package anything here. Nothing in it says where a reader can buy, borrow
or read a book, and nothing in it may be used to claim that.

## Files

| File | What it holds | Licence |
|---|---|---|
| `pilot.json` | The curated input: the five lists, the collection groups chosen from them, each edition's curated contents with who asserted them, and the tier each edition is checked at | MIT, with the repository |
| `gcd-check-inputs.json` | Curated input taken from the database: story titles, series names, sequences set aside with reasons, contents stated in indexer notes, and printing links | CC BY-SA 4.0 |
| `cbh-edition-facts.json` | Generated. The collection groups already recorded in each list, with the comics in each group | MIT, with the repository |
| `editions.json` | Generated. The provider-neutral edition records and coverage for each list | MIT, with the repository |
| `gcd-editions.json` | Generated. Facts from the Grand Comics Database and the result of checking each edition against them | CC BY-SA 4.0 |
| `gcd-fixtures/<id>.json` | One minimised database record per edition, as read on the date it carries | CC BY-SA 4.0 |

`gcd-check-inputs.json`, `gcd-editions.json` and every file in `gcd-fixtures/` contain data from the
[Grand Comics Database](https://www.comics.org/), used under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). They are minimised and reorganised
for this project, and cover images are never recorded. Anything derived from them stays under that
licence and keeps this credit. The three MIT files hold no database facts: an edition in
`editions.json` names its database record by id only, and the check fails if a database-only field,
a contents range asserted by the indexer notes, a series named in the database's own form, or wording
that says one book is a printing or edition of another appears in any of them.

## Model

An edition has an id, a title, a format, a `medium` of `print` or `digital`, identifiers, and
`contents`. Each contents entry names a series and an issue range, and says who asserted it:

- `cbh-heading`: a collection heading in the Comic Book Herald guide names the book.
- `cbh-ledger`: the list's source ledger records the book.
- `gcd-notes`: the database's indexer notes say what the book collects.
- `owner-curated`: chosen for this pilot and recorded here.

An entry marked `portion: "partial"` holds only part of an issue. `printingOf` links a later printing
to the edition it reprints; it comes from the database, so it lives in `gcd-check-inputs.json` and
appears only in `gcd-editions.json`. Contents asserted by `gcd-notes` live there too.

Each edition is checked against its database record at one of four tiers. Only `gcd-notes` and
`gcd-story-titles` can verify a comic, and the notes must state the series and the exact issue span,
so `#1-5` never matches `#1-50`. `gcd-count-only` can show a book is consistent, never which comics
it holds, and `gcd-unindexed` records that the database has not indexed the contents. Every
database sequence left out of a count is listed in `check.excludedSequences` with its reason; a
count that differs is consistent only when recorded exclusions explain the whole difference. A
disagreement is recorded as a conflict with its evidence and left for a person to settle.

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

```
npm run editions:pilot             # check that the generated files are current and valid
npm run editions:pilot -- --write  # regenerate them from the two inputs, the lists and the fixtures
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
