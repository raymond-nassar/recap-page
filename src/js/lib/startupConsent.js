// #1412 decisions 12 to 14: the Microsoft Store app asks before it starts itself at sign-in. Windows shows
// no consent dialog of its own when a packaged desktop app turns its startup task on, so this question is
// the only consent there is. It is asked only in the app window, and only when the package's host says the
// task is Disabled: every other build answers 404, so a browser tab, the portable download and a
// development server never show it, and a task the reader or a policy turned off is never asked about.
//
// The host turns the task on only with the single-use value its latest Disabled read issued (see
// host/startupTask.mjs), so the question on screen is the only one that can be answered. Nothing here
// reports success: the card goes away when the task's own state says it is on.

import { APP_ORIGIN } from './install.js';

export const STARTUP_HOST_PREFIX = '/__recap_startup__/v1/';
export const STARTUP_HOST_HEADER = 'x-recap-startup';
// Device-local, like the app window invitation: the answer is about this Windows account's startup, so
// complete and cloud backups, which list their keys explicitly, never carry it anywhere else.
export const STARTUP_CONSENT_KEY = 'mrt.startupConsent.declined.v1';
// The launcher gives up on Windows after 15 seconds and the host after 20, so this only ends a request
// nothing will answer.
const REQUEST_MS = 25_000;
const CONSENT = /^[0-9a-f]{64}$/;
const SETTLED = new Set(['enabled', 'enabledByPolicy', 'disabledByUser', 'disabledByPolicy']);
let wired = null;

// The host's answer as { state, consent }, or null for anything that is not the host's own answer.
export async function startupRequest(operation, input, { fetchImpl = globalThis.fetch, ms = REQUEST_MS } = {}) {
  let response;
  try {
    response = await fetchImpl(`${STARTUP_HOST_PREFIX}${operation}`, {
      method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(ms),
      headers: { 'content-type': 'application/json', [STARTUP_HOST_HEADER]: '1' },
      body: JSON.stringify(input),
    });
  } catch {
    return null;
  }
  if (response.status !== 200) return null;
  let body;
  try { body = await response.json(); } catch { return null; }
  if (!body || body.ok !== true || typeof body.state !== 'string') return null;
  return { state: body.state, consent: typeof body.consent === 'string' && CONSENT.test(body.consent) ? body.consent : null };
}

export function wireStartupConsent({ scope = globalThis, storage, appOrigin = APP_ORIGIN, fetchImpl } = {}) {
  const card = scope.document.getElementById('startup-consent');
  const turnOn = scope.document.getElementById('btn-startup-on');
  const later = scope.document.getElementById('btn-startup-later');
  const homeHeading = scope.document.getElementById('home-h');
  const fixedOrigin = scope.location.origin === appOrigin;
  const standalone = scope.matchMedia('(display-mode: standalone)');
  const request = (operation, input) => startupRequest(operation, input, fetchImpl ? { fetchImpl } : undefined);
  let consent = null;
  let pending = false;
  let declinedThisPage = false;
  let reads = 0;

  function store() { return storage ?? scope.localStorage; }

  function declined() {
    if (declinedThisPage) return true;
    try {
      return store().getItem(STARTUP_CONSENT_KEY) === 'declined';
    } catch {
      return false;
    }
  }

  function render() {
    const hidden = consent === null && !pending;
    card.hidden = hidden;
    for (const control of [turnOn, later]) {
      if (pending) control.setAttribute('aria-disabled', 'true');
      else control.removeAttribute('aria-disabled');
    }
    const active = scope.document.activeElement;
    if (hidden && (active === turnOn || active === later) && homeHeading) {
      homeHeading.setAttribute('tabindex', '-1');
      homeHeading.focus({ preventScroll: true });
    }
  }

  // Shows the question only for a Disabled task with a fresh consent value. A read that a newer one has
  // overtaken is dropped, so an older answer can never put back a question already withdrawn. After an
  // attempt the card stays as it is until the state is known, so focus does not leave it and come back.
  async function read({ afterAttempt = false } = {}) {
    const turn = ++reads;
    const eligible = fixedOrigin && standalone.matches && !declined();
    const answer = eligible ? await request('state', {}) : null;
    if (afterAttempt) pending = false;
    if (turn !== reads) return;
    consent = answer?.state === 'disabled' && !declined() ? answer.consent : null;
    render();
  }

  turnOn.addEventListener('click', async (event) => {
    if (!event?.isTrusted || pending || consent === null) return;
    const offered = consent;
    // Spent here as on the host: whatever this attempt does, the value is not offered twice.
    consent = null;
    pending = true;
    reads += 1;
    render();
    const answer = await request('enable', { consent: offered });
    if (answer && SETTLED.has(answer.state)) {
      pending = false;
      render();
      return;
    }
    // Still Disabled, not answered, or the value refused: only the task's current state decides whether
    // the question comes back, with a value of its own.
    await read({ afterAttempt: true });
  });

  later.addEventListener('click', () => {
    if (pending) return;
    declinedThisPage = true;
    consent = null;
    reads += 1;
    try {
      store().setItem(STARTUP_CONSENT_KEY, 'declined');
    } catch (error) {
      // Hidden for this page either way; an unsaved answer is asked again next visit, not lost.
      scope.console.error('Recap Page could not remember the automatic startup answer:', error);
    }
    render();
  });

  read();

  wired = {
    // Decision 14: after Not now, the question comes back only when the reader uses Reconnect.
    askAgain() {
      if (pending) return Promise.resolve();
      declinedThisPage = false;
      try {
        store().removeItem(STARTUP_CONSENT_KEY);
      } catch (error) {
        scope.console.error('Recap Page could not forget the automatic startup answer:', error);
      }
      return read();
    },
  };
  return wired;
}

// Reconnect lives in main.js, which never sees the card's wiring, so it asks through here. Before the
// card is wired, or where wiring failed, there is nothing to ask again.
export function askStartupConsentAgain() {
  return wired ? wired.askAgain() : Promise.resolve();
}
