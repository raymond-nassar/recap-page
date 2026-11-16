import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { APP_WINDOW_INVITATION_KEY, appWindowBrowser, wireInstallation } from '../src/js/lib/install.js';
import { captureCompleteBackup, RESTORE_KEYS } from '../src/js/lib/completeBackup.js';
import { KEY } from '../src/js/storage.js';
import { createEmptyState, exportBackup } from '../src/js/lib/model.js';

const EDGE = { platform: 'Windows', brands: [{ brand: 'Not.A/Brand', version: '99' }, { brand: 'Microsoft Edge', version: '142' }, { brand: 'Chromium', version: '142' }] };
const CHROME = { platform: 'Windows', brands: [{ brand: 'Google Chrome', version: '142' }, { brand: 'Chromium', version: '142' }] };
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0';

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

function setup({ standalone = false, ios = false, origin = 'http://127.0.0.1:8787', userAgentData, userAgent = '', storage, scopeStorage } = {}) {
  const listeners = new Map();
  const mediaListeners = new Map();
  const clicks = new Map();
  const card = { hidden: true };
  const control = (id) => {
    const attributes = new Map();
    return {
      id, disabled: false, textContent: '',
      addEventListener: (type, fn) => clicks.set(`${id}:${type}`, fn),
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
      getAttribute: (name) => attributes.get(name) ?? null,
      focus() { scope.document.activeElement = this; },
    };
  };
  const button = control('btn-install');
  const next = { focus() { scope.document.activeElement = next; } };
  const report = { textContent: '', replaceChildren() { this.textContent = ''; } };
  const invitation = { hidden: true };
  const notice = { hidden: true };
  const inviteButton = control('btn-invitation-install');
  const laterButton = control('btn-invitation-later');
  const noticeDismiss = control('app-window-notice-dismiss');
  const homeHeading = control('home-h');
  const nodes = {
    'pwa-install': card, 'btn-install': button, 'btn-check-local-connection': next, 'pwa-install-report': report,
    'app-window-invitation': invitation, 'btn-invitation-install': inviteButton, 'btn-invitation-later': laterButton,
    'app-window-notice': notice, 'app-window-notice-dismiss': noticeDismiss, 'home-h': homeHeading,
  };
  const messages = [];
  const errors = [];
  const media = { matches: standalone, addEventListener: (type, fn) => mediaListeners.set(type, fn) };
  const scope = {
    document: { getElementById: (id) => nodes[id], activeElement: button, body: { id: 'body' } },
    location: { origin },
    navigator: { standalone: ios, userAgentData, userAgent },
    matchMedia: () => media,
    addEventListener: (type, fn) => listeners.set(type, fn),
    console: { error: (...args) => errors.push(args) },
  };
  Object.defineProperty(scope, 'localStorage', {
    get() {
      if (scopeStorage === 'blocked') throw new Error('SecurityError: site data is blocked');
      return scopeStorage;
    },
  });
  wireInstallation({ scope, storage, notify: (...args) => { messages.push(args); report.textContent = args[1]; } });
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
  return {
    scope, card, button, next, report, messages, errors, media, mediaListeners, emit, prompt,
    invitation, notice, inviteButton, laterButton, noticeDismiss, homeHeading,
    click: () => clicks.get('btn-install:click')(),
    press: (control) => {
      scope.document.activeElement = control;
      return clicks.get(`${control.id}:click`)();
    },
  };
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

test('installation feedback is retired when a new attempt starts', async () => {
  const t = setup();
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  t.prompt({ userChoice: waiting });
  // The previous attempt can settle after Chromium has already supplied another offer.
  t.report.textContent = 'Installation canceled.';
  const pending = t.click();
  assert.equal(t.report.textContent, '');
  finish({ outcome: 'accepted' });
  await pending;
});

test('a fresh offer immediately after cancellation preserves the outcome', async () => {
  const t = setup();
  t.prompt();
  await t.click();
  const outcome = t.report.textContent;
  assert.match(outcome, /canceled/);
  t.prompt();
  assert.equal(t.card.hidden, false);
  assert.equal(t.report.textContent, outcome);
});

for (const transition of ['appinstalled', 'standalone']) {
  test(`installation feedback is retired on ${transition}`, async () => {
    for (const failed of [false, true]) {
      const t = setup();
      t.prompt(failed ? { prompt() { throw new Error('refused'); } } : {});
      await t.click();
      assert.match(t.report.textContent, failed ? /could not/ : /canceled/);
      if (transition === 'appinstalled') t.emit('appinstalled');
      else {
        t.media.matches = true;
        t.mediaListeners.get('change')();
      }
      assert.equal(t.report.textContent, '');
    }
  });
}

test('only Edge and Chrome on Windows are invited, and only Windows browsers that name themselves otherwise are told why not', () => {
  const OPERA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 OPR/125.0.0.0';
  for (const [navigator, kind] of [
    [{ userAgentData: EDGE }, 'installable'],
    [{ userAgentData: CHROME }, 'installable'],
    [{ userAgentData: { ...EDGE, platform: 'macOS' } }, 'other'],
    [{ userAgentData: { platform: 'Windows', brands: [{ brand: 'Brave', version: '142' }, { brand: 'Chromium', version: '142' }] } }, 'unsupported'],
    [{ userAgentData: { platform: 'Windows', brands: [{ brand: 'Chromium', version: '142' }] }, brave: {} }, 'unsupported'],
    [{ userAgentData: { platform: 'macOS', brands: [{ brand: 'Brave', version: '142' }] }, brave: {} }, 'other'],
    [{ userAgentData: { platform: 'Windows', brands: [{ brand: 'Opera', version: '125' }, { brand: 'Chromium', version: '142' }] } }, 'unsupported'],
    [{ userAgentData: { platform: 'Windows', brands: [{ brand: 'Opera GX', version: '125' }, { brand: 'Chromium', version: '142' }] } }, 'unsupported'],
    // An Opera that borrows Chrome's brand is still Opera by its user agent, and is never invited.
    [{ userAgentData: CHROME, userAgent: OPERA }, 'unsupported'],
    [{ userAgent: OPERA }, 'unsupported'],
    // A Chromium that names nothing, Brave hiding its brand included, proves nothing either way.
    [{ userAgentData: { platform: 'Windows', brands: [{ brand: 'Chromium', version: '142' }] } }, 'other'],
    [{ userAgentData: { platform: 'Windows', brands: [{ brand: 'Chromium', version: '142' }] }, brave: null }, 'other'],
    [{ userAgent: FIREFOX }, 'unsupported'],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.1; rv:145.0) Gecko/20100101 Firefox/145.0' }, 'other'],
    [{}, 'other'],
    [undefined, 'other'],
  ]) {
    assert.equal(appWindowBrowser(navigator), kind, JSON.stringify(navigator));
  }
});

