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

- The Fluent `GlobalNavButton` toggle stays visible in both states.
- Expanded mode shows icons, labels and the active list's compact progress.
- Collapsed mode is a 48px icon rail. Labels remain in the accessibility tree.
- Hover and keyboard focus reveal the label in a tooltip.
- The choice persists in `localStorage` under `sidebar.collapsed`.
- The rail auto-collapses below 1000px, with `Ctrl+\` as the keyboard shortcut.
- The 150ms transition respects `prefers-reduced-motion`.

## Accessibility Requirements

- The toggle carries `aria-expanded`, `aria-controls="sidebar-nav"` and an accessible name.
- The active rail item carries `aria-current="page"`.
- Every icon-only target keeps a text accessible name and a 44 by 44 pixel minimum target.
- Collapse announcements use the polite live region.
- Tooltips work from keyboard focus as well as pointer hover.
- Group dividers remain decorative CSS borders.
- The selected accent bar is paired with a surface and weight change.
