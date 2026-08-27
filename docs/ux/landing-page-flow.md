# Flow Specification: Home

## Entry Point
App launch, or selecting the brand lockup in the sidebar.

## State A: Empty Library
1. The page asks **"Where do you want to start?"**
2. One line distinguishes **Browse curated Reading Lists** from **Add individual issues or your own
   list**.
3. When its bundled Reading List resolves, a compact callout offers **Setup to Modern Timeline** as
   the recommended preparation path. Its action opens Preview without adding or changing progress.
4. Three large path tiles appear when their shelves contain published Reading Lists:
   - **Modern Timeline** with the compact label **Browse by year**
   - **Storylines** with the compact label **Browse complete arcs**
   - **Character spotlights** with the compact label **Browse heroes and teams**
5. Each tile shows its Reading List count and opens the matching browse screen.
6. Additional populated categories appear under **Discover More**. The whole group remains
   hidden while no additional category has content:
   - **MCU Prep** opens preparation lists for Marvel Cinematic Universe titles.
   - **Marvel Ages** opens one chronological gateway for populated publishing periods.
7. Marvel attribution remains at the end of the surface.

## State B: Library Has Lists
1. **Continue reading** names the active Reading List, progress, next issue and direct actions.
2. **Your Reading Lists** shows every saved list as a compact progress tile.
3. **Explore** offers the same content-backed category gateway as State A.
4. Marvel attribution remains at the end of the surface.

## Transitions
- Primary or additional category tile opens its own browse subpage and creates a browser history entry.
- Marvel Ages first shows populated earlier ages, then populated Modern periods. Its **Browse all
  Modern Age Reading Lists** action keeps Modern available as an aggregate.
- Existing age and Modern-period addresses remain directly usable. Back and Forward include the
  Marvel Ages gateway when the reader entered through it.
- A category with no matching published content is not rendered.
- A directly opened empty Marvel Ages gateway names the empty state rather than inventing categories.
- The recommended-start action opens Preview from Home without changing the URL or local state.
- Modern Timeline uses 1998 as this app's chosen boundary, not as an official Marvel editorial-era
  claim. Its 76 Reading Lists dated 1998 or later appear as 72 grouped normal story cards.
- Setup to Modern Timeline is featured above the normal Modern Timeline cards through the same
  Preview flow. It is not duplicated as a card and is not included in the timeline count.
- Pre-1998 events remain available through Marvel Ages and existing direct addresses.
- Preview's existing Add control can complete the first add from Home. Failures target the Home
  gateway, while the existing success announcement remains unchanged. A separate follow-on owns
  any expanded first-save explanation.
- Home has no breadcrumb because it has no route ancestors. Routed destinations reached from Home
  show their stable hierarchy, while Preview remains a dialog with no breadcrumb.
- Returning with Back restores Home rather than creating a second navigation model.

## Design Principles
1. **Choose a direction before an item.** Home answers how to browse; dedicated screens answer what
   to read.
2. **Headings carry the interface.** Compact labels and counts replace standing explanations.
3. **Content earns a tile.** Empty categories are hidden rather than shown as future promises.
4. **Categories may overlap.** Canonical shelves place each story once; Home categories can select
   across those shelves without changing where a story is filed.
5. **State-aware.** Returning readers keep continuation and saved progress ahead of discovery.
6. **Offline-first.** Availability is derived from the bundled catalogue.
7. **A recommendation is optional.** Setup to Modern Timeline prepares a reader for the 1998-plus
   path, but it is not the only valid beginner start.

## Accessibility Requirements
- [ ] Each category group is a list and each tile is one native button
- [ ] The accessible name begins with the visible category heading and compact label
- [ ] Every tile is at least 44px high and has a visible keyboard focus indicator
- [ ] Category meaning does not depend on colour or icon alone
- [ ] Empty and load-failure states remain named in text
- [ ] The first-run question and recommendation use ordered `h2` and `h3` headings
- [ ] Closing recommended Preview returns focus to its Home button
- [ ] Home and Preview contain no breadcrumb trail
- [ ] The primary grid becomes one column at narrow widths without horizontal clipping
- [ ] The layout survives 200% text zoom without clipping
- [ ] Forced colours preserve tile boundaries and focus
