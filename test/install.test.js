import test from 'node:test';
import assert from 'node:assert/strict';
import { wireInstallation } from '../src/js/lib/install.js';

function setup({ standalone = false, ios = false, origin = 'http://127.0.0.1:8787' } = {}) {
  const listeners = new Map();
  const mediaListeners = new Map();
  const clicks = new Map();
  const card = { hidden: true };
  const attributes = new Map();
  const button = {
    disabled: false, textContent: '',
    addEventListener: (type, fn) => clicks.set(type, fn),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name) ?? null,
  };
  const next = { focus() { scope.document.activeElement = next; } };
  const nodes = { 'pwa-install': card, 'btn-install': button, 'btn-check-local-connection': next };
  const messages = [];
  const errors = [];
  const media = { matches: standalone, addEventListener: (type, fn) => mediaListeners.set(type, fn) };
  const scope = {
    document: { getElementById: (id) => nodes[id], activeElement: button, body: { id: 'body' } },
    location: { origin },
    navigator: { standalone: ios },
    matchMedia: () => media,
    addEventListener: (type, fn) => listeners.set(type, fn),
    console: { error: (...args) => errors.push(args) },
  };
  wireInstallation({ scope, notify: (...args) => messages.push(args) });
  const emit = (type, event = {}) => listeners.get(type)(event);
  const prompt = (overrides = {}) => {
    const event = {
      prevented: false, calls: 0,
      preventDefault() { this.prevented = true; },
      prompt() { this.calls += 1; return Promise.resolve(); },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
      ...overrides,
    };
    emit('beforeinstallprompt', event);
    return event;
  };
  return { scope, card, button, next, messages, errors, media, mediaListeners, emit, prompt, click: () => clicks.get('click')() };
}

test('installation is hidden until a usable browser offer, and hidden in standalone modes', () => {
  for (const options of [{}, { standalone: true }, { ios: true }]) {
    const t = setup(options);
    assert.equal(t.card.hidden, true);
    t.emit('beforeinstallprompt', {});
    assert.equal(t.card.hidden, true);
    const offer = t.prompt();
    assert.equal(t.card.hidden, Boolean(options.standalone || options.ios));
    assert.equal(offer.prevented, !options.standalone && !options.ios);
  }
});

test('click prompts synchronously once; cancel consumes the offer and moves focus outside it', async () => {
  const t = setup();
  const offer = t.prompt();
  t.scope.document.activeElement = t.button;
  const pending = t.click();
  assert.equal(offer.calls, 1);
  // Natively enabled, so Edge keeps focus on it while its own dialog spans rendered frames.
  assert.equal(t.button.disabled, false);
  assert.equal(t.button.getAttribute('aria-disabled'), 'true');
  assert.equal(t.card.hidden, false);
  await t.click();
  await pending;
  assert.equal(offer.calls, 1);
  assert.equal(t.card.hidden, true);
  assert.equal(t.scope.document.activeElement, t.next);
  assert.equal(t.messages[0][0], '#pwa-install-report');
  assert.match(t.messages[0][1], /canceled/);
  const retry = t.prompt();
  await t.click();
  assert.equal(retry.calls, 1);
});

test('prompt failure is reported and cannot reuse a spent event', async () => {
  for (const prompt of [
    () => { throw new Error('refused'); },
    () => Promise.reject(new Error('refused')),
  ]) {
    const t = setup();
    t.prompt({ prompt });
    await t.click();
    assert.equal(t.card.hidden, true);
    assert.equal(t.button.disabled, false);
    assert.equal(t.button.getAttribute('aria-disabled'), null);
    assert.equal(t.errors.length, 1);
    assert.equal(t.messages[0][0], '#pwa-install-report');
    assert.equal(t.messages[0][2], 'error');
    await t.click();
    assert.equal(t.errors.length, 1);
  }
});

test('installation or display-mode change withdraws even a pending offer without cancel feedback', async () => {
  for (const transition of ['appinstalled', 'standalone']) {
    const t = setup();
    let finish;
    t.prompt({ userChoice: new Promise((resolve) => { finish = resolve; }) });
    const pending = t.click();
    if (transition === 'appinstalled') t.emit('appinstalled');
    else {
      t.media.matches = true;
      t.mediaListeners.get('change')();
    }
    assert.equal(t.card.hidden, true);
    finish({ outcome: 'dismissed' });
    await pending;
    t.prompt();
    assert.equal(t.card.hidden, true);
    assert.equal(t.messages.length, 0);
  }
});

test('accepted prompt does not claim installation success before appinstalled', async () => {
  const t = setup();
  t.prompt({ userChoice: Promise.resolve({ outcome: 'accepted' }) });
  await t.click();
  assert.equal(t.card.hidden, true);
  assert.equal(t.messages.length, 0);
});

test('focus that fell back to the page while the browser prompt was open returns to Check connection', async () => {
  for (const outcome of ['dismissed', 'refused']) {
    const t = setup();
    let finish;
    const settled = new Promise((resolve) => { finish = resolve; });
    t.prompt(outcome === 'refused'
      ? { prompt: () => settled.then(() => { throw new Error('refused'); }) }
      : { userChoice: settled.then(() => ({ outcome })) });
    t.scope.document.activeElement = t.button;
    const pending = t.click();
    t.scope.document.activeElement = t.scope.document.body;
    finish();
    await pending;
    assert.equal(t.scope.document.activeElement, t.next, outcome);
  }
});

test('focus the reader moved elsewhere while the prompt was open is left alone', async () => {
  const t = setup();
  let finish;
  t.prompt({ userChoice: new Promise((resolve) => { finish = resolve; }) });
  const pending = t.click();
  const elsewhere = { id: 'elsewhere' };
  t.scope.document.activeElement = elsewhere;
  finish({ outcome: 'dismissed' });
  await pending;
  assert.equal(t.scope.document.activeElement, elsewhere);
});

test('installation is offered only on the fixed origin that owns saved progress', () => {
  for (const [origin, offered] of [
    ['http://127.0.0.1:8787', true],
    ['http://127.0.0.1:8788', false],
    ['http://localhost:8787', false],
  ]) {
    const t = setup({ origin });
    const offer = t.prompt();
    assert.equal(t.card.hidden, !offered, origin);
    assert.equal(offer.prevented, offered, origin);
  }
});