test('the Home invitation appears with a usable offer in Edge or Chrome on the fixed origin only', () => {
  for (const [options, shown] of [
    [{ userAgentData: EDGE }, true],
    [{ userAgentData: CHROME }, true],
    [{ userAgentData: EDGE, origin: 'http://localhost:8787' }, false],
    [{ userAgentData: EDGE, standalone: true }, false],
    [{ userAgent: FIREFOX }, false],
    [{}, false],
  ]) {
    const t = setup({ storage: memoryStorage(), ...options });
    assert.equal(t.invitation.hidden, true, 'hidden before any offer');
    t.prompt();
    assert.equal(t.invitation.hidden, !shown, JSON.stringify(options));
  }
});

test('Not now hides the invitation for good and returns focus to the Home heading', () => {
  const storage = memoryStorage();
  const t = setup({ storage, userAgentData: EDGE });
  t.prompt();
  t.press(t.laterButton);
  assert.equal(t.invitation.hidden, true);
  assert.equal(storage.getItem(APP_WINDOW_INVITATION_KEY), 'dismissed');
  assert.equal(t.scope.document.activeElement, t.homeHeading);
  assert.equal(t.homeHeading.getAttribute('tabindex'), '-1');
  // Settings still offers installation after the Home invitation is declined.
  assert.equal(t.card.hidden, false);
  const later = setup({ storage, userAgentData: EDGE });
  later.prompt();
  assert.equal(later.invitation.hidden, true);
  assert.equal(later.card.hidden, false);
});

test('an invitation that was ignored rather than answered is offered again next visit', () => {
  const storage = memoryStorage();
  setup({ storage, userAgentData: EDGE }).prompt();
  const t = setup({ storage, userAgentData: EDGE });
  t.prompt();
  assert.equal(t.invitation.hidden, false);
});

