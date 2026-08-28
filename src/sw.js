// The offline worker: what makes an installed window open when the server is not running.
//
// Installing the app gives it an icon in the Start menu or the Dock, and an icon is a promise
// that clicking it opens something. Without this file that promise is false whenever the local
// server is stopped, which for anyone who did not start it from a terminal is most of the time.
// The browser answers the click with "this site cannot be reached", which reads as a broken app
// rather than as a program that is not running.
//
// Network first, cache second, and never the other way round. While the server is running every
// response comes from it, so a rebuilt file is seen immediately and the no-cache and ETag
// behaviour in server.mjs keeps working exactly as written. The cache is consulted only when the
// fetch fails, which is the case this file exists for. Nothing here can serve a stale page to
// somebody whose server is running, because the network is asked first every time and its answer
// is what gets returned.
//
// Same-origin GET and nothing else, which is Repository Constraint 1 expressed as one line of
// code rather than as a rule to remember: cover images come from Marvel's CDN and issue metadata
// comes from the third-party service, both on other origins, so neither can enter this cache
// even by accident. A worker that cached whatever it was handed would store comic image bytes on
// the first render, and that is the one thing this project has always refused to do.
//
// Registered by src/js/lib/offline.js. Deliberately a classic worker rather than a module one,
// because Firefox does not support module workers, so this file imports nothing and everything
// it touches is reached through `self`, which also lets a test hand it an entire world.

// Prefixed, and only prefixed names are cleaned up on activation. The app's own metadata cache
// is an IndexedDB structure and nothing else here uses the Cache API today, but deleting every cache
// on the origin would be a worker reaching outside its own business.
const CACHE_PREFIX = 'mrt-offline-';
const CACHE = `${CACHE_PREFIX}v1`;

self.addEventListener('install', () => {
  // Nothing is fetched here on purpose. A precache is a list of files somebody has to keep
  // complete, and the same defect class is what scripts/check-anchors.mjs refuses to enumerate
  // for: a module added later and left off the list breaks the offline launch silently.
  //
  // The shell is warmed instead by the page, in src/js/lib/offline.js, which asks the browser
  // what it actually loaded and re-fetches that through this worker. The list is derived rather
  // than maintained, so it cannot fall behind the app it describes. Doing it here would not work
  // in any case: an install handler cannot know which files the page needs.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await self.caches.keys();
    for (const name of names) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await self.caches.delete(name);
    }
    // Claimed so the worker starts answering for the page that registered it, rather than from
    // the next launch. Safe here in a way it would not be under a cache-first strategy: a
    // half-updated page cannot be served a mixture of generations when every request that can
    // reach the network is answered by the network.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // A URL that will not parse is not one this worker has anything to say about, and throwing
  // here would fail a request the browser could have made perfectly well on its own.
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkThenCache(event));
});

async function networkThenCache(event) {
  const request = event.request;
  try {
    const response = await self.fetch(request);
    // Cloned now and stored on the side, rather than awaited. Awaiting put the disk write in
    // front of every navigation, stylesheet and module response while the server was healthy,
    // which is latency paid on the common path to help the rare one. waitUntil keeps the worker
    // alive until the write finishes without holding the reader's response behind it, and the
    // clone has to be taken before returning because the browser consumes the body it is given.
    event.waitUntil(remember(request, response.clone()));
    return response;
  } catch (networkError) {
    // Scoped to this worker's own cache. caches.match() searches every cache on the origin, and
    // activation deliberately leaves caches it did not create alone, so the unscoped form could
    // answer a reader with an entry written by something else served from 127.0.0.1:8787.
    const cached = await self.caches.open(CACHE)
      .then((cache) => cache.match(request))
      .catch(() => null);
    if (cached) return cached;
    // Nothing to answer with. Rethrowing gives the browser its own offline page, which is what
    // it would have shown had this worker not been here at all. Answering with a page of our own
    // would mean writing a second interface that only the unluckiest reader ever sees.
    throw networkError;
  }
}

// Storing is best effort, and the catch is the point of the function rather than decoration.
// caches.put rejects when the origin is out of quota, and an uncaught rejection here would turn
// a page that had just been fetched successfully into a failed load: the reader would lose the
// app because the copy kept in case they lose the app could not be written.
async function remember(request, response) {
  // 200 exactly, not response.ok. A 206 is a partial body that the Cache API refuses outright,
  // and a 204 or a 205 has nothing in it worth keeping. Our server sends none of the three
  // today, which is a reason to write the guard rather than a reason to leave it out.
  if (response.status !== 200) return;
  try {
    const cache = await self.caches.open(CACHE);
    await cache.put(request, response);
  } catch {
    // Deliberately silent. There is no reader-visible consequence at the moment it happens, and
    // the next successful load tries again.
  }
}
