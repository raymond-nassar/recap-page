# Data sources and credits

Recap Page is an unofficial fan project. It is not affiliated with or endorsed by Marvel
Entertainment. Comics are not included: the app tracks reading lists and your progress, and Marvel
decides who can read on its services.

This page is a short summary. The
[full data provenance record](https://github.com/raymond-nassar/recap-page/blob/main/docs/DATA_PROVENANCE.md)
lists each source, what was taken from it, and what permission it gave. Neither this page nor the
record is legal advice.

## Comic details

Titles, issue numbers, publication dates and creator credits come from the community-run Marvel
Metadata API. It describes itself as an unofficial fan project that provides metadata and links
only. The details came down a chain of three sources:

- **Marvel's own API**, where the records began. It has since been shut down.
- **[marvel.geoffrich.net](https://marvel.geoffrich.net)**, a site holding cached Marvel API data.
- **[emreparker/marvel-comics](https://github.com/emreparker/marvel-comics)**, which built that
  cache into a searchable service. The details bundled with the app were fetched from it, and the
  app asks it for missing details while you use it.

The bundled snapshot ends in 2025, so newer comics start without details or a cover. You can add
them by hand. You can also point the app at your own self-hosted metadata mirror in settings.

## Covers

Covers load straight from Marvel's image servers when the app shows them. Recap Page saves cover
links only, never the images, though your browser may keep copies of covers it shows. You can turn
covers off.

## Reading lists

Some reading lists follow a published reading guide. Each of those names the guide on its card and
links to the exact page it follows. The others are assembled from Marvel series metadata, selected
by the project owner, or compiled by hand for this project. A list keeps comic identities and their
order only. No guide's commentary, branding, images or layout is copied.

**[Comic Book Herald](https://www.comicbookherald.com/).** Its founder and editor-in-chief answered
on 2026-08-20 that he has no problem with the project continuing to credit and link the site for its
reading order work. That covers crediting and linking. It grants nothing over Marvel's material or
over the site's own editorial work.

**[Comic Book Reading Orders](https://comicbookreadingorders.com/).** It answered on 2026-08-20 that
reading orders may be built from the site, credited and linked, with two exceptions: the Marvel
Master Reading Order, and any reading orders that are Patreon exclusives. Every list built from it
credits the site on its card and links to the exact order page it follows. The site holds nothing
over Marvel's material, so its permission covers its own selection and arrangement only.

Two checklists were copied from the emreparker/marvel-comics project. No license text came with
them, so the record treats them as carrying no granted license.

## The optional Marvel Fandom lookup

When you add a comic by hand, you can ask the
[Marvel Fandom wiki](https://marvel.fandom.com/) for its details. The app sends the title only when
you press the lookup button. It reads facts only: a release date, a page count and creator credits.
No wiki prose or images are taken, and nothing from the wiki is written into the project's own
files. The wiki's text is shared under CC BY-SA 3.0.

## What the project license covers

The project's MIT license covers its own work: the app's code, its scripts, tests, styles and
documents. It grants nothing over comic details from other sources. Marvel's comics, characters and
trademarks belong to their owners.
