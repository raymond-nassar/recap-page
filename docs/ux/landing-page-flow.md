# Flow Specification: Home

## Entry Point
App launch, or selecting the brand lockup in the sidebar.

## State A: Empty Library
1. The page asks **"Where do you want to start?"**
2. One line distinguishes **Browse curated Reading Lists** from **Add individual issues or your own
   list**.
3. **Browse Reading Lists** opens the Browse hub, and **Add comics** opens the Add hub without
   requiring the narrow Navigation menu or waiting for catalog load. The category tiles remain
   available below.
4. Setup recommendation cards stay on the dedicated browsing pages rather than Home.
5. Three large path tiles appear when their shelves contain published Reading Lists:
   - **Modern Timeline** with the compact label **Browse by year**
   - **Storylines** with the compact label **Browse complete arcs**
   - **Character spotlights** with the compact label **Browse heroes and teams**
6. Each tile shows its Reading List count and opens the matching browse screen.
7. Additional populated categories appear under **Discover More**. The whole group remains
   hidden while no additional category has content:
   - **MCU Prep** opens preparation lists for Marvel Cinematic Universe titles.
   - **Marvel Ages** opens one chronological gateway for populated publishing periods.
8. Marvel attribution remains at the end of the surface.

## State B: Library Has Lists
1. **Continue reading** names the active Reading List, progress, next issue and direct actions.
   An empty saved list retains **Open the list** but does not offer **Review earlier issues**.
2. **Your Reading Lists** shows every saved list as a compact progress tile.
3. **Explore** offers the same content-backed category gateway as State A.
4. Marvel attribution remains at the end of the surface.

## Optional Home Highlights

Both Home states keep a quiet **What's new** entry beside the heading. Its native disclosure is
closed on arrival, creates no route or history entry, and never interrupts reading. The compact
panel describes improvements included in the running copy and exact newly added Reading Lists,
not available app upgrades. Each section initially shows up to three rows; **More** exposes every
remaining row within the bounded scrolling panel. A maintenance-only copy may explicitly have no
new highlights.

**New** clears on opening and is remembered on this device until a newer highlight batch arrives.
Viewing is a preference outside reading backups; erasing or restoring reading data keeps it.
Clearing actual app storage resets it. If remembering fails, the panel says New may return next
visit while reading data stays unchanged. Version-release preparation supplies the content from
the existing reader summary and catalog delta; no second handwritten announcement list is required.

The summary, Close, Escape, outside pointer and leaving Home close the panel. Explicit Close or
Escape restores summary focus; outside pointers and navigation do not. New-list actions reuse
Preview without importing or changing progress, and Preview returns to the Home summary rather
than a hidden panel child. Catalog failures name the affected entries and offer Retry.
On Android the entry occupies its own phone-header row with 48px controls. Native Back consumes
an open dialog first, then visible narrow navigation, then Home news. Browser-style checks do not
replace installed-device touch, system-text, Back or private-profile acceptance.

## Transitions
- The first-run Browse and Add actions use their existing hubs, create browser history entries,
  and move focus to the destination heading. Back returns to Home.
- Primary or additional category tile opens its own browse subpage and creates a browser history entry.
- Marvel Ages first shows populated earlier ages, then populated Modern periods. Its **Browse all
  Modern Age Reading Lists** action keeps Modern available as an aggregate.
- Existing age and Modern-period addresses remain directly usable. Back and Forward include the
  Marvel Ages gateway when the reader entered through it.
- A category with no matching published content is not rendered.
- A directly opened empty Marvel Ages gateway names the empty state rather than inventing categories.
- Modern Timeline uses 1998 as this app's chosen boundary, not as an official Marvel editorial-era
  claim. Marvel Knights to Planet X opens the sequence in 1998, then Avengers Disassembled resumes it
  in 2004. Its 148 Reading Lists appear as 144 grouped normal story cards.
- Setup to Modern Timeline is featured above the normal Modern Timeline cards through the same
  Preview flow. It is not duplicated as a card and is not included in the timeline count.
- Modern Timeline marks the first story card that is not complete after the completed opening run.
  The position is rebuilt from imported Reading Lists and their issue read markers, not stored as a
  separate cursor. A grouped story follows the shallowest imported option the card already presents,
  or its shallowest option when none has been imported.
- Search and category filters change what is visible, not the reader's position. A visible current
  story keeps the marker even when only another option through that story matches. If the whole story
  is hidden, one message names it instead of marking a different card.
- Completing every timeline story puts the position after the final card. If a catalog entry cannot
  be shown, the position is reported as unavailable because the missing entry's place is unknown.
- Events outside that guided sequence remain available through Marvel Ages and existing direct
  addresses.
- Preview's existing Add control can complete the first add on the chosen browse page. Failures
  target that page, while the existing success announcement remains unchanged. A separate follow-on owns
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
7. **A recommendation is optional.** Setup to Modern Timeline prepares a reader for the guided
   sequence, but it is not the only valid beginner start.

## Accessibility Requirements
- [ ] Each category group is a list and each tile is one native button
- [ ] First-run Browse and Add are named native controls, at least 44px high, with visible focus
- [ ] The accessible name begins with the visible category heading and compact label
- [ ] Every tile is at least 44px high and has a visible keyboard focus indicator
- [ ] Category meaning does not depend on colour or icon alone
- [ ] Empty and load-failure states remain named in text
- [ ] The first-run question is an `h2`, followed by Browse and Add actions
- [ ] Closing Setup Preview returns focus to its action on the originating browse page
- [ ] Home and Preview contain no breadcrumb trail
- [ ] Exactly one current story carries visible **You are here** text before its heading and
      `aria-current="step"` on its card
- [ ] Hidden, complete and unavailable position states are named in text without adding a focus stop
- [ ] Progress updates preserve the focused control, scroll position and existing catalog cards
- [ ] The primary grid becomes one column at narrow widths without horizontal clipping
- [ ] The layout survives 200% text zoom without clipping
- [ ] Forced colours preserve tile and current-position boundaries and focus
