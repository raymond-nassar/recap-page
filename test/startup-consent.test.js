import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { STARTUP_CONSENT_KEY, wireStartupConsent } from '../src/js/lib/startupConsent.js';
import { captureCompleteBackup, RESTORE_KEYS } from '../src/js/lib/completeBackup.js';
import { KEY } from '../src/js/storage.js';
import { createEmptyState, exportBackup } from '../src/js/lib/model.js';

const ONE = 'a'.repeat(64);
const TWO = 'b'.repeat(64);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

function failingStorage() {
  return {
    getItem: () => null,
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
}

const answer = (body, status = 200) => ({ status, json: async () => body });
const state = (value, consent) => answer({ ok: true, state: value, ...(consent ? { consent } : {}) });

// Each request takes the next scripted reply. A reply may be a function, so a test can hold it back.
function host(replies) {
  const calls = [];
  const fetchImpl = async (path, init) => {
    calls.push({ path, init, body: JSON.parse(init.body) });
    const next = replies.shift();
    if (next === undefined) throw new Error(`unexpected request to ${path}`);
    return typeof next === 'function' ? next() : next;
  };
  return { calls, fetchImpl };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function setup({ replies = [], standalone = true, origin = 'http://127.0.0.1:8787', storage = memoryStorage() } = {}) {
  const clicks = new Map();
  const control = (id) => {
    const attributes = new Map();
    return {
      id,
      addEventListener: (type, fn) => clicks.set(`${id}:${type}`, fn),
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
      getAttribute: (name) => attributes.get(name) ?? null,
      focus() { scope.document.activeElement = this; },
    };
  };
  const card = { hidden: true };
  const turnOn = control('btn-startup-on');
  const later = control('btn-startup-later');
  const homeHeading = control('home-h');
  const nodes = { 'startup-consent': card, 'btn-startup-on': turnOn, 'btn-startup-later': later, 'home-h': homeHeading };
  const errors = [];
  const scope = {
    document: { getElementById: (id) => nodes[id], activeElement: { id: 'body' } },
    location: { origin },
    matchMedia: () => ({ matches: standalone }),
    console: { error: (...args) => errors.push(args) },
  };
  const fake = host(replies);
  const consent = wireStartupConsent({ scope, storage, fetchImpl: fake.fetchImpl });
  await settle();
  const press = async (button, trusted = true) => {
    scope.document.activeElement = button;
    const done = clicks.get(`${button.id}:click`)({ isTrusted: trusted });
    // An ignored click must not be awaited: if it were wrongly honored, its request may never answer.
    if (trusted) await done;
    await settle();
  };
  return { scope, card, turnOn, later, homeHeading, errors, storage, consent, press, ...fake };
}

test('the question shows only in the app window at the fixed origin, for a task that is off', async () => {
  const shown = await setup({ replies: [state('disabled', ONE)] });
  assert.equal(shown.card.hidden, false);
  assert.deepEqual(shown.calls.map((call) => call.path), ['/__recap_startup__/v1/state']);

  for (const options of [{ standalone: false }, { origin: 'http://localhost:8787' }]) {
    const t = await setup(options);
    assert.equal(t.card.hidden, true);
    assert.equal(t.calls.length, 0, 'an ineligible page never asks the host');
  }

  for (const reply of [
    state('enabled'), state('disabledByUser'), state('disabledByPolicy'), state('enabledByPolicy'), state('unavailable'),
    state('disabled'), state('disabled', 'not-a-consent-value'), answer({ ok: false, code: 'unavailable' }, 503),
    answer({ ok: false, code: 'not-found' }, 404), () => { throw new TypeError('Failed to fetch'); },
    { status: 200, json: async () => { throw new SyntaxError('not JSON'); } },
  ]) {
    const t = await setup({ replies: [reply] });
    assert.equal(t.card.hidden, true);
  }
});

test('requests carry the host header and a JSON body, and nothing the page could not send itself', async () => {
  const t = await setup({ replies: [state('disabled', ONE), state('enabled')] });
  await t.press(t.turnOn);
  const [read, enable] = t.calls;
  for (const call of [read, enable]) {
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.credentials, 'same-origin');
    assert.deepEqual(call.init.headers, { 'content-type': 'application/json', 'x-recap-startup': '1' });
  }
  assert.deepEqual(read.body, {});
  assert.equal(enable.path, '/__recap_startup__/v1/enable');
  assert.deepEqual(enable.body, { consent: ONE });
});

test('Turn on acts only on the reader\'s own click, once, and hides the question when the task settles', async () => {
  for (const settled of ['enabled', 'enabledByPolicy', 'disabledByUser', 'disabledByPolicy']) {
    const hold = deferred();
    const t = await setup({ replies: [state('disabled', ONE), () => hold.promise] });
    await t.press(t.turnOn, false);
    assert.equal(t.calls.length, 1, 'a scripted click is not consent');

    t.scope.document.activeElement = t.turnOn;
    const first = (async () => t.press(t.turnOn))();
    await settle();
    assert.equal(t.turnOn.getAttribute('aria-disabled'), 'true');
    assert.equal(t.later.getAttribute('aria-disabled'), 'true');
    assert.equal(t.card.hidden, false, 'the card stays put while the answer is pending');
    await t.press(t.turnOn);
    await t.press(t.later);
    assert.equal(t.calls.length, 2, 'a second press while pending sends nothing');
    assert.equal(t.storage.getItem(STARTUP_CONSENT_KEY), null, 'Not now waits while Turn on is pending');

    hold.resolve(state(settled));
    await first;
    assert.equal(t.card.hidden, true, settled);
    assert.equal(t.turnOn.getAttribute('aria-disabled'), null);
    assert.equal(t.scope.document.activeElement, t.homeHeading);
    assert.equal(t.homeHeading.getAttribute('tabindex'), '-1');
  }
});

test('an attempt that does not turn the task on asks again only if the task is still off, with a new value', async () => {
  const refused = await setup({ replies: [state('disabled', ONE), answer({ ok: false, code: 'consent' }, 403), state('disabled', TWO), state('enabled')] });
  await refused.press(refused.turnOn);
  assert.equal(refused.card.hidden, false);
  assert.equal(refused.scope.document.activeElement, refused.turnOn, 'focus stays on the question it was on');
  assert.deepEqual(refused.calls.map((call) => call.path.split('/').pop()), ['state', 'enable', 'state']);
  await refused.press(refused.turnOn);
  assert.deepEqual(refused.calls[3].body, { consent: TWO }, 'a spent value is never offered again');
  assert.equal(refused.card.hidden, true);

  for (const [attempt, reread] of [
    [state('disabled'), state('disabledByUser')],
    [state('unavailable'), state('enabled')],
    [() => { throw new TypeError('Failed to fetch'); }, answer({ ok: false }, 503)],
  ]) {
    const t = await setup({ replies: [state('disabled', ONE), attempt, reread] });
    await t.press(t.turnOn);
    assert.equal(t.card.hidden, true);
    assert.equal(t.calls.length, 3);
    assert.equal(t.scope.document.activeElement, t.homeHeading);
  }
});

test('Not now is remembered on this device, and a remembered answer never reads the task', async () => {
  const t = await setup({ replies: [state('disabled', ONE)] });
  await t.press(t.later);
  assert.equal(t.card.hidden, true);
  assert.equal(t.storage.getItem(STARTUP_CONSENT_KEY), 'declined');
  assert.equal(t.scope.document.activeElement, t.homeHeading);
  assert.equal(t.calls.length, 1, 'declining sends nothing to the host');

  const next = await setup({ storage: t.storage });
  assert.equal(next.card.hidden, true);
  assert.equal(next.calls.length, 0);
});

test('an answer that cannot be saved hides the question for this page only', async () => {
  const t = await setup({ replies: [state('disabled', ONE)], storage: failingStorage() });
  await t.press(t.later);
  assert.equal(t.card.hidden, true);
  assert.equal(t.errors.length, 1);
  const next = await setup({ replies: [state('disabled', TWO)], storage: failingStorage() });
  assert.equal(next.card.hidden, false);
});

test('asking again forgets Not now and shows the question only if the task is still off', async () => {
  const t = await setup({ replies: [state('disabled', ONE), state('disabled', TWO)] });
  await t.press(t.later);
  await t.consent.askAgain();
  assert.equal(t.storage.getItem(STARTUP_CONSENT_KEY), null);
  assert.equal(t.card.hidden, false);
  assert.equal(t.calls.length, 2);

  const off = await setup({ replies: [state('disabled', ONE), state('disabledByUser')] });
  await off.press(off.later);
  await off.consent.askAgain();
  assert.equal(off.card.hidden, true);
});

test('only the newest read decides, so an overtaken answer never puts the question back', async () => {
  const slow = deferred();
  const t = await setup({ replies: [() => slow.promise, state('enabled')] });
  await t.consent.askAgain();
  slow.resolve(state('disabled', ONE));
  await settle();
  assert.equal(t.card.hidden, true);

  const hold = deferred();
  const later = await setup({ replies: [state('disabled', ONE), () => hold.promise] });
  const asking = later.consent.askAgain();
  await later.press(later.later);
  hold.resolve(state('disabled', TWO));
  await asking;
  await settle();
  assert.equal(later.card.hidden, true, 'Not now during a read is not undone by that read');
  assert.equal(later.storage.getItem(STARTUP_CONSENT_KEY), 'declined');
});

test('the startup answer stays on this device: backups neither capture nor restore it', async () => {
  const storage = memoryStorage();
  storage.setItem(KEY, JSON.stringify(exportBackup(createEmptyState())));
  storage.setItem(STARTUP_CONSENT_KEY, 'declined');
  const capture = await captureCompleteBackup({ storage, cryptoProvider: webcrypto });
  assert.equal(capture.text.includes(STARTUP_CONSENT_KEY), false);
  assert.equal(RESTORE_KEYS.includes(STARTUP_CONSENT_KEY), false);
});
