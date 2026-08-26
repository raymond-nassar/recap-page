// Runtime synopsis fetching: prose the reader can see, that this project never keeps.
//
// BL-130 removed 798 synopses from the vendored reading orders because the text is the metadata
// service's and redistributing it is not this project's to do. That left every curated issue saying
// "No synopsis is recorded for this issue", which is honest and useless.
//
// This fetches the same prose from the same service the app already talks to, on request, and holds
// it in a Map that dies with the tab. Nothing here touches mrt.state.v2, nothing here is written to
// the response cache, and nothing here survives a reload. The prose is displayed and then it is
// gone, which is what a reader looking at a synopsis wanted and what the licence position requires.
//
// The three defences are separate and none of them substitutes for another:
//   - normalizeIssue drops the field, so no persistence path can carry it (src/js/lib/model.js).
//   - the response cache is stripped before every write (withoutSynopsis in src/js/api.js).
//   - requests carry no-store, so the browser's own cache does not keep a copy either.

import { synopsisOrder, MAX_DESCRIPTION } from './lib/model.js';

// A known negative: the service answered and had no prose, or had no record of the issue at all.
// Distinct from "not asked yet" so a second run does not spend a request re-learning it, and
// distinct from an empty string so the view can tell "asked, nothing there" from "not asked".
export const NO_SYNOPSIS = Symbol('no synopsis');

export class SessionSynopsis {
  constructor() {
    this.byId = new Map();
  }

  get size() {
    return this.byId.size;
  }

  // undefined means not asked. NO_SYNOPSIS means asked and answered with nothing.
  get(issueId) {
    return this.byId.get(Number(issueId));
  }

  known(issueId) {
    return this.byId.has(Number(issueId));
  }

  text(issueId) {
    const held = this.byId.get(Number(issueId));
    return typeof held === 'string' ? held : null;
  }

  // Capped at the same 2000 characters every other admitted field is. normalizeIssue used to be the
  // only place issue prose met that bound, and this feature removed that line, so without the cap
  // here a broken or hostile upstream description would be held whole in memory and written whole
  // into the hero. It is textContent, so nothing is injected; the cost is memory and layout.
  record(issueId, prose) {
    const text = typeof prose === 'string' ? prose.trim().slice(0, MAX_DESCRIPTION) : '';
    this.byId.set(Number(issueId), text ? text : NO_SYNOPSIS);
  }

  recordMissing(issueId) {
    this.byId.set(Number(issueId), NO_SYNOPSIS);
  }

  // Saved state already knows the service holds no record of some issues: the hydrator writes
  // detailsRefused on a 404, and 63 curated items carry it. An issue the service has never heard of
  // has no synopsis either, so asking about one spends a request per session to be told the same
  // thing the tracker wrote down months ago.
  //
  // Read, never written. This is the only place the synopsis feature touches that field, and it
  // touches it in the one direction that keeps the promise: a synopsis run that met a 404 records
  // the negative here, in memory, and leaves saved state exactly as it found it.
  seedFrom(state) {
    for (const issue of Object.values(state?.issues ?? {})) {
      if (issue?.detailsRefused && !this.byId.has(Number(issue.issueId))) {
        this.byId.set(Number(issue.issueId), NO_SYNOPSIS);
      }
    }
  }

  clear() {
    this.byId.clear();
  }
}

// Sequential, cancellable, and shaped after Hydrator for the same reasons: one request at a time so
// a cancel takes effect within one lookup rather than after a burst, and an AbortController so a
// run stops without waiting out the rate limiter.
//
// What it deliberately does not share with Hydrator is every write. Hydrator persists as it goes,
// because metadata is worth keeping. This persists nothing at all, including the 404 that Hydrator
// records as detailsRefused: a feature whose whole promise is that it writes nothing must not change
// the reader's stored data as a side effect of being used.
export class SynopsisRunner {
  constructor({ api, store, session, onProgress = () => {} } = {}) {
    this.api = api;
    this.store = store;
    this.session = session ?? new SessionSynopsis();
    this.onProgress = onProgress;
    this.controller = null;
    this.running = false;
    this.done = 0;
    this.total = 0;
    this.failed = 0;
  }

  get active() {
    return this.running;
  }

  status(phase) {
    return { phase, done: this.done, total: this.total, failed: this.failed, running: this.running };
  }

  cancel() {
    this.controller?.abort();
    this.controller = null;
    this.running = false;
    this.onProgress(this.status('cancelled'));
  }

  queueFor(listId, lookahead = 8) {
    this.session.seedFrom(this.store.state);
    return synopsisOrder(this.store.state, listId, (id) => !this.session.known(id), lookahead);
  }

  async start(listId, { lookahead = 8 } = {}) {
    if (this.running) return;
    const queue = this.queueFor(listId, lookahead);
    return this.run(queue);
  }

  async startIssue(issueId) {
    if (this.running) return;
    this.session.seedFrom(this.store.state);
    const id = Number(issueId);
    const queue = Number.isInteger(id) && id > 0 && !this.session.known(id) ? [id] : [];
    return this.run(queue);
  }

  async run(queue) {
    if (!queue.length) {
      this.onProgress(this.status('idle'));
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    this.running = true;
    this.done = 0;
    this.total = queue.length;
    this.failed = 0;
    this.onProgress(this.status('running'));

    for (const issueId of queue) {
      if (signal.aborted) break;
      let got = null;
      let missing = false;
      let failed = false;
      try {
        // cache: false on both halves of the option, deliberately. A cached entry has been stripped
        // of its description by now, so reading one would answer "no synopsis" for an issue that has
        // one, and writing one would put back what the strip just removed.
        got = await this.api.issue(issueId, { signal, cache: false });
      } catch (err) {
        if (err?.name === 'AbortError') break;
        // A 404 is the service saying it has no record. Recorded in the session so the rest of this
        // run and the next one skip it, and nowhere else. A timeout or a busy service says nothing
        // about the issue, so it is left unknown and a later run will ask again.
        if (err?.status === 404) missing = true;
        else failed = true;
      }
      // Same guard as Hydrator, for the same reason: a cancelled run can still be unwinding a rate
      // limit wait when a new one starts, and its teardown would otherwise clear the new run's
      // fields, leaving that run invisible to the UI and impossible to stop.
      //
      // It is also checked before the session is written, not after. A request already in flight
      // when the reader pressed stop can still resolve normally, and recording it would put a
      // synopsis on screen that the "Stopped after n of m" count beside it does not include.
      if (signal.aborted || this.controller !== controller) return;
      if (got) this.session.record(issueId, got.description);
      else if (missing) this.session.recordMissing(issueId);
      else if (failed) this.failed += 1;
      this.done += 1;
      this.onProgress(this.status('running'));
    }

    if (this.controller !== controller) return;
    this.running = false;
    this.controller = null;
    // A run that asked for twenty and was refused twenty times has finished, but it has not fetched
    // anything, and "All synopses fetched" would be the app telling the reader something it knows is
    // untrue. A 404 is not a failure here: the service answered, and the answer was that it holds no
    // record. Only a request that got no answer at all counts.
    const ending = signal.aborted ? 'cancelled' : (this.failed ? 'partial' : 'complete');
    this.onProgress(this.status(ending));
  }
}
