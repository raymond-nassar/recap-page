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
| ages | Marvel Ages category |
| arrow-right | Category destination arrows |
| thumb-up | Enjoyed, when rating a completed Reading List |
| thumb-down | Did not enjoy, when rating a completed Reading List |
| star | Your ratings, Rate this issue, and the rating dialog's five stars |

This is 21 symbols. Static markup draws them 27 times in navigation, Library, Add comics and search
controls, and draws the star six more times: beside Rate this issue and on the rating dialog's five
buttons. The completed-list rating adds the two thumbs. Each of the six categories has an icon and a
destination arrow in both the Home and Browse gateways, adding 24 SVG instances. The six category
icons all differ: Modern Timeline reuses `guide`, Character spotlights reuses `person`, Reading paths
reuses `books`, and Marvel Ages has its own `ages`, an hourglass drawn for it.
The same category renderer supplies publishing-age and period tiles when those screens open;
each adds a `guide` and `arrow-right` pair. These are not a fixed runtime node count.

The brand's `icon.svg` and the
ordinary issue-action glyphs are separate and unchanged. The static server serves the sprite
locally, and the existing Windows archive includes tracked files under `src`, including this
sprite. The separate Pages landing site does not serve the application.
