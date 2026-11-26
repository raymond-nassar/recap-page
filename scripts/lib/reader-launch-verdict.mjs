import { appViewerFor } from '../../src/js/lib/marvelComicsApp.js';

export function isComicLauncherCall(entry, origin, issue) {
  const { origin: destination, pathname, searchParams } = new URL(entry.url, origin);
  const viewer = appViewerFor(issue);
  return entry.dispatching && entry.target === '_blank' && entry.features === 'noopener'
    && destination === origin && pathname === '/open.html'
    && searchParams.size === (viewer ? 3 : 2) && searchParams.get('r') === 'comics'
    && searchParams.get('a') === (viewer ? String(viewer) : null)
    && searchParams.get('t') === issue.title.slice(0, 120);
}
