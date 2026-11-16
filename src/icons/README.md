# Interface icon provenance

`ui.svg` contains original generic line drawings authored for Recap Page, licensed under
the repository's MIT [license](../../LICENSE). They are not copied or traced from Segoe
font outlines, Fluent System Icons, comic artwork or another icon collection. No third-party
font or icon license is involved.

The symbols use a 24-unit square and inherit the host SVG's `currentColor` stroke. Each
decorative host is hidden from assistive technology and cannot receive focus; its existing
button supplies the name and action.

## One glyph, one meaning

Each symbol names one thing wherever it is drawn, so a glyph learned in one place can be trusted in
another (#831). The side menu, the phone bar, Search and the category cards draw the same glyph for
the same destination, and the magnifier marks searching alone. `test/portable-icons.test.js` reads
every glyph and destination from the markup and the category definitions and compares them with
this table, so reusing a glyph for something else fails it.

| Symbol | Meaning | Where |
|---|---|---|
| menu | More | The navigation toggle |
| books | Library | `#/library` in the side menu and on the phone bar |
| search | Searching | Search, `#/add`, in the side menu and on the phone bar; the three search submit buttons |
| series | A series | The Series tile on Search, which presses the Series scope |
| creator | A creator | The Creators tile on Search, which presses the Creators scope |
| settings | Backup & settings | `#/data` |
| info | About | About this app, `#/about`, and About these results |
| check | Everything read | `#/library-read` |
| progress | Progress by series | `#/progress` |
| edit | Added by hand | `#/library-manual` |
| paste | Archived symbol | Retained for older artifacts; Search now links Paste a Reading List as text |
| issue-add | Archived symbol | Retained for older artifacts; Search now links Add a comic by hand as text |
| characters | Characters | Characters and the Character spotlights card, both `#/spotlights` |
| timeline | Modern Timeline | Reading guides and the Modern Timeline card, both `#/catalog` |
| storylines | Archived symbol | Retained for older artifacts; the Storylines screen has been replaced by Genres |
| screen | MCU Prep | The MCU Prep card, `#/marvel-on-screen` |
| ages | Marvel Ages | The Marvel Ages card, `#/marvel-ages`, and the card of every age and period inside it |
| reader | Young readers | The Young readers card, `#/young-readers` |
| story-types | Genres | The Genres card, `#/genres` |
| universes | Universes | The Universes card and Search shortcut, both `#/universes` |
| arrow-left | Back | The integrated history control before a view heading |
| arrow-right | Opens a category | The destination arrow on every category card |
| thumb-up | Enjoyed | Rating a completed Reading List |
| thumb-down | Did not enjoy | Rating a completed Reading List |
| star | Rating | Your ratings, `#/library-rated`, Rate this comic, and the rating dialog's five stars |

Static markup draws symbols in navigation, Library, Search and its search controls, and draws
the star beside Rate this comic and on the rating dialog's five buttons. The completed-list rating
adds the two thumbs. Each Home category card has an icon and a destination arrow. The category
icons all differ, and each names only its own destination. The hourglass was drawn for Marvel Ages in #873, `series`,
`creator` and `timeline` for #831, the reader behind an open book for Young readers in #897, and
the tag for Genres in #1060. The overlapping worlds mark Universes. The left arrow marks Back only when the current history entry has an
earlier in-app entry.
The same category renderer supplies the age and period cards inside Marvel Ages when those screens
open; each adds an `ages` and `arrow-right` pair. These are not a fixed runtime node count.

The brand's `icon.svg` and the
ordinary issue-action glyphs are separate and unchanged. The static server serves the sprite
locally, and the existing Windows archive includes tracked files under `src`, including this
sprite. The separate Pages landing site does not serve the application.