test('canceling the browser dialog from either control is an answer; a refused prompt is not', async () => {
  for (const from of ['invitation', 'settings']) {
    for (const refused of [false, true]) {
      const storage = memoryStorage();
      const t = setup({ storage, userAgentData: EDGE });
      t.prompt(refused ? { prompt() { throw new Error('refused'); } } : {});
      await t.press(from === 'invitation' ? t.inviteButton : t.button);
      const label = `${from} ${refused ? 'refused' : 'canceled'}`;
      assert.equal(storage.getItem(APP_WINDOW_INVITATION_KEY), refused ? null : 'dismissed', label);
      t.prompt();
      assert.equal(t.invitation.hidden, !refused, label);
      assert.equal(t.messages[0][0], from === 'invitation' ? '#app-report' : '#pwa-install-report', label);
    }
  }
});

test('the invitation prompts once on its own click and returns focus to the Home heading', async () => {
  const t = setup({ storage: memoryStorage(), userAgentData: EDGE });
  let finish;
  const offer = t.prompt({ userChoice: new Promise((resolve) => { finish = resolve; }) });
  const pending = t.press(t.inviteButton);
  assert.equal(offer.calls, 1);
  assert.equal(t.inviteButton.getAttribute('aria-disabled'), 'true');
  assert.equal(t.button.getAttribute('aria-disabled'), 'true');
  // Not now is ignored while the browser's own dialog is open.
  t.press(t.laterButton);
  assert.equal(t.invitation.hidden, false);
  await t.press(t.inviteButton);
  assert.equal(offer.calls, 1);
  t.scope.document.activeElement = t.scope.document.body;
  finish({ outcome: 'dismissed' });
  await pending;
  assert.equal(t.invitation.hidden, true);
  assert.equal(t.scope.document.activeElement, t.homeHeading);
  assert.match(t.messages[0][1], /canceled/);
});

test('installing from either control withdraws the invitation without remembering a refusal', async () => {
  for (const control of ['inviteButton', 'button']) {
    const storage = memoryStorage();
    const t = setup({ storage, userAgentData: CHROME });
    t.prompt({ userChoice: Promise.resolve({ outcome: 'accepted' }) });
    const pending = t.press(t[control]);
    t.emit('appinstalled');
    await pending;
    assert.equal(t.invitation.hidden, true, control);
    assert.equal(storage.getItem(APP_WINDOW_INVITATION_KEY), null, control);
    assert.equal(t.messages.length, 0, control);
  }
});

test('Firefox on Windows sees the app window notice until it is dismissed', () => {
  const storage = memoryStorage();
  const t = setup({ storage, userAgent: FIREFOX });
  assert.equal(t.notice.hidden, false);
  assert.equal(t.invitation.hidden, true);
  t.press(t.noticeDismiss);
  assert.equal(t.notice.hidden, true);
  assert.equal(t.scope.document.activeElement, t.homeHeading);
  assert.equal(setup({ storage, userAgent: FIREFOX }).notice.hidden, true);
  for (const options of [{ userAgentData: EDGE }, {}, { userAgent: FIREFOX, origin: 'http://127.0.0.1:8788' }]) {
    assert.equal(setup({ storage: memoryStorage(), ...options }).notice.hidden, true, JSON.stringify(options));
  }
});

test('an answer that cannot be saved hides the invitation for this page and is asked again next visit', () => {
  for (const scopeStorage of ['blocked', { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } }]) {
    const t = setup({ scopeStorage, userAgentData: EDGE });
    t.prompt();
    assert.equal(t.invitation.hidden, false);
    t.press(t.laterButton);
    assert.equal(t.invitation.hidden, true);
    assert.equal(t.errors.length, 1);
    t.prompt();
    assert.equal(t.invitation.hidden, true);
    const next = setup({ scopeStorage, userAgentData: EDGE });
    next.prompt();
    assert.equal(next.invitation.hidden, false);
  }
});

test('the app window answer stays with this browser: backups neither capture nor restore it', async () => {
  const storage = memoryStorage();
  storage.setItem(KEY, JSON.stringify(exportBackup(createEmptyState())));
  storage.setItem(APP_WINDOW_INVITATION_KEY, 'dismissed');
  const capture = await captureCompleteBackup({ storage, cryptoProvider: webcrypto });
  assert.equal(capture.text.includes(APP_WINDOW_INVITATION_KEY), false);
  assert.equal(RESTORE_KEYS.includes(APP_WINDOW_INVITATION_KEY), false);
});
