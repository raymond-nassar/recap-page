# Flow Specification: Hub-based Sidebar

## Goal

Keep the navigation pane short as Reading Lists, browse categories and ways to add grow. The rail
names stable destinations. Each hub owns the choices within it.

## Destinations

| Group | Rail item | Behavior |
|---|---|---|
| Brand | Home | Opens the category gateway and returning-reader surfaces |
| Reading | Continue reading | Appears only when an active Reading List exists |
| Reading | Library | Opens saved lists and library-wide views |
| Discover | Browse | Opens every available reading category |
| Discover | Add comics | Opens the five ways to add comics |
| App | Backup & settings | Stays pinned at the bottom |
| App | About this app | Stays pinned at the bottom |

Saved Reading Lists never become additional rail rows. Continue reading shows only the active list's
name and progress. Future browse categories and ways to add comics belong on their hubs rather than
in the rail.

## Parent Selection

- Home selects the brand with `aria-current="page"` and the same visible selected treatment
  as other destination links. Other routes clear it.
- Timeline, Storylines, Character spotlights and future category pages select Browse.
- Search issues, Find a series, Browse a creator, Paste a Reading List and Add by hand select Add
  comics.
- Everything read, Progress by series and Added by hand select Library.
- The active reading page selects Continue reading.

Direct child addresses remain valid. Selecting a hub changes the address to that hub, and Back
returns through the actual pages visited.

## Breadcrumbs

- Every routed page except Home has one breadcrumb trail above its heading. Home has none.
- Ancestors are real hash links. The current page is plain text and is never linked to itself.
- Library children stay under Library, browse categories stay under Browse, publishing periods stay
  under Marvel Ages, and the five ways to add stay under Add comics.
- A saved Reading List uses its validated name. An issue in a saved list stays under that list. An
  issue from a bundled Reading List stays under its canonical Browse shelf.
- Stale or unscoped issue context falls back to Home and the resolved issue title rather than
  inventing an origin.
- Preview and Ask are dialogs rather than routed pages, so neither has breadcrumbs.

## Collapse Behavior

- Desktop keeps two rails: expanded at 252px and compact at 48px.
- The compact desktop rail keeps labels in the accessibility tree and uses tooltips for visible names.
- `sidebar.collapsed` stores desktop intent only. It changes only on deliberate desktop toggle.
- Crossing below 1000px auto-compacts desktop presentation; crossing back restores the saved choice.
- At or below 880px, Home, Library, Browse and Add comics are stable icon/text bottom links.
  More opens the existing utility panel, including Continue reading, settings, About and status.
- Narrow mode starts closed regardless of saved desktop choice.
- Narrow open and closed state is ephemeral and is never written to storage.
- In narrow mode, the controlled panel holds nav plus API and queue status explanations.
- `Ctrl+\` toggles desktop expand and compact or narrow More with the same exact shortcut.
- Escape closes only from inside the narrow sidebar when open; it is not a global escape rule.
- Routed view changes close narrow navigation before layout work; passive rerenders do not.
- Downward scrolling hides the bottom bar after 16 accumulated pixels; upward scrolling reveals
  it after 16 pixels. The top 32 pixels, route changes and viewport changes reset visibility.
- Keyboard focus entering the bar reveals it and pins it while focus remains there. Navigation
  can always be reached without scrolling. Editing a field or a reduced visual viewport
  withdraws the bar until navigation itself receives focus, so it does not sit over the keyboard.
- The utility panel stays in document flow and scrolls internally. Content and focus clearance
  use the measured bar height plus safe-area padding, including enlarged text. Dialogs hide
  background mobile chrome. Mobile visibility is ephemeral and changes no saved reading data.
  The spacing checker classifies only the authored bottom safe-area padding on `.rail-header`
  and the measured `main` bottom clearance with its 80px initial fallback. CSS owns the inset;
  the mobile navigation controller owns the measured height. Other consumers remain unclassified.

## Native Destinations

Every in-app destination uses the existing same-origin hash address. Left click and Enter retain
the app's selection and heading-focus behavior; modifier and middle clicks retain browser defaults.
Commands, toggles, downloads and separate synchronous reader launch remain actions. Page titles
identify the current view, validated Reading List or resolved issue and the app, including truthful
loading and unavailable titles. Added by hand rows open Issue details; membership links use actual
saved list IDs in saved order, including distinct lists with identical names. Missing membership
does not invent a destination or provider metadata.

## Accessibility Requirements

- The toggle carries `aria-expanded`, `aria-controls="sidebar-panel"` and an accessible name.
- The active rail item carries `aria-current="page"`.
- Every icon-only target keeps a text accessible name and a 44 by 44 pixel minimum target.
- Collapse announcements use the polite live region.
- Tooltips work from keyboard focus as well as pointer hover.
- Group dividers remain decorative CSS borders.
- The selected accent bar is paired with a surface and weight change.
- Closing a Reading-row disclosure with Escape keeps focus on that row's More actions button.
  Its control and outline are revealed below the current sticky reading filters when they overlap,
  using their measured bounds rather than a fixed filter height. Bottom-navigation clearance remains.
