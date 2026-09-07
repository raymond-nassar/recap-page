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

- Desktop keeps two rails: expanded at 252px and compact at 48px.
- The compact desktop rail keeps labels in the accessibility tree and uses tooltips for visible names.
- `sidebar.collapsed` stores desktop intent only. It changes only on deliberate desktop toggle.
- Crossing below 1000px auto-compacts desktop presentation; crossing back restores the saved choice.
- At or below 880px, the rail becomes an in-flow compact header with a visible Navigation label.
- Narrow mode starts closed regardless of saved desktop choice.
- Narrow open and closed state is ephemeral and is never written to storage.
- In narrow mode, the controlled panel holds nav plus API and queue status explanations.
- `Ctrl+\` toggles desktop expand and compact or narrow show and hide with the same exact shortcut.
- Escape closes only from inside the narrow sidebar when open; it is not a global escape rule.
- Routed view changes close narrow navigation before layout work; passive rerenders do not.

## Accessibility Requirements

- The toggle carries `aria-expanded`, `aria-controls="sidebar-panel"` and an accessible name.
- The active rail item carries `aria-current="page"`.
- Every icon-only target keeps a text accessible name and a 44 by 44 pixel minimum target.
- Collapse announcements use the polite live region.
- Tooltips work from keyboard focus as well as pointer hover.
- Group dividers remain decorative CSS borders.
- The selected accent bar is paired with a surface and weight change.
