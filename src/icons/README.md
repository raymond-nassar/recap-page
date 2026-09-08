# Interface icon provenance

`ui.svg` contains original generic line drawings authored for Recap Page, licensed under
the repository's MIT [license](../../LICENSE). They are not copied or traced from Segoe
font outlines, Fluent System Icons, comic artwork or another icon collection. No third-party
font or icon license is involved.

The symbols use a 24-unit square and inherit the host SVG's `currentColor` stroke. Each
decorative host is hidden from assistive technology and cannot receive focus; its existing
button supplies the name and action.

| Symbol | Controls |
|---|---|
| menu | Navigation toggle |
| books | Library, Find a series, Series |
| search | Browse, Search issues, all three search submit buttons |
| add | Add comics |
| settings | Backup & settings |
| info | About this app |
| check | Everything read |
| progress | Progress by series |
| edit | Added by hand |
| person | Browse a creator, Creators |
| paste | Paste a Reading List in Add comics and Search issues |
| issue-add | Add an issue by hand in Add comics and Search issues |
| characters | Characters |
| guide | Reading guides |
| storylines | Storylines category |
| screen | MCU Prep category |
| arrow-right | Category destination arrows |

This is 17 symbols used by 23 static navigation/search controls plus the generated Home/Browse
category controls. Each of the six categories has a leading icon and destination arrow in both
gateways, adding 24 SVG instances (47 before opening publishing-category screens). Modern Timeline and Marvel Ages reuse `guide`,
Character spotlights reuses `person`, and Reading paths reuses `books`.
The same category renderer supplies publishing-age and period tiles when those screens open;
each adds a `guide` and `arrow-right` pair. These are not a fixed runtime node count.

The brand's `icon.svg` and the
ordinary issue-action glyphs are separate and unchanged. The static server serves the sprite
locally, and the existing Windows archive includes tracked files under `src`, including this
sprite. The separate Pages landing site does not serve the application.
