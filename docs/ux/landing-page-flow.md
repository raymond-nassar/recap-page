# Flow Specification: Home

## Entry Point
App launch, or selecting the brand lockup in the sidebar.

## State A: Empty Library
1. The page asks **"How do you want to read?"**
2. Three large path tiles appear when their shelves contain published Reading Lists:
   - **Modern Timeline** with the compact label **Browse by year**
   - **Storylines** with the compact label **Browse complete arcs**
   - **Character spotlights** with the compact label **Browse heroes and teams**
3. Each tile shows its Reading List count and opens the matching browse screen.
4. Additional populated categories appear under **More ways to read**. The whole group remains
   hidden while no additional category has content.
5. Marvel attribution remains at the end of the surface.

## State B: Library Has Lists
1. **Continue reading** names the active Reading List, progress, next issue and direct actions.
2. **Your Reading Lists** shows every saved list as a compact progress tile.
3. **Ways to read** offers the same content-backed category gateway as State A.
4. Marvel attribution remains at the end of the surface.

## Transitions
- Primary or additional category tile opens its own browse subpage and creates a browser history entry.
- A category with no matching published content is not rendered.
- Adding a Reading List happens on its browse screen or in its preview dialog, not on Home.
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

## Accessibility Requirements
- [ ] Each category group is a list and each tile is one native button
- [ ] The accessible name begins with the visible category heading and compact label
- [ ] Every tile is at least 44px high and has a visible keyboard focus indicator
- [ ] Category meaning does not depend on colour or icon alone
- [ ] Empty and load-failure states remain named in text
- [ ] The primary grid becomes one column at narrow widths without horizontal clipping
- [ ] The layout survives 200% text zoom without clipping
- [ ] Forced colours preserve tile boundaries and focus
